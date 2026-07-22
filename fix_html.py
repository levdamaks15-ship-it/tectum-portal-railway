with open('static/admin.html', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace('id="btn-sync-sharepoint" onclick="syncDirectoriesFromSharepoint()"', 'id="btn-sync-google" onclick="syncDirectoriesFromGoogle()"')
content = content.replace('Синхронизация с M365', 'Синхронизация с Google')

with open('static/admin.html', 'w', encoding='utf-8') as f:
    f.write(content)
