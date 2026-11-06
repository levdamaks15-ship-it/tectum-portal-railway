import os
import re
import json
import time
import base64
import urllib.request
import urllib.error
from datetime import datetime, timedelta, date
import calendar
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request, BackgroundTasks, UploadFile, File, Body
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_, func

import models
import schemas
from routers.common import (
    get_db,
    check_admin_session,
    sync_downtimes_bg,
    get_authenticated_user_from_request,
    get_primary_role,
)

try:
    import google_sheets_integration
except ImportError:
    google_sheets_integration = None

try:
    import m365_integration
except ImportError:
    m365_integration = None

router = APIRouter(tags=["downtimes"])

TONS_PER_HOUR = 5.0
PRICE_PER_TON = 100000.0

def compute_downtime_actual_date(shift_date, shift_name, start_time):
    if not shift_date:
        return None
    if shift_name == "Ночь" and start_time:
        try:
            hour = int(start_time.strip().split(":")[0])
            if hour < 12:
                from datetime import timedelta
                return shift_date + timedelta(days=1)
        except Exception:
            pass
    return shift_date


def get_product_financial_metrics(product_name: Optional[str]) -> dict:
    from routers.analytics import PRODUCT_PRICING
    default_entry = PRODUCT_PRICING["8_wave"]
    if not product_name:
        return default_entry
    p_lower = product_name.lower()
    for key, pinfo in PRODUCT_PRICING.items():
        if any(kw in p_lower for kw in pinfo.get("search_keywords", [])):
            return pinfo
    return default_entry


def calculate_downtime_losses(duration_minutes: int, shift: Optional[models.Shift], db: Session) -> tuple[float, float]:
    """
    Рассчитывает технологические и финансовые потери от простоя по нормативу завода ХЦИ:
    - 6 оборотов за 24 секунды = 1 накат.
    - 1 накат = 2 листа продукции (для 7 волн 3.5м - 1 лист).
    - Номинальный темп: 5 листов/мин (300 листов/час).
    - Вес листа: строго из базы нормативов завода (models.ProductNorm.weight_kg).
    - Упущенная маржа: из прейскуранта себестоимости и цен PRODUCT_PRICING (755 тг/лист для 8-волнового шифера).
    """
    if duration_minutes <= 0:
        return 0.0, 0.0
        
    product_name = None
    if shift:
        product_name = shift.product_name
        if not product_name and shift.lfm_reports:
            product_name = shift.lfm_reports[-1].product_name
        
    if not product_name:
        product_name = "Шифер 8 волн рифленый"
        
    if db is not None:
        from routers.common import get_product_finished_weight_kg
        weight_kg = get_product_finished_weight_kg(db, product_name)
    else:
        weight_kg = 19.6
    
    p_lower = product_name.lower()
    sheets_per_cycle = 1 if ("3500" in p_lower or "3.5" in p_lower) else 2
    
    total_seconds = duration_minutes * 60.0
    cycles = total_seconds / 24.0 # 6 оборотов за 24 секунды = 1 накат!
    lost_sheets = cycles * sheets_per_cycle
    lost_tons = round((lost_sheets * weight_kg) / 1000.0, 3)
    
    pmetrics = get_product_financial_metrics(product_name)
    unit_margin = pmetrics.get("margin", 755.0)
    lost_tenge = round(lost_sheets * unit_margin, 2)
    
    return lost_tons, lost_tenge


@router.post("/api/downtimes/directory/sync_from_google")
def sync_downtime_directory_from_google_sheets_endpoint(request: Request, db: Session = Depends(get_db)):
    auth_user = get_authenticated_user_from_request(request, db)
    if auth_user:
        user_id = auth_user.id
        user_role = get_primary_role(auth_user)
    else:
        user_id = request.session.get("user_id")
        user_role = request.session.get("user_role")

    if (user_role or "").lower() in ("workshop_master", "master"):
        user_role = "master"

    if not user_id or not user_role:
        raise HTTPException(status_code=401, detail="Не авторизован")
    return {"status": "success", "message": "Справочник простоев ведется и управляется напрямую в панели администратора"}


@router.get("/api/downtimes/directory/departments")
def get_downtime_departments(db: Session = Depends(get_db)):
    results = db.query(models.DowntimeDirectory.department).distinct().all()
    return [r[0] for r in results if r[0]]


@router.get("/api/downtimes/directory/nodes")
def get_downtime_nodes(department: str, db: Session = Depends(get_db)):
    results = db.query(models.DowntimeDirectory.node).filter(models.DowntimeDirectory.department == department).distinct().all()
    return [r[0] for r in results if r[0]]


@router.get("/api/downtimes/directory/breakdowns")
def get_downtime_breakdowns(department: str, node: str, db: Session = Depends(get_db)):
    results = db.query(models.DowntimeDirectory.breakdown, models.DowntimeDirectory.comment, models.DowntimeDirectory.category).filter(
        models.DowntimeDirectory.department == department,
        models.DowntimeDirectory.node == node
    ).all()
    return [{"breakdown": r[0], "comment": r[1], "category": r[2]} for r in results if r[0]]


@router.get("/api/downtimes/directory", response_model=list[schemas.DowntimeDirectory])
def get_downtime_directory(db: Session = Depends(get_db)):
    return db.query(models.DowntimeDirectory).order_by(
        models.DowntimeDirectory.department,
        models.DowntimeDirectory.node,
        models.DowntimeDirectory.breakdown
    ).all()


@router.post("/api/downtimes/directory", response_model=schemas.DowntimeDirectory)
def create_downtime_directory_entry(data: schemas.DowntimeDirectoryCreate, request: Request, db: Session = Depends(get_db)):
    admin = check_admin_session(request, db)
    entry = models.DowntimeDirectory(**data.model_dump())
    db.add(entry)
    db.commit()
    db.refresh(entry)
    
    log = models.AuditLog(
        timestamp=datetime.utcnow(),
        user_name=admin.name,
        action="CREATE",
        target_table="downtime_directory",
        target_id=entry.id,
        details=f"Добавлена запись: {entry.department} -> {entry.node} -> {entry.breakdown} (Категория: {entry.category})"
    )
    db.add(log)
    db.commit()
    return entry


@router.put("/api/downtimes/directory/{entry_id}", response_model=schemas.DowntimeDirectory)
def update_downtime_directory_entry(entry_id: int, data: schemas.DowntimeDirectoryCreate, request: Request, db: Session = Depends(get_db)):
    admin = check_admin_session(request, db)
    entry = db.query(models.DowntimeDirectory).get(entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    
    old_details = f"{entry.department} -> {entry.node} -> {entry.breakdown} (Категория: {entry.category}, Комментарий: {entry.comment})"
    
    entry.department = data.department
    entry.node = data.node
    entry.breakdown = data.breakdown
    entry.category = data.category
    entry.comment = data.comment
    db.commit()
    db.refresh(entry)
    
    new_details = f"{entry.department} -> {entry.node} -> {entry.breakdown} (Категория: {entry.category}, Комментарий: {entry.comment})"
    
    log = models.AuditLog(
        timestamp=datetime.utcnow(),
        user_name=admin.name,
        action="UPDATE",
        target_table="downtime_directory",
        target_id=entry.id,
        details=f"Изменена запись ID {entry_id}: {old_details} -> {new_details}"
    )
    db.add(log)
    db.commit()
    return entry


@router.delete("/api/downtimes/directory/{entry_id}")
def delete_downtime_directory_entry(entry_id: int, request: Request, db: Session = Depends(get_db)):
    admin = check_admin_session(request, db)
    entry = db.query(models.DowntimeDirectory).get(entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    
    log = models.AuditLog(
        timestamp=datetime.utcnow(),
        user_name=admin.name,
        action="DELETE",
        target_table="downtime_directory",
        target_id=entry.id,
        details=f"Удалена запись ID {entry_id}: {entry.department} -> {entry.node} -> {entry.breakdown}"
    )
    db.add(log)
    db.delete(entry)
    db.commit()
    return {"status": "ok"}


@router.post("/api/downtimes", response_model=schemas.Downtime)
def create_autonomous_downtime(data: schemas.DowntimeCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    duration = 0
    if data.end_time and data.start_time:
        fmt = "%H:%M"
        try:
            t_start = datetime.strptime(data.start_time.strip(), fmt)
            t_end = datetime.strptime(data.end_time.strip(), fmt)
            if t_end < t_start:
                duration = int((t_end.timestamp() + 24*3600 - t_start.timestamp()) / 60)
            else:
                duration = int((t_end - t_start).total_seconds() / 60)
        except Exception:
            duration = 0
            
    shift = None
    shift_id = None
    if data.date and data.shift_name and data.line:
        shift = db.query(models.Shift).filter(
            models.Shift.date == data.date,
            models.Shift.shift_name == data.shift_name,
            models.Shift.line == data.line
        ).first()
        if shift:
            shift_id = shift.id
            
    lost_tons, lost_tenge = calculate_downtime_losses(duration, shift, db)
    status = "resolved" if data.end_time else "pending"
    
    desc_text = (data.description or data.comment or "").strip()
    desc_kz_text = (data.description_kz or "").strip()
    category_val = data.category or ""
    node_val = data.node or ""
    dept_val = data.department or ""
    is_equipment_val = data.is_equipment_downtime if data.is_equipment_downtime is not None else True
    
    base_date = data.date or (shift.date if shift else None)
    s_name = data.shift_name or (shift.shift_name if shift else "")
    actual_date = compute_downtime_actual_date(base_date, s_name, data.start_time)

    dt_data = data.model_dump(exclude={"status", "category", "node", "department", "is_equipment_downtime", "date", "shift_name", "line", "master_id", "actual_date"})
    dt_data["description"] = desc_text
    dt_data["description_kz"] = desc_kz_text
    dt_data["comment"] = data.comment or desc_text
    dt_data["category"] = category_val
    dt_data["node"] = node_val
    dt_data["department"] = dept_val
    dt_data["is_equipment_downtime"] = is_equipment_val
    
    db_dt = models.Downtime(
        **dt_data,
        shift_id=shift_id,
        date=data.date,
        actual_date=actual_date,
        shift_name=data.shift_name,
        line=data.line,
        master_id=data.master_id,
        duration=duration,
        lost_tons=lost_tons,
        lost_tenge=lost_tenge,
        status=status,
        created_at=datetime.utcnow()
    )
    db.add(db_dt)
    db.commit()
    db.refresh(db_dt)
    background_tasks.add_task(sync_downtimes_bg)
    return db_dt


@router.get("/api/downtimes/by_slot")
def get_downtimes_by_slot(date: str, shift_name: str, line: str, db: Session = Depends(get_db)):
    try:
        if hasattr(date, "strftime"):
            parsed_date = date.date() if hasattr(date, "date") else date
        else:
            parsed_date = datetime.strptime(str(date), "%Y-%m-%d").date()
    except Exception:
        raise HTTPException(400, "Неверный формат даты. Ожидается YYYY-MM-DD")
        
    downtimes = db.query(models.Downtime).outerjoin(models.Shift).filter(
        or_(
            models.Downtime.date == parsed_date,
            and_(models.Downtime.date.is_(None), models.Shift.date == parsed_date)
        ),
        or_(
            models.Downtime.shift_name == shift_name,
            and_(models.Downtime.shift_name.is_(None), models.Shift.shift_name == shift_name)
        ),
        or_(
            models.Downtime.line == line,
            and_(models.Downtime.line.is_(None), models.Shift.line == line)
        )
    ).all()
    
    # Chronological sorting for the shift: in night shifts, evening (18-23) comes before morning (00-11)
    def shift_sort_key(d):
        t = (d.start_time or "").strip()
        h = 0
        try:
            h = int(t.split(":")[0])
        except Exception:
            pass
        if shift_name == "Ночь":
            period = 0 if h >= 12 else 1
            return (period, t, d.id or 0)
        return (t, d.id or 0)

    downtimes = sorted(downtimes, key=shift_sort_key)
    
    result = []
    for d in downtimes:
        d_dict = schemas.Downtime.model_validate(d).model_dump()
        d_dict["record_date"] = str(d.record_date) if d.record_date else str(parsed_date)
        effective_act = d.actual_date or d.effective_actual_date
        d_dict["actual_date"] = str(effective_act) if effective_act else str(parsed_date)
        d_dict["is_next_day"] = bool(effective_act and parsed_date and effective_act > parsed_date)
        d_dict["record_shift_name"] = d.record_shift_name or shift_name
        d_dict["record_line"] = d.record_line or line
        d_dict["master_name"] = d.master.name if d.master else (d.shift.master.name if d.shift and d.shift.master else "Н/Д")
        result.append(d_dict)
    return result


@router.post("/api/shifts/{shift_id}/downtimes", response_model=schemas.Downtime)
def create_downtime(shift_id: int, data: schemas.DowntimeCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    shift = db.query(models.Shift).get(shift_id)
    if not shift: raise HTTPException(404)
    
    duration = 0
    if data.end_time and data.start_time:
        fmt = "%H:%M"
        try:
            t_start = datetime.strptime(data.start_time.strip(), fmt)
            t_end = datetime.strptime(data.end_time.strip(), fmt)
            if t_end < t_start:
                duration = int((t_end.timestamp() + 24*3600 - t_start.timestamp()) / 60)
            else:
                duration = int((t_end - t_start).total_seconds() / 60)
        except Exception:
            duration = 0
            
    lost_tons, lost_tenge = calculate_downtime_losses(duration, shift, db)
    status = "resolved" if data.end_time else "pending"
    
    desc_text = (data.description or data.comment or "").strip()
    category_val = data.category or ""
    node_val = data.node or ""
    dept_val = data.department or ""
    is_equipment_val = data.is_equipment_downtime if data.is_equipment_downtime is not None else True
    
    base_date = data.date or shift.date
    s_name = data.shift_name or shift.shift_name
    actual_date = compute_downtime_actual_date(base_date, s_name, data.start_time)

    dt_data = data.model_dump(exclude={"status", "category", "node", "department", "is_equipment_downtime", "date", "shift_name", "line", "master_id", "actual_date"})
    dt_data["description"] = desc_text
    dt_data["comment"] = data.comment or desc_text
    dt_data["category"] = category_val
    dt_data["node"] = node_val
    dt_data["department"] = dept_val
    dt_data["is_equipment_downtime"] = is_equipment_val
    
    db_dt = models.Downtime(
        **dt_data,
        shift_id=shift_id,
        date=data.date or shift.date,
        actual_date=actual_date,
        shift_name=data.shift_name or shift.shift_name,
        line=data.line or shift.line,
        master_id=data.master_id or shift.master_id,
        duration=duration,
        lost_tons=lost_tons,
        lost_tenge=lost_tenge,
        status=status,
        created_at=datetime.utcnow()
    )
    db.add(db_dt)
    db.commit()
    db.refresh(db_dt)
    background_tasks.add_task(sync_downtimes_bg)
    return db_dt


@router.get("/api/downtimes/{dt_id:int}")
def get_downtime_by_id(dt_id: int, request: Request, db: Session = Depends(get_db)):
    auth_user = get_authenticated_user_from_request(request, db)
    if auth_user:
        user_role = get_primary_role(auth_user)
    else:
        user_role = request.session.get("user_role") if hasattr(request, "session") else None

    if (user_role or "").lower() in ("workshop_master", "master"):
        user_role = "master"

    allowed_roles = {"admin", "director", "tech_director", "production_head", "technologist", "mechanic", "master", "itr", "operator"}
    if not user_role or user_role not in allowed_roles:
        raise HTTPException(status_code=403, detail="Доступ запрещен")

    dt = db.query(models.Downtime).get(dt_id)
    if not dt:
        raise HTTPException(status_code=404, detail="Простой не найден")

    dur = dt.duration or 0
    d_date = dt.effective_actual_date or dt.record_date
    d_date_str = d_date.strftime("%Y-%m-%d") if d_date else ""
    d_date_display = d_date.strftime("%d.%m.%Y") if d_date else "Н/Д"

    m_name = dt.master.name if dt.master else (dt.shift.master.name if (dt.shift and dt.shift.master) else "Мастер не указан")
    line_str = dt.record_line or (dt.shift.line if dt.shift else "Линия 1")
    shift_str = dt.record_shift_name or (dt.shift.shift_name if dt.shift else "День")

    return {
        "id": dt.id,
        "shift_id": dt.shift_id,
        "date": d_date_str,
        "date_display": d_date_display,
        "line": line_str,
        "shift_name": shift_str,
        "master_id": dt.master_id,
        "master_name": m_name,
        "start_time": dt.start_time or "",
        "end_time": dt.end_time or "",
        "duration": dur,
        "duration_formatted": format_minutes_hh_mm_ss(dur),
        "category": dt.category or "Без категории",
        "department": dt.department or "",
        "node": dt.node or "Основное оборудование",
        "description": dt.description or dt.comment or "",
        "description_kz": dt.description_kz or "",
        "comment": dt.comment or "",
        "is_equipment_downtime": dt.is_equipment_downtime if dt.is_equipment_downtime is not None else True,
        "lost_tons": dt.lost_tons or 0.0,
        "lost_tenge": dt.lost_tenge or 0.0,
        "status": dt.status or "pending",
        "created_at": dt.created_at.isoformat() if dt.created_at else None
    }


@router.put("/api/downtimes/{dt_id}", response_model=schemas.Downtime)
def update_downtime(dt_id: int, data: schemas.DowntimeCreate, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    auth_user = get_authenticated_user_from_request(request, db)
    if auth_user:
        user_id = auth_user.id
        user_name = auth_user.name
        user_role = get_primary_role(auth_user)
    else:
        user_id = request.session.get("user_id")
        user_name = request.session.get("user_name", "Unknown")
        user_role = request.session.get("user_role")

    if (user_role or "").lower() in ("workshop_master", "master"):
        user_role = "master"

    if not user_role or not user_id:
        raise HTTPException(status_code=401, detail="Не авторизован")

    allowed_roles = {"admin", "director", "tech_director", "production_head", "technologist", "mechanic", "master"}
    privileged_roles = {"admin", "director", "tech_director", "production_head", "technologist", "mechanic"}

    if user_role not in allowed_roles:
        raise HTTPException(status_code=403, detail="Доступ запрещен")

    dt = db.query(models.Downtime).get(dt_id)
    if not dt: raise HTTPException(404, "Простой не найден")
    
    # 30-минутный лимит действует только для линейного мастера
    if user_role not in privileged_roles and dt.created_at:
        time_diff = (datetime.utcnow() - dt.created_at).total_seconds()
        if time_diff > 1800:
            raise HTTPException(
                status_code=403, 
                detail="Время на самостоятельное редактирование простоя (30 мин) истекло. Обратитесь к администратору или главному технологу."
            )
    
    duration = 0
    if data.end_time and data.start_time:
        fmt = "%H:%M"
        try:
            t_start = datetime.strptime(data.start_time.strip(), fmt)
            t_end = datetime.strptime(data.end_time.strip(), fmt)
            if t_end < t_start:
                duration = int((t_end.timestamp() + 24*3600 - t_start.timestamp()) / 60)
            else:
                duration = int((t_end - t_start).total_seconds() / 60)
        except Exception:
            duration = 0
            
    shift = dt.shift
    if not shift and dt.shift_id:
        shift = db.query(models.Shift).get(dt.shift_id)
        
    lost_tons, lost_tenge = calculate_downtime_losses(duration, shift, db)
    status = "resolved" if data.end_time else "pending"
    
    desc_text = (data.description or data.comment or "").strip()
    category_val = data.category or dt.category or ""
    node_val = data.node or dt.node or ""
    dept_val = data.department or dt.department or ""
    is_equipment_val = data.is_equipment_downtime if data.is_equipment_downtime is not None else dt.is_equipment_downtime
    
    base_date = dt.date or (shift.date if shift else None)
    s_name = dt.shift_name or (shift.shift_name if shift else "")
    dt.actual_date = compute_downtime_actual_date(base_date, s_name, data.start_time)

    dt.start_time = data.start_time
    dt.end_time = data.end_time
    if data.line:
        dt.line = data.line.strip()
    dt.description = desc_text
    if data.description_kz is not None:
        dt.description_kz = data.description_kz.strip()
    dt.comment = data.comment or desc_text
    dt.category = category_val
    dt.department = dept_val
    dt.node = node_val
    dt.media_urls = data.media_urls
    dt.is_equipment_downtime = is_equipment_val
    dt.duration = duration
    dt.lost_tons = lost_tons
    dt.lost_tenge = lost_tenge
    dt.status = status
    if data.breakdowns:
        dt.breakdowns = data.breakdowns
        
    db.add(models.AuditLog(
        user_name=user_name,
        action="UPDATE",
        target_table="downtimes",
        target_id=dt_id,
        details=f"Обновлен простой ID {dt_id} пользователем {user_name} ({user_role}): {desc_text}, линия {dt.line}, {duration} мин"
    ))
    db.commit()
    db.refresh(dt)
    background_tasks.add_task(sync_downtimes_bg)
    return dt


@router.delete("/api/downtimes/{dt_id}")
def delete_downtime(dt_id: int, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    auth_user = get_authenticated_user_from_request(request, db)
    if auth_user:
        user_id = auth_user.id
        user_name = auth_user.name
        user_role = get_primary_role(auth_user)
    else:
        user_id = request.session.get("user_id")
        user_name = request.session.get("user_name", "Unknown")
        user_role = request.session.get("user_role")

    if (user_role or "").lower() in ("workshop_master", "master"):
        user_role = "master"

    if not user_role or not user_id:
        raise HTTPException(status_code=401, detail="Не авторизован")

    allowed_roles = {"admin", "director", "tech_director", "production_head", "technologist", "mechanic", "master"}
    privileged_roles = {"admin", "director", "tech_director", "production_head", "technologist", "mechanic"}

    if user_role not in allowed_roles:
        raise HTTPException(status_code=403, detail="Доступ запрещен")

    dt = db.query(models.Downtime).get(dt_id)
    if not dt: raise HTTPException(404, "Простой не найден")
    
    # 30-минутный лимит действует только для линейного мастера
    if user_role not in privileged_roles and dt.created_at:
        time_diff = (datetime.utcnow() - dt.created_at).total_seconds()
        if time_diff > 1800:
            raise HTTPException(
                status_code=403, 
                detail="Время на самостоятельное удаление простоя (30 мин) истекло. Обратитесь к администратору или главному технологу."
            )
            
    db.add(models.AuditLog(
        user_name=user_name,
        action="DELETE",
        target_table="downtimes",
        target_id=dt_id,
        details=f"Удален простой ID {dt_id} пользователем {user_name} ({user_role}): {dt.description or ''}, {dt.duration or 0} мин."
    ))
    db.delete(dt)
    db.commit()
    background_tasks.add_task(sync_downtimes_bg)
    return {"status": "ok"}


@router.post("/api/dashboard/sync_downtimes_to_google")
def sync_downtimes_to_google(request: Request, db: Session = Depends(get_db)):
    auth_user = get_authenticated_user_from_request(request, db)
    if auth_user:
        user_id = auth_user.id
        user_name = auth_user.name
        user_role = get_primary_role(auth_user)
    else:
        user_id = request.session.get("user_id")
        user_role = request.session.get("user_role")
        user_name = request.session.get("user_name", "Unknown")

    if (user_role or "").lower() in ("workshop_master", "master"):
        user_role = "master"
        
    if not user_id:
        raise HTTPException(status_code=401, detail="Вы не авторизованы")
        
    if user_role not in ["master", "admin", "director", "mechanic"]:
        raise HTTPException(status_code=403, detail="Доступ запрещен.")
        
    try:
        if google_sheets_integration:
            google_sheets_integration.export_downtimes_to_google_sheets(db)
            db.add(models.AuditLog(
                user_name=user_name,
                action="EXPORT",
                target_table="downtimes",
                target_id=0,
                details="Ручная выгрузка простоев в Google Таблицы выполнена успешно."
            ))
            db.commit()
        return {"message": "Выгрузка простоев в Google Таблицы выполнена успешно!"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка выгрузки простоев в Google: {str(e)}")


@router.get("/api/admin/downtimes/all")
def get_all_admin_downtimes(
    limit: int = 200, 
    offset: int = 0,
    request: Request = None, 
    db: Session = Depends(get_db)
):
    admin = check_admin_session(request, db)
    downtimes = db.query(models.Downtime).outerjoin(models.Shift).order_by(
        func.coalesce(models.Downtime.date, models.Shift.date).desc(),
        models.Downtime.id.desc()
    ).offset(offset).limit(limit).all()
    
    result = []
    for d in downtimes:
        d_dict = {
            "id": d.id,
            "shift_id": d.shift_id,
            "start_time": d.start_time,
            "end_time": d.end_time,
            "duration": d.duration,
            "category": d.category,
            "department": d.department,
            "node": d.node,
            "description": d.description,
            "status": d.status,
            "is_equipment_downtime": d.is_equipment_downtime,
            "lost_tons": d.lost_tons,
            "lost_tenge": d.lost_tenge,
            "shift_date": d.record_date,
            "shift_line": d.record_line,
            "shift_name": d.record_shift_name
        }
        if d.master:
            d_dict["master_name"] = d.master.name
        elif d.shift and d.shift.master:
            d_dict["master_name"] = d.shift.master.name
        else:
            d_dict["master_name"] = "Н/Д"
        result.append(d_dict)
    return result


@router.put("/api/admin/downtimes/{downtime_id}")
def admin_update_downtime(downtime_id: int, data: dict, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    admin = check_admin_session(request, db)
    dt = db.query(models.Downtime).get(downtime_id)
    if not dt: raise HTTPException(404, "Простой не найден")
    
    old_values = {}
    new_values = {}
    
    # Safe date conversion
    if "date" in data:
        raw_date = data["date"]
        if isinstance(raw_date, str) and raw_date.strip():
            try:
                data["date"] = datetime.strptime(raw_date.strip(), "%Y-%m-%d").date()
            except Exception:
                try:
                    data["date"] = datetime.strptime(raw_date.strip(), "%d.%m.%Y").date()
                except Exception:
                    data["date"] = None
        elif not raw_date:
            data["date"] = None

    # Free text synchronization (description and comment)
    if "description" in data or "comment" in data:
        desc_text = (data.get("description") or data.get("comment") or "").strip()
        data["description"] = desc_text
        data["comment"] = desc_text

    for key, val in data.items():
        if hasattr(dt, key):
            old_val = getattr(dt, key)
            if old_val != val:
                old_values[key] = str(old_val)
                new_values[key] = str(val)
                setattr(dt, key, val)

    # Actual date recalculation (e.g. night shift crossover)
    cur_date = dt.date or (dt.shift.date if dt.shift else None)
    cur_shift = dt.shift_name or (dt.shift.shift_name if dt.shift else "")
    cur_start = dt.start_time
    new_act_date = compute_downtime_actual_date(cur_date, cur_shift, cur_start)
    if dt.actual_date != new_act_date:
        dt.actual_date = new_act_date

    # Recalculate duration if 0 and start/end are set
    if (not dt.duration or dt.duration <= 0) and dt.start_time and dt.end_time:
        try:
            t_start = datetime.strptime(dt.start_time.strip(), "%H:%M")
            t_end = datetime.strptime(dt.end_time.strip(), "%H:%M")
            if t_end < t_start:
                dt.duration = int((t_end.timestamp() + 24*3600 - t_start.timestamp()) / 60)
            else:
                dt.duration = int((t_end - t_start).total_seconds() / 60)
        except Exception:
            pass

    # Recalculate losses if empty and duration is known
    if (not dt.lost_tons or not dt.lost_tenge) and dt.duration:
        shift = dt.shift or (db.query(models.Shift).get(dt.shift_id) if dt.shift_id else None)
        auto_tons, auto_tenge = calculate_downtime_losses(dt.duration, shift, db)
        if not dt.lost_tons:
            dt.lost_tons = auto_tons
        if not dt.lost_tenge:
            dt.lost_tenge = auto_tenge
                
    if old_values:
        log_entry = models.AuditLog(
            timestamp=datetime.utcnow(),
            user_name=admin.name,
            action=f"Редактирование простоя ID {downtime_id}",
            details=f"Смена {dt.shift_id}. Изменено: {old_values} -> {new_values}"
        )
        db.add(log_entry)
        db.commit()
    else:
        db.commit()
    background_tasks.add_task(sync_downtimes_bg)
    return {"status": "ok"}


@router.delete("/api/admin/downtimes/{downtime_id}")
def admin_delete_downtime(downtime_id: int, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    admin = check_admin_session(request, db)
    dt = db.query(models.Downtime).get(downtime_id)
    if not dt: raise HTTPException(404, "Простой не найден")
    
    log_entry = models.AuditLog(
        timestamp=datetime.utcnow(),
        user_name=admin.name,
        action=f"Удаление простоя ID {downtime_id}",
        details=f"Смена {dt.shift_id}. Удалено описание: {dt.description}, длительность: {dt.duration} мин."
    )
    db.add(log_entry)
    db.delete(dt)
    db.commit()
    background_tasks.add_task(sync_downtimes_bg)
    return {"status": "ok"}


@router.post("/api/downtimes/transcribe-voice")
async def transcribe_voice_downtime(file: UploadFile = File(...)):
    """
    Транскрибация голосового сообщения мастера смены о простое.
    Поддерживает казахский язык, русский язык и смешанную цеховую речь.
    Переводит и форматирует речь в понятный технический русский текст для журнала.
    """
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="GEMINI_API_KEY не настроен в переменных окружения сервера"
        )

    # Чтение аудиофайла
    audio_bytes = await file.read()
    if not audio_bytes or len(audio_bytes) < 100:
        raise HTTPException(
            status_code=400,
            detail="Аудиозапись пуста или не содержит данных"
        )

    # Ограничение размера 15 МБ
    if len(audio_bytes) > 15 * 1024 * 1024:
        raise HTTPException(
            status_code=400,
            detail="Размер аудиозаписи превышает допустимый лимит (15 МБ)"
        )

    # Очистка MIME-типа (отсекаем параметры кодеков вроде ;codecs=opus)
    raw_content_type = (file.content_type or "audio/webm").split(";")[0].strip().lower()
    valid_mimes = {
        "audio/webm": "audio/webm",
        "audio/ogg": "audio/ogg",
        "audio/mp4": "audio/mp4",
        "audio/mpeg": "audio/mp3",
        "audio/mp3": "audio/mp3",
        "audio/wav": "audio/wav",
        "audio/x-wav": "audio/wav",
        "audio/aac": "audio/aac",
        "audio/m4a": "audio/mp4",
        "video/webm": "audio/webm",
        "video/mp4": "audio/mp4"
    }
    mime_type = valid_mimes.get(raw_content_type, "audio/webm")

    b64_data = base64.b64encode(audio_bytes).decode("utf-8")

    prompt = (
        "Ты — дежурный диспетчер асбестоцементного завода Tectum.\n"
        "Мастер смены надиктовал голосовое сообщение о причине простоя или выполненных работах на оборудовании.\n"
        "Речь может звучать на казахском языке, русском языке или их смеси (цеховой суржик с техническими терминами).\n\n"
        "Твоя задача:\n"
        "1. Внимательно прослушай аудиозапись.\n"
        "2. Если речь на казахском языке или смешанная — переведи её на грамотный, понятный технический русский язык. Если на русском — оставь на русском, исправив невнятные речевые оговорки и шумы.\n"
        "3. Выдай ТОЛЬКО краткое, четкое описание произошедшего для журнала сменного рапорта (например: 'Остановка стакера, чистка кармана и замена ножей').\n"
        "4. Запрещено добавлять вводные слова, приветствия, кавычки, комментарии от себя или markdown-разметку. Ответь ТОЛЬКО чистым текстом описания простоя."
    )

    candidate_models = [
        "gemini-3.5-flash-lite",
        "gemini-3.1-flash-lite",
        "gemini-flash-lite-latest",
        "gemini-3.6-flash",
        "gemini-3.8-flash",
        "gemini-3.7-flash",
        "gemini-3.5-flash",
        "gemini-flash-latest"
    ]

    payload = {
        "contents": [
            {
                "parts": [
                    {
                        "inlineData": {
                            "mimeType": mime_type,
                            "data": b64_data
                        }
                    },
                    {
                        "text": prompt
                    }
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 300
        }
    }
    encoded_payload = json.dumps(payload).encode("utf-8")

    last_err = None
    for model_name in candidate_models:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
        req = urllib.request.Request(
            url,
            data=encoded_payload,
            headers={"Content-Type": "application/json"}
        )

        for attempt in range(2):
            try:
                with urllib.request.urlopen(req, timeout=20) as resp:
                    resp_data = json.loads(resp.read().decode("utf-8"))
                    candidates = resp_data.get("candidates", [])
                    if candidates and "content" in candidates[0]:
                        parts = candidates[0]["content"].get("parts", [])
                        if parts and "text" in parts[0]:
                            transcribed_text = parts[0]["text"].strip()
                            if (transcribed_text.startswith('"') and transcribed_text.endswith('"')) or \
                               (transcribed_text.startswith("'") and transcribed_text.endswith("'")):
                                transcribed_text = transcribed_text[1:-1].strip()
                            return {
                                "status": "ok",
                                "text": transcribed_text,
                                "model_used": model_name
                            }
            except urllib.error.HTTPError as e:
                last_err = f"{model_name} HTTP {e.code}"
                if e.code in (429, 503):
                    time.sleep(0.5)
                    continue
                else:
                    break
            except Exception as e:
                last_err = str(e)
                time.sleep(0.3)
                continue

    raise HTTPException(
        status_code=503,
        detail=f"Не удалось распознать голосовое сообщение ({last_err}). Пожалуйста, повторите попытку или введите текст вручную."
    )


@router.post("/api/downtimes/translate")
def translate_downtime_text(payload: dict = Body(...)):
    """
    Чистый двусторонний перевод RU <-> KZ через проверенный движок Планнера без изменения текста.
    """
    from routers.planner import detect_and_translate_task_text

    raw_text = (payload.get("text", "") if isinstance(payload, dict) else str(payload)).strip()
    source_lang = (payload.get("source_lang", "auto") if isinstance(payload, dict) else "auto").strip().lower()

    if not raw_text:
        return {"status": "ok", "text_ru": "", "text_kz": "", "detected_lang": "ru"}

    forced_source = "kk" if source_lang in ("kk", "kk-kz", "kz") else (None if source_lang == "auto" else source_lang)
    return detect_and_translate_task_text(raw_text, forced_source=forced_source)


@router.post("/api/downtimes/normalize-and-translate")
def normalize_and_translate_downtime_text(payload: dict = Body(...)):
    return translate_downtime_text(payload)



# -------------------------------------------------------------
# Режим технолога: Инлайн-классификация, Лента и Экспорт в Google
# -------------------------------------------------------------

def check_technologist_or_admin(request: Request, db: Session):
    user = get_authenticated_user_from_request(request, db)
    allowed_roles = {"admin", "director", "tech_director", "production_head", "technologist", "mechanic"}
    if user:
        primary_role = get_primary_role(user)
        if primary_role in allowed_roles:
            return user
    
    # Legacy session checks
    user_id = request.session.get('user_id') if hasattr(request, 'session') else None
    role = request.session.get('user_role') if hasattr(request, 'session') else None
    if user_id and role in allowed_roles:
        u = db.query(models.User).get(user_id)
        if u:
            return u

    pin_header = request.headers.get('x-admin-pin') or request.headers.get('x-pin')
    if pin_header:
        u = db.query(models.User).filter(models.User.pin_code == pin_header.strip()).first()
        if u and get_primary_role(u) in allowed_roles:
            return u

    raise HTTPException(status_code=403, detail="Доступ разрешен только главному технологу или руководству.")


def format_minutes_hh_mm_ss(mins: int) -> str:
    h = mins // 60
    m = mins % 60
    return f"{h}:{m:02d}:00"


@router.patch("/api/downtimes/{downtime_id}/classify")
def classify_downtime_endpoint(
    downtime_id: int,
    data: schemas.DowntimeClassifyUpdate,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Быстрая инлайн-классификация простоя технологом или администратором.
    Атомарно обновляет категорию и признак остановки оборудования.
    """
    user = check_technologist_or_admin(request, db)
    dt = db.query(models.Downtime).get(downtime_id)
    if not dt:
        raise HTTPException(status_code=404, detail="Простой не найден")

    old_cat = dt.category or "Без категории"
    new_cat = (data.category or "").strip()
    if not new_cat:
        new_cat = "Без категории"

    dt.category = new_cat

    # Если меняется признак остановки оборудования
    if data.is_equipment_downtime is not None:
        dt.is_equipment_downtime = bool(data.is_equipment_downtime)
    elif new_cat == "Остановки не связанные с простоем оборудования":
        dt.is_equipment_downtime = False

    if data.node and data.node.strip():
        dt.node = data.node.strip()

    # Аудит
    try:
        user_name = getattr(user, 'name', 'Технолог')
        audit = models.AuditLog(
            user_name=user_name,
            action="CLASSIFY_DOWNTIME",
            details=f"Простой #{dt.id}: категория изменена с '{old_cat}' на '{new_cat}', простой оборудования: {dt.is_equipment_downtime}"
        )
        db.add(audit)
    except Exception:
        pass

    db.commit()
    db.refresh(dt)

    if background_tasks:
        background_tasks.add_task(sync_downtimes_bg)

    return {
        "success": True,
        "id": dt.id,
        "category": dt.category,
        "is_equipment_downtime": dt.is_equipment_downtime,
        "node": dt.node
    }


@router.get("/api/downtimes/feed")
def get_downtimes_feed(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    line: Optional[str] = None,
    unclassified_only: bool = False,
    category: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 500,
    offset: int = 0,
    db: Session = Depends(get_db)
):
    """
    Оптимизированная выдача простоев для рабочего стола технолога и журнала админки.
    """
    from sqlalchemy.orm import joinedload
    query = db.query(models.Downtime).options(
        joinedload(models.Downtime.shift),
        joinedload(models.Downtime.master)
    ).outerjoin(models.Shift, models.Downtime.shift_id == models.Shift.id)

    # Парсинг дат
    s_date = None
    e_date = None
    if start_date:
        try:
            s_date = datetime.strptime(start_date.strip(), "%Y-%m-%d").date()
        except Exception:
            try: s_date = datetime.strptime(start_date.strip(), "%d.%m.%Y").date()
            except Exception: pass
    if end_date:
        try:
            e_date = datetime.strptime(end_date.strip(), "%Y-%m-%d").date()
        except Exception:
            try: e_date = datetime.strptime(end_date.strip(), "%d.%m.%Y").date()
            except Exception: pass

    effective_dt_date = func.coalesce(models.Downtime.actual_date, models.Downtime.date, models.Shift.date)
    if s_date:
        query = query.filter(effective_dt_date >= s_date)
    if e_date:
        query = query.filter(effective_dt_date <= e_date)

    # Фильтр линии
    if line and line not in ("all", "Все линии", "Все", "СВОД"):
        clean_line = "Линия 1" if "1" in line else ("Линия 2" if "2" in line else line)
        query = query.filter(
            or_(
                models.Downtime.line == clean_line,
                and_(models.Downtime.line.is_(None), models.Shift.line == clean_line)
            )
        )

    # Поиск по подстроке
    if search and search.strip():
        term = f"%{search.strip().lower()}%"
        query = query.filter(
            or_(
                func.lower(models.Downtime.description).like(term),
                func.lower(models.Downtime.comment).like(term),
                func.lower(models.Downtime.node).like(term),
                func.lower(models.Downtime.category).like(term)
            )
        )

    # Каноническое условие неклассифицированного простоя
    unclass_condition = or_(
        models.Downtime.category.is_(None),
        models.Downtime.category == "",
        func.lower(func.trim(models.Downtime.category)).in_([
            "без категории", "не классифицировано", "-", "none", "не указана"
        ])
    )

    # Базовые счетчики для пилюль до применения сужающих фильтров категории
    total_period_count = query.count()
    unclassified_count = query.filter(unclass_condition).count()

    # Фильтр категории
    if category and category != "all":
        if category == "unclassified" or category == "Без категории":
            unclassified_only = True
        else:
            query = query.filter(models.Downtime.category == category)

    if unclassified_only:
        query = query.filter(unclass_condition)

    # Сортировка: сначала свежие
    query = query.order_by(
        func.coalesce(models.Downtime.actual_date, models.Downtime.date, models.Shift.date).desc(),
        models.Downtime.id.desc()
    )

    filtered_total = query.count() if (unclassified_only or (category and category != "all")) else total_period_count
    records = query.offset(offset).limit(limit).all()

    items = []
    for d in records:
        dur = d.duration or 0
        d_date = d.effective_actual_date or d.record_date
        d_date_str = d_date.strftime("%d.%m.%Y") if d_date else "Н/Д"

        m_name = d.master.name if d.master else (d.shift.master.name if (d.shift and d.shift.master) else "Мастер не указан")
        line_str = d.record_line or (d.shift.line if d.shift else "Линия 1")
        shift_str = d.record_shift_name or (d.shift.shift_name if d.shift else "День")

        cat = (d.category or "").strip()
        is_unclass = not cat or cat in ("Без категории", "Не классифицировано", "-", "None", "не указана")

        items.append({
            "id": d.id,
            "date": d_date_str,
            "line": line_str,
            "shift_name": shift_str,
            "master_name": m_name,
            "start_time": d.start_time or "--:--",
            "end_time": d.end_time or "--:--",
            "duration_minutes": dur,
            "duration_formatted": format_minutes_hh_mm_ss(dur),
            "category": cat or "Без категории",
            "is_unclassified": is_unclass,
            "node": d.node or "Основное оборудование",
            "description": d.description or d.comment or "",
            "is_equipment_downtime": d.is_equipment_downtime if d.is_equipment_downtime is not None else True,
            "lost_tons": d.lost_tons or 0.0,
            "lost_tenge": d.lost_tenge or 0.0
        })

    return {
        "total": total_period_count,
        "unclassified_count": unclassified_count,
        "filtered_total": filtered_total,
        "count": len(items),
        "items": items
    }


@router.get("/api/downtimes/report-summary")
def get_downtimes_report_summary(
    start_date: str,
    end_date: str,
    line: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """
    Формирует структуру отчета по простоям за период, сгруппированную по 5 каноническим категориям
    с шапкой KPI выработки, планами (39 000 нед. / 160 000 мес.) и финансовыми потерями.
    """
    from sqlalchemy.orm import joinedload

    try:
        sd = datetime.strptime(start_date.strip(), "%Y-%m-%d").date()
    except Exception:
        sd = datetime.strptime(start_date.strip(), "%d.%m.%Y").date()

    try:
        ed = datetime.strptime(end_date.strip(), "%Y-%m-%d").date()
    except Exception:
        ed = datetime.strptime(end_date.strip(), "%d.%m.%Y").date()

    num_days = max(1, (ed - sd).days + 1)
    total_operating_hours = num_days * 24

    # 1. Загружаем смены
    shifts_q = db.query(models.Shift).filter(
        models.Shift.date >= sd,
        models.Shift.date <= ed
    )
    clean_line = None
    if line and line not in ("all", "Все линии", "Все", "СВОД"):
        clean_line = "Линия 1" if "1" in line else ("Линия 2" if "2" in line else line)
        shifts_q = shifts_q.filter(models.Shift.line == clean_line)

    shifts = shifts_q.all()

    # Применяем утвержденные целевые планы завода (160k мес / 39k нед / 2700 день [0 в Пн] / 3300 ночь)
    is_whole_month = (
        sd.day == 1 and 
        ed.day == calendar.monthrange(sd.year, sd.month)[1] and 
        sd.year == ed.year and 
        sd.month == ed.month
    ) or (sd.day == 1 and num_days in (28, 29, 30, 31) and sd.month == ed.month)
    is_standard_week = (num_days == 7)

    if is_whole_month:
        # 1. Весь месяц — директивный утвержденный план завода
        plan_sheets = 40000 if clean_line == "Линия 1" else 160000
    elif is_standard_week:
        # 2. Ровно неделя — директивный недельный план завода
        plan_sheets = 13000 if clean_line == "Линия 1" else 39000
    else:
        # 3. Произвольный диапазон дат — расчет по сменным планам календаря завода
        #    (День: 2700 шт. [0 в Пн — сан-день], Ночь: 3300 шт. для Линии 2 / Общего; для Линии 1: 800 [0 в Пн] / 1200)
        calc_plan = 0
        for i in range(num_days):
            cur_d = sd + timedelta(days=i)
            is_mon = (cur_d.weekday() == 0)
            if clean_line == "Линия 1":
                day_plan = 0 if is_mon else 800
                night_plan = 1200
            else:
                day_plan = 0 if is_mon else 2700
                night_plan = 3300
            calc_plan += (day_plan + night_plan)
        plan_sheets = calc_plan

    shift_ids = [s.id for s in shifts]
    fact_sheets = 0
    if shift_ids:
        lfm_sum = db.query(func.sum(models.LFMReport.lfm_sheets)).filter(models.LFMReport.shift_id.in_(shift_ids)).scalar()
        fact_sheets = int(lfm_sum or 0)

    overproduction_sheets = max(0, fact_sheets - plan_sheets)

    # 2. Загружаем простои (с учетом фактической даты actual_date, даты простоя и даты смены)
    effective_dt_date = func.coalesce(models.Downtime.actual_date, models.Downtime.date, models.Shift.date)
    dts_q = db.query(models.Downtime).options(
        joinedload(models.Downtime.shift),
        joinedload(models.Downtime.master)
    ).outerjoin(models.Shift, models.Downtime.shift_id == models.Shift.id).filter(
        effective_dt_date >= sd,
        effective_dt_date <= ed
    )
    if line and line not in ("all", "Все линии", "Все", "СВОД"):
        clean_line = "Линия 1" if "1" in line else ("Линия 2" if "2" in line else line)
        dts_q = dts_q.filter(
            or_(
                models.Downtime.line == clean_line,
                and_(models.Downtime.line.is_(None), models.Shift.line == clean_line)
            )
        )

    all_dts = dts_q.all()

    # Физический расчет формования:
    # 6 оборотов за 24 секунды = 1 накат.
    # 1 накат = 2 листа продукции (для 7 волн 3.5м - 1 лист).
    # Номинальный темп: 5 листов/мин (300 листов/час).
    from routers.common import get_product_finished_weight_kg

    processed_dts = []
    total_stop_minutes = 0
    total_lost_sheets_all = 0
    total_lost_tons_all = 0.0
    total_lost_margin_all = 0.0
    total_lost_revenue_all = 0.0

    for d in all_dts:
        dur = d.duration or 0
        is_stop = (d.is_equipment_downtime is not False)
        prod_name = (d.shift.product_name if d.shift and d.shift.product_name else "Шифер 8 волн рифленый")
        w_kg = get_product_finished_weight_kg(db, prod_name)
        p_lower = prod_name.lower()
        spc = 1 if ("3500" in p_lower or "3.5" in p_lower) else 2

        if is_stop and dur > 0:
            total_stop_minutes += dur
            rolls = round((dur * 60.0) / 24.0, 1)
            sheets = int(round(rolls * spc))
            tons = round((sheets * w_kg) / 1000.0, 3)
        else:
            rolls = 0.0
            sheets = 0
            tons = 0.0

        pmetrics = get_product_financial_metrics(prod_name)
        unit_margin = pmetrics.get("margin", 755.0)
        unit_price = pmetrics.get("price_cash", 2200.0)
        lost_margin = round(sheets * unit_margin, 2)
        lost_revenue = round(sheets * unit_price, 2)

        total_lost_sheets_all += sheets
        total_lost_tons_all += tons
        total_lost_margin_all += lost_margin
        total_lost_revenue_all += lost_revenue

        processed_dts.append({
            "downtime": d,
            "duration": dur,
            "is_stop": is_stop,
            "product_name": prod_name,
            "weight_kg": w_kg,
            "rolls": rolls,
            "lost_sheets": sheets,
            "lost_tons": tons,
            "lost_margin": lost_margin,
            "lost_revenue": lost_revenue
        })

    cat_defs = [
        {"key": "mech", "title": "Механические:", "search": ["механ"], "color": "#f6b26b"},
        {"key": "energy", "title": "Энергетические:", "search": ["энерг", "электр"], "color": "#ffe599"},
        {"key": "tech", "title": "Технологические:", "search": ["технолог"], "color": "#ffd966"},
        {"key": "maint", "title": "ТО и ППР:", "search": ["то и ппр", "ппр", "санитарный"], "color": "#b6d7a8"},
        {"key": "no_stop", "title": "Остановки не связанные с простоем оборудования:", "search": ["без простоя", "не связан"], "color": "#f9cb9c"},
        {"key": "unclassified", "title": "Требуют классификации:", "search": [], "color": "#ef4444"}
    ]

    def get_record_cat_key(p_item):
        dt_record = p_item["downtime"]
        c_name = (dt_record.category or "").strip().lower()
        if not c_name or c_name in ("без категории", "не классифицировано", "-", "none", "не указана"):
            return "unclassified"
        if any(s in c_name for s in ["механ"]):
            return "mech"
        if any(s in c_name for s in ["энерг", "электр"]):
            return "energy"
        if any(s in c_name for s in ["технолог"]):
            return "tech"
        if any(s in c_name for s in ["то и ппр", "ппр", "санитарный"]):
            return "maint"
        if any(s in c_name for s in ["без простоя", "не связан"]) or (not p_item["is_stop"]):
            return "no_stop"
        return "unclassified"

    total_downtime_minutes = sum(p["duration"] for p in processed_dts)
    categories_res = []

    for cdef in cat_defs:
        c_key = cdef["key"]
        c_items = []
        c_mins = 0
        c_rolls = 0.0
        c_sheets = 0
        c_tons = 0.0
        c_margin = 0.0
        c_revenue = 0.0

        for p in processed_dts:
            if get_record_cat_key(p) == c_key:
                d = p["downtime"]
                dur = p["duration"]
                c_mins += dur
                c_rolls += p["rolls"]
                c_sheets += p["lost_sheets"]
                c_tons += p["lost_tons"]
                c_margin += p["lost_margin"]
                c_revenue += p["lost_revenue"]

                d_date = d.effective_actual_date or d.record_date
                d_date_str = d_date.strftime("%d.%m.%Y") if d_date else "Н/Д"
                m_name = d.master.name if d.master else (d.shift.master.name if (d.shift and d.shift.master) else "Мастер не указан")
                reason = d.description or d.comment or ""
                if d.node and d.node != "Основное оборудование" and not reason.startswith(d.node):
                    reason = f"{d.node}. {reason}"

                pct_time = (dur / (total_operating_hours * 60)) if total_operating_hours > 0 else 0.0

                c_items.append({
                    "id": d.id,
                    "date": d_date_str,
                    "shift_name": d.record_shift_name or "День",
                    "master_name": m_name,
                    "node": d.node or "Основное оборудование",
                    "reason": reason,
                    "start_time": d.start_time or "--:--",
                    "end_time": d.end_time or "--:--",
                    "duration_minutes": dur,
                    "duration_formatted": format_minutes_hh_mm_ss(dur),
                    "is_equipment_downtime": p["is_stop"],
                    "lost_rolls": p["rolls"],
                    "lost_sheets": p["lost_sheets"],
                    "lost_tons": p["lost_tons"],
                    "lost_margin_tenge": p["lost_margin"],
                    "lost_revenue_tenge": p["lost_revenue"],
                    "annual_margin_loss_tenge": round((p["lost_margin"] / num_days) * 365.0, 2),
                    "annual_revenue_loss_tenge": round((p["lost_revenue"] / num_days) * 365.0, 2),
                    "annual_lost_sheets": int(round((p["lost_sheets"] / num_days) * 365.0)),
                    "annual_lost_hours": round(((dur / 60.0) / num_days) * 365.0, 1),
                    "percentage_of_pure_time": round(pct_time, 4)
                })
        annual_margin = round((c_margin / num_days) * 365.0, 2)
        annual_revenue = round((c_revenue / num_days) * 365.0, 2)
        annual_sheets = int(round((c_sheets / num_days) * 365.0))
        annual_tons = round((c_tons / num_days) * 365.0, 2)
        annual_hours = round(((c_mins / 60.0) / num_days) * 365.0, 1)

        categories_res.append({
            "key": cdef["key"],
            "title": cdef["title"],
            "color": cdef["color"],
            "total_minutes": c_mins,
            "total_formatted": format_minutes_hh_mm_ss(c_mins),
            "lost_rolls": round(c_rolls, 1),
            "lost_sheets": c_sheets,
            "lost_tons": round(c_tons, 2),
            "lost_margin_tenge": round(c_margin, 2),
            "lost_revenue_tenge": round(c_revenue, 2),
            "percentage_of_pure_time": round(c_mins / (total_operating_hours * 60), 4) if total_operating_hours > 0 else 0.0,
            "count": len(c_items),
            "annualized": {
                "annual_margin_loss_tenge": annual_margin,
                "annual_revenue_loss_tenge": annual_revenue,
                "annual_lost_sheets": annual_sheets,
                "annual_lost_tons": annual_tons,
                "annual_lost_hours": annual_hours
            },
            "items": c_items
        })

    # ТОП повторяющихся узлов и неполадок (Рейтинг годового ущерба)
    node_groups = {}
    for p in processed_dts:
        d = p["downtime"]
        node = (d.node or "Основное оборудование").strip()
        reason = (d.description or d.comment or "").strip()
        if node not in node_groups:
            node_groups[node] = {
                "node": node,
                "count": 0,
                "total_minutes": 0,
                "lost_sheets": 0,
                "lost_tons": 0.0,
                "lost_margin_tenge": 0.0,
                "lost_revenue_tenge": 0.0,
                "sample_reasons": []
            }
        ng = node_groups[node]
        ng["count"] += 1
        ng["total_minutes"] += p["duration"]
        ng["lost_sheets"] += p["lost_sheets"]
        ng["lost_tons"] += p["lost_tons"]
        ng["lost_margin_tenge"] += p["lost_margin"]
        ng["lost_revenue_tenge"] += p["lost_revenue"]
        if reason and reason not in ng["sample_reasons"] and len(ng["sample_reasons"]) < 3:
            ng["sample_reasons"].append(reason)

    top_recurring = []
    for node, ng in node_groups.items():
        ann_loss = round((ng["lost_margin_tenge"] / num_days) * 365.0, 2)
        ann_sheets = int(round((ng["lost_sheets"] / num_days) * 365.0))
        ann_hours = round(((ng["total_minutes"] / 60.0) / num_days) * 365.0, 1)
        top_recurring.append({
            "node": node,
            "count": ng["count"],
            "total_minutes": ng["total_minutes"],
            "total_formatted": format_minutes_hh_mm_ss(ng["total_minutes"]),
            "lost_sheets": ng["lost_sheets"],
            "lost_tons": round(ng["lost_tons"], 2),
            "lost_margin_tenge": round(ng["lost_margin_tenge"], 2),
            "lost_revenue_tenge": round(ng["lost_revenue_tenge"], 2),
            "annual_margin_loss_tenge": ann_loss,
            "annual_lost_sheets": ann_sheets,
            "annual_lost_hours": ann_hours,
            "sample_reasons": ng["sample_reasons"]
        })

    top_recurring.sort(key=lambda x: x["annual_margin_loss_tenge"], reverse=True)
    top_recurring = top_recurring[:10]

    unclass_items = []
    for d in all_dts:
        c_name = (d.category or "").strip().lower()
        if not c_name or c_name in ("без категории", "не классифицировано", "-", "none", "не указана"):
            dur = d.duration or 0
            d_date = d.effective_actual_date or d.record_date
            d_date_str = d_date.strftime("%d.%m.%Y") if d_date else "Н/Д"
            m_name = d.master.name if d.master else (d.shift.master.name if (d.shift and d.shift.master) else "Мастер не указан")
            reason = d.description or d.comment or ""
            if d.node and d.node != "Основное оборудование" and not reason.startswith(d.node):
                reason = f"{d.node}. {reason}"
            unclass_items.append({
                "id": d.id,
                "date": d_date_str,
                "shift_name": d.record_shift_name or "День",
                "master_name": m_name,
                "reason": reason,
                "start_time": d.start_time or "--:--",
                "end_time": d.end_time or "--:--",
                "duration_minutes": dur,
                "duration_formatted": format_minutes_hh_mm_ss(dur)
            })

    potential_sheets = fact_sheets + total_lost_sheets_all
    capacity_loss_percent = round((total_lost_sheets_all / potential_sheets * 100.0), 2) if potential_sheets > 0 else 0.0
    availability_rate_percent = round(((total_operating_hours * 60 - total_stop_minutes) / (total_operating_hours * 60) * 100.0), 2) if total_operating_hours > 0 else 100.0

    # Фактически отработанное время: плановые часы периода минус общие часы простоев
    actual_operating_minutes = max(0, total_operating_hours * 60 - total_downtime_minutes)
    actual_operating_hours = round(actual_operating_minutes / 60.0, 2)
    actual_operating_hours_formatted = format_minutes_hh_mm_ss(actual_operating_minutes)
    operating_rate_percent = round((actual_operating_minutes / (total_operating_hours * 60) * 100.0), 2) if total_operating_hours > 0 else 100.0

    annual_margin_loss_all = round((total_lost_margin_all / num_days) * 365.0, 2)
    annual_revenue_loss_all = round((total_lost_revenue_all / num_days) * 365.0, 2)
    annual_lost_sheets_all = int(round((total_lost_sheets_all / num_days) * 365.0))
    annual_lost_tons_all = round((total_lost_tons_all / num_days) * 365.0, 2)
    annual_lost_hours_all = round(((total_stop_minutes / 60.0) / num_days) * 365.0, 1)

    return {
        "start_date": sd.strftime("%d.%m.%Y"),
        "end_date": ed.strftime("%d.%m.%Y"),
        "line": line or "Все линии",
        "total_count": len(all_dts),
        "unclassified_count": sum(1 for p in processed_dts if get_record_cat_key(p) == "unclassified"),
        "kpi": {
            "num_days": num_days,
            "total_operating_hours": total_operating_hours,
            "actual_operating_minutes": actual_operating_minutes,
            "actual_operating_hours": actual_operating_hours,
            "actual_operating_hours_formatted": actual_operating_hours_formatted,
            "operating_rate_percent": operating_rate_percent,
            "plan_sheets": plan_sheets,
            "fact_sheets": fact_sheets,
            "potential_sheets": potential_sheets,
            "capacity_loss_percent": capacity_loss_percent,
            "availability_rate_percent": availability_rate_percent,
            "overproduction_sheets": overproduction_sheets,
            "underproduction_sheets": total_lost_sheets_all,
            "underproduction_tenge": round(total_lost_margin_all, 2),
            "total_lost_sheets": total_lost_sheets_all,
            "total_lost_tons": round(total_lost_tons_all, 2),
            "total_lost_margin_tenge": round(total_lost_margin_all, 2),
            "total_lost_revenue_tenge": round(total_lost_revenue_all, 2),
            "total_downtime_minutes": total_downtime_minutes,
            "total_downtime_formatted": format_minutes_hh_mm_ss(total_downtime_minutes),
            "total_stop_minutes": total_stop_minutes,
            "total_stop_formatted": format_minutes_hh_mm_ss(total_stop_minutes),
            "annualized": {
                "annual_margin_loss_tenge": annual_margin_loss_all,
                "annual_revenue_loss_tenge": annual_revenue_loss_all,
                "annual_lost_sheets": annual_lost_sheets_all,
                "annual_lost_tons": annual_lost_tons_all,
                "annual_lost_hours": annual_lost_hours_all
            }
        },
        "categories": categories_res,
        "top_recurring_losses": top_recurring,
        "unclassified": {
            "count": len(unclass_items),
            "items": unclass_items
        }
    }


@router.post("/api/downtimes/export/google-sheets")
def export_downtimes_to_google_endpoint(
    payload: dict = Body(...),
    request: Request = None,
    db: Session = Depends(get_db)
):
    """
    Экспорт отчета по простоям в отдельную Google Таблицу (DOWNTIMES_SPREADSHEET_ID).
    """
    check_technologist_or_admin(request, db)
    if not google_sheets_integration:
        raise HTTPException(status_code=500, detail="Модуль Google Sheets не доступен")

    start_date = payload.get("start_date")
    end_date = payload.get("end_date")
    if not start_date or not end_date:
        raise HTTPException(status_code=400, detail="Необходимо указать start_date и end_date")

    result = google_sheets_integration.export_downtime_technologist_report_to_google_sheets(
        db, start_date, end_date
    )
    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error", "Ошибка экспорта в Google Sheets"))

    return result

