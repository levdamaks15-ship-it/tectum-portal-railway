from main import save_shift_report, get_shift_by_params, get_db, SessionLocal
import models
import schemas
from fastapi import BackgroundTasks

class MockRequest:
    def __init__(self, session_data):
        self.session = session_data

def cleanup_test_date(db, date_str):
    shifts = db.query(models.Shift).filter(models.Shift.date == date_str).all()
    for s in shifts:
        db.query(models.LFMReport).filter(models.LFMReport.shift_id == s.id).delete()
        db.query(models.Batch).filter(models.Batch.shift_id == s.id).delete()
        db.query(models.Downtime).filter(models.Downtime.shift_id == s.id).delete()
        db.query(models.RawMaterialReceipt).filter(models.RawMaterialReceipt.shift_id == s.id).delete()
        db.delete(s)
    db.commit()

db = SessionLocal()
try:
    # Find a master or admin
    user = db.query(models.Master).filter(models.Master.role.in_(["admin", "master"])).first()
    if not user:
        print("No master or admin found in DB!")
        exit(1)
    print(f"Testing as: {user.name} (ID: {user.id}, Role: {user.role})")
    master_id = user.id
    login_name = user.name
    
    test_date = "2099-01-01"
    
    # Clean up any previous test runs for 2099-01-01
    cleanup_test_date(db, test_date)
    
    req = MockRequest({"user_id": master_id, "user_role": "admin", "user_name": login_name})
    bg = BackgroundTasks()
    
    data1 = schemas.ShiftReportCreate(
        date=test_date,
        shift_name="День",
        line="Линия 1 (ЛФМ-1)",
        master_id=master_id,
        batch_number="9991",
        product_name="Шифер 8 волн гладкий",
        lfm_sheets=1000,
        first_grade=500,
        zo_batches=10
    )
    
    data2 = schemas.ShiftReportCreate(
        date=test_date,
        shift_name="День",
        line="Линия 1 (ЛФМ-1)",
        master_id=master_id,
        batch_number="9992",
        product_name="Шифер 8 волн рифленый",
        lfm_sheets=500,
        first_grade=250,
        zo_batches=5
    )
    
    print(f"\n--- Saving Report 1 (Batch 9991, Шифер 8 волн гладкий) on {test_date} ---")
    res1 = save_shift_report(data=data1, request=req, background_tasks=bg, db=db)
    print("Result 1:", res1)
    
    print(f"\n--- Saving Report 2 (Batch 9992, Шифер 8 волн рифленый) on {test_date} ---")
    res2 = save_shift_report(data=data2, request=req, background_tasks=bg, db=db)
    print("Result 2:", res2)
    
    print("\n--- Fetching by params (Product 1 / Batch 9991) ---")
    s1 = get_shift_by_params(date=test_date, shift_name="День", line="Линия 1 (ЛФМ-1)", request=req, product_name="Шифер 8 волн гладкий", batch_number="9991", db=db)
    print(f"Found Product 1: ID={s1.id}, batch='{s1.batch_number}', product='{s1.product_name}', lfm_sheets={s1.lfm_reports[0].lfm_sheets if s1.lfm_reports else 0}")
    
    print("\n--- Fetching by params (Product 2 / Batch 9992) ---")
    s2 = get_shift_by_params(date=test_date, shift_name="День", line="Линия 1 (ЛФМ-1)", request=req, product_name="Шифер 8 волн рифленый", batch_number="9992", db=db)
    print(f"Found Product 2: ID={s2.id}, batch='{s2.batch_number}', product='{s2.product_name}', lfm_sheets={s2.lfm_reports[0].lfm_sheets if s2.lfm_reports else 0}")
    
    print(f"\n--- Summary of Shifts in DB for {test_date} ---")
    shifts = db.query(models.Shift).filter(models.Shift.date == test_date).order_by(models.Shift.id).all()
    print(f"Total shifts for {test_date} in DB: {len(shifts)}")
    for s in shifts:
        print(f" - Shift ID={s.id}, product='{s.product_name}', batch='{s.batch_number}'")
        
    assert len(shifts) == 2, f"Expected 2 shifts, found {len(shifts)}"
    assert s1.id != s2.id, "Shift 1 and Shift 2 should have different IDs!"
    print("\nSUCCESS! Both reports were saved as separate shifts without overwriting!")

finally:
    # Clean up test shifts after verification so we leave DB clean!
    cleanup_test_date(db, "2099-01-01")
    db.close()
