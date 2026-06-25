from fastapi import FastAPI, Depends, HTTPException, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from database import SessionLocal, engine, Base
import models, schemas
import os
import m365_integration
from datetime import datetime
from pydantic import BaseModel
from sqlalchemy import or_, func
from contextlib import asynccontextmanager
import seed_norms
import calendar
from datetime import timedelta
import openpyxl
from openpyxl.chart import BarChart, Reference
import io
from fastapi import Response
from urllib.parse import quote

@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    
    # SQLite alter table hack to auto-add columns if they don't exist
    import sqlite3
    try:
        conn = sqlite3.connect("tectum.db")
        conn.execute("ALTER TABLE monthly_plan_board ADD COLUMN first_grade INTEGER DEFAULT 0")
        conn.commit()
        conn.close()
    except: pass
    
    try:
        conn = sqlite3.connect("tectum.db")
        conn.execute("ALTER TABLE monthly_plan_board ADD COLUMN defect INTEGER DEFAULT 0")
        conn.commit()
        conn.close()
    except: pass
    
    db = SessionLocal()
    try:
        if not db.query(models.Master).first():
            db.add(models.Master(name="Бекбосынов", pin="1234", role="master"))
            db.add(models.Master(name="Оператор ЗО", pin="2222", role="zo"))
            db.add(models.Master(name="Машинист ЛФМ", pin="3333", role="lfm"))
            db.add(models.Master(name="Стакер", pin="4444", role="stacker"))
            db.add(models.Master(name="Дестакер", pin="5555", role="destacker"))
            db.add(models.Master(name="Инспектор СКК", pin="6666", role="qcd"))
            db.add(models.Master(name="Механик", pin="8888", role="mechanic"))
            db.commit()
        if not db.query(models.Master).filter(models.Master.role == "director").first():
            db.add(models.Master(name="Директор", pin="7777", role="director"))
            db.commit()
        if not db.query(models.Master).filter(models.Master.role == "admin").first():
            db.add(models.Master(name="Админ", pin="0000", role="admin"))
            db.commit()
    finally:
        db.close()
    
    seed_norms.seed_norms()
    yield

app = FastAPI(title="Tectum Enterprise Portal", lifespan=lifespan)

TONS_PER_HOUR = 5.0
PRICE_PER_TON = 100000.0

if not os.path.exists("static"):
    os.makedirs("static")
app.mount("/static", StaticFiles(directory="static"), name="static")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.get("/")
def read_root():
    return FileResponse("static/index.html")

@app.post("/api/setup_demo_data/")
def setup_demo_data(db: Session = Depends(get_db)):
    if not db.query(models.Master).first():
        db.add(models.Master(name="Бекбосынов", pin="1234", role="master"))
        db.add(models.Master(name="Оператор ЗО", pin="2222", role="zo"))
        db.add(models.Master(name="Машинист ЛФМ", pin="3333", role="lfm"))
        db.add(models.Master(name="Стакер", pin="4444", role="stacker"))
        db.add(models.Master(name="Дестакер", pin="5555", role="destacker"))
        db.add(models.Master(name="Инспектор СКК", pin="6666", role="qcd"))
        db.add(models.Master(name="Механик", pin="8888", role="mechanic"))
        db.commit()
    
    if not db.query(models.Master).filter(models.Master.role == "director").first():
        db.add(models.Master(name="Директор", pin="7777", role="director"))
        db.commit()

    return {"message": "Demo data loaded"}

class LoginRequest(BaseModel):
    name: str
    pin: str

@app.post("/api/login/")
def login(data: LoginRequest, db: Session = Depends(get_db)):
    master = db.query(models.Master).filter(models.Master.name == data.name, models.Master.pin == data.pin).first()
    if not master:
        raise HTTPException(status_code=400, detail="Неверное имя или ПИН-код")
    return {"id": master.id, "name": master.name, "role": master.role}

@app.get("/api/masters/")
def get_masters(db: Session = Depends(get_db)):
    return db.query(models.Master).all()

# --- УПРАВЛЕНИЕ СМЕНОЙ ---
@app.post("/api/shifts/", response_model=schemas.Shift)
def create_shift(shift: schemas.ShiftCreate, db: Session = Depends(get_db)):
    db_shift = models.Shift(**shift.model_dump())
    db.add(db_shift)
    db.commit()
    db.refresh(db_shift)
    return db_shift

@app.get("/api/shifts/active", response_model=list[schemas.Shift])
def get_active_shifts(db: Session = Depends(get_db)):
    return db.query(models.Shift).filter(models.Shift.status == "active").all()

@app.get("/api/shifts/all", response_model=list[schemas.Shift])
def get_all_shifts(db: Session = Depends(get_db)):
    return db.query(models.Shift).order_by(models.Shift.date.desc(), models.Shift.id.desc()).all()

@app.get("/api/shifts/{shift_id}", response_model=schemas.Shift)
def get_single_shift(shift_id: int, db: Session = Depends(get_db)):
    shift = db.query(models.Shift).get(shift_id)
    if not shift: raise HTTPException(404, "Смена не найдена")
    return shift

@app.put("/api/shifts/{shift_id}/close")
def close_shift(shift_id: int, db: Session = Depends(get_db)):
    shift = db.query(models.Shift).get(shift_id)
    if not shift: raise HTTPException(404, "Смена не найдена")
    shift.status = "closed"
    db.commit()
    return {"message": "Смена закрыта"}

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
    asb_drain: float = 0
    cem_drain: float = 0
    batches: int = 0
    submitted: bool = False

@app.post("/api/shifts/{shift_id}/receipt")
def update_receipt(shift_id: int, data: UpdateReceiptZO, db: Session = Depends(get_db)):
    shift = db.query(models.Shift).get(shift_id)
    if not shift: raise HTTPException(404)
    shift.receipt_chrysotile_4_20 = data.chrysotile_4_20
    shift.receipt_chrysotile_5_65 = data.chrysotile_5_65
    shift.receipt_chrysotile_6_40 = data.chrysotile_6_40
    shift.receipt_cement = data.cement
    shift.receipt_cellulose = data.cellulose
    shift.receipt_crushed_slate = data.crushed_slate
    shift.receipt_asbozurit = data.asbozurit
    shift.receipt_fiberglass = data.fiberglass
    shift.receipt_laprol = data.laprol
    db.commit()
    return {"status": "ok"}

@app.post("/api/shifts/{shift_id}/zo")
def update_zo(shift_id: int, data: UpdateReceiptZO, db: Session = Depends(get_db)):
    shift = db.query(models.Shift).get(shift_id)
    if not shift: raise HTTPException(404)
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
    shift.zo_asb_drain = data.asb_drain
    shift.zo_cem_drain = data.cem_drain
    shift.zo_batches = data.batches
    
    shift.zo_submitted = data.submitted
    
    db.commit()
    return {"message": "ZO updated"}

# --- ЛФМ ---
@app.post("/api/shifts/{shift_id}/lfm")
def create_lfm_report(shift_id: int, data: schemas.LFMReportCreate, db: Session = Depends(get_db)):
    shift = db.query(models.Shift).get(shift_id)
    if not shift: raise HTTPException(404)
    db_report = models.LFMReport(**data.model_dump(), shift_id=shift_id)
    db.add(db_report)
    db.commit()
    return {"status": "ok"}

# --- ПРОСТОИ ---
@app.post("/api/upload_media/")
async def upload_media(file: UploadFile = File(...)):
    try:
        file_bytes = await file.read()
        filename = file.filename
        url = m365_integration.upload_file_to_sharepoint(file_bytes, filename)
        return {"url": url}
    except Exception as e:
        print(f"Upload error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/shifts/{shift_id}/downtimes", response_model=schemas.Downtime)
def create_downtime(shift_id: int, data: schemas.DowntimeCreate, db: Session = Depends(get_db)):
    shift = db.query(models.Shift).get(shift_id)
    if not shift: raise HTTPException(404)
    
    duration = 0
    if data.end_time:
        fmt = "%H:%M"
        try:
            t_start = datetime.strptime(data.start_time, fmt)
            t_end = datetime.strptime(data.end_time, fmt)
            if t_end < t_start:
                duration = int((t_end.timestamp() + 24*3600 - t_start.timestamp()) / 60)
            else:
                duration = int((t_end - t_start).total_seconds() / 60)
        except Exception:
            duration = 0
            
    lost_tons = (duration / 60.0) * TONS_PER_HOUR
    lost_tenge = lost_tons * PRICE_PER_TON
    
    status = "resolved" if data.end_time and data.category else "pending"
    
    db_dt = models.Downtime(
        **data.model_dump(exclude={"status"}),
        shift_id=shift_id,
        duration=duration,
        lost_tons=lost_tons,
        lost_tenge=lost_tenge,
        status=status
    )
    db.add(db_dt)
    db.commit()
    db.refresh(db_dt)
    return db_dt

@app.put("/api/downtimes/{dt_id}", response_model=schemas.Downtime)
def update_downtime(dt_id: int, data: schemas.DowntimeCreate, db: Session = Depends(get_db)):
    dt = db.query(models.Downtime).get(dt_id)
    if not dt: raise HTTPException(404)
    
    duration = 0
    if data.end_time:
        fmt = "%H:%M"
        try:
            t_start = datetime.strptime(data.start_time, fmt)
            t_end = datetime.strptime(data.end_time, fmt)
            if t_end < t_start:
                duration = int((t_end.timestamp() + 24*3600 - t_start.timestamp()) / 60)
            else:
                duration = int((t_end - t_start).total_seconds() / 60)
        except Exception:
            duration = 0
            
    lost_tons = (duration / 60.0) * TONS_PER_HOUR
    lost_tenge = lost_tons * PRICE_PER_TON
    
    status = "resolved" if data.end_time and data.category else "pending"
    
    dt.start_time = data.start_time
    dt.end_time = data.end_time
    dt.category = data.category
    dt.node = data.node
    dt.description = data.description
    dt.media_urls = data.media_urls
    dt.duration = duration
    dt.lost_tons = lost_tons
    dt.lost_tenge = lost_tenge
    dt.status = status
    
    db.commit()
    db.refresh(dt)
    return dt

@app.delete("/api/downtimes/{dt_id}")
def delete_downtime(dt_id: int, db: Session = Depends(get_db)):
    dt = db.query(models.Downtime).get(dt_id)
    if not dt: raise HTTPException(404)
    db.delete(dt)
    db.commit()
    return {"status": "ok"}

# --- ПАРТИИ (Стакер) ---
@app.post("/api/batches/")
def create_batch(shift_id: int, data: schemas.BatchCreate, db: Session = Depends(get_db)):
    db_batch = models.Batch(**data.model_dump(exclude={"status"}), shift_id=shift_id, status="stacked")
    db.add(db_batch)
    db.commit()
    db.refresh(db_batch)
    return db_batch

# --- Дестакер и СКК ---
@app.get("/api/batches/pending_destacker", response_model=list[schemas.Batch])
def get_pending_destacker_batches(db: Session = Depends(get_db)):
    # Дестакер видит все партии, которые были уложены (stacked)
    return db.query(models.Batch).filter(models.Batch.status == "stacked").all()

@app.get("/api/batches/pending_qcd", response_model=list[schemas.Batch])
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

@app.post("/api/batches/{batch_id}/destacker")
def update_destacker(batch_id: int, data: DestackerUpdate, db: Session = Depends(get_db)):
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
    return {"status": "ok"}

class QCDUpdate(BaseModel):
    qcd_condition: int
    qcd_first_grade: int
    qcd_defect: int

@app.post("/api/batches/{batch_id}/qcd")
def update_qcd(batch_id: int, data: QCDUpdate, db: Session = Depends(get_db)):
    batch = db.query(models.Batch).get(batch_id)
    if not batch: raise HTTPException(404)
    batch.qcd_condition = data.qcd_condition
    batch.qcd_first_grade = data.qcd_first_grade
    batch.qcd_defect = data.qcd_defect
    batch.status = "qcd_checked"
    db.commit()
    return {"status": "ok"}

@app.get("/api/dashboard/stats")
def get_dashboard_stats(db: Session = Depends(get_db)):
    prod_stats = db.query(
        func.sum(models.Batch.qcd_condition).label('condition'),
        func.sum(models.Batch.qcd_first_grade).label('first_grade'),
        func.sum(models.Batch.qcd_defect).label('defect')
    ).first()

    defects = db.query(
        func.sum(models.Batch.ds_defect_chip).label('chip'),
        func.sum(models.Batch.ds_defect_scratch).label('scratch'),
        func.sum(models.Batch.ds_defect_bad_cut).label('bad_cut'),
        func.sum(models.Batch.ds_defect_stick_bottom).label('stick_bottom'),
        func.sum(models.Batch.ds_defect_stick_top).label('stick_top'),
        func.sum(models.Batch.ds_defect_broken).label('broken'),
        func.sum(models.Batch.ds_defect_fell_box).label('fell_box'),
        func.sum(models.Batch.ds_defect_dent).label('dent'),
        func.sum(models.Batch.ds_defect_thickness).label('thickness'),
        func.sum(models.Batch.ds_defect_delamination).label('delamination'),
        func.sum(models.Batch.ds_defect_edge).label('edge'),
    ).first()

    mats = db.query(
        func.sum(models.Shift.receipt_chrysotile_4_20).label('r_4_20'),
        func.sum(models.Shift.receipt_chrysotile_5_65).label('r_5_65'),
        func.sum(models.Shift.receipt_chrysotile_6_40).label('r_6_40'),
        func.sum(models.Shift.zo_chrysotile_4_20).label('z_4_20'),
        func.sum(models.Shift.zo_chrysotile_5_65).label('z_5_65'),
        func.sum(models.Shift.zo_chrysotile_6_40).label('z_6_40'),
        func.sum(models.Shift.receipt_cement).label('r_cem'),
        func.sum(models.Shift.zo_cement).label('z_cem'),
        func.sum(models.Shift.receipt_cellulose).label('r_cel'),
        func.sum(models.Shift.zo_cellulose).label('z_cel')
    ).first()

    rec_asb = (mats.r_4_20 or 0) + (mats.r_5_65 or 0) + (mats.r_6_40 or 0)
    zo_asb = (mats.z_4_20 or 0) + (mats.z_5_65 or 0) + (mats.z_6_40 or 0)

    # --- DOWNTIME AGGREGATION ---
    downtimes = db.query(models.Downtime).all()
    total_downtime_minutes = sum((d.duration or 0) for d in downtimes)
    total_lost_tons = sum((d.lost_tons or 0) for d in downtimes)
    total_lost_tenge = sum((d.lost_tenge or 0) for d in downtimes)
    
    dt_by_cat = {}
    node_counts = {}
    for d in downtimes:
        if d.category:
            dt_by_cat[d.category] = dt_by_cat.get(d.category, 0) + (d.duration or 0)
        if d.node:
            node_counts[d.node] = node_counts.get(d.node, 0) + 1
            
    top_reasons = sorted([{"node": k, "count": v} for k, v in node_counts.items()], key=lambda x: x['count'], reverse=True)[:5]

    return {
        "production": {
            "condition": prod_stats.condition or 0,
            "first_grade": prod_stats.first_grade or 0,
            "defect": prod_stats.defect or 0
        },
        "defects": {
            "Скол": defects.chip or 0,
            "Сдир": defects.scratch or 0,
            "Плохой рез": defects.bad_cut or 0,
            "Налип снизу": defects.stick_bottom or 0,
            "Налип сверху": defects.stick_top or 0,
            "Сломан": defects.broken or 0,
            "Упал коробки": defects.fell_box or 0,
            "Вмятина": defects.dent or 0,
            "Толщина": defects.thickness or 0,
            "Расслоение": defects.delamination or 0,
            "Кромка": defects.edge or 0
        },
        "materials": {
            "Асбест": {"receipt": rec_asb, "zo": zo_asb},
            "Цемент": {"receipt": mats.r_cem or 0, "zo": mats.z_cem or 0},
            "Целлюлоза": {"receipt": mats.r_cel or 0, "zo": mats.z_cel or 0}
        },
        "downtimes": {
            "total_minutes": total_downtime_minutes,
            "lost_tons": total_lost_tons,
            "lost_tenge": total_lost_tenge,
            "by_category": dt_by_cat,
            "top_reasons": top_reasons
        }
    }

# --- НОРМЫ РАСХОДА И ОТЧЕТ ПО СЫРЬЮ ---
@app.get("/api/norms/", response_model=list[schemas.ProductNorm])
def get_product_norms(db: Session = Depends(get_db)):
    return db.query(models.ProductNorm).all()

def get_product_finished_weight_kg(db: Session, product_name: str) -> float:
    norm = db.query(models.ProductNorm).filter(models.ProductNorm.product_name == product_name).first()
    if not norm or not norm.weight_kg:
        return 19.6 # fallback for 8 волн
    return norm.weight_kg

def get_product_raw_weight_kg(db: Session, product_name: str) -> float:
    norm = db.query(models.ProductNorm).filter(models.ProductNorm.product_name == product_name).first()
    if not norm:
        return 18.2 # fallback
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

@app.get("/api/dashboard/daily_report")
def get_daily_report(start_date: str, line: str = None, db: Session = Depends(get_db)):
    try:
        sd = datetime.strptime(start_date, "%Y-%m-%d").date()
    except:
        raise HTTPException(400, "Invalid date format")
        
    num_days = 7
    ed = sd + timedelta(days=num_days - 1)
    
    shifts = db.query(models.Shift).filter(
        models.Shift.date >= sd,
        models.Shift.date <= ed
    ).all()
    
    plan_boards = db.query(models.MonthlyPlanBoard).filter(
        models.MonthlyPlanBoard.date >= sd,
        models.MonthlyPlanBoard.date <= ed
    ).all()
    
    data = {
        "line_1": {str(sd + timedelta(days=i)): {"День": {"sheets": 0, "tons": 0.0, "plan_sheets": (0 if (sd + timedelta(days=i)).weekday() == 0 else 2700), "plan_tons": (0 if (sd + timedelta(days=i)).weekday() == 0 else 2700) * 19.6 / 1000.0, "first_grade": 0, "defect": 0}, "Ночь": {"sheets": 0, "tons": 0.0, "plan_sheets": 3300, "plan_tons": 3300 * 19.6 / 1000.0, "first_grade": 0, "defect": 0}} for i in range(num_days)},
        "line_2": {str(sd + timedelta(days=i)): {"День": {"sheets": 0, "tons": 0.0, "plan_sheets": (0 if (sd + timedelta(days=i)).weekday() == 0 else 2700), "plan_tons": (0 if (sd + timedelta(days=i)).weekday() == 0 else 2700) * 19.6 / 1000.0, "first_grade": 0, "defect": 0}, "Ночь": {"sheets": 0, "tons": 0.0, "plan_sheets": 3300, "plan_tons": 3300 * 19.6 / 1000.0, "first_grade": 0, "defect": 0}} for i in range(num_days)}
    }
    
    for pb in plan_boards:
        day_key = str(pb.date)
        line_key = "line_1" if pb.line == "ЛФМ-1" else "line_2"
        s_name = pb.shift_name
        if day_key in data[line_key] and s_name in ["День", "Ночь"]:
            data[line_key][day_key][s_name]["plan_sheets"] = pb.plan_sheets or 0
            data[line_key][day_key][s_name]["sheets"] = pb.fact_sheets or 0
            data[line_key][day_key][s_name]["plan_tons"] = (pb.plan_sheets or 0) * 19.6 / 1000.0
            data[line_key][day_key][s_name]["tons"] = (pb.fact_sheets or 0) * 19.6 / 1000.0
            data[line_key][day_key][s_name]["first_grade"] = pb.first_grade or 0
            data[line_key][day_key][s_name]["defect"] = pb.defect or 0
            
    for s in shifts:
        if not s.date: continue
        day_key = str(s.date)
        line_key = "line_1" if "1" in s.line else "line_2"
        s_name = "День" if s.shift_name == "День" else "Ночь"
        
        if day_key not in data[line_key]:
            continue
            
        total_w = 0
        total_s = 0
        for r in s.lfm_reports:
            w_kg = get_product_finished_weight_kg(db, r.product_name)
            data[line_key][day_key][s_name]["first_grade"] += (r.formed_1st_grade or 0)
            data[line_key][day_key][s_name]["defect"] += (r.formed_defect or 0)
            total_w += w_kg * r.lfm_sheets
            total_s += r.lfm_sheets
            
        if total_s > 0:
            # Если есть введенные данные в систему, они приоритетнее или дополняют
            if data[line_key][day_key][s_name]["sheets"] == 0:
                data[line_key][day_key][s_name]["sheets"] = total_s
            avg_w = total_w / total_s
            
            data[line_key][day_key][s_name]["plan_tons"] = data[line_key][day_key][s_name]["plan_sheets"] * avg_w / 1000.0
            data[line_key][day_key][s_name]["tons"] = data[line_key][day_key][s_name]["sheets"] * avg_w / 1000.0
            
    return {
        "days": num_days,
        "start_date": str(sd),
        "data": data
    }

@app.get("/api/dashboard/export_daily_report")
def export_daily_report(start_date: str, line: str = None, db: Session = Depends(get_db)):
    try:
        sd = datetime.strptime(start_date, "%Y-%m-%d").date()
    except:
        raise HTTPException(400, "Invalid date format")
        
    num_days = 14
    ed = sd + timedelta(days=num_days - 1)
    
    shifts = db.query(models.Shift).filter(
        models.Shift.date >= sd,
        models.Shift.date <= ed
    ).all()
    
    plan_boards = db.query(models.MonthlyPlanBoard).filter(
        models.MonthlyPlanBoard.date >= sd,
        models.MonthlyPlanBoard.date <= ed
    ).all()
    
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    
    lines_to_export = [("Линия 1", "ЛФМ-1"), ("Линия 2", "ЛФМ-2")]
    if line == 'lfm1':
        lines_to_export = [("Линия 1", "ЛФМ-1")]
    elif line == 'lfm2':
        lines_to_export = [("Линия 2", "ЛФМ-2")]
        
    for line_id, line_label in lines_to_export:
        ws = wb.create_sheet(title=line_label)
        ws.append(["Дата", "Смена", "План (Листы)", "Факт (Листы)", "План (Тонны)", "Факт (Тонны)", "1-й сорт", "Брак"])
        
        ws.column_dimensions['A'].width = 12
        ws.column_dimensions['B'].width = 8
        ws.column_dimensions['C'].width = 16
        ws.column_dimensions['D'].width = 16
        ws.column_dimensions['E'].width = 16
        ws.column_dimensions['F'].width = 16
        ws.column_dimensions['G'].width = 12
        ws.column_dimensions['H'].width = 12
        
        day_data = {str(sd + timedelta(days=i)): {
            "День": {"sheets": 0, "tons": 0.0, "plan_sheets": (0 if (sd + timedelta(days=i)).weekday() == 0 else 2700), "plan_tons": (0 if (sd + timedelta(days=i)).weekday() == 0 else 2700) * 19.6 / 1000.0, "first_grade": 0, "defect": 0}, 
            "Ночь": {"sheets": 0, "tons": 0.0, "plan_sheets": 3300, "plan_tons": 3300 * 19.6 / 1000.0, "first_grade": 0, "defect": 0}
        } for i in range(num_days)}
        
        for pb in plan_boards:
            if pb.line != line_label: continue
            day_key = str(pb.date)
            s_name = pb.shift_name
            if day_key in day_data and s_name in ["День", "Ночь"]:
                day_data[day_key][s_name]["plan_sheets"] = pb.plan_sheets or 0
                day_data[day_key][s_name]["sheets"] = pb.fact_sheets or 0
                day_data[day_key][s_name]["plan_tons"] = (pb.plan_sheets or 0) * 19.6 / 1000.0
                day_data[day_key][s_name]["tons"] = (pb.fact_sheets or 0) * 19.6 / 1000.0
                day_data[day_key][s_name]["first_grade"] = pb.first_grade or 0
                day_data[day_key][s_name]["defect"] = pb.defect or 0
        
        for s in shifts:
            if not s.date or s.line != line_id: continue
            day_key = str(s.date)
            if day_key not in day_data: continue
            
            s_name = "День" if s.shift_name == "День" else "Ночь"
            
            total_w = 0
            total_s = 0
            for r in s.lfm_reports:
                w_kg = get_product_finished_weight_kg(db, r.product_name)
                total_w += w_kg * r.lfm_sheets
                total_s += r.lfm_sheets
                
            if total_s > 0:
                if day_data[day_key][s_name]["sheets"] == 0:
                    day_data[day_key][s_name]["sheets"] = total_s
                avg_w = total_w / total_s
                
                day_data[day_key][s_name]["plan_tons"] = day_data[day_key][s_name]["plan_sheets"] * avg_w / 1000.0
                day_data[day_key][s_name]["tons"] = day_data[day_key][s_name]["sheets"] * avg_w / 1000.0
                
        row_idx = 2
        for i in range(num_days):
            d_str = str(sd + timedelta(days=i))
            ws.append([d_str, "День", day_data[d_str]["День"]["plan_sheets"], day_data[d_str]["День"]["sheets"], round(day_data[d_str]["День"]["plan_tons"], 2), round(day_data[d_str]["День"]["tons"], 2), day_data[d_str]["День"]["first_grade"], day_data[d_str]["День"]["defect"]])
            ws.append([d_str, "Ночь", day_data[d_str]["Ночь"]["plan_sheets"], day_data[d_str]["Ночь"]["sheets"], round(day_data[d_str]["Ночь"]["plan_tons"], 2), round(day_data[d_str]["Ночь"]["tons"], 2), day_data[d_str]["Ночь"]["first_grade"], day_data[d_str]["Ночь"]["defect"]])
            row_idx += 2
            
        chart_sheets = BarChart()
        chart_sheets.type = "col"
        chart_sheets.style = 10
        chart_sheets.title = f"Выработка {line_label} (Листы)"
        chart_sheets.y_axis.title = 'Количество (Листы)'
        chart_sheets.x_axis.title = 'Дата / Смена'
        
        data_sheets = Reference(ws, min_col=3, min_row=1, max_row=row_idx-1, max_col=4)
        cats = Reference(ws, min_col=1, min_row=2, max_row=row_idx-1, max_col=2)
        
        chart_sheets.add_data(data_sheets, titles_from_data=True)
        chart_sheets.set_categories(cats)
        chart_sheets.width = 20
        
        ws.add_chart(chart_sheets, "H2")
        
        chart_tons = BarChart()
        chart_tons.type = "col"
        chart_tons.style = 10
        chart_tons.title = f"Выработка {line_label} (Тонны)"
        chart_tons.y_axis.title = 'Вес (Тонны)'
        chart_tons.x_axis.title = 'Дата / Смена'
        
        data_tons = Reference(ws, min_col=5, min_row=1, max_row=row_idx-1, max_col=6)
        
        chart_tons.add_data(data_tons, titles_from_data=True)
        chart_tons.set_categories(cats)
        chart_tons.width = 20
        
        ws.add_chart(chart_tons, "H18")
        
    out = io.BytesIO()
    wb.save(out)
    
    filename = f"report_{start_date}_{line or 'all'}.xlsx"
    headers = {
        'Content-Disposition': f'attachment; filename="{filename}"'
    }
    return Response(content=out.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers=headers)

@app.get("/api/dashboard/shift_board")
def get_shift_board(month: str, db: Session = Depends(get_db)):
    try:
        y, m = map(int, month.split('-'))
        num_days = calendar.monthrange(y, m)[1]
    except:
        raise HTTPException(400, "Invalid month format")
        
    month_start = datetime(y, m, 1).date()
    month_end = datetime(y, m, num_days).date()
    shifts = db.query(models.Shift).filter(
        models.Shift.date >= month_start,
        models.Shift.date <= month_end
    ).order_by(models.Shift.date, models.Shift.id).all()
    
    board = {}
    for s in shifts:
        if not s.date: continue
        master = s.master_name or "Неизвестный мастер"
        if master not in board:
            board[master] = []
            
        total_s = 0
        total_w = 0
        for r in s.lfm_reports:
            w_kg = get_product_finished_weight_kg(db, r.product_name)
            total_s += r.lfm_sheets
            total_w += r.lfm_sheets * w_kg
            
        plan_sheets = get_shift_plan(db, s)
        plan_tons = (plan_sheets * 19.6) / 1000.0
        if total_s > 0:
            avg_w = total_w / total_s
            plan_tons = (plan_sheets * avg_w) / 1000.0
            
        board[master].append({
            "shift_id": s.id,
            "date": str(s.date),
            "shift_name": s.shift_name,
            "line": s.line,
            "plan_sheets": plan_sheets,
            "fact_sheets": total_s,
            "plan_tons": round(plan_tons, 2),
            "fact_tons": round(total_w / 1000.0, 2),
            "closed": s.status == "closed"
        })
        
    return board

@app.get("/api/dashboard/export_shift")
def export_shift(shift_id: int, db: Session = Depends(get_db)):
    shift = db.query(models.Shift).get(shift_id)
    if not shift:
        raise HTTPException(404, "Смена не найдена")
        
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = f"Смена {shift_id}"
    
    master = shift.master_name or "Неизвестно"
    date_str = str(shift.date)
    
    ws.append([f"Отчет за смену: {date_str} ({shift.shift_name})"])
    ws.append([f"Мастер: {master}", f"Линия: {shift.line}"])
    ws.append([])
    
    ws.append(["Продукция", "План", "Факт", "Ед. изм."])
    ws.column_dimensions['A'].width = 20
    ws.column_dimensions['B'].width = 12
    ws.column_dimensions['C'].width = 12
    ws.column_dimensions['D'].width = 12
    
    total_sheets = sum(r.lfm_sheets for r in shift.lfm_reports)
    total_tons = sum(r.lfm_sheets * get_product_finished_weight_kg(db, r.product_name) / 1000.0 for r in shift.lfm_reports)
    
    plan_sheets = get_shift_plan(db, shift)
    plan_tons = plan_sheets * (total_tons / total_sheets if total_sheets > 0 else 19.6/1000)
    
    ws.append(["Вся продукция", plan_sheets, total_sheets, "Листы"])
    ws.append(["Вся продукция", round(plan_tons, 2), round(total_tons, 2), "Тонны"])
    
    out = io.BytesIO()
    wb.save(out)
    
    filename = f"shift_{shift_id}.xlsx"
    return Response(content=out.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={'Content-Disposition': f'attachment; filename="{filename}"'})

@app.get("/api/dashboard/export_week")
def export_week(start_date: str, db: Session = Depends(get_db)):
    try:
        sd = datetime.strptime(start_date, "%Y-%m-%d").date()
    except:
        raise HTTPException(400, "Invalid date format, use YYYY-MM-DD")
        
    ed = sd + timedelta(days=6)
    
    shifts = db.query(models.Shift).filter(
        models.Shift.date >= sd,
        models.Shift.date <= ed
    ).order_by(models.Shift.date, models.Shift.id).all()
    
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = f"Неделя {sd} - {ed}"
    
    ws.append([f"Отчет за неделю с {sd} по {ed}"])
    ws.append(["Дата", "Смена", "Мастер", "Линия", "План (Листы)", "Факт (Листы)", "План (Тонны)", "Факт (Тонны)"])
    
    ws.column_dimensions['A'].width = 12
    ws.column_dimensions['B'].width = 8
    ws.column_dimensions['C'].width = 20
    ws.column_dimensions['D'].width = 10
    ws.column_dimensions['E'].width = 15
    ws.column_dimensions['F'].width = 15
    ws.column_dimensions['G'].width = 15
    ws.column_dimensions['H'].width = 15
    
    plan_boards = db.query(models.MonthlyPlanBoard).filter(
        models.MonthlyPlanBoard.date >= sd,
        models.MonthlyPlanBoard.date <= ed
    ).all()
    pb_dict = {(pb.date, pb.shift_name, pb.line): pb for pb in plan_boards}

    active_lines = set([s.line.replace("Линия ", "ЛФМ-") for s in shifts if s.line] + [pb.line for pb in plan_boards])
    if not active_lines:
        active_lines = {"ЛФМ-2"}

    for l_key in active_lines:
        for i in range(7):
            d = sd + timedelta(days=i)
            for s_name in ["День", "Ночь"]:
                plan_sheets = 0 if d.weekday() == 0 and s_name == "День" else (2700 if s_name == "День" else 3300)
                
                pb = pb_dict.get((d, s_name, l_key))
                if pb and pb.plan_sheets is not None:
                    plan_sheets = pb.plan_sheets
                    
                s = next((shift for shift in shifts if shift.date == d and shift.shift_name == s_name and (shift.line.replace("Линия ", "ЛФМ-") if shift.line else "ЛФМ-1") == l_key), None)
                total_sheets = pb.fact_sheets if pb else 0
                
                if s:
                    sum_lfm_sheets = sum(r.lfm_sheets for r in s.lfm_reports)
                    sum_lfm_tons = sum(r.lfm_sheets * get_product_finished_weight_kg(db, r.product_name) / 1000.0 for r in s.lfm_reports)
                    avg_w = (sum_lfm_tons / sum_lfm_sheets) if sum_lfm_sheets > 0 else (19.6/1000)
                    if total_sheets == 0 and sum_lfm_sheets > 0:
                        total_sheets = sum_lfm_sheets
                    master_name = s.master.name if s.master else "Н/Д"
                else:
                    avg_w = 19.6 / 1000.0
                    master_name = "Н/Д"
                    
                plan_tons = plan_sheets * avg_w
                total_tons = total_sheets * avg_w
                
                ws.append([str(d), s_name, master_name, l_key, plan_sheets, total_sheets, round(plan_tons, 2), round(total_tons, 2)])
    out = io.BytesIO()
    wb.save(out)
    
    filename = f"week_{sd}.xlsx"
    return Response(content=out.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={'Content-Disposition': f'attachment; filename="{filename}"'})

@app.get("/api/dashboard/weekly")
def get_weekly_json(start_date: str, db: Session = Depends(get_db)):
    try:
        sd = datetime.strptime(start_date, "%Y-%m-%d").date()
    except:
        raise HTTPException(400, "Invalid date format, use YYYY-MM-DD")
        
    ed = sd + timedelta(days=6)
    
    shifts = db.query(models.Shift).filter(
        models.Shift.date >= sd,
        models.Shift.date <= ed
    ).order_by(models.Shift.date, models.Shift.id).all()
    
    plan_boards = db.query(models.MonthlyPlanBoard).filter(
        models.MonthlyPlanBoard.date >= sd,
        models.MonthlyPlanBoard.date <= ed
    ).all()
    pb_dict = {(pb.date, pb.shift_name, pb.line): pb for pb in plan_boards}
    
    active_lines = set([s.line.replace("Линия ", "ЛФМ-") for s in shifts if s.line] + [pb.line for pb in plan_boards])
    if not active_lines:
        active_lines = {"ЛФМ-2"}
        
    data = []
    
    for l_key in active_lines:
        for i in range(7):
            d = sd + timedelta(days=i)
            day_str = str(d)
            for s_name in ["День", "Ночь"]:
                plan_sheets = 0 if d.weekday() == 0 and s_name == "День" else (2700 if s_name == "День" else 3300)
                
                pb = pb_dict.get((d, s_name, l_key))
                if pb and pb.plan_sheets is not None:
                    plan_sheets = pb.plan_sheets
                    
                s = next((shift for shift in shifts if shift.date == d and shift.shift_name == s_name and (shift.line.replace("Линия ", "ЛФМ-") if shift.line else "ЛФМ-1") == l_key), None)
                total_sheets = pb.fact_sheets if pb else 0
                
                if s:
                    sum_lfm_sheets = sum(r.lfm_sheets for r in s.lfm_reports)
                    sum_lfm_tons = sum(r.lfm_sheets * get_product_finished_weight_kg(db, r.product_name) / 1000.0 for r in s.lfm_reports)
                    avg_w = (sum_lfm_tons / sum_lfm_sheets) if sum_lfm_sheets > 0 else (19.6/1000)
                    if total_sheets == 0 and sum_lfm_sheets > 0:
                        total_sheets = sum_lfm_sheets
                        
                    if pb and (pb.first_grade or pb.defect):
                        ds_first = pb.first_grade
                        ds_defect = pb.defect
                    else:
                        ds_first = sum(b.ds_first_grade for b in s.batches)
                        ds_defect = sum(b.ds_defect for b in s.batches)
                        
                    qcd_first = sum(b.qcd_first_grade for b in s.batches)
                    qcd_defect = sum(b.qcd_defect for b in s.batches)
                    
                    sanitary_note = ""
                    for dt in s.downtimes:
                        if dt.category == "Санитарный день":
                            sanitary_note = "Санитарный день"
                            if dt.duration:
                                sanitary_note += f" ({dt.duration} мин)"
                            break
                    master_name = s.master.name if s.master else "Н/Д"
                    shift_id = s.id
                else:
                    avg_w = 19.6 / 1000.0
                    ds_first = pb.first_grade if pb else 0
                    ds_defect = pb.defect if pb else 0
                    qcd_first = 0
                    qcd_defect = 0
                    sanitary_note = "Санитарный день (план 0)" if d.weekday() == 0 and s_name == "День" else "Нет данных"
                    master_name = "Н/Д"
                    shift_id = None
                    
                plan_tons = plan_sheets * avg_w
                total_tons = total_sheets * avg_w
                
                data.append({
                    "id": shift_id,
                    "date": day_str,
                    "shift_name": s_name,
                    "master": master_name,
                    "line": l_key,
                    "plan_sheets": plan_sheets,
                    "fact_sheets": total_sheets,
                    "plan_tons": round(plan_tons, 2),
                    "fact_tons": round(total_tons, 2),
                    "ds_first_grade": ds_first,
                    "ds_defect": ds_defect,
                    "qcd_first_grade": qcd_first,
                    "qcd_defect": qcd_defect,
                    "note": sanitary_note
                })
        
    return {
        "start_date": str(sd),
        "end_date": str(ed),
        "data": data
    }


@app.get("/api/shifts/{shift_id}/materials_report", response_model=schemas.RawMaterialReport)
def get_materials_report(shift_id: int, db: Session = Depends(get_db)):
    shift = db.query(models.Shift).get(shift_id)
    if not shift:
        raise HTTPException(404, "Смена не найдена")
    
    # 1. Считаем произведенную продукцию (Формовка)
    lfm_reports = db.query(models.LFMReport).filter(models.LFMReport.shift_id == shift_id).all()
    product_counts = {}
    for r in lfm_reports:
        product_counts[r.product_name] = product_counts.get(r.product_name, 0) + r.lfm_sheets
        
    # 2. Получаем нормы для этих продуктов и считаем теорию
    theoretical = {
        "chrysotile_4_20": 0.0, "chrysotile_5_65": 0.0, "chrysotile_6_40": 0.0,
        "cement": 0.0, "cellulose": 0.0, "crushed_slate": 0.0,
        "asbozurit": 0.0, "fiberglass": 0.0
    }
    
    for prod_name, sheets in product_counts.items():
        norm = db.query(models.ProductNorm).filter(models.ProductNorm.product_name == prod_name).first()
        if norm:
            theoretical["chrysotile_4_20"] += sheets * norm.norm_chrysotile_4_20
            theoretical["chrysotile_5_65"] += sheets * norm.norm_chrysotile_5_65
            theoretical["chrysotile_6_40"] += sheets * norm.norm_chrysotile_6_40
            theoretical["cement"] += sheets * norm.norm_cement
            theoretical["cellulose"] += sheets * norm.norm_cellulose
            theoretical["crushed_slate"] += sheets * norm.norm_crushed_slate
            theoretical["asbozurit"] += sheets * norm.norm_asbozurit
            theoretical["fiberglass"] += sheets * norm.norm_fiberglass

    # 3. Формируем детальный отчет (Факт из ZO - Теория)
    details = []
    total_dev = 0.0
    
    mapping = [
        ("Хризотил 4-20", shift.zo_chrysotile_4_20, theoretical["chrysotile_4_20"]),
        ("Хризотил 5-65", shift.zo_chrysotile_5_65, theoretical["chrysotile_5_65"]),
        ("Хризотил 6-40", shift.zo_chrysotile_6_40, theoretical["chrysotile_6_40"]),
        ("Цемент", shift.zo_cement, theoretical["cement"]),
        ("Целлюлоза", shift.zo_cellulose, theoretical["cellulose"]),
        ("Дробленый шифер", shift.zo_crushed_slate, theoretical["crushed_slate"]),
        ("Асбозурит", shift.zo_asbozurit, theoretical["asbozurit"]),
        ("Стекловолокно", shift.zo_fiberglass, theoretical["fiberglass"])
    ]
    
    for mat_name, actual, theory in mapping:
        actual_val = actual or 0.0
        theory_val = theory or 0.0
        dev = actual_val - theory_val
        total_dev += dev
        details.append({
            "material": mat_name,
            "actual": round(actual_val, 2),
            "theoretical": round(theory_val, 2),
            "deviation": round(dev, 2)
        })
        
    return {
        "shift_id": shift_id,
        "total_deviation_kg": round(total_dev, 2),
        "details": details
    }


# --- ADMIN PANEL ENDPOINTS ---

@app.get("/admin")
def read_admin():
    return FileResponse("static/admin.html")

@app.post("/api/admin/masters/", response_model=schemas.Master)
def create_master(master: schemas.MasterCreate, db: Session = Depends(get_db)):
    db_master = models.Master(**master.model_dump())
    db.add(db_master)
    db.commit()
    db.refresh(db_master)
    return db_master

@app.put("/api/admin/masters/{master_id}", response_model=schemas.Master)
def update_master(master_id: int, master: schemas.MasterUpdate, db: Session = Depends(get_db)):
    db_master = db.query(models.Master).get(master_id)
    if not db_master: raise HTTPException(404)
    update_data = master.model_dump(exclude_unset=True)
    for key, val in update_data.items():
        setattr(db_master, key, val)
    db.commit()
    db.refresh(db_master)
    return db_master

@app.delete("/api/admin/masters/{master_id}")
def delete_master(master_id: int, db: Session = Depends(get_db)):
    db_master = db.query(models.Master).get(master_id)
    if not db_master: raise HTTPException(404)
    db.delete(db_master)
    db.commit()
    return {"status": "ok"}

@app.post("/api/admin/norms/", response_model=schemas.ProductNorm)
def create_norm(norm: schemas.ProductNormCreate, db: Session = Depends(get_db)):
    db_norm = models.ProductNorm(**norm.model_dump())
    db.add(db_norm)
    db.commit()
    db.refresh(db_norm)
    return db_norm

@app.put("/api/admin/norms/{norm_id}", response_model=schemas.ProductNorm)
def update_norm(norm_id: int, norm: schemas.ProductNormUpdate, db: Session = Depends(get_db)):
    db_norm = db.query(models.ProductNorm).get(norm_id)
    if not db_norm: raise HTTPException(404)
    update_data = norm.model_dump(exclude_unset=True)
    for key, val in update_data.items():
        setattr(db_norm, key, val)
    db.commit()
    db.refresh(db_norm)
    return db_norm

@app.delete("/api/admin/norms/{norm_id}")
def delete_norm(norm_id: int, db: Session = Depends(get_db)):
    db_norm = db.query(models.ProductNorm).get(norm_id)
    if not db_norm: raise HTTPException(404)
    db.delete(db_norm)
    db.commit()
    return {"status": "ok"}

@app.post("/api/admin/clear_data/")
def clear_operational_data(db: Session = Depends(get_db)):
    try:
        deleted_batches = db.query(models.Batch).delete()
        deleted_lfm = db.query(models.LFMReport).delete()
        deleted_downtime = db.query(models.Downtime).delete()
        deleted_shifts = db.query(models.Shift).delete()
        deleted_plan_board = db.query(models.MonthlyPlanBoard).delete()
        db.commit()
        return {
            "status": "ok",
            "deleted": {
                "batches": deleted_batches,
                "lfm_reports": deleted_lfm,
                "downtimes": deleted_downtime,
                "shifts": deleted_shifts,
                "plan_board": deleted_plan_board
            }
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(500, str(e))

# --- MONTHLY PLAN BOARD ---
@app.get("/api/plan_board", response_model=list[schemas.MonthlyPlanBoard])
def get_plan_board(db: Session = Depends(get_db)):
    return db.query(models.MonthlyPlanBoard).order_by(models.MonthlyPlanBoard.date.desc(), models.MonthlyPlanBoard.shift_number).all()

@app.post("/api/plan_board", response_model=schemas.MonthlyPlanBoard)
def create_or_update_plan_board(data: schemas.MonthlyPlanBoardCreate, db: Session = Depends(get_db)):
    existing = db.query(models.MonthlyPlanBoard).filter(
        models.MonthlyPlanBoard.date == data.date,
        models.MonthlyPlanBoard.shift_number == data.shift_number
    ).first()
    
    if data.date.weekday() == 0 and data.shift_name == "День":
        data.plan_sheets = 0
        
    if existing:
        existing.shift_name = data.shift_name
        existing.master_id = data.master_id
        existing.plan_sheets = data.plan_sheets
        existing.fact_sheets = data.fact_sheets
        db.commit()
        db.refresh(existing)
        return existing
    else:
        new_plan = models.MonthlyPlanBoard(**data.model_dump())
        db.add(new_plan)
        db.commit()
        db.refresh(new_plan)
        return new_plan

@app.post("/api/admin/import_plan_board")
def import_plan_board(db: Session = Depends(get_db)):
    file_path = "monthly_plan_board.xlsx"
    if not os.path.exists(file_path):
        raise HTTPException(404, "Файл monthly_plan_board.xlsx не найден в корне проекта")
    
    try:
        wb = openpyxl.load_workbook(file_path, data_only=True)
        ws = wb["Выработка"] if "Выработка" in wb.sheetnames else wb.active
        
        count_created = 0
        count_updated = 0
        
        # Пропускаем заголовки (первые две строки, например)
        # Ожидаемый формат: Дата (0), Месяц (1), Тип смены (2), Линия (3), Мастер (4), Смена (5), План (6), Факт (7)
        for row in ws.iter_rows(min_row=3, values_only=True):
            if not row[0]: continue # пустая дата
            
            date_val = row[0]
            if isinstance(date_val, datetime):
                date_val = date_val.date()
            elif isinstance(date_val, str):
                try:
                    date_val = datetime.strptime(date_val, "%d.%m.%Y").date()
                except ValueError:
                    try:
                        date_val = datetime.strptime(date_val, "%Y-%m-%d").date()
                    except ValueError:
                        continue
                
            shift_name = str(row[2]) if row[2] else "День"
            
            line_val = str(row[3]).strip() if row[3] else "ЛФМ-1"
            if line_val == "Линия 1":
                line_val = "ЛФМ-1"
            elif line_val == "Линия 2":
                line_val = "ЛФМ-2"
                
            master_name = str(row[4]).strip() if row[4] else ""
            shift_number = int(row[5]) if row[5] else 1
            plan_sheets = int(row[6]) if len(row) > 6 and row[6] else 0
            fact_sheets = int(row[7]) if len(row) > 7 and row[7] else 0
            
            if date_val.weekday() == 0 and shift_name == "День":
                plan_sheets = 0
            
            first_grade = 0
            if len(row) > 8 and row[8] is not None:
                try: first_grade = int(row[8])
                except: pass
                
            defect = 0
            if len(row) > 9 and row[9] is not None:
                try: defect = int(row[9])
                except: pass
            
            # Поиск мастера по имени
            master = db.query(models.Master).filter(models.Master.name == master_name).first()
            if not master:
                # Если мастер не найден, создаем его? Или берем первого попавшегося?
                # Лучше создать, чтобы не терять данные
                master = models.Master(name=master_name, pin="0000", role="master")
                db.add(master)
                db.commit()
                db.refresh(master)
                
            existing = db.query(models.MonthlyPlanBoard).filter(
                models.MonthlyPlanBoard.date == date_val,
                models.MonthlyPlanBoard.shift_number == shift_number,
                models.MonthlyPlanBoard.line == line_val
            ).first()
            
            if existing:
                existing.shift_name = shift_name
                existing.master_id = master.id
                existing.plan_sheets = plan_sheets
                existing.fact_sheets = fact_sheets
                existing.first_grade = first_grade
                existing.defect = defect
                count_updated += 1
            else:
                new_plan = models.MonthlyPlanBoard(
                    date=date_val,
                    shift_name=shift_name,
                    master_id=master.id,
                    shift_number=shift_number,
                    line=line_val,
                    plan_sheets=plan_sheets,
                    fact_sheets=fact_sheets,
                    first_grade=first_grade,
                    defect=defect
                )
                db.add(new_plan)
                count_created += 1
                
        db.commit()
        return {"status": "ok", "created": count_created, "updated": count_updated}
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Ошибка импорта: {str(e)}")
