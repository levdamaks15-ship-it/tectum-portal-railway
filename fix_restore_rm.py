with open('main.py', 'r', encoding='utf-8') as f:
    c = f.read()

old = '@app.get("/api/shifts/all")\ndef get_all_shifts(db: Session = Depends(get_db)):\n    return db.query(models.Shift).options('
new = '@app.get("/api/shifts/all", response_model=list[schemas.Shift])\ndef get_all_shifts(db: Session = Depends(get_db)):\n    return db.query(models.Shift).options('

c = c.replace(old, new)
if old not in c:
    print("Replaced response_model")
else:
    print("NOT replaced - checking...")
    idx = c.find('def get_all_shifts')
    print(c[idx:idx+200])

with open('main.py', 'w', encoding='utf-8') as f:
    f.write(c)
print("Done")