import os
from database import SessionLocal
from models import MonthlyPlanBoard, Shift

db = SessionLocal()

pbs = db.query(MonthlyPlanBoard).filter(MonthlyPlanBoard.date >= "2026-07-01").all()
print("--- MonthlyPlanBoard ---")
for pb in pbs:
    if pb.fact_sheets and pb.fact_sheets > 0:
        print(f"PB: {pb.id} | {pb.date} | {pb.line} | {pb.shift_name} | Plan: {pb.plan_sheets} | Fact: {pb.fact_sheets} | Master: {pb.master_id}")

shifts = db.query(Shift).filter(Shift.date >= "2026-07-01").all()
print("\n--- Shifts ---")
for s in shifts:
    lfm_sum = sum(r.lfm_sheets for r in s.lfm_reports)
    print(f"Shift: {s.id} | {s.date} | {s.line} | {s.shift_name} | LFM: {lfm_sum} | Master: {s.master_id}")

db.close()
