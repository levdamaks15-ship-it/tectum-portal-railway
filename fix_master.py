with open('main.py', 'r', encoding='utf-8') as f:
    c = f.read()

old = '''@app.get("/api/shifts/all")
def get_all_shifts(db: Session = Depends(get_db)):
    try:
        return db.query(models.Shift).options(
            selectinload(models.Shift.receipts),
            selectinload(models.Shift.batches),
            selectinload(models.Shift.lfm_reports),
            selectinload(models.Shift.downtimes)
        ).order_by(models.Shift.date.desc(), models.Shift.id.desc()).all()
    except Exception as err:
        import traceback
        print(f"Error in get_all_shifts: {err}\\n{traceback.format_exc()}")
        return []'''

new = '''@app.get("/api/shifts/all")
def get_all_shifts(db: Session = Depends(get_db)):
    return db.query(models.Shift).options(
        selectinload(models.Shift.master),
        selectinload(models.Shift.receipts),
        selectinload(models.Shift.batches),
        selectinload(models.Shift.lfm_reports),
        selectinload(models.Shift.downtimes)
    ).order_by(models.Shift.date.desc(), models.Shift.id.desc()).all()'''

if old in c:
    c = c.replace(old, new)
    print("Replaced get_all_shifts")
else:
    print("PATTERN NOT FOUND - old:")
    # Try to find the function
    idx = c.find('def get_all_shifts')
    if idx != -1:
        print(c[idx:idx+600])
    else:
        print("def get_all_shifts NOT FOUND at all")

with open('main.py', 'w', encoding='utf-8') as f:
    f.write(c)