import re

with open('main.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Add the Google Sync endpoint
google_sync_endpoint = '''
@app.post("/api/admin/sync_directories_google")
def sync_directories_google(request: Request, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role")
    
    if not user_id:
        raise HTTPException(status_code=401, detail="Не авторизован")
    if user_role != "admin":
        raise HTTPException(status_code=403, detail="Доступ запрещен")
        
    try:
        import google_sheets_integration
        google_sheets_integration.sync_norms_from_google_sheets(db)
        google_sheets_integration.sync_downtime_directory_from_google_sheets(db)
        
        db.add(models.AuditLog(
            user_id=user_id,
            action="SYNC_DIRECTORIES",
            entity="Directories",
            entity_id=0,
            details="Синхронизация нормативов и справочника простоев из Google Sheets"
        ))
        db.commit()
        return {"status": "success", "message": "Справочники успешно синхронизированы из Google Sheets"}
    except Exception as e:
        import traceback
        err_msg = f"Ошибка синхронизации: {str(e)}"
        print(f"{err_msg}\\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=err_msg)
'''

# Find the place to insert it (after sync_directories_sharepoint)
insert_pos = content.find('@app.post("/api/admin/sync_directories_sharepoint")')
if insert_pos != -1:
    content = content[:insert_pos] + google_sync_endpoint + '\\n' + content[insert_pos:]
else:
    content += google_sync_endpoint

with open('main.py', 'w', encoding='utf-8') as f:
    f.write(content)
