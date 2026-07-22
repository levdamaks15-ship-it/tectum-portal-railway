import re

with open('main.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace shift.receipt_<material> with sum((r.<material> or 0.0) for r in shift.receipts)
content = re.sub(
    r'shift\.receipt_([a-zA-Z0-9_]+)',
    r'(sum((r.\1 or 0.0) for r in shift.receipts) if getattr(shift, "receipts", None) else 0.0)',
    content
)

with open('main.py', 'w', encoding='utf-8') as f:
    f.write(content)
