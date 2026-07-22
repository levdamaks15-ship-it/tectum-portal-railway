import re

with open('main.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace sum(r.cement for r in shift.receipts) with sum((r.cement_silo1 + r.cement_silo2 + r.cement_silo3 + r.cement_silo4) for r in shift.receipts)
content = content.replace('sum(r.cement for r in shift.receipts)', 'sum((r.cement_silo1 + r.cement_silo2 + r.cement_silo3 + r.cement_silo4) for r in shift.receipts)')

with open('main.py', 'w', encoding='utf-8') as f:
    f.write(content)
print('Done!')
