with open('main.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Remove 'and not shift.receipts' from the empty check
content = content.replace('and not shift.zo_submitted and not shift.receipts and not shift.downtimes:', 'and not shift.zo_submitted and not shift.downtimes:')

with open('main.py', 'w', encoding='utf-8') as f:
    f.write(content)
