from database import SessionLocal
import models
from datetime import date

db = SessionLocal()

d = date(2026, 7, 23)

# 1. Simulate addReceipt (creates shift)
s1 = models.Shift(
    date=d,
    shift_name="День",
    line="Линия 1",
    master_id=1,
    status="closed",
    plan_sheets=0,
    plan_tons=0.0
)
db.add(s1)
db.commit()
db.refresh(s1)
print("Shift 1 ID:", s1.id)

# 2. Simulate save_shift_report querying it
s2 = db.query(models.Shift).filter(
    models.Shift.date == d,
    models.Shift.shift_name == "День",
    models.Shift.line == "Линия 1"
).first()

if s2:
    print("Found Shift ID:", s2.id)
    print("Are they the same?", s1.id == s2.id)
else:
    print("NOT FOUND!")
