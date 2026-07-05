import sys
import os

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import SessionLocal
import models

def check():
    db = SessionLocal()
    try:
        shifts_count = db.query(models.Shift).count()
        batches_count = db.query(models.Batch).count()
        lfm_count = db.query(models.LFMReport).count()
        masters_count = db.query(models.Master).count()
        norms_count = db.query(models.ProductNorm).count()
        
        print("Database Verification Counts:")
        print(f"- Shifts: {shifts_count}")
        print(f"- Batches: {batches_count}")
        print(f"- LFM Reports: {lfm_count}")
        print(f"- Masters: {masters_count}")
        print(f"- Product Norms: {norms_count}")
        
        if shifts_count > 0:
            print("\nSample Shift:")
            first_shift = db.query(models.Shift).first()
            print(f"  ID: {first_shift.id}")
            print(f"  Date: {first_shift.date}")
            print(f"  Shift: {first_shift.shift_name}")
            print(f"  Line: {first_shift.line}")
            print(f"  Master ID: {first_shift.master_id}")
            print(f"  Cement (Silo 1): {first_shift.zo_cement_silo1} kg")
            print(f"  Cellulose: {first_shift.zo_cellulose} kg")
    finally:
        db.close()

if __name__ == '__main__':
    check()
