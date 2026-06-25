from database import SessionLocal
import models

def fix_mondays():
    db = SessionLocal()
    
    pbs = db.query(models.MonthlyPlanBoard).all()
    count_pb = 0
    for pb in pbs:
        if pb.date.weekday() == 0 and pb.shift_name == "День":
            if pb.plan_sheets != 0:
                pb.plan_sheets = 0
                count_pb += 1

    shifts = db.query(models.Shift).all()
    count_s = 0
    for s in shifts:
        if s.date and s.date.weekday() == 0 and s.shift_name == "День":
            if s.plan_sheets != 0:
                s.plan_sheets = 0
                count_s += 1

    db.commit()
    print(f"Fixed {count_pb} MonthlyPlanBoard and {count_s} Shift records")
    db.close()

if __name__ == "__main__":
    fix_mondays()
