from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request, BackgroundTasks
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_, func

import models
import schemas
from database import SessionLocal
from routers.common import check_admin_session

try:
    import google_sheets_integration
except ImportError:
    google_sheets_integration = None

try:
    import m365_integration
except ImportError:
    m365_integration = None

router = APIRouter(tags=["downtimes"])

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

TONS_PER_HOUR = 5.0
PRICE_PER_TON = 100000.0

def calculate_downtime_losses(duration_minutes: int, shift: Optional[models.Shift], db: Session) -> tuple[float, float]:
    if duration_minutes <= 0:
        return 0.0, 0.0
        
    product_name = None
    if shift:
        product_name = shift.product_name
        if not product_name and shift.lfm_reports:
            product_name = shift.lfm_reports[-1].product_name
        
    if not product_name:
        product_name = "Шифер 8 волн рифленый"
        
    norm = db.query(models.ProductNorm).filter(models.ProductNorm.product_name == product_name).first()
    weight_kg = norm.weight_kg if (norm and norm.weight_kg) else 19.6
    
    sheets_per_cycle = 1 if product_name == "Шифер 7 волн 3500*980" else 2
    
    total_seconds = duration_minutes * 60
    cycles = total_seconds / 26.0
    lost_sheets = cycles * sheets_per_cycle
    lost_tons = (lost_sheets * weight_kg) / 1000.0
    lost_tenge = lost_tons * PRICE_PER_TON
    
    return lost_tons, lost_tenge

def sync_downtimes_bg():
    db = SessionLocal()
    try:
        if google_sheets_integration:
            google_sheets_integration.export_downtimes_to_google_sheets(db)
    except Exception as e:
        print(f"Error syncing downtimes to Google Sheets: {e}")
        try:
            db.add(models.AuditLog(
                user_name="Google Sync Downtimes",
                action="ERROR",
                details=f"Ошибка экспорта простоев в Google Sheets: {str(e)}"
            ))
            db.commit()
        except Exception:
            pass
    finally:
        db.close()


@router.post("/api/downtimes/directory/sync_from_google")
def sync_downtime_directory_from_google_sheets_endpoint(request: Request, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role")
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
    category_val = data.category or ""
    node_val = data.node or ""
    dept_val = data.department or ""
    is_equipment_val = data.is_equipment_downtime if data.is_equipment_downtime is not None else True
    
    dt_data = data.model_dump(exclude={"status", "category", "node", "department", "is_equipment_downtime", "date", "shift_name", "line", "master_id"})
    dt_data["description"] = desc_text
    dt_data["comment"] = data.comment or desc_text
    dt_data["category"] = category_val
    dt_data["node"] = node_val
    dt_data["department"] = dept_val
    dt_data["is_equipment_downtime"] = is_equipment_val
    
    db_dt = models.Downtime(
        **dt_data,
        shift_id=shift_id,
        date=data.date,
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
    ).order_by(models.Downtime.start_time.asc(), models.Downtime.id.asc()).all()
    
    result = []
    for d in downtimes:
        d_dict = schemas.Downtime.model_validate(d).model_dump()
        d_dict["record_date"] = str(d.record_date) if d.record_date else str(parsed_date)
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
    
    dt_data = data.model_dump(exclude={"status", "category", "node", "department", "is_equipment_downtime", "date", "shift_name", "line", "master_id"})
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


@router.put("/api/downtimes/{dt_id}", response_model=schemas.Downtime)
def update_downtime(dt_id: int, data: schemas.DowntimeCreate, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    user_role = request.session.get("user_role")
    dt = db.query(models.Downtime).get(dt_id)
    if not dt: raise HTTPException(404)
    
    if user_role not in ["admin", "master", "mechanic", "technologist", "director"] and dt.created_at:
        time_diff = (datetime.utcnow() - dt.created_at).total_seconds()
        if time_diff > 1800:
            raise HTTPException(
                status_code=403, 
                detail="Время на самостоятельное редактирование простоя (30 мин) истекло. Обратитесь к администратору."
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
    if not shift:
        shift = db.query(models.Shift).get(dt.shift_id)
        
    lost_tons, lost_tenge = calculate_downtime_losses(duration, shift, db)
    status = "resolved" if data.end_time else "pending"
    
    desc_text = (data.description or data.comment or "").strip()
    category_val = data.category or dt.category or ""
    node_val = data.node or dt.node or ""
    dept_val = data.department or dt.department or ""
    is_equipment_val = data.is_equipment_downtime if data.is_equipment_downtime is not None else dt.is_equipment_downtime
    
    dt.start_time = data.start_time
    dt.end_time = data.end_time
    dt.description = desc_text
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
        
    db.commit()
    db.refresh(dt)
    background_tasks.add_task(sync_downtimes_bg)
    return dt


@router.delete("/api/downtimes/{dt_id}")
def delete_downtime(dt_id: int, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    user_role = request.session.get("user_role")
    dt = db.query(models.Downtime).get(dt_id)
    if not dt: raise HTTPException(404)
    
    if user_role != "admin" and dt.created_at:
        time_diff = (datetime.utcnow() - dt.created_at).total_seconds()
        if time_diff > 1800:
            raise HTTPException(
                status_code=403, 
                detail="Время на самостоятельное удаление простоя (30 мин) истекло. Обратитесь к администратору."
            )
            
    db.delete(dt)
    db.commit()
    background_tasks.add_task(sync_downtimes_bg)
    return {"status": "ok"}


@router.post("/api/dashboard/sync_downtimes_to_google")
def sync_downtimes_to_google(request: Request, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role")
    
    if not user_id:
        raise HTTPException(status_code=401, detail="Вы не авторизованы")
        
    if user_role not in ["master", "admin", "director", "mechanic"]:
        raise HTTPException(status_code=403, detail="Доступ запрещен.")
        
    try:
        if google_sheets_integration:
            google_sheets_integration.export_downtimes_to_google_sheets(db)
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
    for key, val in data.items():
        if hasattr(dt, key):
            old_val = getattr(dt, key)
            if old_val != val:
                old_values[key] = str(old_val)
                new_values[key] = str(val)
                setattr(dt, key, val)
                
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
