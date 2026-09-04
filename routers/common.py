from fastapi import HTTPException, Request
from sqlalchemy.orm import Session
import models

def check_admin_session(request: Request, db: Session):
    role = request.session.get("user_role")
    user_id = request.session.get("user_id")
    if not user_id or role not in ["admin", "director", "technologist"]:
        raise HTTPException(status_code=403, detail="Доступ запрещен. Требуются права администратора.")
    user = db.query(models.Master).get(user_id)
    if not user or user.role not in ["admin", "director", "technologist"]:
        raise HTTPException(status_code=403, detail="Доступ запрещен. Требуются права администратора.")
    return user

_norms_cache = {}
_norms_cache_time = 0

def _get_norm_cached(db: Session, product_name: str):
    global _norms_cache, _norms_cache_time
    import time
    if time.time() - _norms_cache_time > 60:
        norms = db.query(models.ProductNorm).all()
        _norms_cache = {n.product_name: n for n in norms}
        _norms_cache_time = time.time()
    return _norms_cache.get(product_name)

def get_product_finished_weight_kg(db: Session, product_name: str) -> float:
    norm = _get_norm_cached(db, product_name)
    if not norm or not norm.weight_kg:
        return 19.6
    return norm.weight_kg

def get_product_raw_weight_kg(db: Session, product_name: str) -> float:
    norm = _get_norm_cached(db, product_name)
    if not norm:
        return 18.2
    return (
        (norm.norm_chrysotile_4_20 or 0) +
        (norm.norm_chrysotile_5_65 or 0) +
        (norm.norm_chrysotile_6_40 or 0) +
        (norm.norm_cement or 0) +
        (norm.norm_cellulose or 0) +
        (norm.norm_crushed_slate or 0) +
        (norm.norm_asbozurit or 0) +
        (norm.norm_fiberglass or 0)
    )

def get_last_produced_weight_kg(db: Session, line_identifier: str, before_date_str: str = None) -> float:
    try:
        q = db.query(models.Shift).filter(models.Shift.line.like(f"%{line_identifier}%"))
        if before_date_str:
            q = q.filter(models.Shift.date <= before_date_str)
        shifts = q.order_by(models.Shift.date.desc(), models.Shift.id.desc()).limit(100).all()
        if not shifts:
            shifts = db.query(models.Shift).filter(models.Shift.line.like(f"%{line_identifier}%")).order_by(models.Shift.date.desc(), models.Shift.id.desc()).all()
        for s in shifts:
            if s.lfm_reports:
                for r in reversed(s.lfm_reports):
                    if r.lfm_sheets > 0 and r.product_name:
                        return get_product_finished_weight_kg(db, r.product_name)
    except Exception as e:
        print(f"Error in get_last_produced_weight_kg: {e}")
    return 19.6

def get_shift_plan(db: Session, shift: models.Shift) -> int:
    if shift.plan_sheets is not None and shift.plan_sheets > 0:
        return shift.plan_sheets
    sanitary_downtime = 0
    for dt in shift.downtimes:
        if dt.category == "Санитарный день":
            sanitary_downtime += dt.duration or 0
    if sanitary_downtime > 0:
        return 0
    if getattr(shift, "date", None) and shift.date.weekday() == 0 and shift.shift_name == "День":
        return 0
    return 2700 if shift.shift_name == "День" else 3300

from datetime import datetime
from sqlalchemy import func
import os
from database import SessionLocal
import excel_exporter
import m365_integration
import google_sheets_integration

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def sync_lfm_to_plan_board(shift_date, shift_name: str, shift_line: str, db: Session, master_id: int = None):
    # Map shift line to plan board line
    is_line_1 = "1" in shift_line
    pb_line = "ЛФМ-1" if is_line_1 else "ЛФМ-2"
    
    # Find all shifts matching the date, name, and line
    matching_shifts = db.query(models.Shift).filter(
        models.Shift.date == shift_date,
        models.Shift.shift_name == shift_name,
        models.Shift.line.like("%1%" if is_line_1 else "%2%")
    ).all()
    
    shift_ids = [s.id for s in matching_shifts]
    
    total_sheets = 0
    total_1st = 0
    total_defect = 0
    
    if shift_ids:
        # Calculate sum of sheets from LFM reports, and 1st grade, defect from batches for these shifts
        lfm_stats = db.query(
            func.sum(models.LFMReport.lfm_sheets).label("total_sheets")
        ).filter(models.LFMReport.shift_id.in_(shift_ids)).first()
        
        batch_stats = db.query(
            func.sum(models.Batch.ds_first_grade).label("total_1st"),
            func.sum(models.Batch.ds_defect).label("total_defect")
        ).filter(models.Batch.shift_id.in_(shift_ids)).first()
        
        total_sheets = int(lfm_stats.total_sheets or 0) if lfm_stats else 0
        total_1st = int(batch_stats.total_1st or 0) if batch_stats else 0
        total_defect = int(batch_stats.total_defect or 0) if batch_stats else 0
    
    # Find corresponding MonthlyPlanBoard row
    pb_row = db.query(models.MonthlyPlanBoard).filter(
        models.MonthlyPlanBoard.date == shift_date,
        models.MonthlyPlanBoard.shift_name == shift_name,
        models.MonthlyPlanBoard.line == pb_line
    ).first()
    
    if pb_row:
        old_fact = pb_row.fact_sheets
        pb_row.fact_sheets = total_sheets
        pb_row.first_grade = total_1st
        pb_row.defect = total_defect
        
        # Log to AuditLog (per rules, plan board changes must be logged to AuditLog)
        log_entry = models.AuditLog(
            timestamp=datetime.utcnow(),
            user_name="System Sync (LFM)",
            action="UPDATE",
            target_table="monthly_plan_board",
            target_id=pb_row.id,
            details=f"Синхронизация {shift_line} {shift_date} {shift_name}. Факт обновлен: {old_fact} -> {total_sheets}. 1 сорт: {total_1st}, Брак: {total_defect}."
        )
        db.add(log_entry)
    else:
        # If there are no shifts and no fact, don't create a phantom row
        if total_sheets == 0 and not shift_ids:
            return
            
        final_master_id = master_id if master_id is not None else (matching_shifts[0].master_id if matching_shifts else None)
        if isinstance(shift_date, str):
            try:
                dt_obj = datetime.strptime(shift_date, "%Y-%m-%d").date()
                is_monday = dt_obj.weekday() == 0
            except:
                is_monday = False
        else:
            is_monday = shift_date.weekday() == 0
            
        default_plan_sheets = 0 if is_monday and shift_name == "День" else (2700 if shift_name == "День" else 3300)
        
        # Create a new plan board row if it doesn't exist
        pb_row = models.MonthlyPlanBoard(
            date=shift_date,
            shift_name=shift_name,
            line=pb_line,
            master_id=final_master_id,
            plan_sheets=default_plan_sheets,
            fact_sheets=total_sheets,
            first_grade=total_1st,
            defect=total_defect
        )
        db.add(pb_row)
        db.flush() # get the ID
        
        log_entry = models.AuditLog(
            timestamp=datetime.utcnow(),
            user_name="System Sync (LFM)",
            action="CREATE",
            target_table="monthly_plan_board",
            target_id=pb_row.id,
            details=f"Создана новая запись план-борда для {shift_line} {shift_date} {shift_name}. Факт: {total_sheets}. 1 сорт: {total_1st}, Брак: {total_defect}."
        )
        db.add(log_entry)
        
    db.commit()

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

def sync_google_sheets_bg():
    from database import SessionLocal
    import google_sheets_integration
    db = SessionLocal()
    try:
        google_sheets_integration.sync_report_to_google_sheets(db)
        google_sheets_integration.export_receipt_to_google_sheets(db)
        google_sheets_integration.sync_qcd_reports_to_google_sheets(db)
    except Exception as e:
        print(f"Error syncing reports/receipts to Google Sheets: {e}")
        try:
            db.add(models.AuditLog(
                user_name="Google Sync Reports",
                action="ERROR",
                details=f"Ошибка синхронизации отчетов в Google Sheets: {str(e)}"
            ))
            db.commit()
        except Exception:
            pass
    finally:
        db.close()

def sync_receipts_bg():
    from database import SessionLocal
    import google_sheets_integration
    db = SessionLocal()
    try:
        google_sheets_integration.export_receipt_to_google_sheets(db)
    except Exception as e:
        print(f"Error syncing receipts to Google Sheets: {e}")
    finally:
        db.close()




def calculate_shift_deviations(db: Session, shift: models.Shift):
    # Find LFM reports for the shift
    lfm_reports = shift.lfm_reports
    product_counts = {}
    for r in lfm_reports:
        product_counts[r.product_name] = product_counts.get(r.product_name, 0) + (r.lfm_sheets or 0)
        
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
