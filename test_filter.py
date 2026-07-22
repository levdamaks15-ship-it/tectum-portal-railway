from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from models import Shift, LFMReport, Batch

engine = create_engine('sqlite:///tectum.db')
SessionLocal = sessionmaker(bind=engine)
db = SessionLocal()

shifts = db.query(Shift).all()
for shift in shifts:
    lfm = db.query(LFMReport).filter(LFMReport.shift_id == shift.id).first()
    batch = db.query(Batch).filter(Batch.shift_id == shift.id).first()
    
    lfm_sheets_check = lfm.lfm_sheets if lfm else 0
    warehouse_gp_check = batch.ds_condition if batch else 0
    zo_batches_check = shift.zo_batches or 0
    plan_sheets_check = shift.plan_sheets or 0
    
    is_empty = plan_sheets_check == 0 and lfm_sheets_check == 0 and warehouse_gp_check == 0 and zo_batches_check == 0 and not shift.zo_submitted and not shift.receipts and not shift.downtimes
    
    print(f"Shift ID {shift.id}: is_empty={bool(is_empty)}, plan={plan_sheets_check}, lfm={lfm_sheets_check}, gp={warehouse_gp_check}, zo={zo_batches_check}, receipts_len={len(shift.receipts)}, down_len={len(shift.downtimes)}")
