with open('main.py', 'r', encoding='utf-8') as f:
    c = f.read()

old = 'selectinload(models.Shift.receipts),'
new = 'selectinload(models.Shift.receipts).selectinload(models.RawMaterialReceipt.master),'

c = c.replace(old, new)
print("Replaced:", c.count(new))

with open('main.py', 'w', encoding='utf-8') as f:
    f.write(c)
print("Done")