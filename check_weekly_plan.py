from database import SessionLocal
import models
from sqlalchemy import func
from datetime import datetime, timedelta

db = SessionLocal()

pbs = db.query(models.MonthlyPlanBoard).all()
shifts = db.query(models.Shift).all()

print(f"Total Plan Boards: {len(pbs)}")
print(f"Total Shifts: {len(shifts)}")

min_d = None
if shifts:
    valid_dates = [s.date for s in shifts if s.date]
    if valid_dates:
        min_d = min(valid_dates)
        max_d = max(valid_dates)
        print(f"Shifts range: {min_d} to {max_d}")

if not min_d:
    min_d = datetime(2026, 6, 1).date()

sd = min_d
ed = sd + timedelta(days=6)

print(f"Checking week {sd} to {ed}")
week_shifts = db.query(models.Shift).filter(models.Shift.date >= sd, models.Shift.date <= ed).order_by(models.Shift.date, models.Shift.id).all()

from main import get_shift_plan

total_plan_db = 0
total_plan_dynamic = 0

for s in week_shifts:
    pb_line = s.line.replace("Линия ", "ЛФМ-") if s.line else "ЛФМ-1"
    pb = db.query(models.MonthlyPlanBoard).filter_by(date=s.date, shift_name=s.shift_name, line=pb_line).first()
    pb_plan = pb.plan_sheets if pb and pb.plan_sheets else 0
    dyn_plan = get_shift_plan(db, s)
    total_plan_db += pb_plan
    total_plan_dynamic += dyn_plan
    final_plan = pb_plan if pb_plan > 0 else dyn_plan
    print(f"{s.date} {s.shift_name} ({s.line}) -> pb: {pb_plan}, dyn: {dyn_plan}, final: {final_plan}")
    
print(f"Total PB Plan: {total_plan_db}")
print(f"Total Dynamic Plan: {total_plan_dynamic}")
