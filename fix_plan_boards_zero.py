import sys
import datetime
from sqlalchemy.orm import Session
from database import SessionLocal
import models

def fix_plan_boards():
    db = SessionLocal()
    try:
        boards = db.query(models.MonthlyPlanBoard).filter(models.MonthlyPlanBoard.plan_sheets == 0).all()
        updated_count = 0
        for pb in boards:
            # Check if it's a sanitary day
            date_val = pb.date
            is_monday = False
            if isinstance(date_val, str):
                try:
                    dt_obj = datetime.datetime.strptime(date_val, "%Y-%m-%d").date()
                    is_monday = dt_obj.weekday() == 0
                except:
                    pass
            else:
                try:
                    is_monday = date_val.weekday() == 0
                except:
                    pass
                
            if is_monday and pb.shift_name == "День":
                # Correctly 0
                continue
                
            correct_plan = 2700 if pb.shift_name == "День" else 3300
            
            pb.plan_sheets = correct_plan
            updated_count += 1
            
        db.commit()
        print(f"Updated {updated_count} plan_boards")
    except Exception as e:
        print(f"Error: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    fix_plan_boards()
