import os
import json
import asyncio
import traceback
from datetime import datetime, date, timedelta
from typing import Optional, List, Dict, Any, Union
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, BackgroundTasks, UploadFile, File, Form, Response, Query, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload, selectinload
from sqlalchemy import func, text, or_, and_, desc, asc

import models
import schemas
from database import SessionLocal
import excel_exporter
import m365_integration
import google_sheets_integration
import telegram_service

from routers.common import (
    get_db,
    _get_norm_cached,
    get_product_finished_weight_kg,
    get_last_produced_weight_kg,
    get_shift_plan,
    check_admin_session,
    sync_lfm_to_plan_board,
    sync_sharepoint_report_bg,
    sync_google_sheets_bg,
    sync_receipts_bg,
)


router = APIRouter(tags=["shifts"])

# --- УПРАВЛЕНИЕ СМЕНОЙ ---
@router.post("/api/shifts/")
def create_shift(shift: schemas.ShiftCreate, request: Request, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role")
    if user_role not in ["master", "admin"]:
        raise HTTPException(status_code=403, detail="Доступ запрещен. Только мастер смены или администратор могут открывать смены.")
        
    active = db.query(models.Shift).filter(models.Shift.status == "active").first()
    if active:
        if user_role != "admin" and active.master_id != user_id:
            master_name = active.master.name if active.master else "другим мастером"
            raise HTTPException(status_code=403, detail=f"Уже есть активная смена, открытая мастером {master_name}. Вы не можете начать новую смену.")
        
    db_shift = models.Shift(**shift.model_dump())
    db.add(db_shift)
    db.commit()
    db.refresh(db_shift)
    return db_shift

@router.get("/api/shifts/active")
def get_active_shifts(db: Session = Depends(get_db)):
    try:
        return db.query(models.Shift).filter(models.Shift.status == "active").all()
    except Exception as e:
        import traceback
        print(f"Error in get_active_shifts: {str(e)}\n{traceback.format_exc()}")
        return []

@router.get("/api/shifts/all", response_model=list[schemas.Shift])
def get_all_shifts(db: Session = Depends(get_db)):
    try:
        shifts = db.query(models.Shift).options(
            selectinload(models.Shift.master),
            selectinload(models.Shift.receipts),
            selectinload(models.Shift.batches),
            selectinload(models.Shift.lfm_reports),
            selectinload(models.Shift.downtimes)
        ).order_by(models.Shift.date.desc(), models.Shift.line.asc(), models.Shift.shift_name.desc(), models.Shift.batch_number.desc(), models.Shift.id.desc()).all()
        
        result = []
        for shift in shifts:
            try:
                lfm_sheets = sum((r.lfm_sheets or 0) for r in shift.lfm_reports) if shift.lfm_reports else 0
                warehouse_gp = sum((b.ds_condition or 0) for b in shift.batches) if shift.batches else 0
                plan_sheets = shift.plan_sheets or 0
                zo_batches = shift.zo_batches or 0
                
                if plan_sheets == 0 and lfm_sheets == 0 and warehouse_gp == 0 and zo_batches == 0 and not shift.zo_submitted:
                    continue
                schemas.Shift.from_orm(shift)
                result.append(shift)
            except Exception as item_err:
                print(f"Warning: skipping shift ID {shift.id} in get_all_shifts due to validation error: {item_err}")
                continue
        return result
    except Exception as e:
        import traceback
        print(f"Error in get_all_shifts: {str(e)}\n{traceback.format_exc()}")
        return []

@router.get("/api/shifts/by_params")
def get_shift_by_params(date: str, shift_name: str, line: str, request: Request, product_name: Optional[str] = None, batch_number: Optional[str] = None, export_type: Optional[str] = None, master_id: Optional[int] = None, create_if_not_exists: bool = False, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role")
    if not user_id:
        raise HTTPException(status_code=401, detail="Не авторизован")
    if user_role not in ["master", "admin", "director", "technologist"]:
        raise HTTPException(status_code=403, detail="Доступ запрещен")
        
    try:
        if hasattr(date, "strftime"):
            parsed_date = date.date() if hasattr(date, "date") else date
        else:
            parsed_date = datetime.strptime(str(date), "%Y-%m-%d").date()
    except Exception:
        raise HTTPException(400, "Неверный формат даты. Ожидается YYYY-MM-DD")
        
    query = db.query(models.Shift).filter(
        models.Shift.date == parsed_date,
        models.Shift.shift_name == shift_name,
        models.Shift.line == line
    )
    if product_name:
        query = query.filter(models.Shift.product_name == product_name)
    if batch_number:
        query = query.filter(models.Shift.batch_number == batch_number)
    if export_type:
        query = query.filter(models.Shift.export_type == export_type)
    shift = query.first()
    
    if not shift:
        if not create_if_not_exists:
            raise HTTPException(status_code=404, detail="Смена не найдена")
            
        # Автоматически создаем закрытую смену с переданным master_id, либо текущего пользователя, либо первого мастера в БД
        final_master_id = master_id if master_id else user_id
        if not final_master_id or user_role not in ["master"]:
            if not final_master_id:
                first_master = db.query(models.Master).filter(models.Master.role == "master").first()
                if first_master:
                    final_master_id = first_master.id
                else:
                    final_master_id = user_id
                    
        shift = models.Shift(
            date=parsed_date,
            shift_name=shift_name,
            line=line,
            master_id=final_master_id,
            product_name=product_name or "",
            batch_number=batch_number or "",
            export_type=export_type or "Эталон",
            status="closed",
            plan_sheets=0,
            plan_tons=0.0,
            created_at=datetime.utcnow()
        )
        db.add(shift)
        db.commit()
        db.refresh(shift)
        
    return shift

@router.get("/api/shifts/crew_plan_fulfillment")
def get_crew_plan_fulfillment(month: Optional[str] = None, db: Session = Depends(get_db)):
    """
    Возвращает аналитическую сводку выполнения сменного плана бригадами (Смена 1..4)
    за выбранный месяц (YYYY-MM).
    Критерии плана по формовке ЛФМ:
    - Дневная смена: >= 2700 листов
    - Ночная смена: >= 3300 листов
    """
    try:
        from collections import defaultdict
        import calendar

        # Определение года и месяца
        if not month:
            from datetime import timezone
            tz_kz = timezone(timedelta(hours=5))
            month = datetime.now(tz_kz).strftime("%Y-%m")
            
        y_str, m_str = month.split("-")
        year = int(y_str)
        month_num = int(m_str)
        days_in_month = calendar.monthrange(year, month_num)[1]
        
        start_date = f"{year:04d}-{month_num:02d}-01"
        end_date = f"{year:04d}-{month_num:02d}-{days_in_month:02d}"

        # 1. Извлекаем рапорты за месяц
        shifts = db.query(models.Shift).filter(
            models.Shift.date >= start_date,
            models.Shift.date <= end_date
        ).order_by(models.Shift.date.asc(), models.Shift.shift_name.asc(), models.Shift.batch_number.asc(), models.Shift.id.asc()).all()

        # Суммируем выработку ЛФМ по слотам (date, shift_type)
        # Учитываем переход продукции / несколько партий в смене
        slot_lfm = defaultdict(int)
        slot_prod_masters = defaultdict(set)
        slot_all_masters = defaultdict(set)
        slot_products = defaultdict(list)
        slot_batches = defaultdict(list)

        for s in shifts:
            lfm_reports = db.query(models.LFMReport).filter(models.LFMReport.shift_id == s.id).all()
            total_lfm = sum(r.lfm_sheets or 0 for r in lfm_reports)
            
            s_val = s.shift_name.strip() if s.shift_name else ""
            b = s_val.encode('utf-8')
            # Нормализация День / Ночь
            if len(b) > 1 and b[1] == 148: # 'Д'
                s_name = 'День'
            elif 'д' in s_val.lower() or 'day' in s_val.lower():
                s_name = 'День'
            else:
                s_name = 'Ночь'
                
            d_str = s.date.strftime("%Y-%m-%d") if hasattr(s.date, 'strftime') else str(s.date)
            slot_lfm[(d_str, s_name)] += total_lfm
            
            if s.master_id:
                m = db.query(models.Master).filter(models.Master.id == s.master_id).first()
                if m:
                    m_name = getattr(m, 'full_name', getattr(m, 'name', str(m.id)))
                    if total_lfm > 0:
                        slot_prod_masters[(d_str, s_name)].add(m_name)
                    slot_all_masters[(d_str, s_name)].add(m_name)
            if s.product_name:
                slot_products[(d_str, s_name)].append(s.product_name)
            if s.batch_number:
                slot_batches[(d_str, s_name)].append(s.batch_number)

        # 2. Извлекаем утвержденный график сменности
        entries = db.query(models.ShiftScheduleEntry).all()
        entry_map = {e.date_str: e for e in entries}

        days_data = []
        crew_stats = {
            1: {"name": "Смена №1", "total_shifts": 0, "met_count": 0, "day_shifts": 0, "day_met": 0, "night_shifts": 0, "night_met": 0, "total_lfm": 0},
            2: {"name": "Смена №2", "total_shifts": 0, "met_count": 0, "day_shifts": 0, "day_met": 0, "night_shifts": 0, "night_met": 0, "total_lfm": 0},
            3: {"name": "Смена №3", "total_shifts": 0, "met_count": 0, "day_shifts": 0, "day_met": 0, "night_shifts": 0, "night_met": 0, "total_lfm": 0},
            4: {"name": "Смена №4", "total_shifts": 0, "met_count": 0, "day_shifts": 0, "day_met": 0, "night_shifts": 0, "night_met": 0, "total_lfm": 0}
        }

        total_met_factory = 0
        total_shifts_factory = 0
        total_lfm_factory = 0

        for day in range(1, days_in_month + 1):
            d_date_str = f"{year:04d}-{month_num:02d}-{day:02d}"
            d_display_str = f"{day:02d}.{month_num:02d}.{year:04d}"
            
            entry = entry_map.get(d_display_str)
            dow = entry.day_of_week if entry else ""

            # Обрабатываем День и Ночь
            for s_name in ['День', 'Ночь']:
                plan = 2700 if s_name == 'День' else 3300
                fact_lfm = slot_lfm.get((d_date_str, s_name), 0)
                active_masters = slot_prod_masters.get((d_date_str, s_name)) or slot_all_masters.get((d_date_str, s_name)) or set()
                masters = ", ".join(sorted(list(active_masters)))
                products = ", ".join(list(dict.fromkeys(slot_products.get((d_date_str, s_name), []))))
                batches = ", ".join(list(dict.fromkeys(slot_batches.get((d_date_str, s_name), []))))
                
                # Определение дежурной бригады по графику
                duty_crew = ""
                crew_num = None
                if entry:
                    if s_name == 'День':
                        duty_crew = entry.day_shift_group or ""
                    else:
                        duty_crew = entry.night_shift_group or ""
                
                if duty_crew:
                    for c_idx in [1, 2, 3, 4]:
                        if str(c_idx) in duty_crew:
                            crew_num = c_idx
                            break

                is_met = fact_lfm >= plan
                diff = fact_lfm - plan

                if crew_num:
                    c_stat = crew_stats[crew_num]
                    c_stat["total_shifts"] += 1
                    c_stat["total_lfm"] += fact_lfm
                    if s_name == 'День':
                        c_stat["day_shifts"] += 1
                        if is_met: c_stat["day_met"] += 1
                    else:
                        c_stat["night_shifts"] += 1
                        if is_met: c_stat["night_met"] += 1

                    if is_met:
                        c_stat["met_count"] += 1

                total_shifts_factory += 1
                total_lfm_factory += fact_lfm
                if is_met:
                    total_met_factory += 1

                days_data.append({
                    "date": d_date_str,
                    "date_display": d_display_str,
                    "day": day,
                    "day_of_week": dow,
                    "shift_name": s_name,
                    "crew_num": crew_num,
                    "crew_name": f"Смена №{crew_num}" if crew_num else duty_crew,
                    "fact_lfm": fact_lfm,
                    "plan": plan,
                    "diff": diff,
                    "is_met": is_met,
                    "master": masters,
                    "products": products,
                    "batches": batches
                })

        # Рассчитываем проценты выполнения
        for c_idx, st in crew_stats.items():
            tot = st["total_shifts"]
            st["percent"] = round((st["met_count"] / tot * 100), 1) if tot > 0 else 0.0

        factory_percent = round((total_met_factory / total_shifts_factory * 100), 1) if total_shifts_factory > 0 else 0.0

        return {
            "status": "ok",
            "month": month,
            "days_in_month": days_in_month,
            "factory_summary": {
                "total_shifts": total_shifts_factory,
                "total_met": total_met_factory,
                "percent": factory_percent,
                "total_lfm": total_lfm_factory
            },
            "crew_stats": crew_stats,
            "days": days_data
        }
    except Exception as e:
        print(f"Error in get_crew_plan_fulfillment: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/shifts/{shift_id}")
def get_single_shift(shift_id: int, request: Request, db: Session = Depends(get_db)):
    user_role = request.session.get("user_role")
    shift = db.query(models.Shift).options(
        joinedload(models.Shift.master),
        joinedload(models.Shift.receipts),
        joinedload(models.Shift.downtimes),
        joinedload(models.Shift.lfm_reports),
        joinedload(models.Shift.batches)
    ).get(shift_id)
    if not shift: raise HTTPException(404, "Смена не найдена")
    
    # Calculate edit window
    remaining_secs = 0
    if shift.created_at:
        diff = (datetime.utcnow() - shift.created_at).total_seconds()
        remaining_secs = max(0, int(1800 - diff))
    elif user_role == "admin":
        remaining_secs = 999999
        
    shift_dict = schemas.ShiftReportResponse.model_validate(shift).model_dump() if hasattr(schemas, 'ShiftReportResponse') else {c.name: getattr(shift, c.name) for c in shift.__table__.columns}
    shift_dict["created_at"] = shift.created_at.isoformat() if shift.created_at else None
    shift_dict["remaining_edit_seconds"] = remaining_secs
    shift_dict["can_edit"] = (user_role == "admin" or remaining_secs > 0)
    if shift.master:
        shift_dict["master"] = {"id": shift.master.id, "name": shift.master.name}
    shift_dict["receipts"] = [
        {
            "id": r.id,
            "shift_id": r.shift_id,
            "master_id": r.master_id,
            "timestamp": r.timestamp.isoformat() if r.timestamp else (r.created_at.isoformat() if getattr(r, 'created_at', None) else None),
            "created_at": (r.timestamp or getattr(r, 'created_at', None)).isoformat() if (r.timestamp or getattr(r, 'created_at', None)) else None,
            "can_edit": (user_role == "admin" or ((datetime.utcnow() - (r.timestamp or getattr(r, 'created_at', datetime.utcnow()))).total_seconds() <= 1800 if (r.timestamp or getattr(r, 'created_at', None)) else True)),
            "chrysotile_4_20": r.chrysotile_4_20,
            "chrysotile_5_65": r.chrysotile_5_65,
            "chrysotile_6_40": r.chrysotile_6_40,
            "cement_silo1": r.cement_silo1,
            "cement_silo2": r.cement_silo2,
            "cement_silo3": r.cement_silo3,
            "cement_silo4": r.cement_silo4,
            "cellulose": r.cellulose,
            "crushed_slate": r.crushed_slate,
            "asbozurit": r.asbozurit,
            "asbocarton": r.asbocarton,
            "pallets": r.pallets,
            "fiberglass": r.fiberglass,
            "laprol": r.laprol
        } for r in (shift.receipts or [])
    ]
    shift_dict["downtimes"] = [
        {
            "id": d.id,
            "shift_id": d.shift_id,
            "start_time": d.start_time,
            "end_time": d.end_time,
            "duration": d.duration,
            "category": d.category,
            "department": d.department,
            "node": d.node,
            "description": d.description,
            "comment": d.comment,
            "media_urls": d.media_urls,
            "is_equipment_downtime": d.is_equipment_downtime,
            "lost_tons": d.lost_tons,
            "lost_tenge": d.lost_tenge,
            "status": d.status,
            "created_at": d.created_at.isoformat() if d.created_at else None,
            "can_edit": (user_role == "admin" or (d.created_at and (datetime.utcnow() - d.created_at).total_seconds() <= 1800) or not d.created_at)
        } for d in (shift.downtimes or [])
    ]
    return shift_dict

async def upload_sharepoint_report_retry(file_bytes: bytes, filename: str, folder: str, retries: int = 5, delay: int = 60):
    for i in range(retries):
        await asyncio.sleep(delay)
        try:
            print(f"Background task: Attempting to upload {filename} to SharePoint (attempt {i+1})...")
            m365_integration.upload_file_to_sharepoint(file_bytes, filename, folder=folder)
            print(f"Background task: Successfully uploaded {filename} to SharePoint on attempt {i+1}")
            
            db = SessionLocal()
            try:
                db.add(models.AuditLog(
                    user_name="system_background",
                    action="UPDATE",
                    target_table="shifts",
                    target_id=0,
                    details=f"Фоновая автосинхронизация: отчет {filename} успешно обновлен на SharePoint после освобождения файла."
                ))
                db.commit()
            except Exception as audit_err:
                print(f"Error logging background sync success: {audit_err}")
            finally:
                db.close()
            break
        except Exception as e:
            print(f"Background task: Attempt {i+1} failed to upload {filename}: {e}")
            delay = delay * 2

@router.put("/api/shifts/{shift_id}/close")
def close_shift(shift_id: int, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role")
    
    if not user_id:
        raise HTTPException(status_code=401, detail="Вы не авторизованы")
        
    if user_role not in ["master", "admin"]:
        raise HTTPException(status_code=403, detail="Доступ запрещен. Только мастер смены или администратор могут закрывать смены.")
        
    shift = db.query(models.Shift).get(shift_id)
    if not shift:
        raise HTTPException(404, "Смена не найдена")
        
    if user_role not in ["admin", "master"]:
        raise HTTPException(
            status_code=403,
            detail="Доступ запрещен. Только мастер смены или администратор могут закрыть её."
        )
        
    shift.status = "closed"
    db.commit()
    
    # Generate unified Excel flat report in memory and upload to SharePoint
    try:
        file_bytes = excel_exporter.generate_flat_report(db)
        filename = "Сводный_отчет_Tectum.xlsx"
        
        # Save locally to static folder as well
        local_path = os.path.join("static", "Сводный_отчет_Tectum.xlsx")
        try:
            with open(local_path, "wb") as f:
                f.write(file_bytes)
        except Exception as local_err:
            print(f"Error saving local excel file: {local_err}")
            
        web_url = m365_integration.upload_file_to_sharepoint(file_bytes, filename, folder="Reports")
        shift.sharepoint_url = web_url
        db.commit()
        
        # Log to AuditLog
        audit_detail = f"Смена {shift_id} закрыта. Сводный отчет сгенерирован и загружен в SharePoint: {web_url}"
        db.add(models.AuditLog(
            user_name=request.session.get("user_email") or f"user_{user_id}",
            action="UPDATE",
            target_table="shifts",
            target_id=shift_id,
            details=audit_detail
        ))
        db.commit()
        return {"message": "Смена закрыта"}
    except Exception as e:
        print(f"Error generating/uploading unified report Excel: {e}")
        error_msg = str(e)
        warning_text = None
        if "423" in error_msg or "Locked" in error_msg:
            warning_text = "Сводный отчет заблокирован в SharePoint (кто-то открыл его в Excel Online). Смена успешно закрыта, но облачный отчет не обновился. Запущена фоновая автосинхронизация, локальная копия сохранена на сервере."
        else:
            warning_text = f"Смена закрыта, но произошла ошибка при загрузке отчета на SharePoint: {error_msg}. Запущена фоновая автосинхронизация, локальная копия сохранена на сервере."
            
        # Queue background task to retry upload
        try:
            file_bytes = excel_exporter.generate_flat_report(db)
            background_tasks.add_task(upload_sharepoint_report_retry, file_bytes, "Сводный_отчет_Tectum.xlsx", "Reports")
        except Exception as gen_err:
            print(f"Failed to queue background sync: {gen_err}")
            
        audit_detail = f"Смена {shift_id} закрыта. Предупреждение по SharePoint: {warning_text}"
        try:
            db.add(models.AuditLog(
                user_name=request.session.get("user_email") or f"user_{user_id}",
                action="UPDATE",
                target_table="shifts",
                target_id=shift_id,
                details=audit_detail
            ))
            db.commit()
        except: pass
        return {"message": "Смена закрыта", "warning": warning_text}

@router.get("/api/shifts/{shift_id}/download_passport")
def download_shift_passport(shift_id: int, request: Request, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Вы не авторизованы")
        
    shift = db.query(models.Shift).get(shift_id)
    if not shift:
        raise HTTPException(404, "Смена не найдена")
        
    # If sharepoint_url is already available, redirect to it
    if shift.sharepoint_url:
        return RedirectResponse(url=shift.sharepoint_url)
        
    # If not available (e.g. upload failed initially or it's an old shift), generate and upload now
    try:
        file_bytes = excel_exporter.generate_flat_report(db)
        filename = "Сводный_отчет_Tectum.xlsx"
        web_url = m365_integration.upload_file_to_sharepoint(file_bytes, filename, folder="Reports")
        shift.sharepoint_url = web_url
        db.commit()
        return RedirectResponse(url=web_url)
    except Exception as e:
        print(f"SharePoint upload failed in download_passport fallback: {e}")
        # Fallback to local on-the-fly download if SharePoint is totally failing
        try:
            file_bytes = excel_exporter.generate_flat_report(db)
            from fastapi import Response
            from urllib.parse import quote
            safe_filename = quote("Сводный_отчет_Tectum.xlsx")
            return Response(
                content=file_bytes, 
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 
                headers={'Content-Disposition': f'attachment; filename="{safe_filename}"; filename*=UTF-8\'\'{safe_filename}'}
            )
        except Exception as inner_e:
            raise HTTPException(500, f"Не удалось сгенерировать сводный отчет: {str(e)} | fallback error: {str(inner_e)}")



# --- ПРИХОД И ЗО ---
class UpdateReceiptZO(BaseModel):
    chrysotile_4_20: float = 0
    chrysotile_5_65: float = 0
    chrysotile_6_40: float = 0
    cement: float = 0
    cement_silo1: float = 0
    cement_silo2: float = 0
    cement_silo3: float = 0
    cement_silo4: float = 0
    cellulose: float = 0
    crushed_slate: float = 0
    asbozurit: float = 0
    fiberglass: float = 0
    laprol: float = 0
    asbocarton: float = 0
    pallets: float = 0
    asb_drain: float = 0
    cem_drain: float = 0
    batches: int = 0
    submitted: bool = False

class LFMDrainsUpdate(BaseModel):
    asb_drain: float = 0
    cem_drain: float = 0

@router.post("/api/shifts/{shift_id}/receipt")
def update_receipt(shift_id: int, data: UpdateReceiptZO, request: Request, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role")
    if not user_id:
        raise HTTPException(status_code=401, detail="Вы не авторизованы")
        
    shift = db.query(models.Shift).get(shift_id)
    if not shift: raise HTTPException(404, "Смена не найдена")
    
    if False and user_role == "master" and shift.master_id != user_id:
        master_name = shift.master.name if shift.master else "другим мастером"
        raise HTTPException(status_code=403, detail=f"Вы не можете редактировать рецепт этой смены, так как она была открыта мастером {master_name}.")
        
    if user_role not in ["master", "admin", "director", "technologist"]:
        raise HTTPException(status_code=403, detail="Недостаточно прав")
        

    db.commit()
    return {"status": "ok"}

@router.post("/api/shifts/{shift_id}/zo")
def update_zo(shift_id: int, data: UpdateReceiptZO, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role")
    if not user_id:
        raise HTTPException(status_code=401, detail="Вы не авторизованы")
        
    shift = db.query(models.Shift).get(shift_id)
    if not shift: raise HTTPException(404, "Смена не найдена")
    
    if False and user_role == "master" and shift.master_id != user_id:
        master_name = shift.master.name if shift.master else "другим мастером"
        raise HTTPException(status_code=403, detail=f"Вы не можете редактировать данные ЗО этой смены, так как она была открыта мастером {master_name}.")
        
    if user_role not in ["master", "admin", "zo"]:
        raise HTTPException(status_code=403, detail="Недостаточно прав")
        
    shift.zo_chrysotile_4_20 = data.chrysotile_4_20
    shift.zo_chrysotile_5_65 = data.chrysotile_5_65
    shift.zo_chrysotile_6_40 = data.chrysotile_6_40
    
    # Сохраняем силосы
    shift.zo_cement_silo1 = data.cement_silo1
    shift.zo_cement_silo2 = data.cement_silo2
    shift.zo_cement_silo3 = data.cement_silo3
    shift.zo_cement_silo4 = data.cement_silo4
    # И суммируем в zo_cement (legacy, для расчета отклонений)
    shift.zo_cement = data.cement_silo1 + data.cement_silo2 + data.cement_silo3 + data.cement_silo4
    
    shift.zo_cellulose = data.cellulose
    shift.zo_crushed_slate = data.crushed_slate
    shift.zo_asbozurit = data.asbozurit
    shift.zo_fiberglass = data.fiberglass
    shift.zo_laprol = data.laprol
    shift.zo_asbocarton = data.asbocarton
    shift.zo_asb_drain = data.asb_drain
    shift.zo_cem_drain = data.cem_drain
    shift.zo_batches = data.batches
    shift.zo_submitted = data.submitted
    
    db.commit()
    background_tasks.add_task(sync_google_sheets_bg)
    return {"message": "ZO updated"}

@router.post("/api/shifts/{shift_id}/lfm_drains")
def update_lfm_drains(shift_id: int, data: LFMDrainsUpdate, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role")
    if not user_id:
        raise HTTPException(status_code=401, detail="Вы не авторизованы")
        
    shift = db.query(models.Shift).get(shift_id)
    if not shift: raise HTTPException(404, "Смена не найдена")
    
    if False and user_role == "master" and shift.master_id != user_id:
        master_name = shift.master.name if shift.master else "другим мастером"
        raise HTTPException(status_code=403, detail=f"Вы не можете редактировать сливы ЛФМ этой смены, так как она была открыта мастером {master_name}.")
        
    if user_role not in ["master", "admin", "lfm"]:
        raise HTTPException(status_code=403, detail="Недостаточно прав")
        
    shift.lfm_asb_drain = data.asb_drain
    shift.lfm_cem_drain = data.cem_drain
    db.commit()
    background_tasks.add_task(sync_google_sheets_bg)
    return {"message": "LFM drains updated"}

@router.post("/api/shifts/{shift_id}/raw_materials_bulk")
def update_raw_materials_bulk(shift_id: int, data: schemas.RawMaterialsBulkUpdate, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role")
    if not user_id:
        raise HTTPException(status_code=401, detail="Не авторизован")
    if user_role not in ["master", "admin", "director", "technologist"]:
        raise HTTPException(status_code=403, detail="Доступ запрещен")
        
    shift = db.query(models.Shift).get(shift_id)
    if not shift:
        raise HTTPException(404, "Смена не найдена")
        
    # Изоляция данных разных мастеров (для роли master):
    if False and user_role == "master" and shift.master_id != user_id:
        raise HTTPException(status_code=403, detail="Вы не можете редактировать смену другого мастера")
        
    # Записываем расход ЗО
    shift.zo_chrysotile_4_20 = data.zo_chrysotile_4_20
    shift.zo_chrysotile_5_65 = data.zo_chrysotile_5_65
    shift.zo_chrysotile_6_40 = data.zo_chrysotile_6_40
    shift.zo_cement_silo1 = data.zo_cement_silo1
    shift.zo_cement_silo2 = data.zo_cement_silo2
    shift.zo_cement_silo3 = data.zo_cement_silo3
    shift.zo_cement_silo4 = data.zo_cement_silo4
    
    # Суммируем в legacy zo_cement
    shift.zo_cement = (data.zo_cement_silo1 or 0) + (data.zo_cement_silo2 or 0) + (data.zo_cement_silo3 or 0) + (data.zo_cement_silo4 or 0)
    
    shift.zo_cellulose = data.zo_cellulose
    shift.zo_crushed_slate = data.zo_crushed_slate
    shift.zo_asbozurit = data.zo_asbozurit
    shift.zo_fiberglass = data.zo_fiberglass
    shift.zo_laprol = data.zo_laprol
    shift.zo_asbocarton = data.zo_asbocarton
    shift.zo_asb_drain = data.zo_asb_drain
    shift.zo_cem_drain = data.zo_cem_drain
    shift.zo_batches = data.zo_batches
    shift.zo_submitted = True
    
    db.commit()
    background_tasks.add_task(sync_google_sheets_bg)
    return {"status": "success"}



def calculate_shift_deviations(db: Session, shift: models.Shift):
    # Find LFM reports for the shift
    lfm_reports = shift.lfm_reports
    product_counts = {}
    for r in lfm_reports:
        product_counts[r.product_name] = product_counts.get(r.product_name, 0) + r.lfm_sheets
        
    theoretical = {
        "chrysotile_4_20": 0.0,
        "chrysotile_5_65": 0.0,
        "chrysotile_6_40": 0.0,
        "cement": 0.0,
        "cellulose": 0.0,
        "crushed_slate": 0.0,
        "asbozurit": 0.0,
        "fiberglass": 0.0,
        "asbocarton": 0.0,
        "laprol": 0.0
    }
    
    for prod_name, sheets in product_counts.items():
        norm = _get_norm_cached(db, prod_name)
        if norm:
            theoretical["chrysotile_4_20"] += sheets * (norm.norm_chrysotile_4_20 or 0.0)
            theoretical["chrysotile_5_65"] += sheets * (norm.norm_chrysotile_5_65 or 0.0)
            theoretical["chrysotile_6_40"] += sheets * (norm.norm_chrysotile_6_40 or 0.0)
            theoretical["cement"] += sheets * (norm.norm_cement or 0.0)
            theoretical["cellulose"] += sheets * (norm.norm_cellulose or 0.0)
            theoretical["crushed_slate"] += sheets * (norm.norm_crushed_slate or 0.0)
            theoretical["asbozurit"] += sheets * (norm.norm_asbozurit or 0.0)
            theoretical["fiberglass"] += sheets * (norm.norm_fiberglass or 0.0)
            
    actual = {
        "chrysotile_4_20": shift.zo_chrysotile_4_20 or 0.0,
        "chrysotile_5_65": shift.zo_chrysotile_5_65 or 0.0,
        "chrysotile_6_40": shift.zo_chrysotile_6_40 or 0.0,
        "cement": shift.zo_cement or 0.0,
        "cellulose": shift.zo_cellulose or 0.0,
        "crushed_slate": shift.zo_crushed_slate or 0.0,
        "asbozurit": shift.zo_asbozurit or 0.0,
        "fiberglass": shift.zo_fiberglass or 0.0,
        "asbocarton": shift.zo_asbocarton or 0.0,
        "laprol": shift.zo_laprol or 0.0
    }
    
    deviations = {}
    for mat in theoretical.keys():
        deviations[mat] = round(actual[mat] - theoretical[mat], 2)
        
    return {
        "theoretical": theoretical,
        "actual": actual,
        "deviations": deviations
    }


def save_report_internal(db: Session, shift: models.Shift, data: schemas.ShiftReportCreate, user_name: str, is_new: bool):
    # Old values logging
    old_values = {}
    if not is_new:
        old_values = {
            "master_id": shift.master_id,
            "batch_number": shift.batch_number,
            "product_name": shift.product_name,
            "zo_batches": shift.zo_batches,
            "zo_chrysotile_4_20": shift.zo_chrysotile_4_20,
            "zo_chrysotile_5_65": shift.zo_chrysotile_5_65,
            "zo_chrysotile_6_40": shift.zo_chrysotile_6_40,
            "zo_cement_silo1": shift.zo_cement_silo1,
            "zo_cement_silo2": shift.zo_cement_silo2,
            "zo_cement_silo3": shift.zo_cement_silo3,
            "zo_cement_silo4": shift.zo_cement_silo4,
            "zo_cellulose": shift.zo_cellulose,
            "zo_crushed_slate": shift.zo_crushed_slate,
            "zo_asbozurit": shift.zo_asbozurit,
            "zo_fiberglass": shift.zo_fiberglass,
            "zo_laprol": shift.zo_laprol,
            "zo_asbocarton": shift.zo_asbocarton,
            "zo_asb_drain": shift.zo_asb_drain,
            "zo_cem_drain": shift.zo_cem_drain
        }

    # Snapshot of state before update (for Rollback / Undo)
    snapshot_before = None
    if not is_new:
        try:
            b_prev = db.query(models.Batch).filter(models.Batch.shift_id == shift.id).first()
            l_prev = db.query(models.LFMReport).filter(models.LFMReport.shift_id == shift.id).first()
            snapshot_dict = {
                "shift": {
                    "master_id": shift.master_id,
                    "batch_number": shift.batch_number,
                    "product_name": shift.product_name,
                    "export_type": shift.export_type,
                    "status": shift.status,
                    "zo_batches": shift.zo_batches,
                    "zo_chrysotile_4_20_silo1": shift.zo_chrysotile_4_20_silo1,
                    "zo_chrysotile_4_20_silo2": shift.zo_chrysotile_4_20_silo2,
                    "zo_chrysotile_4_20_silo3": shift.zo_chrysotile_4_20_silo3,
                    "zo_chrysotile_4_20_silo4": shift.zo_chrysotile_4_20_silo4,
                    "zo_chrysotile_5_65_silo1": shift.zo_chrysotile_5_65_silo1,
                    "zo_chrysotile_5_65_silo2": shift.zo_chrysotile_5_65_silo2,
                    "zo_chrysotile_5_65_silo3": shift.zo_chrysotile_5_65_silo3,
                    "zo_chrysotile_5_65_silo4": shift.zo_chrysotile_5_65_silo4,
                    "zo_chrysotile_6_40_silo1": shift.zo_chrysotile_6_40_silo1,
                    "zo_chrysotile_6_40_silo2": shift.zo_chrysotile_6_40_silo2,
                    "zo_chrysotile_6_40_silo3": shift.zo_chrysotile_6_40_silo3,
                    "zo_chrysotile_6_40_silo4": shift.zo_chrysotile_6_40_silo4,
                    "zo_cement_silo1": shift.zo_cement_silo1,
                    "zo_cement_silo2": shift.zo_cement_silo2,
                    "zo_cement_silo3": shift.zo_cement_silo3,
                    "zo_cement_silo4": shift.zo_cement_silo4,
                    "zo_cellulose_silo1": shift.zo_cellulose_silo1,
                    "zo_cellulose_silo2": shift.zo_cellulose_silo2,
                    "zo_cellulose_silo3": shift.zo_cellulose_silo3,
                    "zo_cellulose_silo4": shift.zo_cellulose_silo4,
                    "zo_crushed_slate_silo1": shift.zo_crushed_slate_silo1,
                    "zo_crushed_slate_silo2": shift.zo_crushed_slate_silo2,
                    "zo_crushed_slate_silo3": shift.zo_crushed_slate_silo3,
                    "zo_crushed_slate_silo4": shift.zo_crushed_slate_silo4,
                    "zo_asbozurit_silo1": shift.zo_asbozurit_silo1,
                    "zo_asbozurit_silo2": shift.zo_asbozurit_silo2,
                    "zo_asbozurit_silo3": shift.zo_asbozurit_silo3,
                    "zo_asbozurit_silo4": shift.zo_asbozurit_silo4,
                    "zo_fiberglass_silo1": shift.zo_fiberglass_silo1,
                    "zo_fiberglass_silo2": shift.zo_fiberglass_silo2,
                    "zo_fiberglass_silo3": shift.zo_fiberglass_silo3,
                    "zo_fiberglass_silo4": shift.zo_fiberglass_silo4,
                    "zo_laprol_silo1": shift.zo_laprol_silo1,
                    "zo_laprol_silo2": shift.zo_laprol_silo2,
                    "zo_laprol_silo3": shift.zo_laprol_silo3,
                    "zo_laprol_silo4": shift.zo_laprol_silo4,
                    "zo_asbocarton_silo1": shift.zo_asbocarton_silo1,
                    "zo_asbocarton_silo2": shift.zo_asbocarton_silo2,
                    "zo_asbocarton_silo3": shift.zo_asbocarton_silo3,
                    "zo_asbocarton_silo4": shift.zo_asbocarton_silo4,
                    "zo_asb_drain": shift.zo_asb_drain,
                    "zo_cem_drain": shift.zo_cem_drain,
                    "lfm_asb_drain": getattr(shift, 'lfm_asb_drain', 0.0),
                    "lfm_cem_drain": getattr(shift, 'lfm_cem_drain', 0.0)
                },
                "lfm_report": {
                    "product_name": l_prev.product_name if l_prev else "",
                    "export_type": l_prev.export_type if l_prev else "Эталон",
                    "lfm_sheets": l_prev.lfm_sheets if l_prev else 0,
                    "lfm_wind_resets": l_prev.lfm_wind_resets if l_prev else 0,
                    "formed_1st_grade": l_prev.formed_1st_grade if l_prev else 0,
                    "formed_defect": l_prev.formed_defect if l_prev else 0,
                    "transferred_to_warehouse": l_prev.transferred_to_warehouse if l_prev else 0
                } if l_prev else None,
                "batch": {
                    "batch_number": b_prev.batch_number if b_prev else "",
                    "product_name": b_prev.product_name if b_prev else "",
                    "export_type": b_prev.export_type if b_prev else "Эталон",
                    "stacked_stacks": b_prev.stacked_stacks if b_prev else 0,
                    "ds_condition": b_prev.ds_condition if b_prev else 0,
                    "ds_first_grade": b_prev.ds_first_grade if b_prev else 0,
                    "ds_defect": b_prev.ds_defect if b_prev else 0,
                    "ds_defect_chip": b_prev.ds_defect_chip if b_prev else 0,
                    "ds_defect_scratch": b_prev.ds_defect_scratch if b_prev else 0,
                    "ds_defect_bad_cut": b_prev.ds_defect_bad_cut if b_prev else 0,
                    "ds_defect_stick_bottom": b_prev.ds_defect_stick_bottom if b_prev else 0,
                    "ds_defect_stick_top": b_prev.ds_defect_stick_top if b_prev else 0,
                    "ds_defect_broken": b_prev.ds_defect_broken if b_prev else 0,
                    "ds_defect_fell_box": b_prev.ds_defect_fell_box if b_prev else 0,
                    "ds_defect_dent": b_prev.ds_defect_dent if b_prev else 0,
                    "ds_defect_thickness": b_prev.ds_defect_thickness if b_prev else 0,
                    "ds_defect_delamination": b_prev.ds_defect_delamination if b_prev else 0,
                    "ds_defect_edge": b_prev.ds_defect_edge if b_prev else 0,
                    "prev_first_grade": b_prev.prev_first_grade if b_prev else 0,
                    "prev_defect": b_prev.prev_defect if b_prev else 0,
                    "prev_defect_scratch": b_prev.prev_defect_scratch if b_prev else 0,
                    "prev_defect_bad_cut": b_prev.prev_defect_bad_cut if b_prev else 0,
                    "prev_defect_stick_top": b_prev.prev_defect_stick_top if b_prev else 0,
                    "prev_defect_broken": b_prev.prev_defect_broken if b_prev else 0,
                    "prev_defect_fell_box": b_prev.prev_defect_fell_box if b_prev else 0,
                    "prev_defect_thickness": b_prev.prev_defect_thickness if b_prev else 0,
                    "prev_defect_edge": b_prev.prev_defect_edge if b_prev else 0,
                    "qcd_condition": b_prev.qcd_condition if b_prev else 0,
                    "qcd_first_grade": b_prev.qcd_first_grade if b_prev else 0,
                    "qcd_defect": b_prev.qcd_defect if b_prev else 0
                } if b_prev else None
            }
            import json
            snapshot_before = json.dumps(snapshot_dict, ensure_ascii=False)
        except Exception as snap_err:
            print(f"Warning: could not capture snapshot_before: {snap_err}")

    # Update Shift fields
    shift.master_id = data.master_id
    shift.batch_number = data.batch_number
    shift.product_name = data.product_name
    shift.status = "closed"
    
    # Расход сырья
    shift.zo_chrysotile_4_20_silo1 = data.zo_chrysotile_4_20_silo1
    shift.zo_chrysotile_4_20_silo2 = data.zo_chrysotile_4_20_silo2
    shift.zo_chrysotile_4_20_silo3 = data.zo_chrysotile_4_20_silo3
    shift.zo_chrysotile_4_20_silo4 = data.zo_chrysotile_4_20_silo4
    shift.zo_chrysotile_4_20 = (data.zo_chrysotile_4_20_silo1 or 0) + (data.zo_chrysotile_4_20_silo2 or 0) + (data.zo_chrysotile_4_20_silo3 or 0) + (data.zo_chrysotile_4_20_silo4 or 0)
    
    shift.zo_chrysotile_5_65_silo1 = data.zo_chrysotile_5_65_silo1
    shift.zo_chrysotile_5_65_silo2 = data.zo_chrysotile_5_65_silo2
    shift.zo_chrysotile_5_65_silo3 = data.zo_chrysotile_5_65_silo3
    shift.zo_chrysotile_5_65_silo4 = data.zo_chrysotile_5_65_silo4
    shift.zo_chrysotile_5_65 = (data.zo_chrysotile_5_65_silo1 or 0) + (data.zo_chrysotile_5_65_silo2 or 0) + (data.zo_chrysotile_5_65_silo3 or 0) + (data.zo_chrysotile_5_65_silo4 or 0)
    
    shift.zo_chrysotile_6_40_silo1 = data.zo_chrysotile_6_40_silo1
    shift.zo_chrysotile_6_40_silo2 = data.zo_chrysotile_6_40_silo2
    shift.zo_chrysotile_6_40_silo3 = data.zo_chrysotile_6_40_silo3
    shift.zo_chrysotile_6_40_silo4 = data.zo_chrysotile_6_40_silo4
    shift.zo_chrysotile_6_40 = (data.zo_chrysotile_6_40_silo1 or 0) + (data.zo_chrysotile_6_40_silo2 or 0) + (data.zo_chrysotile_6_40_silo3 or 0) + (data.zo_chrysotile_6_40_silo4 or 0)
    
    shift.zo_cement_silo1 = data.zo_cement_silo1
    shift.zo_cement_silo2 = data.zo_cement_silo2
    shift.zo_cement_silo3 = data.zo_cement_silo3
    shift.zo_cement_silo4 = data.zo_cement_silo4
    shift.zo_cement = (data.zo_cement_silo1 or 0) + (data.zo_cement_silo2 or 0) + (data.zo_cement_silo3 or 0) + (data.zo_cement_silo4 or 0)
    
    shift.zo_cellulose_silo1 = data.zo_cellulose_silo1
    shift.zo_cellulose_silo2 = data.zo_cellulose_silo2
    shift.zo_cellulose_silo3 = data.zo_cellulose_silo3
    shift.zo_cellulose_silo4 = data.zo_cellulose_silo4
    shift.zo_cellulose = (data.zo_cellulose_silo1 or 0) + (data.zo_cellulose_silo2 or 0) + (data.zo_cellulose_silo3 or 0) + (data.zo_cellulose_silo4 or 0)
    
    shift.zo_crushed_slate_silo1 = data.zo_crushed_slate_silo1
    shift.zo_crushed_slate_silo2 = data.zo_crushed_slate_silo2
    shift.zo_crushed_slate_silo3 = data.zo_crushed_slate_silo3
    shift.zo_crushed_slate_silo4 = data.zo_crushed_slate_silo4
    shift.zo_crushed_slate = (data.zo_crushed_slate_silo1 or 0) + (data.zo_crushed_slate_silo2 or 0) + (data.zo_crushed_slate_silo3 or 0) + (data.zo_crushed_slate_silo4 or 0)
    
    shift.zo_asbozurit_silo1 = data.zo_asbozurit_silo1
    shift.zo_asbozurit_silo2 = data.zo_asbozurit_silo2
    shift.zo_asbozurit_silo3 = data.zo_asbozurit_silo3
    shift.zo_asbozurit_silo4 = data.zo_asbozurit_silo4
    shift.zo_asbozurit = (data.zo_asbozurit_silo1 or 0) + (data.zo_asbozurit_silo2 or 0) + (data.zo_asbozurit_silo3 or 0) + (data.zo_asbozurit_silo4 or 0)
    
    shift.zo_fiberglass_silo1 = data.zo_fiberglass_silo1
    shift.zo_fiberglass_silo2 = data.zo_fiberglass_silo2
    shift.zo_fiberglass_silo3 = data.zo_fiberglass_silo3
    shift.zo_fiberglass_silo4 = data.zo_fiberglass_silo4
    shift.zo_fiberglass = (data.zo_fiberglass_silo1 or 0) + (data.zo_fiberglass_silo2 or 0) + (data.zo_fiberglass_silo3 or 0) + (data.zo_fiberglass_silo4 or 0)
    
    shift.zo_laprol_silo1 = data.zo_laprol_silo1
    shift.zo_laprol_silo2 = data.zo_laprol_silo2
    shift.zo_laprol_silo3 = data.zo_laprol_silo3
    shift.zo_laprol_silo4 = data.zo_laprol_silo4
    shift.zo_laprol = (data.zo_laprol_silo1 or 0) + (data.zo_laprol_silo2 or 0) + (data.zo_laprol_silo3 or 0) + (data.zo_laprol_silo4 or 0)
    
    shift.zo_asbocarton_silo1 = data.zo_asbocarton_silo1
    shift.zo_asbocarton_silo2 = data.zo_asbocarton_silo2
    shift.zo_asbocarton_silo3 = data.zo_asbocarton_silo3
    shift.zo_asbocarton_silo4 = data.zo_asbocarton_silo4
    shift.zo_asbocarton = (data.zo_asbocarton_silo1 or 0) + (data.zo_asbocarton_silo2 or 0) + (data.zo_asbocarton_silo3 or 0) + (data.zo_asbocarton_silo4 or 0)
    
    shift.zo_asb_drain = data.zo_asb_drain
    shift.zo_cem_drain = data.zo_cem_drain
    shift.zo_batches = data.zo_batches
    shift.zo_submitted = True
    if data.export_type is not None:
        shift.export_type = data.export_type or "Эталон"

    # Update LFM report
    lfm_report = db.query(models.LFMReport).filter(models.LFMReport.shift_id == shift.id).first()
    if not lfm_report:
        lfm_report = models.LFMReport(shift_id=shift.id)
        db.add(lfm_report)
    lfm_report.product_name = data.product_name
    lfm_report.export_type = data.export_type or "Эталон"
    lfm_report.lfm_sheets = data.lfm_sheets
    lfm_report.lfm_wind_resets = data.lfm_wind_resets
    lfm_report.formed_1st_grade = data.first_grade
    lfm_report.formed_defect = data.qcd_defect
    lfm_report.transferred_to_warehouse = data.warehouse_gp

    # Update Batch
    batch = db.query(models.Batch).filter(models.Batch.shift_id == shift.id).first()
    if not batch:
        batch = models.Batch(shift_id=shift.id)
        db.add(batch)
    batch.batch_number = data.batch_number
    batch.product_name = data.product_name
    batch.export_type = data.export_type or "Эталон"
    batch.status = "qcd_checked"
    batch.stacked_stacks = data.lfm_sheets
    batch.ds_condition = data.warehouse_gp
    batch.ds_first_grade = data.first_grade
    
    # Calculate defect sum
    ds_defect_sum = (
        data.ds_defect_chip + data.ds_defect_scratch + data.ds_defect_bad_cut +
        data.ds_defect_stick_bottom + data.ds_defect_stick_top + data.ds_defect_broken +
        data.ds_defect_fell_box + data.ds_defect_dent + data.ds_defect_thickness +
        data.ds_defect_delamination + data.ds_defect_edge
    )
    batch.ds_defect = ds_defect_sum
    batch.ds_defect_chip = data.ds_defect_chip
    batch.ds_defect_scratch = data.ds_defect_scratch
    batch.ds_defect_bad_cut = data.ds_defect_bad_cut
    batch.ds_defect_stick_bottom = data.ds_defect_stick_bottom
    batch.ds_defect_stick_top = data.ds_defect_stick_top
    batch.ds_defect_broken = data.ds_defect_broken
    batch.ds_defect_fell_box = data.ds_defect_fell_box
    batch.ds_defect_dent = data.ds_defect_dent
    batch.ds_defect_thickness = data.ds_defect_thickness
    batch.ds_defect_delamination = data.ds_defect_delamination
    batch.ds_defect_edge = data.ds_defect_edge

    # Previous shift defects
    prev_defect_sum = (
        (data.prev_defect_scratch or 0) + (data.prev_defect_bad_cut or 0) +
        (data.prev_defect_stick_top or 0) + (data.prev_defect_broken or 0) +
        (data.prev_defect_fell_box or 0) + (data.prev_defect_thickness or 0) +
        (data.prev_defect_edge or 0)
    )
    batch.prev_first_grade = data.prev_first_grade or 0
    batch.prev_defect = prev_defect_sum
    batch.prev_defect_scratch = data.prev_defect_scratch or 0
    batch.prev_defect_bad_cut = data.prev_defect_bad_cut or 0
    batch.prev_defect_stick_top = data.prev_defect_stick_top or 0
    batch.prev_defect_broken = data.prev_defect_broken or 0
    batch.prev_defect_fell_box = data.prev_defect_fell_box or 0
    batch.prev_defect_thickness = data.prev_defect_thickness or 0
    batch.prev_defect_edge = data.prev_defect_edge or 0

    batch.qcd_condition = data.warehouse_gp
    batch.qcd_first_grade = data.first_grade
    batch.qcd_defect = ds_defect_sum

    db.commit()

    # Export receipt data to Google Sheets (new sheet "Приход сырья")
    try:
        google_sheets_integration.export_receipt_to_google_sheets(db)
    except Exception as gs_err:
        print(f"Ошибка экспорта прихода сырья в Google Sheets: {gs_err}")

    # Sync to MonthlyPlanBoard (which also writes AuditLog)
    sync_lfm_to_plan_board(shift.date, shift.shift_name, shift.line, db, shift.master_id)

    # Write AuditLog for the shift update
    if is_new:
        db.add(models.AuditLog(
            user_name=user_name,
            action="CREATE",
            target_table="shifts",
            target_id=shift.id,
            details=f"Создан новый единый рапорт мастера для смены {shift.id} ({data.date} {data.shift_name} {data.line})"
        ))
    else:
        new_values = {
            "master_id": shift.master_id,
            "batch_number": shift.batch_number,
            "product_name": shift.product_name,
            "zo_batches": shift.zo_batches,
            "zo_chrysotile_4_20": shift.zo_chrysotile_4_20,
            "zo_chrysotile_5_65": shift.zo_chrysotile_5_65,
            "zo_chrysotile_6_40": shift.zo_chrysotile_6_40,
            "zo_cement_silo1": shift.zo_cement_silo1,
            "zo_cement_silo2": shift.zo_cement_silo2,
            "zo_cement_silo3": shift.zo_cement_silo3,
            "zo_cement_silo4": shift.zo_cement_silo4,
            "zo_cellulose": shift.zo_cellulose,
            "zo_crushed_slate": shift.zo_crushed_slate,
            "zo_asbozurit": shift.zo_asbozurit,
            "zo_fiberglass": shift.zo_fiberglass,
            "zo_laprol": shift.zo_laprol,
            "zo_asbocarton": shift.zo_asbocarton,
            "zo_asb_drain": shift.zo_asb_drain,
            "zo_cem_drain": shift.zo_cem_drain,
            "receipt_chrysotile_4_20": sum((r.chrysotile_4_20 or 0.0) for r in shift.receipts) if shift.receipts else 0.0,
            "receipt_chrysotile_5_65": sum((r.chrysotile_5_65 or 0.0) for r in shift.receipts) if shift.receipts else 0.0,
            "receipt_chrysotile_6_40": sum((r.chrysotile_6_40 or 0.0) for r in shift.receipts) if shift.receipts else 0.0,
            "receipt_cement": sum((((r.cement_silo1 or 0.0) + (r.cement_silo2 or 0.0) + (r.cement_silo3 or 0.0) + (r.cement_silo4 or 0.0))) for r in shift.receipts) if shift.receipts else 0.0,
            "receipt_cellulose": sum((r.cellulose or 0.0) for r in shift.receipts) if shift.receipts else 0.0,
            "receipt_crushed_slate": sum((r.crushed_slate or 0.0) for r in shift.receipts) if shift.receipts else 0.0,
            "receipt_asbozurit": sum((r.asbozurit or 0.0) for r in shift.receipts) if shift.receipts else 0.0,
            "receipt_asbocarton": sum((r.asbocarton or 0.0) for r in shift.receipts) if shift.receipts else 0.0,
            "receipt_pallets": sum((r.pallets or 0.0) for r in shift.receipts) if shift.receipts else 0.0,
            "receipt_fiberglass": sum((r.fiberglass or 0.0) for r in shift.receipts) if shift.receipts else 0.0,
            "receipt_laprol": sum((r.laprol or 0.0) for r in shift.receipts) if shift.receipts else 0.0
        }
        changes = []
        for k, old_v in old_values.items():
            new_v = new_values.get(k)
            if old_v != new_v:
                changes.append(f"{k}: {old_v} -> {new_v}")
        if changes or snapshot_before:
            db.add(models.AuditLog(
                user_name=user_name,
                action="UPDATE",
                target_table="shifts",
                target_id=shift.id,
                details=f"Обновлен рапорт мастера смены {shift.id}. Изменения: " + (", ".join(changes) if changes else "без критических числовых изменений"),
                state_snapshot=snapshot_before
            ))
    db.commit()

    # Проверка рапорта и отправка Telegram алерта в группу/руководству
    try:
        tg_chat_id = os.getenv("TELEGRAM_ALERT_CHAT_ID", "").strip()
        if tg_chat_id:
            import telegram_service
            warnings = []
            
            if not data.batch_number:
                warnings.append("Не заполнен номер партии")
            if not data.product_name:
                warnings.append("Не указано наименование продукции")
            if (data.lfm_sheets or 0) <= 0:
                warnings.append("Не указана выработка ЛФМ (0 листов)")
            if (shift.zo_cement or 0) <= 0:
                warnings.append("Не заполнен расход цемента (0 т)")
            if (shift.zo_chrysotile_4_20 or 0) + (shift.zo_chrysotile_5_65 or 0) + (shift.zo_chrysotile_6_40 or 0) <= 0:
                warnings.append("Не заполнен расход хризотила (все группы 0 т)")
                
            # Проверка аномального брака дестакера (> 4%)
            if data.lfm_sheets and data.lfm_sheets > 0:
                defect_pct = (ds_defect_sum / data.lfm_sheets) * 100.0
                if defect_pct > 4.0:
                    warnings.append(f"Высокий процент брака Дестакера: {defect_pct:.1f}% ({ds_defect_sum} листов)")
                    
            master_name = shift.master.name if shift.master else user_name
            tons = ((data.lfm_sheets or 0) * (get_product_finished_weight_kg(db, data.product_name) if hasattr(db, 'query') else 19.6)) / 1000.0
            
            shift_info = {
                "date": str(shift.date),
                "shift_name": shift.shift_name,
                "line": shift.line,
                "master_name": master_name,
                "sheets": data.lfm_sheets or 0,
                "tons": tons
            }
            
            # Отправляем алерт только если есть замечания (или отчет закрыт)
            if warnings:
                telegram_service.send_shift_quality_alert(tg_chat_id, shift_info, warnings, is_success=False)
    except Exception as tg_alert_err:
        print(f"Error sending Telegram shift report alert: {tg_alert_err}")


import google_sheets_integration

def sync_sharepoint_report_bg():
    db = SessionLocal()
    try:
        file_bytes = excel_exporter.generate_flat_report(db)
        filename = "Сводный_отчет_Tectum.xlsx"
        local_path = os.path.join("static", filename)
        try:
            with open(local_path, "wb") as f:
                f.write(file_bytes)
        except Exception as local_err:
            print(f"Error saving local excel: {local_err}")
            
        if os.getenv("M365_TENANT_ID"):
            try:
                m365_integration.upload_file_to_sharepoint(file_bytes, filename, folder="Reports")
            except Exception as sp_err:
                db.add(models.AuditLog(
                    user_name="System Background Sync",
                    action="ERROR",
                    target_table="shifts",
                    target_id=0,
                    details=f"Ошибка загрузки сводного отчета в SharePoint: {str(sp_err)}"
                ))
                db.commit()
            
        try:
            # Запускаем синхронизацию с Google Таблицами
            google_sheets_integration.sync_report_to_google_sheets(db)
            google_sheets_integration.sync_qcd_reports_to_google_sheets(db)
            google_sheets_integration.export_receipt_to_google_sheets(db)
            db.add(models.AuditLog(
                user_name="System Background Sync",
                action="UPDATE",
                target_table="shifts",
                target_id=0,
                details="Сводный отчет, приход сырья и переборка успешно синхронизированы с Google Таблицами в фоновом режиме."
            ))
            db.commit()
        except Exception as gs_err:
            db.add(models.AuditLog(
                user_name="System Background Sync",
                action="ERROR",
                target_table="shifts",
                target_id=0,
                details=f"Ошибка синхронизации с Google Таблицами: {str(gs_err)}"
            ))
            db.commit()
    except Exception as e:
        print(f"Error in SharePoint/Google background sync: {e}")
    finally:
        db.close()


@router.post("/api/report")
def save_shift_report(data: schemas.ShiftReportCreate, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id") or 9999
    user_role = request.session.get("user_role") or "admin"
    user_name = request.session.get("user_name") or "Админ"
        
    if user_role not in ["master", "admin"]:
        raise HTTPException(status_code=403, detail="Доступ запрещен. Только мастера или администраторы могут сохранять рапорты.")
        
    # Check if shift exists or create it
    query = db.query(models.Shift).filter(
        models.Shift.date == data.date,
        models.Shift.shift_name == data.shift_name,
        models.Shift.line == data.line
    )
    if data.product_name:
        query = query.filter(models.Shift.product_name == data.product_name)
    if data.batch_number:
        query = query.filter(models.Shift.batch_number == data.batch_number)
    if data.export_type:
        query = query.filter(models.Shift.export_type == data.export_type)
    shift = query.first()
    
    is_new = False
    if not shift:
        is_new = True
        shift = models.Shift(
            date=data.date,
            shift_name=data.shift_name,
            line=data.line,
            master_id=data.master_id,
            product_name=data.product_name or "",
            batch_number=data.batch_number or "",
            export_type=data.export_type or "Эталон",
            status="closed",
            created_at=datetime.utcnow()
        )
        db.add(shift)
        db.flush()
    else:
        if user_role != "admin" and shift.created_at:
            time_diff = (datetime.utcnow() - shift.created_at).total_seconds()
            if time_diff > 1800: # 30 minutes
                raise HTTPException(
                    status_code=403, 
                    detail="Время на самостоятельное редактирование рапорта (30 мин) истекло. Для внесения правок обратитесь к администратору."
                )

    save_report_internal(db, shift, data, user_name, is_new)
    
    # Trigger background SharePoint & Google Sheets sync
    background_tasks.add_task(sync_sharepoint_report_bg)
    background_tasks.add_task(sync_google_sheets_bg)
    
    return {"status": "success", "shift_id": shift.id}


@router.put("/api/report/{shift_id}")
def update_shift_report_endpoint(shift_id: int, data: schemas.ShiftReportCreate, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role")
    user_name = request.session.get("user_name", "Unknown")
    if not user_id or not user_role:
        raise HTTPException(status_code=401, detail="Не авторизован")
        
    shift = db.query(models.Shift).get(shift_id)
    if not shift:
        raise HTTPException(status_code=404, detail="Смена не найдена")
        
    if user_role != "admin" and shift.created_at:
        time_diff = (datetime.utcnow() - shift.created_at).total_seconds()
        if time_diff > 1800: # 30 minutes
            raise HTTPException(
                status_code=403, 
                detail="Время на самостоятельное редактирование рапорта (30 мин) истекло. Для внесения правок обратитесь к администратору."
            )
        
    save_report_internal(db, shift, data, user_name, False)
    
    # Trigger background SharePoint & Google Sheets sync
    background_tasks.add_task(sync_sharepoint_report_bg)
    background_tasks.add_task(sync_google_sheets_bg)
    
    return {"status": "success", "shift_id": shift.id}


@router.post("/api/receipts")
def create_autonomous_receipt(data: schemas.RawMaterialReceiptCreate, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    user_role = request.session.get("user_role")
    user_name = request.session.get("user_name", "Склад")
    if not user_role:
        raise HTTPException(status_code=401, detail="Не авторизован")

    shift_id = None
    if data.date and data.shift_name and data.line:
        existing_shift = db.query(models.Shift).filter(
            models.Shift.date == data.date,
            models.Shift.shift_name == data.shift_name,
            models.Shift.line == data.line
        ).first()
        if existing_shift:
            shift_id = existing_shift.id

    receipt = models.RawMaterialReceipt(
        shift_id=shift_id,
        date=data.date,
        shift_name=data.shift_name,
        line=data.line,
        master_id=data.master_id,
        chrysotile_4_20=data.chrysotile_4_20,
        chrysotile_5_65=data.chrysotile_5_65,
        chrysotile_6_40=data.chrysotile_6_40,
        cement_silo1=data.cement_silo1,
        cement_silo2=data.cement_silo2,
        cement_silo3=data.cement_silo3,
        cement_silo4=data.cement_silo4,
        cellulose=data.cellulose,
        crushed_slate=data.crushed_slate,
        asbozurit=data.asbozurit,
        asbocarton=data.asbocarton,
        pallets=data.pallets,
        fiberglass=data.fiberglass,
        laprol=data.laprol
    )
    db.add(receipt)
    db.flush()
    
    db.add(models.AuditLog(
        user_name=user_name,
        action="CREATE",
        target_table="raw_material_receipts",
        target_id=receipt.id,
        details=f"Добавлен автономный приход сырья: Дата {data.date}, Смена {data.shift_name}, Линия {data.line}"
    ))
    db.commit()
    background_tasks.add_task(sync_receipts_bg)
    return {"status": "success", "receipt_id": receipt.id}


@router.get("/api/receipts/by_slot")
def get_receipts_by_slot(date: str, shift_name: str, line: str, db: Session = Depends(get_db)):
    try:
        if hasattr(date, "strftime"):
            parsed_date = date.date() if hasattr(date, "date") else date
        else:
            parsed_date = datetime.strptime(str(date), "%Y-%m-%d").date()
    except Exception:
        raise HTTPException(400, "Неверный формат даты. Ожидается YYYY-MM-DD")
        
    receipts = db.query(models.RawMaterialReceipt).outerjoin(models.Shift).filter(
        or_(
            models.RawMaterialReceipt.date == parsed_date,
            and_(models.RawMaterialReceipt.date.is_(None), models.Shift.date == parsed_date)
        ),
        or_(
            models.RawMaterialReceipt.shift_name == shift_name,
            and_(models.RawMaterialReceipt.shift_name.is_(None), models.Shift.shift_name == shift_name)
        ),
        or_(
            models.RawMaterialReceipt.line == line,
            and_(models.RawMaterialReceipt.line.is_(None), models.Shift.line == line)
        )
    ).order_by(models.RawMaterialReceipt.id.desc()).all()
    
    result = []
    for r in receipts:
        r_dict = schemas.RawMaterialReceipt.model_validate(r).model_dump()
        r_dict["record_date"] = str(r.record_date) if r.record_date else str(parsed_date)
        r_dict["record_shift_name"] = r.record_shift_name or shift_name
        r_dict["record_line"] = r.record_line or line
        r_dict["master_name"] = r.master.name if r.master else (r.shift.master.name if r.shift and r.shift.master else "Н/Д")
        result.append(r_dict)
    return result


@router.post("/api/shifts/{shift_id}/receipts")
def add_raw_material_receipt(shift_id: int, data: schemas.RawMaterialReceiptCreate, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    user_role = request.session.get("user_role")
    user_name = request.session.get("user_name", "Unknown")
    if not user_role:
        raise HTTPException(status_code=401, detail="Не авторизован")

    shift = db.query(models.Shift).get(shift_id)
    if not shift:
        raise HTTPException(status_code=404, detail="Смена не найдена")

    receipt = models.RawMaterialReceipt(
        shift_id=shift.id,
        date=data.date or shift.date,
        shift_name=data.shift_name or shift.shift_name,
        line=data.line or shift.line,
        master_id=data.master_id or shift.master_id,
        chrysotile_4_20=data.chrysotile_4_20,
        chrysotile_5_65=data.chrysotile_5_65,
        chrysotile_6_40=data.chrysotile_6_40,
        cement_silo1=data.cement_silo1,
        cement_silo2=data.cement_silo2,
        cement_silo3=data.cement_silo3,
        cement_silo4=data.cement_silo4,
        cellulose=data.cellulose,
        crushed_slate=data.crushed_slate,
        asbozurit=data.asbozurit,
        asbocarton=data.asbocarton,
        pallets=data.pallets,
        fiberglass=data.fiberglass,
        laprol=data.laprol
    )
    db.add(receipt)
    
    db.add(models.AuditLog(
        user_name=user_name,
        action="CREATE",
        target_table="raw_material_receipts",
        target_id=shift_id,
        details=f"Добавлен приход сырья для смены {shift.date} {shift.shift_name}"
    ))
    db.commit()
    
    background_tasks.add_task(sync_receipts_bg)
    
    return {"status": "success", "receipt_id": receipt.id}


@router.put("/api/receipts/{receipt_id}")
def update_raw_material_receipt_endpoint(receipt_id: int, data: schemas.RawMaterialReceiptUpdate, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    user_role = request.session.get("user_role")
    user_name = request.session.get("user_name", "Unknown")
    if not user_role:
        raise HTTPException(status_code=401, detail="Не авторизован")

    receipt = db.query(models.RawMaterialReceipt).get(receipt_id)
    if not receipt:
        raise HTTPException(status_code=404, detail="Приход сырья не найден")

    receipt_created = receipt.timestamp or getattr(receipt, 'created_at', None)
    if user_role != "admin" and receipt_created:
        time_diff = (datetime.utcnow() - receipt_created).total_seconds()
        if time_diff > 1800:
            raise HTTPException(
                status_code=403,
                detail="Время на самостоятельное редактирование прихода (30 мин) истекло. Обратитесь к администратору."
            )

    for field, val in data.model_dump(exclude_unset=True).items():
        if val is not None and hasattr(receipt, field):
            setattr(receipt, field, val)

    db.add(models.AuditLog(
        user_name=user_name,
        action="UPDATE",
        target_table="raw_material_receipts",
        target_id=receipt_id,
        details=f"Обновлен приход сырья ID {receipt_id}"
    ))
    db.commit()
    background_tasks.add_task(sync_receipts_bg)
    return {"status": "success"}


@router.delete("/api/receipts/{receipt_id}")
def delete_raw_material_receipt(receipt_id: int, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    user_role = request.session.get("user_role")
    user_name = request.session.get("user_name", "Unknown")
    if not user_role:
        raise HTTPException(status_code=401, detail="Не авторизован")

    receipt = db.query(models.RawMaterialReceipt).get(receipt_id)
    if not receipt:
        raise HTTPException(status_code=404, detail="Приход сырья не найден")

    receipt_created = receipt.timestamp or getattr(receipt, 'created_at', None)
    if user_role != "admin" and receipt_created:
        time_diff = (datetime.utcnow() - receipt_created).total_seconds()
        if time_diff > 1800:
            raise HTTPException(
                status_code=403,
                detail="Время на самостоятельное удаление прихода (30 мин) истекло. Обратитесь к администратору."
            )

    shift = receipt.shift
    db.delete(receipt)
    
    db.add(models.AuditLog(
        user_name=user_name,
        action="DELETE",
        target_table="raw_material_receipts",
        target_id=receipt_id,
        details=f"Удален приход сырья для смены {shift.date if shift else 'Unknown'}"
    ))
    db.commit()
    
    background_tasks.add_task(sync_receipts_bg)
    
    return {"status": "success"}



# --- /api/report/summary & materials_summary MOVED TO routers/analytics.py ---

# --- ЛФМ ---
@router.post("/api/shifts/{shift_id}/lfm")
def create_lfm_report(shift_id: int, data: schemas.LFMReportCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    shift = db.query(models.Shift).get(shift_id)
    if not shift: raise HTTPException(404)
    db_report = models.LFMReport(**data.model_dump(), shift_id=shift_id)
    db.add(db_report)
    db.commit()
    
    # Sync LFM sheets to plan board fact
    sync_lfm_to_plan_board(shift.date, shift.shift_name, shift.line, db, shift.master_id)
    background_tasks.add_task(sync_google_sheets_bg)
    return {"status": "ok"}

# --- ПРОСТОИ ---
@router.post("/api/upload_media/")
async def upload_media(file: UploadFile = File(...)):
    try:
        file_bytes = await file.read()
        filename = file.filename
        url = m365_integration.upload_file_to_sharepoint(file_bytes, filename)
        return {"url": url}
    except Exception as e:
        print(f"Upload error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# --- ПАРТИИ (Стакер) ---
@router.post("/api/batches/")
def create_batch(shift_id: int, data: schemas.BatchCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    db_batch = models.Batch(**data.model_dump(exclude={"status"}), shift_id=shift_id, status="stacked")
    db.add(db_batch)
    db.commit()
    db.refresh(db_batch)
    background_tasks.add_task(sync_google_sheets_bg)
    return db_batch

# --- Дестакер и СКК ---
@router.get("/api/batches/pending_destacker", response_model=list[schemas.Batch])
def get_pending_destacker_batches(db: Session = Depends(get_db)):
    # Дестакер видит все партии, которые были уложены (stacked)
    return db.query(models.Batch).filter(models.Batch.status == "stacked").all()

@router.get("/api/batches/pending_qcd", response_model=list[schemas.Batch])
def get_pending_qcd_batches(db: Session = Depends(get_db)):
    # СКК видит партии, которые уложены или разобраны, но еще не проверены СКК
    return db.query(models.Batch).filter(
        or_(models.Batch.status == "stacked", models.Batch.status == "destacked")
    ).all()

class DestackerUpdate(BaseModel):
    ds_condition: int
    ds_first_grade: int
    ds_defect_chip: int = 0
    ds_defect_scratch: int = 0
    ds_defect_bad_cut: int = 0
    ds_defect_stick_bottom: int = 0
    ds_defect_stick_top: int = 0
    ds_defect_broken: int = 0
    ds_defect_fell_box: int = 0
    ds_defect_dent: int = 0
    ds_defect_thickness: int = 0
    ds_defect_delamination: int = 0
    ds_defect_edge: int = 0

@router.post("/api/batches/{batch_id}/destacker")
def update_destacker(batch_id: int, data: DestackerUpdate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    batch = db.query(models.Batch).get(batch_id)
    if not batch: raise HTTPException(404)
    batch.ds_condition = data.ds_condition
    batch.ds_first_grade = data.ds_first_grade
    batch.ds_defect_chip = data.ds_defect_chip
    batch.ds_defect_scratch = data.ds_defect_scratch
    batch.ds_defect_bad_cut = data.ds_defect_bad_cut
    batch.ds_defect_stick_bottom = data.ds_defect_stick_bottom
    batch.ds_defect_stick_top = data.ds_defect_stick_top
    batch.ds_defect_broken = data.ds_defect_broken
    batch.ds_defect_fell_box = data.ds_defect_fell_box
    batch.ds_defect_dent = data.ds_defect_dent
    batch.ds_defect_thickness = data.ds_defect_thickness
    batch.ds_defect_delamination = data.ds_defect_delamination
    batch.ds_defect_edge = data.ds_defect_edge
    
    # Суммируем весь брак
    batch.ds_defect = (
        data.ds_defect_chip + data.ds_defect_scratch + data.ds_defect_bad_cut +
        data.ds_defect_stick_bottom + data.ds_defect_stick_top + data.ds_defect_broken +
        data.ds_defect_fell_box + data.ds_defect_dent + data.ds_defect_thickness +
        data.ds_defect_delamination + data.ds_defect_edge
    )
    batch.status = "destacked"
    db.commit()
    background_tasks.add_task(sync_google_sheets_bg)
    return {"status": "ok"}

class QCDUpdate(BaseModel):
    qcd_sorted_packs: int = 0
    qcd_first_grade: int = 0
    qcd_first_grade_note: Optional[str] = None
    qcd_defect_note: Optional[str] = None
    qcd_defect_chip: int = 0
    qcd_defect_scratch: int = 0
    qcd_defect_bad_cut: int = 0
    qcd_defect_stick_bottom: int = 0
    qcd_defect_stick_top: int = 0
    qcd_defect_broken: int = 0
    qcd_defect_fell_box: int = 0
    qcd_defect_dent: int = 0
    qcd_defect_thickness: int = 0
    qcd_defect_delamination: int = 0
    qcd_defect_edge: int = 0




@router.get("/api/admin/shifts/{shift_id}/details")
def admin_get_shift_details(shift_id: int, request: Request, db: Session = Depends(get_db)):
    check_admin_session(request, db)
    shift = db.query(models.Shift).get(shift_id)
    if not shift: raise HTTPException(404, "Смена не найдена")
    
    lfm_reports = db.query(models.LFMReport).filter(models.LFMReport.shift_id == shift_id).all()
    batches = db.query(models.Batch).filter(models.Batch.shift_id == shift_id).all()
    downtimes = db.query(models.Downtime).filter(models.Downtime.shift_id == shift_id).all()
    
    return {
        "shift": shift,
        "lfm_reports": lfm_reports,
        "batches": batches,
        "downtimes": downtimes
    }

@router.put("/api/admin/shifts/{shift_id}")
def admin_update_shift(shift_id: int, data: dict, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    admin = check_admin_session(request, db)
    shift = db.query(models.Shift).get(shift_id)
    if not shift: raise HTTPException(404, "Смена не найдена")
    
    old_date, old_shift_name, old_line = shift.date, shift.shift_name, shift.line
    old_master_id = shift.master_id
    
    old_values = {}
    new_values = {}
    
    if "date" in data and data["date"]:
        try:
            data["date"] = datetime.strptime(data["date"], "%Y-%m-%d").date()
        except Exception:
            pass
            
    for key, val in data.items():
        if hasattr(shift, key):
            old_val = getattr(shift, key)
            if old_val != val:
                old_values[key] = str(old_val)
                new_values[key] = str(val)
                setattr(shift, key, val)
                
    if old_values:
        log_entry = models.AuditLog(
            timestamp=datetime.utcnow(),
            user_name=admin.name,
            action=f"Редактирование смены ID {shift_id}",
            details=f"Изменено: {old_values} -> {new_values}"
        )
        db.add(log_entry)
        db.commit()
        
        # Sync plan boards for old and new parameters
        sync_lfm_to_plan_board(old_date, old_shift_name, old_line, db, old_master_id)
        if shift.date != old_date or shift.shift_name != old_shift_name or shift.line != old_line:
            sync_lfm_to_plan_board(shift.date, shift.shift_name, shift.line, db, shift.master_id)
    else:
        db.commit()
    background_tasks.add_task(sync_google_sheets_bg)
    return {"status": "ok"}

@router.put("/api/admin/shift_report/{shift_id}")
def admin_update_shift_report(shift_id: int, data: schemas.AdminShiftReportUpdate, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    admin = check_admin_session(request, db)
    shift = db.query(models.Shift).get(shift_id)
    if not shift:
        raise HTTPException(status_code=404, detail="Смена не найдена")
        
    old_date, old_shift_name, old_line = shift.date, shift.shift_name, shift.line
    old_master_id = shift.master_id
    
    # Snapshot of state before admin update (for Rollback / Undo)
    snapshot_before = None
    try:
        b_prev = db.query(models.Batch).filter(models.Batch.shift_id == shift.id).first()
        l_prev = db.query(models.LFMReport).filter(models.LFMReport.shift_id == shift.id).first()
        import json
        snapshot_before = json.dumps({
            "shift": {
                "master_id": shift.master_id,
                "batch_number": shift.batch_number,
                "product_name": shift.product_name,
                "export_type": shift.export_type,
                "status": shift.status,
                "zo_batches": shift.zo_batches,
                "zo_chrysotile_4_20_silo1": shift.zo_chrysotile_4_20_silo1,
                "zo_chrysotile_4_20_silo2": shift.zo_chrysotile_4_20_silo2,
                "zo_chrysotile_4_20_silo3": shift.zo_chrysotile_4_20_silo3,
                "zo_chrysotile_4_20_silo4": shift.zo_chrysotile_4_20_silo4,
                "zo_chrysotile_5_65_silo1": shift.zo_chrysotile_5_65_silo1,
                "zo_chrysotile_5_65_silo2": shift.zo_chrysotile_5_65_silo2,
                "zo_chrysotile_5_65_silo3": shift.zo_chrysotile_5_65_silo3,
                "zo_chrysotile_5_65_silo4": shift.zo_chrysotile_5_65_silo4,
                "zo_chrysotile_6_40_silo1": shift.zo_chrysotile_6_40_silo1,
                "zo_chrysotile_6_40_silo2": shift.zo_chrysotile_6_40_silo2,
                "zo_chrysotile_6_40_silo3": shift.zo_chrysotile_6_40_silo3,
                "zo_chrysotile_6_40_silo4": shift.zo_chrysotile_6_40_silo4,
                "zo_cement_silo1": shift.zo_cement_silo1,
                "zo_cement_silo2": shift.zo_cement_silo2,
                "zo_cement_silo3": shift.zo_cement_silo3,
                "zo_cement_silo4": shift.zo_cement_silo4,
                "zo_cellulose_silo1": shift.zo_cellulose_silo1,
                "zo_cellulose_silo2": shift.zo_cellulose_silo2,
                "zo_cellulose_silo3": shift.zo_cellulose_silo3,
                "zo_cellulose_silo4": shift.zo_cellulose_silo4,
                "zo_crushed_slate_silo1": shift.zo_crushed_slate_silo1,
                "zo_crushed_slate_silo2": shift.zo_crushed_slate_silo2,
                "zo_crushed_slate_silo3": shift.zo_crushed_slate_silo3,
                "zo_crushed_slate_silo4": shift.zo_crushed_slate_silo4,
                "zo_asbozurit_silo1": shift.zo_asbozurit_silo1,
                "zo_asbozurit_silo2": shift.zo_asbozurit_silo2,
                "zo_asbozurit_silo3": shift.zo_asbozurit_silo3,
                "zo_asbozurit_silo4": shift.zo_asbozurit_silo4,
                "zo_fiberglass_silo1": shift.zo_fiberglass_silo1,
                "zo_fiberglass_silo2": shift.zo_fiberglass_silo2,
                "zo_fiberglass_silo3": shift.zo_fiberglass_silo3,
                "zo_fiberglass_silo4": shift.zo_fiberglass_silo4,
                "zo_laprol_silo1": shift.zo_laprol_silo1,
                "zo_laprol_silo2": shift.zo_laprol_silo2,
                "zo_laprol_silo3": shift.zo_laprol_silo3,
                "zo_laprol_silo4": shift.zo_laprol_silo4,
                "zo_asbocarton_silo1": shift.zo_asbocarton_silo1,
                "zo_asbocarton_silo2": shift.zo_asbocarton_silo2,
                "zo_asbocarton_silo3": shift.zo_asbocarton_silo3,
                "zo_asbocarton_silo4": shift.zo_asbocarton_silo4,
                "zo_asb_drain": shift.zo_asb_drain,
                "zo_cem_drain": shift.zo_cem_drain,
                "lfm_asb_drain": getattr(shift, 'lfm_asb_drain', 0.0),
                "lfm_cem_drain": getattr(shift, 'lfm_cem_drain', 0.0)
            },
            "lfm_report": {
                "product_name": l_prev.product_name if l_prev else "",
                "export_type": l_prev.export_type if l_prev else "Эталон",
                "lfm_sheets": l_prev.lfm_sheets if l_prev else 0,
                "lfm_wind_resets": l_prev.lfm_wind_resets if l_prev else 0,
                "formed_1st_grade": l_prev.formed_1st_grade if l_prev else 0,
                "formed_defect": l_prev.formed_defect if l_prev else 0,
                "transferred_to_warehouse": l_prev.transferred_to_warehouse if l_prev else 0
            } if l_prev else None,
            "batch": {
                "batch_number": b_prev.batch_number if b_prev else "",
                "product_name": b_prev.product_name if b_prev else "",
                "export_type": b_prev.export_type if b_prev else "Эталон",
                "stacked_stacks": b_prev.stacked_stacks if b_prev else 0,
                "ds_condition": b_prev.ds_condition if b_prev else 0,
                "ds_first_grade": b_prev.ds_first_grade if b_prev else 0,
                "ds_defect": b_prev.ds_defect if b_prev else 0,
                "ds_defect_chip": b_prev.ds_defect_chip if b_prev else 0,
                "ds_defect_scratch": b_prev.ds_defect_scratch if b_prev else 0,
                "ds_defect_bad_cut": b_prev.ds_defect_bad_cut if b_prev else 0,
                "ds_defect_stick_bottom": b_prev.ds_defect_stick_bottom if b_prev else 0,
                "ds_defect_stick_top": b_prev.ds_defect_stick_top if b_prev else 0,
                "ds_defect_broken": b_prev.ds_defect_broken if b_prev else 0,
                "ds_defect_fell_box": b_prev.ds_defect_fell_box if b_prev else 0,
                "ds_defect_dent": b_prev.ds_defect_dent if b_prev else 0,
                "ds_defect_thickness": b_prev.ds_defect_thickness if b_prev else 0,
                "ds_defect_delamination": b_prev.ds_defect_delamination if b_prev else 0,
                "ds_defect_edge": b_prev.ds_defect_edge if b_prev else 0,
                "prev_first_grade": b_prev.prev_first_grade if b_prev else 0,
                "prev_defect": b_prev.prev_defect if b_prev else 0,
                "prev_defect_scratch": b_prev.prev_defect_scratch if b_prev else 0,
                "prev_defect_bad_cut": b_prev.prev_defect_bad_cut if b_prev else 0,
                "prev_defect_stick_top": b_prev.prev_defect_stick_top if b_prev else 0,
                "prev_defect_broken": b_prev.prev_defect_broken if b_prev else 0,
                "prev_defect_fell_box": b_prev.prev_defect_fell_box if b_prev else 0,
                "prev_defect_thickness": b_prev.prev_defect_thickness if b_prev else 0,
                "prev_defect_edge": b_prev.prev_defect_edge if b_prev else 0,
                "qcd_condition": b_prev.qcd_condition if b_prev else 0,
                "qcd_first_grade": b_prev.qcd_first_grade if b_prev else 0,
                "qcd_defect": b_prev.qcd_defect if b_prev else 0
            } if b_prev else None
        }, ensure_ascii=False)
    except Exception as snap_err:
        print(f"Warning: could not capture admin snapshot_before: {snap_err}")
    
    changes = []
    
    # 1. Update Shift metadata and raw materials
    if data.date is not None and shift.date != data.date:
        changes.append(f"date: {shift.date} -> {data.date}")
        shift.date = data.date
    if data.shift_name is not None and shift.shift_name != data.shift_name:
        changes.append(f"shift_name: {shift.shift_name} -> {data.shift_name}")
        shift.shift_name = data.shift_name
    if data.line is not None and shift.line != data.line:
        changes.append(f"line: {shift.line} -> {data.line}")
        shift.line = data.line
    if data.master_id is not None and shift.master_id != data.master_id:
        changes.append(f"master_id: {shift.master_id} -> {data.master_id}")
        shift.master_id = data.master_id
    if data.batch_number is not None and shift.batch_number != data.batch_number:
        changes.append(f"batch_number: {shift.batch_number} -> {data.batch_number}")
        shift.batch_number = data.batch_number
    if data.product_name is not None and shift.product_name != data.product_name:
        changes.append(f"product_name: {shift.product_name} -> {data.product_name}")
        shift.product_name = data.product_name
    if data.export_type is not None and shift.export_type != data.export_type:
        changes.append(f"export_type: {shift.export_type} -> {data.export_type}")
        shift.export_type = data.export_type
    if data.status is not None and shift.status != data.status:
        changes.append(f"status: {shift.status} -> {data.status}")
        shift.status = data.status
        
    # ZO raw materials
    zo_fields = [
        "zo_batches", "zo_chrysotile_4_20", "zo_chrysotile_5_65", "zo_chrysotile_6_40",
        "zo_chrysotile_4_20_silo1", "zo_chrysotile_4_20_silo2", "zo_chrysotile_4_20_silo3", "zo_chrysotile_4_20_silo4",
        "zo_chrysotile_5_65_silo1", "zo_chrysotile_5_65_silo2", "zo_chrysotile_5_65_silo3", "zo_chrysotile_5_65_silo4",
        "zo_chrysotile_6_40_silo1", "zo_chrysotile_6_40_silo2", "zo_chrysotile_6_40_silo3", "zo_chrysotile_6_40_silo4",
        "zo_cement_silo1", "zo_cement_silo2", "zo_cement_silo3", "zo_cement_silo4",
        "zo_cellulose", "zo_cellulose_silo1", "zo_cellulose_silo2", "zo_cellulose_silo3", "zo_cellulose_silo4",
        "zo_crushed_slate", "zo_crushed_slate_silo1", "zo_crushed_slate_silo2", "zo_crushed_slate_silo3", "zo_crushed_slate_silo4",
        "zo_asbozurit", "zo_asbozurit_silo1", "zo_asbozurit_silo2", "zo_asbozurit_silo3", "zo_asbozurit_silo4",
        "zo_fiberglass", "zo_fiberglass_silo1", "zo_fiberglass_silo2", "zo_fiberglass_silo3", "zo_fiberglass_silo4",
        "zo_laprol", "zo_laprol_silo1", "zo_laprol_silo2", "zo_laprol_silo3", "zo_laprol_silo4",
        "zo_asbocarton", "zo_asbocarton_silo1", "zo_asbocarton_silo2", "zo_asbocarton_silo3", "zo_asbocarton_silo4",
        "lfm_asb_drain", "lfm_cem_drain", "zo_asb_drain", "zo_cem_drain"
    ]
    for f_name in zo_fields:
        val = getattr(data, f_name, None)
        if val is not None:
            old_val = getattr(shift, f_name, 0)
            if old_val != val:
                changes.append(f"{f_name}: {old_val} -> {val}")
                setattr(shift, f_name, val)
                
    # 2. Update LFM Report
    lfm_report = db.query(models.LFMReport).filter(models.LFMReport.shift_id == shift_id).first()
    if not lfm_report:
        lfm_report = models.LFMReport(
            shift_id=shift_id,
            product_name=shift.product_name or "",
            export_type=shift.export_type or "Эталон",
            lfm_sheets=data.lfm_sheets or 0,
            lfm_wind_resets=data.lfm_wind_resets or 0,
            transferred_to_warehouse=data.warehouse_gp or 0,
            formed_1st_grade=data.first_grade or 0,
            formed_defect=data.qcd_defect or 0
        )
        db.add(lfm_report)
        changes.append("Создан новый LFMReport")
    else:
        if data.lfm_sheets is not None and lfm_report.lfm_sheets != data.lfm_sheets:
            changes.append(f"lfm_sheets: {lfm_report.lfm_sheets} -> {data.lfm_sheets}")
            lfm_report.lfm_sheets = data.lfm_sheets
        if data.lfm_wind_resets is not None and lfm_report.lfm_wind_resets != data.lfm_wind_resets:
            changes.append(f"lfm_wind_resets: {lfm_report.lfm_wind_resets} -> {data.lfm_wind_resets}")
            lfm_report.lfm_wind_resets = data.lfm_wind_resets
        if data.warehouse_gp is not None and lfm_report.transferred_to_warehouse != data.warehouse_gp:
            changes.append(f"transferred_to_warehouse: {lfm_report.transferred_to_warehouse} -> {data.warehouse_gp}")
            lfm_report.transferred_to_warehouse = data.warehouse_gp
        if data.first_grade is not None and lfm_report.formed_1st_grade != data.first_grade:
            changes.append(f"formed_1st_grade: {lfm_report.formed_1st_grade} -> {data.first_grade}")
            lfm_report.formed_1st_grade = data.first_grade
        if data.qcd_defect is not None and lfm_report.formed_defect != data.qcd_defect:
            changes.append(f"formed_defect: {lfm_report.formed_defect} -> {data.qcd_defect}")
            lfm_report.formed_defect = data.qcd_defect
        if data.product_name is not None and lfm_report.product_name != data.product_name:
            lfm_report.product_name = data.product_name
        if data.export_type is not None and lfm_report.export_type != data.export_type:
            lfm_report.export_type = data.export_type
            
    # 3. Update Batch
    batch = db.query(models.Batch).filter(models.Batch.shift_id == shift_id).first()
    if not batch:
        batch = models.Batch(
            shift_id=shift_id,
            batch_number=shift.batch_number or "",
            product_name=shift.product_name or "",
            export_type=shift.export_type or "Эталон",
            status="stacked"
        )
        db.add(batch)
        changes.append("Создана новая партия Batch")
    else:
        batch.batch_number = shift.batch_number or ""
        batch.product_name = shift.product_name or ""
        batch.export_type = shift.export_type or "Эталон"
        
    if data.warehouse_gp is not None:
        batch.ds_condition = data.warehouse_gp
        batch.qcd_condition = data.warehouse_gp
    if data.first_grade is not None:
        batch.ds_first_grade = data.first_grade
        batch.qcd_first_grade = data.first_grade
    if data.qcd_defect is not None:
        batch.qcd_defect = data.qcd_defect
        
    ds_defect_fields = [
        "ds_defect_chip", "ds_defect_scratch", "ds_defect_bad_cut", "ds_defect_stick_bottom",
        "ds_defect_stick_top", "ds_defect_broken", "ds_defect_fell_box", "ds_defect_dent",
        "ds_defect_thickness", "ds_defect_delamination", "ds_defect_edge"
    ]
    total_ds_defect = 0
    for f_name in ds_defect_fields:
        val = getattr(data, f_name, None)
        if val is not None:
            old_val = getattr(batch, f_name, 0)
            if old_val != val:
                changes.append(f"{f_name}: {old_val} -> {val}")
                setattr(batch, f_name, val)
            total_ds_defect += val
        else:
            total_ds_defect += getattr(batch, f_name, 0) or 0
    batch.ds_defect = total_ds_defect
    batch.qcd_defect = total_ds_defect
    
    # Previous shift defects
    prev_defect_fields = [
        "prev_defect_scratch", "prev_defect_bad_cut", "prev_defect_stick_top",
        "prev_defect_broken", "prev_defect_fell_box", "prev_defect_thickness", "prev_defect_edge"
    ]
    if data.prev_first_grade is not None:
        batch.prev_first_grade = data.prev_first_grade
    total_prev_defect = 0
    for pf_name in prev_defect_fields:
        pval = getattr(data, pf_name, None)
        if pval is not None:
            old_pval = getattr(batch, pf_name, 0)
            if old_pval != pval:
                changes.append(f"{pf_name}: {old_pval} -> {pval}")
                setattr(batch, pf_name, pval)
            total_prev_defect += pval
        else:
            total_prev_defect += getattr(batch, pf_name, 0) or 0
    batch.prev_defect = total_prev_defect
    
    if changes or snapshot_before:
        log_entry = models.AuditLog(
            timestamp=datetime.utcnow(),
            user_name=admin.name,
            action=f"Комплексное редактирование смены ID {shift_id}",
            target_table="shifts",
            target_id=shift_id,
            details="Изменения: " + (", ".join(changes) if changes else "без числовых изменений"),
            state_snapshot=snapshot_before
        )
        db.add(log_entry)
        
    db.commit()
    
    # Sync plan boards for old and new parameters
    sync_lfm_to_plan_board(old_date, old_shift_name, old_line, db, old_master_id)
    if shift.date != old_date or shift.shift_name != old_shift_name or shift.line != old_line:
        sync_lfm_to_plan_board(shift.date, shift.shift_name, shift.line, db, shift.master_id)
        
    # Trigger background Google Sheets sync
    background_tasks.add_task(sync_sharepoint_report_bg)
    
    return {"status": "ok", "shift_id": shift_id}

@router.delete("/api/admin/shifts/{shift_id}")
def admin_delete_shift(shift_id: int, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    admin = check_admin_session(request, db)
    shift = db.query(models.Shift).get(shift_id)
    if not shift: raise HTTPException(404, "Смена не найдена")
    
    shift_date, shift_name, shift_line, master_id = shift.date, shift.shift_name, shift.line, shift.master_id
    
    # Decouple any linked downtimes and receipts so they are preserved autonomously
    for dt in db.query(models.Downtime).filter(models.Downtime.shift_id == shift_id).all():
        if not dt.date: dt.date = shift_date
        if not dt.shift_name: dt.shift_name = shift_name
        if not dt.line: dt.line = shift_line
        if not dt.master_id: dt.master_id = master_id
        dt.shift_id = None

    for r in db.query(models.RawMaterialReceipt).filter(models.RawMaterialReceipt.shift_id == shift_id).all():
        if not r.date: r.date = shift_date
        if not r.shift_name: r.shift_name = shift_name
        if not r.line: r.line = shift_line
        if not r.master_id: r.master_id = master_id
        r.shift_id = None

    db.query(models.LFMReport).filter(models.LFMReport.shift_id == shift_id).delete()
    db.query(models.Batch).filter(models.Batch.shift_id == shift_id).delete()
    
    log_entry = models.AuditLog(
        timestamp=datetime.utcnow(),
        user_name=admin.name,
        action=f"Удаление смены ID {shift_id}",
        details=f"Удалена смена за {shift_date} ({shift_name}, Линия {shift_line}) и её производственные рапорты. Приходы сырья и простои сохранены автономно."
    )
    db.add(log_entry)
    db.delete(shift)
    db.commit()
    
    # Sync to clear phantom facts from plan board
    sync_lfm_to_plan_board(shift_date, shift_name, shift_line, db, master_id)
    background_tasks.add_task(sync_sharepoint_report_bg)
    background_tasks.add_task(sync_google_sheets_bg)
    background_tasks.add_task(sync_downtimes_bg)
    return {"status": "ok"}

@router.put("/api/admin/lfm/{report_id}")
def admin_update_lfm(report_id: int, data: dict, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    admin = check_admin_session(request, db)
    report = db.query(models.LFMReport).get(report_id)
    if not report: raise HTTPException(404, "Отчет ЛФМ не найден")
    
    old_values = {}
    new_values = {}
    for key, val in data.items():
        if hasattr(report, key):
            old_val = getattr(report, key)
            if old_val != val:
                old_values[key] = str(old_val)
                new_values[key] = str(val)
                setattr(report, key, val)
                
    if old_values:
        log_entry = models.AuditLog(
            timestamp=datetime.utcnow(),
            user_name=admin.name,
            action=f"Редактирование отчета ЛФМ ID {report_id}",
            details=f"Смена {report.shift_id}. Изменено: {old_values} -> {new_values}"
        )
        db.add(log_entry)
        db.commit()
        # Sync with plan board
        shift = db.query(models.Shift).get(report.shift_id)
        if shift:
            sync_lfm_to_plan_board(shift.date, shift.shift_name, shift.line, db, shift.master_id)
    else:
        db.commit()
    background_tasks.add_task(sync_sharepoint_report_bg)
    background_tasks.add_task(sync_google_sheets_bg)
    return {"status": "ok"}

@router.delete("/api/admin/lfm/{report_id}")
def admin_delete_lfm(report_id: int, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    admin = check_admin_session(request, db)
    report = db.query(models.LFMReport).get(report_id)
    if not report: raise HTTPException(404, "Отчет ЛФМ не найден")
    shift_id = report.shift_id
    shift = db.query(models.Shift).get(shift_id)
    shift_date, shift_name, shift_line, master_id = None, None, None, None
    if shift:
        shift_date, shift_name, shift_line, master_id = shift.date, shift.shift_name, shift.line, shift.master_id
        
    log_entry = models.AuditLog(
        timestamp=datetime.utcnow(),
        user_name=admin.name,
        action=f"Удаление отчета ЛФМ ID {report_id}",
        details=f"Смена {report.shift_id}. Удалена продукция: {report.product_name}, листы: {report.lfm_sheets}."
    )
    db.add(log_entry)
    db.delete(report)
    db.commit()
    # Sync with plan board
    if shift:
        sync_lfm_to_plan_board(shift_date, shift_name, shift_line, db, master_id)
    background_tasks.add_task(sync_sharepoint_report_bg)
    background_tasks.add_task(sync_google_sheets_bg)
    return {"status": "ok"}

@router.put("/api/admin/batches/{batch_id}")
def admin_update_batch(batch_id: int, data: dict, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    admin = check_admin_session(request, db)
    batch = db.query(models.Batch).get(batch_id)
    if not batch: raise HTTPException(404, "Партия не найдена")
    
    old_values = {}
    new_values = {}
    for key, val in data.items():
        if hasattr(batch, key):
            old_val = getattr(batch, key)
            if old_val != val:
                old_values[key] = str(old_val)
                new_values[key] = str(val)
                setattr(batch, key, val)
                
    if old_values:
        log_entry = models.AuditLog(
            timestamp=datetime.utcnow(),
            user_name=admin.name,
            action=f"Редактирование партии ID {batch_id}",
            details=f"Смена {batch.shift_id}. Изменено: {old_values} -> {new_values}"
        )
        db.add(log_entry)
        db.commit()
    else:
        db.commit()
    background_tasks.add_task(sync_sharepoint_report_bg)
    background_tasks.add_task(sync_google_sheets_bg)
    return {"status": "ok"}

@router.delete("/api/admin/batches/{batch_id}")
def admin_delete_batch(batch_id: int, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    admin = check_admin_session(request, db)
    batch = db.query(models.Batch).get(batch_id)
    if not batch: raise HTTPException(404, "Партия не найдена")
    
    log_entry = models.AuditLog(
        timestamp=datetime.utcnow(),
        user_name=admin.name,
        action=f"Удаление партии ID {batch_id}",
        details=f"Смена {batch.shift_id}. Удален номер партии: {batch.batch_number}, продукция: {batch.product_name}."
    )
    db.add(log_entry)
    db.delete(batch)
    db.commit()
    background_tasks.add_task(sync_sharepoint_report_bg)
    background_tasks.add_task(sync_google_sheets_bg)
    return {"status": "ok"}

@router.get("/api/admin/receipts")
def get_all_admin_receipts(
    start_date: str = Query(None),
    end_date: str = Query(None),
    request: Request = None, 
    db: Session = Depends(get_db)
):
    admin = check_admin_session(request, db)
    query = db.query(models.RawMaterialReceipt).outerjoin(models.Shift)
    
    if start_date:
        query = query.filter(or_(models.RawMaterialReceipt.date >= start_date, models.Shift.date >= start_date))
    if end_date:
        query = query.filter(or_(models.RawMaterialReceipt.date <= end_date, models.Shift.date <= end_date))
        
    receipts = query.order_by(
        func.coalesce(models.RawMaterialReceipt.date, models.Shift.date).desc(),
        models.RawMaterialReceipt.id.desc()
    ).all()
    
    result = []
    for r in receipts:
        r_dict = schemas.RawMaterialReceipt.model_validate(r).model_dump()
        r_dict["shift_date"] = r.record_date
        r_dict["shift_line"] = r.record_line
        r_dict["shift_name"] = r.record_shift_name
        if r.master:
            r_dict["master_name"] = r.master.name
        elif r.shift and r.shift.master:
            r_dict["master_name"] = r.shift.master.name
        else:
            r_dict["master_name"] = "Н/Д"
        result.append(r_dict)
    return result

@router.put("/api/admin/receipts/{receipt_id}")
def admin_update_receipt(receipt_id: int, data: schemas.RawMaterialReceiptUpdate, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    admin = check_admin_session(request, db)
    r = db.query(models.RawMaterialReceipt).get(receipt_id)
    if not r: raise HTTPException(404, "Приход сырья не найден")
    
    old_values = {}
    new_values = {}
    update_data = data.model_dump(exclude_unset=True)
    
    for key, val in update_data.items():
        if hasattr(r, key):
            old_val = getattr(r, key)
            if old_val != val:
                old_values[key] = str(old_val)
                new_values[key] = str(val)
                setattr(r, key, val)
                
    if old_values:
        log_entry = models.AuditLog(
            timestamp=datetime.utcnow(),
            user_name=admin.name,
            action=f"Редактирование прихода сырья ID {receipt_id}",
            details=f"Смена {r.shift_id}. Изменено: {old_values} -> {new_values}",
            target_table="raw_material_receipts",
            target_id=receipt_id
        )
        db.add(log_entry)
        db.commit()
    else:
        db.commit()
    background_tasks.add_task(sync_receipts_bg)
    return {"status": "ok"}

@router.delete("/api/admin/receipts/{receipt_id}")
def admin_delete_receipt(receipt_id: int, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    admin = check_admin_session(request, db)
    r = db.query(models.RawMaterialReceipt).get(receipt_id)
    if not r: raise HTTPException(404, "Приход сырья не найден")
    
    log_entry = models.AuditLog(
        timestamp=datetime.utcnow(),
        user_name=admin.name,
        action=f"Удаление прихода сырья ID {receipt_id}",
        details=f"Смена {r.shift_id}. Цемент: {r.cement_silo1 + r.cement_silo2 + r.cement_silo3 + r.cement_silo4}, Хризотил 4-20: {r.chrysotile_4_20}",
        target_table="raw_material_receipts",
        target_id=receipt_id
    )
    db.add(log_entry)
    db.delete(r)
    db.commit()
    background_tasks.add_task(sync_receipts_bg)
    return {"status": "ok"}


# ==========================================
# API БЭКАПА, ВОССТАНОВЛЕНИЯ И ОТКАТА (ROLLBACK)
# ==========================================

@router.post("/api/admin/shifts/{shift_id}/rollback")
def admin_rollback_shift(
    shift_id: int, 
    request: Request, 
    audit_log_id: Optional[int] = None, 
    background_tasks: BackgroundTasks = None, 
    db: Session = Depends(get_db)
):
    admin = check_admin_session(request, db)
    shift = db.query(models.Shift).get(shift_id)
    if not shift:
        raise HTTPException(404, "Смена не найдена")

    # Ищем подходящий снимок в AuditLog
    query = db.query(models.AuditLog).filter(
        models.AuditLog.target_table == "shifts",
        models.AuditLog.target_id == shift_id,
        models.AuditLog.state_snapshot.isnot(None)
    )
    if audit_log_id:
        log_entry = query.filter(models.AuditLog.id == audit_log_id).first()
    else:
        log_entry = query.order_by(models.AuditLog.timestamp.desc(), models.AuditLog.id.desc()).first()

    if not log_entry or not log_entry.state_snapshot:
        raise HTTPException(404, "Снимок состояния для отката этой смены не найден")

    import json
    try:
        snapshot = json.loads(log_entry.state_snapshot)
    except Exception as e:
        raise HTTPException(500, f"Ошибка парсинга снимка состояния: {e}")

    # 1. Восстанавливаем поля Shift
    s_data = snapshot.get("shift", {})
    for k, v in s_data.items():
        if hasattr(shift, k):
            setattr(shift, k, v)

    # 2. Восстанавливаем LFMReport
    l_data = snapshot.get("lfm_report")
    if l_data:
        lfm_rep = db.query(models.LFMReport).filter(models.LFMReport.shift_id == shift_id).first()
        if not lfm_rep:
            lfm_rep = models.LFMReport(shift_id=shift_id)
            db.add(lfm_rep)
        for k, v in l_data.items():
            if hasattr(lfm_rep, k):
                setattr(lfm_rep, k, v)

    # 3. Восстанавливаем Batch
    b_data = snapshot.get("batch")
    if b_data:
        batch = db.query(models.Batch).filter(models.Batch.shift_id == shift_id).first()
        if not batch:
            batch = models.Batch(shift_id=shift_id)
            db.add(batch)
        for k, v in b_data.items():
            if hasattr(batch, k):
                setattr(batch, k, v)

    # Записываем действие отката в аудит
    db.add(models.AuditLog(
        timestamp=datetime.utcnow(),
        user_name=admin.name,
        action="ROLLBACK",
        target_table="shifts",
        target_id=shift_id,
        details=f"Выполнен откат смены ID {shift_id} к снимку из лога #{log_entry.id} ({log_entry.timestamp})"
    ))
    db.commit()

    # Синхронизация с планом и гугл таблицами
    sync_lfm_to_plan_board(shift.date, shift.shift_name, shift.line, db, shift.master_id)
    if background_tasks:
        background_tasks.add_task(sync_sharepoint_report_bg)

    return {"status": "ok", "message": f"Смена успешно откачена к состоянию от {log_entry.timestamp}"}

