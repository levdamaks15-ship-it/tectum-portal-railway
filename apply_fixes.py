#!/usr/bin/env python
"""Apply fixes to main.py"""
import re

with open('main.py', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add joinedload import
content = content.replace(
    'from sqlalchemy import or_, func\nfrom contextlib import asynccontextmanager',
    'from sqlalchemy import or_, func\nfrom sqlalchemy.orm import joinedload\nfrom contextlib import asynccontextmanager'
)
print("1. Added joinedload import")

# 2. Fix get_all_shifts - add joinedload options
old_get_all = '''@app.get("/api/shifts/all", response_model=list[schemas.Shift])
def get_all_shifts(db: Session = Depends(get_db)):
    try:
        return db.query(models.Shift).order_by(models.Shift.date.desc(), models.Shift.id.desc()).all()
    except Exception as err:
        print(f"Error: {err}")
        return []'''

new_get_all = '''@app.get("/api/shifts/all", response_model=list[schemas.Shift])
def get_all_shifts(db: Session = Depends(get_db)):
    try:
        return db.query(models.Shift).options(
            joinedload(models.Shift.receipts),
            joinedload(models.Shift.batches),
            joinedload(models.Shift.lfm_reports),
            joinedload(models.Shift.downtimes)
        ).order_by(models.Shift.date.desc(), models.Shift.id.desc()).all()
    except Exception as err:
        import traceback
        print(f"Error in get_all_shifts: {err}\\ntraceback.format_exc()}")
        return []'''

if old_get_all in content:
    content = content.replace(old_get_all, new_get_all)
    print("2. Fixed get_all_shifts with joinedload")
else:
    print("2. WARNING: get_all_shifts pattern NOT FOUND!")

# 3. Remove and not shift.receipts from filter
old_filter = 'if plan_sheets_check == 0 and lfm_sheets_check == 0 and warehouse_gp_check == 0 and zo_batches_check == 0 and not shift.zo_submitted and not shift.receipts and not shift.downtimes:'
new_filter = 'if plan_sheets_check == 0 and lfm_sheets_check == 0 and warehouse_gp_check == 0 and zo_batches_check == 0 and not shift.zo_submitted and not shift.downtimes:'

if old_filter in content:
    content = content.replace(old_filter, new_filter)
    print("3. Removed 'and not shift.receipts' from summary filter")
else:
    print("3. WARNING: filter line NOT FOUND!")

with open('main.py', 'w', encoding='utf-8') as f:
    f.write(content)

print("All fixes applied successfully!")