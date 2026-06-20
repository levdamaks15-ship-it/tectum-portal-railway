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

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Tectum Enterprise Portal")

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
