with open('static/js/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Add master_id to data
content = content.replace('const data = {', 'const data = {\\n        master_id: parseInt(master_id) || null,')

# Remove renderReceiptsTable call
content = content.replace('renderReceiptsTable(shift.receipts, shift);', '// renderReceiptsTable removed')

with open('static/js/app.js', 'w', encoding='utf-8') as f:
    f.write(content)
