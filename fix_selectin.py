with open('main.py', 'r', encoding='utf-8') as f:
    c = f.read()

# 1. Replace joinedload import with selectinload
c = c.replace('from sqlalchemy.orm import joinedload', 'from sqlalchemy.orm import selectinload')

# 2. Replace joinedload() calls with selectinload()
c = c.replace('joinedload(models.Shift.receipts)', 'selectinload(models.Shift.receipts)')
c = c.replace('joinedload(models.Shift.batches)', 'selectinload(models.Shift.batches)')
c = c.replace('joinedload(models.Shift.lfm_reports)', 'selectinload(models.Shift.lfm_reports)')
c = c.replace('joinedload(models.Shift.downtimes)', 'selectinload(models.Shift.downtimes)')

with open('main.py', 'w', encoding='utf-8') as f:
    f.write(c)

print("Done. selectinload replaces joinedload everywhere.")