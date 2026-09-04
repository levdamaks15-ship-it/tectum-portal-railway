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
