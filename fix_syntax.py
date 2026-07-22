with open('main.py', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace('\\n@app.post("/api/admin/sync_directories_sharepoint")', '@app.post("/api/admin/sync_directories_sharepoint")')

with open('main.py', 'w', encoding='utf-8') as f:
    f.write(content)
