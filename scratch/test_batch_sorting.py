import sys, os
sys.path.insert(0, os.path.abspath('.'))
import datetime
from main import get_db, models
from sqlalchemy.orm import Session
from database import SessionLocal

def test_batch_sort():
    db = SessionLocal()
    try:
        test_date = datetime.date(2099, 5, 15)
        # Clean any old test data
        db.query(models.Shift).filter(models.Shift.date == test_date).delete()
        db.commit()

        # Create shift 1 with earlier batch number but created first
        s1 = models.Shift(
            date=test_date,
            shift_name="День",
            line="Линия 2",
            product_name="Шифер 8 волн гладкий",
            batch_number="0212",
            status="closed",
            plan_sheets=100
        )
        db.add(s1)
        db.commit()
        db.refresh(s1)

        # Create shift 2 with later batch number but created second (higher id)
        s2 = models.Shift(
            date=test_date,
            shift_name="День",
            line="Линия 2",
            product_name="Шифер 8 волн рифленый",
            batch_number="0213",
            status="closed",
            plan_sheets=100
        )
        db.add(s2)
        db.commit()
        db.refresh(s2)

        # Query using the exact order_by from get_report_summary
        shifts = db.query(models.Shift).filter(models.Shift.date == test_date).order_by(
            models.Shift.date.desc(),
            models.Shift.line.asc(),
            models.Shift.shift_name.desc(),
            models.Shift.batch_number.desc(),
            models.Shift.id.desc()
        ).all()

        print(f"Total found for {test_date}: {len(shifts)}")
        for idx, s in enumerate(shifts):
            print(f"  Row {idx+1}: batch='{s.batch_number}', product='{s.product_name}', id={s.id}")

        assert len(shifts) == 2
        assert shifts[0].batch_number == "0213", f"Expected 0213 first, got {shifts[0].batch_number}"
        assert shifts[1].batch_number == "0212", f"Expected 0212 second, got {shifts[1].batch_number}"
        print("\nSUCCESS! Batch numbers are sorted descending correctly within the same shift!")

    finally:
        db.query(models.Shift).filter(models.Shift.date == test_date).delete()
        db.commit()
        db.close()

if __name__ == "__main__":
    test_batch_sort()
