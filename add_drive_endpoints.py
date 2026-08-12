import os

endpoints_code = """
# ==========================================
# API БАЗЫ ЗНАНИЙ (GOOGLE DRIVE)
# ==========================================
import google_drive_integration
from fastapi import Form

@app.get("/api/documents/list")
def list_documents(parent_id: Optional[str] = Query(None)):
    try:
        data = google_drive_integration.list_files_and_folders(parent_id)
        return {"status": "success", "data": data}
    except Exception as e:
        print(f"Drive API Error: {e}")
        return {"status": "error", "message": str(e)}

@app.post("/api/documents/upload")
async def upload_document(
    file: UploadFile = File(...),
    parent_id: Optional[str] = Form(None)
):
    try:
        file_bytes = await file.read()
        uploaded_file = google_drive_integration.upload_file(
            filename=file.filename,
            mime_type=file.content_type,
            file_bytes=file_bytes,
            parent_id=parent_id
        )
        return {"status": "success", "file": uploaded_file}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/documents/folders")
def create_document_folder(
    folder_name: str = Form(...),
    parent_id: Optional[str] = Form(None)
):
    try:
        folder = google_drive_integration.create_folder(folder_name, parent_id)
        return {"status": "success", "folder": folder}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.delete("/api/documents/{file_id}")
def delete_document(file_id: str):
    try:
        google_drive_integration.delete_file(file_id)
        return {"status": "success"}
    except Exception as e:
        return {"status": "error", "message": str(e)}
"""

with open("main.py", "a", encoding="utf-8") as f:
    f.write(endpoints_code)
print("Endpoints for Google Drive API added to main.py")
