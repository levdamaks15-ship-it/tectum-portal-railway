import os
import re
import json
import uuid
import shutil
import hashlib
from datetime import datetime, date
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Request, BackgroundTasks, UploadFile, File, Form, Query, Header, Body
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_, func

import models
import schemas
from database import SessionLocal
from routers.common import check_admin_session

try:
    import google_drive_integration
except ImportError:
    google_drive_integration = None

try:
    import yandex_disk_integration
except ImportError:
    yandex_disk_integration = None

try:
    import r2_integration
except ImportError:
    r2_integration = None

router = APIRouter(tags=["documents"])

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ==========================================
# API БАЗЫ ЗНАНИЙ (ЛОКАЛЬНОЕ ХРАНИЛИЩЕ)
# ==========================================
from fastapi import Form, UploadFile, File
from fastapi.responses import FileResponse
import os
import uuid
import shutil

UPLOAD_DIR = os.path.join(os.getcwd(), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

def sort_folders_custom(folders):
    order = {
        # Orange
        "Должностные инструкции по всем сотрудникам": 0,
        "ОТ и ТБ": 1,
        "Договора с подрядчиками": 2,
        # Purple
        "Отдел кадров": 3,
        "Коммерческий департамент": 4,
        "Технический директор": 5,
        "Финансовый директор": 6,
        "Начальник производства": 7,
        # Green
        "Главный технолог": 8,
        "Служба контроля качества": 9,
        "Бережливое производство": 10,
        "ОГМ": 11
    }
    return sorted(folders, key=lambda x: (order.get(x.name, 999), x.name))

from fastapi import Header

def build_category_protection_map(db: Session) -> dict:
    cats = {c.id: (c.parent_id, bool(c.password_hash)) for c in db.query(models.DocumentCategory.id, models.DocumentCategory.parent_id, models.DocumentCategory.password_hash).all()}
    memo = {}
    def check_prot(cid: int) -> bool:
        if cid in memo:
            return memo[cid]
        curr = cid
        while curr and curr in cats:
            parent_id, has_pwd = cats[curr]
            if has_pwd:
                memo[cid] = True
                return True
            curr = parent_id
        memo[cid] = False
        return False
    return {cid: check_prot(cid) for cid in cats}

def get_protected_ancestor(db: Session, folder_id: int):
    current_id = folder_id
    while current_id:
        folder = db.query(models.DocumentCategory).filter(models.DocumentCategory.id == current_id).first()
        if not folder:
            break
        if folder.password_hash:
            return folder
        current_id = folder.parent_id
    return None

def is_folder_protected(db: Session, folder_id: int) -> bool:
    return get_protected_ancestor(db, folder_id) is not None

@router.get("/api/documents/list")
def list_documents(
    parent_id: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    try:
        prot_map = build_category_protection_map(db)

        if q and q.strip():
            query_str = f"%{q.strip()}%"
            folders = db.query(models.DocumentCategory).filter(models.DocumentCategory.name.ilike(query_str)).order_by(models.DocumentCategory.name).all()
            files = db.query(models.Document).filter(models.Document.title.ilike(query_str)).order_by(models.Document.title).all()
        else:
            cat_id = None
            if parent_id and parent_id.startswith("folder_"):
                cat_id = int(parent_id.split("_")[1])
                
            if cat_id is None:
                folders = db.query(models.DocumentCategory).filter(models.DocumentCategory.parent_id == None).order_by(models.DocumentCategory.name).all()
                files = db.query(models.Document).filter(models.Document.category_id == None).order_by(models.Document.title).all()
            else:
                folders = db.query(models.DocumentCategory).filter(models.DocumentCategory.parent_id == cat_id).order_by(models.DocumentCategory.name).all()
                files = db.query(models.Document).filter(models.Document.category_id == cat_id).order_by(models.Document.title).all()
            
        folders = sort_folders_custom(folders)
        
        folder_data = []
        for f in folders:
            folder_data.append({
                "id": f"folder_{f.id}",
                "name": f.name,
                "mimeType": "application/vnd.google-apps.folder",
                "created_at": f.id,
                "created_by": f.created_by or "",
                "is_protected": prot_map.get(f.id, False)
            })
            
        file_data = []
        for f in files:
            file_link = f.external_url if f.external_url else f"/api/documents/download/{f.id}"
            file_data.append({
                "id": f"file_{f.id}",
                "name": f.title,
                "mimeType": f.mime_type or "application/octet-stream",
                "webViewLink": file_link,
                "external_url": f.external_url,
                "uploaded_at": f.uploaded_at.isoformat() if f.uploaded_at else "",
                "is_protected": prot_map.get(f.category_id, False) if f.category_id else False,
                "version_number": f.version_number or 1,
                "locked_by_user": f.locked_by_user,
                "locked_at": f.locked_at.strftime("%d.%m %H:%M") if f.locked_at else None,
                "last_modified_by": f.last_modified_by or "",
                "created_by": f.created_by or f.last_modified_by or ""
            })
            
        return {"status": "success", "data": {"folders": folder_data, "files": file_data}}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@router.get("/api/documents/recent")
def get_recent_documents(db: Session = Depends(get_db)):
    """Возвращает 6 последних добавленных/обновленных документов для панели быстрого доступа"""
    try:
        prot_map = build_category_protection_map(db)
        docs = db.query(models.Document).order_by(models.Document.uploaded_at.desc(), models.Document.id.desc()).limit(6).all()
        recent_docs = []
        for d in docs:
            file_link = d.external_url if d.external_url else f"/api/documents/download/{d.id}"
            recent_docs.append({
                "id": f"file_{d.id}",
                "doc_id": d.id,
                "name": d.title,
                "mimeType": d.mime_type or "application/octet-stream",
                "webViewLink": file_link,
                "external_url": d.external_url,
                "uploaded_at": d.uploaded_at.strftime("%d.%m.%Y %H:%M") if d.uploaded_at else "",
                "is_protected": prot_map.get(d.category_id, False) if d.category_id else False,
                "version_number": d.version_number or 1,
                "locked_by_user": d.locked_by_user,
                "last_modified_by": d.last_modified_by or "Сотрудник",
                "created_by": d.created_by or d.last_modified_by or "Сотрудник"
            })
        return {"status": "success", "data": recent_docs}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@router.get("/api/documents/all")
def get_all_documents_flat(db: Session = Depends(get_db)):
    """Возвращает плоский список всех документов с именами папок для модалки выбора."""
    try:
        categories = {c.id: c.name for c in db.query(models.DocumentCategory).all()}
        docs = db.query(models.Document).all()
        
        result = []
        for d in docs:
            file_link = d.external_url if d.external_url else f"/api/documents/download/{d.id}"
            cat_name = categories.get(d.category_id, "Главная директория")
            result.append({
                "id": d.id,
                "title": d.title or "Документ",
                "category_id": d.category_id,
                "category_name": cat_name,
                "mime_type": d.mime_type or "application/octet-stream",
                "doc_type": d.doc_type or "other",
                "link": file_link,
                "uploaded_at": d.uploaded_at.strftime("%d.%m.%Y %H:%M") if d.uploaded_at else "",
                "created_by": d.created_by or d.last_modified_by or ""
            })
        
        # Сортировка по имени
        result.sort(key=lambda x: (x["category_name"], x["title"].lower()))
        return result
    except Exception as e:
        print(f"Error fetching all documents flat: {e}")
        return []

@router.get("/api/documents/tree")
def get_documents_tree(db: Session = Depends(get_db)):
    try:
        prot_map = build_category_protection_map(db)
        folders = db.query(models.DocumentCategory).order_by(models.DocumentCategory.name).all()
        folders = sort_folders_custom(folders)
        folder_data = []
        for f in folders:
            folder_data.append({
                "id": f"folder_{f.id}",
                "name": f.name,
                "parent_id": f"folder_{f.parent_id}" if f.parent_id else None,
                "created_by": f.created_by or "",
                "is_protected": prot_map.get(f.id, False)
            })
            
        docs = db.query(models.Document).order_by(models.Document.title).all()
        file_data = []
        for d in docs:
            file_link = d.external_url if d.external_url else f"/api/documents/download/{d.id}"
            file_data.append({
                "id": f"file_{d.id}",
                "name": d.title,
                "parent_id": f"folder_{d.category_id}" if d.category_id else None,
                "mimeType": d.mime_type or "application/octet-stream",
                "webViewLink": file_link,
                "external_url": d.external_url,
                "is_protected": prot_map.get(d.category_id, False) if d.category_id else False,
                "version_number": d.version_number or 1,
                "locked_by_user": d.locked_by_user,
                "locked_at": d.locked_at.strftime("%d.%m %H:%M") if d.locked_at else None,
                "last_modified_by": d.last_modified_by or "",
                "created_by": d.created_by or d.last_modified_by or ""
            })
            
        return {"status": "success", "data": {"folders": folder_data, "files": file_data}}
    except Exception as e:
        return {"status": "error", "message": str(e)}

class VerifyPasswordRequest(BaseModel):
    folder_id: str
    password: str

@router.post("/api/documents/verify-password")
def verify_document_password(req: VerifyPasswordRequest, db: Session = Depends(get_db)):
    try:
        cat_id = None
        if req.folder_id and req.folder_id.startswith("folder_"):
            cat_id = int(req.folder_id.split("_")[1])
        if not cat_id:
            return {"status": "error", "message": "Неверный ID папки"}
            
        protected_folder = get_protected_ancestor(db, cat_id)
        if not protected_folder:
            return {"status": "success"} # Не защищена
            
        hashed_pwd = hashlib.sha256(req.password.encode()).hexdigest()
        if protected_folder.password_hash == hashed_pwd:
            return {"status": "success"}
        return {"status": "error", "message": "Неверный пароль"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@router.post("/api/documents/sync-folders-to-drive")
def manual_sync_folders_to_drive(db: Session = Depends(get_db)):
    """Принудительная выгрузка всех папок и файлов из базы Tectum в Google Drive"""
    try:
        import google_drive_integration
        all_categories = db.query(models.DocumentCategory).all()
        synced_folders = []
        for cat in all_categories:
            # Force find or create in Drive
            f_id = get_or_create_google_drive_folder_for_category(db, cat.id, force_check=True)
            synced_folders.append({"id": cat.id, "name": cat.name, "drive_id": f_id})
            
        unmigrated_docs = db.query(models.Document).filter(
            (models.Document.google_drive_url == None) | (models.Document.google_drive_url == "")
        ).all()
        synced_docs = []
        for u_doc in unmigrated_docs:
            if u_doc.file_path and os.path.exists(u_doc.file_path):
                clean_t = u_doc.title or os.path.basename(u_doc.file_path)
                parent_drive_id = get_or_create_google_drive_folder_for_category(db, u_doc.category_id)
                d_info = google_drive_integration.upload_file_to_drive(u_doc.file_path, clean_t, parent_drive_id=parent_drive_id)
                if d_info and d_info.get("id"):
                    u_doc.google_drive_id = d_info["id"]
                    u_doc.google_drive_url = d_info["url"]
                    db.commit()
                    synced_docs.append(clean_t)

        return {
            "status": "success", 
            "folders_count": len(synced_folders), 
            "folders": synced_folders,
            "docs_synced": synced_docs
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

@router.get("/api/admin/document-categories")
def admin_get_document_categories(request: Request, db: Session = Depends(get_db)):
    if request.session.get("user_role") not in ["admin", "director", "technologist"]:
        return {"status": "error", "message": "Access denied"}
    try:
        folders = db.query(models.DocumentCategory).order_by(models.DocumentCategory.name).all()
        data = []
        for f in folders:
            data.append({
                "id": f.id,
                "name": f.name,
                "is_protected": bool(f.password_hash)
            })
        return {"status": "success", "data": data}
    except Exception as e:
        return {"status": "error", "message": str(e)}

class SetPasswordRequest(BaseModel):
    password: Optional[str] = None

@router.post("/api/admin/document-categories/{cat_id}/set-password")
def admin_set_document_password(cat_id: int, req: SetPasswordRequest, request: Request, db: Session = Depends(get_db)):
    if request.session.get("user_role") not in ["admin", "director", "technologist"]:
        return {"status": "error", "message": "Access denied"}
    try:
        folder = db.query(models.DocumentCategory).filter(models.DocumentCategory.id == cat_id).first()
        if not folder:
            return {"status": "error", "message": "Папка не найдена"}
            
        if req.password:
            folder.password_hash = hashlib.sha256(req.password.encode()).hexdigest()
        else:
            folder.password_hash = None
        db.commit()
        return {"status": "success"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

def is_editable_doc(file_name: str) -> bool:
    name = (file_name or '').lower()
    return name.endswith('.xlsx') or name.endswith('.xls') or name.endswith('.docx') or name.endswith('.doc') or name.endswith('.pptx') or name.endswith('.ppt')

def get_or_create_google_drive_folder_for_category(db: Session, cat_id: Optional[int], force_check: bool = False) -> Optional[str]:
    """
    Recursively ensures that the folder hierarchy exists in Google Drive
    and returns the google_drive_folder_id for the given category.
    """
    root_folder_id = os.getenv("GOOGLE_DRIVE_FOLDER_ID")
    if not cat_id:
        return root_folder_id
        
    category = db.query(models.DocumentCategory).filter(models.DocumentCategory.id == cat_id).first()
    if not category:
        return root_folder_id
        
    # If already set and not forced, return it
    if category.google_drive_folder_id and not force_check:
        return category.google_drive_folder_id
        
    # Get or create parent drive folder recursively
    parent_drive_id = get_or_create_google_drive_folder_for_category(db, category.parent_id, force_check=force_check)
    
    try:
        import google_drive_integration
        drive_folder_id = google_drive_integration.get_or_create_drive_folder(category.name, parent_drive_id)
        if drive_folder_id:
            category.google_drive_folder_id = drive_folder_id
            db.commit()
            return drive_folder_id
    except Exception as e:
        print(f"Failed to create Google Drive folder for '{category.name}': {e}")
        
    return root_folder_id

def upload_doc_to_drive_bg(doc_id: int, file_path: str, clean_title: str, cat_id: Optional[int] = None):
    """Фоновая выгрузка файла в Google Drive с обновлением ID и URL в БД и сохранением структуры папок"""
    try:
        import google_drive_integration
        bg_db = database.SessionLocal()
        parent_drive_id = None
        try:
            parent_drive_id = get_or_create_google_drive_folder_for_category(bg_db, cat_id)
        finally:
            bg_db.close()

        drive_info = google_drive_integration.upload_file_to_drive(file_path, clean_title, parent_drive_id=parent_drive_id)
        if drive_info and drive_info.get("id"):
            bg_db = database.SessionLocal()
            try:
                doc = bg_db.query(models.Document).filter(models.Document.id == doc_id).first()
                if doc:
                    doc.google_drive_id = drive_info["id"]
                    doc.google_drive_url = drive_info["url"]
                    bg_db.commit()
            finally:
                bg_db.close()
    except Exception as drive_err:
        print(f"Background upload to Google Drive failed for doc #{doc_id}: {drive_err}")

class DirectUploadRegisterRequest(BaseModel):
    title: str
    category_id: Optional[int] = None
    yandex_path: Optional[str] = None
    mime_type: Optional[str] = None
    r2_key: Optional[str] = None

@router.post("/api/documents/direct_upload_token")
def get_direct_upload_token(
    filename: str = Form(...),
    mime_type: Optional[str] = Form("application/octet-stream"),
    parent_id: Optional[str] = Form(None),
    relative_path: Optional[str] = Form(None),
    x_folder_password: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    """
    Generates a direct PUT URL straight to Yandex Disk.
    The browser uploads directly into Yandex Disk without touching Railway server disk!
    """
    try:
        cat_id = None
        if parent_id and parent_id.startswith("folder_"):
            cat_id = int(parent_id.split("_")[1])
            
        if cat_id is not None:
            protected_folder = get_protected_ancestor(db, cat_id)
            if protected_folder:
                if not x_folder_password or protected_folder.password_hash != hashlib.sha256(x_folder_password.encode()).hexdigest():
                    raise HTTPException(status_code=403, detail="Access Denied")

        if relative_path:
            parts = relative_path.split("/")[:-1]
            current_parent = cat_id
            for part in parts:
                if not part: continue
                existing_folder = db.query(models.DocumentCategory).filter(
                    models.DocumentCategory.name == part,
                    models.DocumentCategory.parent_id == current_parent
                ).first()
                if not existing_folder:
                    try:
                        new_folder = models.DocumentCategory(name=part, parent_id=current_parent)
                        db.add(new_folder)
                        db.commit()
                        db.refresh(new_folder)
                        current_parent = new_folder.id
                    except Exception:
                        db.rollback()
                        existing_folder = db.query(models.DocumentCategory).filter(
                            models.DocumentCategory.name == part,
                            models.DocumentCategory.parent_id == current_parent
                        ).first()
                        if existing_folder:
                            current_parent = existing_folder.id
                else:
                    current_parent = existing_folder.id
            cat_id = current_parent

        import yandex_disk_integration, migrate_all_to_yandex, re
        clean_name = re.sub(r'[\\/:*?"<>|]', '_', filename.strip())
        folder_path = migrate_all_to_yandex.build_category_path(db, cat_id) if cat_id else "/Tectum"
        remote_path = f"{folder_path}/{clean_name}"
        
        upload_url = yandex_disk_integration.get_yandex_upload_url(remote_path)
        if not upload_url:
            raise HTTPException(status_code=500, detail="Не удалось получить ссылку для загрузки в Яндекс.Диск")
        return {
            "status": "success",
            "upload_url": upload_url,
            "yandex_path": remote_path,
            "category_id": cat_id
        }
    except HTTPException:
        raise
    except Exception as e:
        return {"status": "error", "message": str(e)}

@router.post("/api/documents/register_direct_upload")
def register_direct_upload(
    req: DirectUploadRegisterRequest,
    db: Session = Depends(get_db)
):
    """
    Registers a file in Tectum database after direct upload straight to Yandex Disk and publishes it.
    """
    try:
        import yandex_disk_integration
        pub_url = None
        if req.yandex_path:
            pub_url = yandex_disk_integration.publish_and_get_public_url(req.yandex_path)

        new_doc = models.Document(
            title=req.title,
            category_id=req.category_id,
            file_path=None,
            mime_type=req.mime_type or "application/octet-stream",
            yandex_path=req.yandex_path,
            yandex_url=pub_url,
            r2_key=req.r2_key
        )
        db.add(new_doc)
        db.commit()
        db.refresh(new_doc)

        is_editable = is_editable_doc(new_doc.title)

        return {
            "status": "success",
            "file": {
                "id": f"file_{new_doc.id}",
                "name": new_doc.title,
                "mimeType": new_doc.mime_type,
                "webViewLink": f"/editor?id=file_{new_doc.id}" if is_editable else f"/api/documents/download/{new_doc.id}"
            }
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

class AddExternalLinkRequest(BaseModel):
    title: str
    external_url: str
    parent_id: Optional[str] = None
    author_name: Optional[str] = "Сотрудник"

@router.post("/api/documents/add_link")
def add_external_document_link(
    req: AddExternalLinkRequest,
    x_folder_password: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    """
    Добавляет ссылку на внешний документ (OneDrive, Google Docs, SharePoint, Яндекс.Диск и т.д.)
    """
    try:
        cat_id = None
        if req.parent_id and req.parent_id.startswith("folder_"):
            cat_id = int(req.parent_id.split("_")[1])

        if cat_id is not None:
            protected_folder = get_protected_ancestor(db, cat_id)
            if protected_folder:
                if not x_folder_password or protected_folder.password_hash != hashlib.sha256(x_folder_password.encode()).hexdigest():
                    raise HTTPException(status_code=403, detail="Access Denied")

        clean_url = req.external_url.strip()
        if not clean_url.startswith("http://") and not clean_url.startswith("https://"):
            clean_url = "https://" + clean_url

        # Определение типа иконки
        clean_title = req.title.strip()
        mime_type = "application/x-external-link"
        low_url = clean_url.lower()
        if "1drv.ms" in low_url or "onedrive" in low_url or "sharepoint" in low_url:
            mime_type = "application/vnd.ms-onedrive"
        elif "docs.google" in low_url or "drive.google" in low_url:
            mime_type = "application/vnd.google-apps.document"
        elif "disk.yandex" in low_url or "yadi.sk" in low_url:
            mime_type = "application/vnd.yandex-disk"
        elif "docs.google.com/spreadsheets" in low_url:
            mime_type = "application/vnd.google-apps.spreadsheet"
        elif "docs.google.com/document" in low_url:
            mime_type = "application/vnd.google-apps.document"
        elif "docs.google.com/presentation" in low_url:
            mime_type = "application/vnd.google-apps.presentation"

        new_doc = models.Document(
            title=clean_title,
            category_id=cat_id,
            external_url=clean_url,
            mime_type=mime_type,
            created_by=req.author_name or "Сотрудник",
            last_modified_by=req.author_name or "Сотрудник",
            uploaded_at=datetime.utcnow()
        )
        db.add(new_doc)
        db.commit()
        db.refresh(new_doc)

        return {
            "status": "success",
            "message": "Ссылка успешно добавлена!",
            "file": {
                "id": f"file_{new_doc.id}",
                "name": new_doc.title,
                "external_url": new_doc.external_url,
                "mimeType": new_doc.mime_type
            }
        }
    except Exception as e:
        db.rollback()
        return {"status": "error", "message": str(e)}

def extract_external_link_title_sync(clean_url: str) -> Optional[str]:
    """Вспомогательная функция для быстрого извлечения названия ссылки"""
    import re
    import html as py_html
    
    if not clean_url.startswith("http://") and not clean_url.startswith("https://"):
        clean_url = "https://" + clean_url
        
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7"
    }

    gdoc_match = re.search(r'docs\.google\.com/(spreadsheets|document|presentation)/d/([a-zA-Z0-9-_]+)', clean_url)
    target_urls_to_try = [clean_url]
    if gdoc_match:
        dtype, doc_id = gdoc_match.group(1), gdoc_match.group(2)
        if dtype == "spreadsheets":
            target_urls_to_try = [
                f"https://docs.google.com/spreadsheets/d/{doc_id}/edit",
                f"https://docs.google.com/spreadsheets/d/{doc_id}/preview",
                clean_url
            ]
        elif dtype == "document":
            target_urls_to_try = [
                f"https://docs.google.com/document/d/{doc_id}/edit",
                f"https://docs.google.com/document/d/{doc_id}/preview",
                clean_url
            ]
    for test_url in target_urls_to_try:
        try:
            resp = requests.get(test_url, headers=headers, timeout=4, allow_redirects=True)
            if resp.status_code != 200:
                continue
                
            text = resp.text
            title = ""
            
            itemprop_match = re.search(r'<meta\s+itemprop=["\']name["\']\s+content=["\']([^"\']+)["\']', text, re.IGNORECASE)
            if not itemprop_match:
                itemprop_match = re.search(r'<meta\s+content=["\']([^"\']+)["\']\s+itemprop=["\']name["\']', text, re.IGNORECASE)
            if itemprop_match:
                title = itemprop_match.group(1).strip()

            if not title:
                og_match = re.search(r'<meta\s+(?:property|name)=["\'](?:og:title|twitter:title)["\']\s+content=["\']([^"\']+)["\']', text, re.IGNORECASE)
                if not og_match:
                    og_match = re.search(r'<meta\s+content=["\']([^"\']+)["\']\s+(?:property|name)=["\'](?:og:title|twitter:title)["\']', text, re.IGNORECASE)
                if og_match:
                    title = og_match.group(1).strip()

            if not title:
                title_match = re.search(r'<title>(.*?)</title>', text, re.IGNORECASE | re.DOTALL)
                if title_match:
                    title = title_match.group(1).strip()
                    
            if title:
                title = py_html.unescape(title)
                for suffix in [
                    " - Google Таблицы", " - Google Документы", " - Google Презентации", 
                    " - Google Диск", " - Google Sheets", " - Google Docs", " - Google Drive",
                    " - OneDrive", " - Excel", " - Word", " - Microsoft OneDrive", " — Яндекс Диск"
                ]:
                    if title.endswith(suffix):
                        title = title[:-len(suffix)].strip()
                
                if title and not any(bad in title.lower() for bad in ["вход", "войти", "sign in", "login", "google accounts"]):
                    return title
        except Exception:
            continue
    return None

@router.get("/api/documents/fetch_link_title")
def fetch_external_link_title(url: str = Query(...)):
    """
    Автоматически извлекает реальный заголовок/название файла по ссылке (OneDrive, Google Docs, Sheets, Yandex и др.)
    """
    title = extract_external_link_title_sync(url)
    if title:
        return {"status": "success", "title": title}
    return {"status": "error", "message": "Не удалось автоматически извлечь заголовок"}

@router.post("/api/documents/sync_external_titles")
def sync_external_documents_titles(
    parent_id: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """
    Фоновая синхронизация и актуализация названий документов по внешним облачным ссылкам
    """
    try:
        cat_id = None
        if parent_id and parent_id.startswith("folder_"):
            cat_id = int(parent_id.split("_")[1])
            
        query = db.query(models.Document).filter(models.Document.external_url != None)
        if cat_id is not None:
            query = query.filter(models.Document.category_id == cat_id)
        elif parent_id == "root":
            query = query.filter(models.Document.category_id == None)
            
        docs = query.all()
        updated_count = 0
        
        for doc in docs:
            if not doc.external_url:
                continue
            new_title = extract_external_link_title_sync(doc.external_url)
            if new_title and new_title != doc.title:
                doc.title = new_title
                updated_count += 1
                
        if updated_count > 0:
            db.commit()
            
        return {"status": "success", "updated_count": updated_count}
    except Exception as e:
        db.rollback()
        return {"status": "error", "message": str(e)}

@router.post("/api/documents/folders")
def create_document_folder(
    folder_name: str = Form(...),
    parent_id: Optional[str] = Form(None),
    author_name: Optional[str] = Form("Сотрудник"),
    x_folder_password: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    try:
        cat_id = None
        if parent_id and parent_id.startswith("folder_"):
            cat_id = int(parent_id.split("_")[1])
            
        if cat_id is not None:
            protected_folder = get_protected_ancestor(db, cat_id)
            if protected_folder:
                if not x_folder_password or protected_folder.password_hash != hashlib.sha256(x_folder_password.encode()).hexdigest():
                    raise HTTPException(status_code=403, detail="Access Denied")
        else:
            if not x_folder_password or x_folder_password != "6282":
                raise HTTPException(status_code=403, detail="Неверный пароль для создания корневой папки")
            
        clean_name = folder_name.strip()
        existing = db.query(models.DocumentCategory).filter(
            models.DocumentCategory.name == clean_name,
            models.DocumentCategory.parent_id == cat_id
        ).first()
        if existing:
            return {"status": "success", "folder": {
                "id": f"folder_{existing.id}",
                "name": existing.name,
                "mimeType": "application/vnd.google-apps.folder"
            }}

        new_folder = models.DocumentCategory(
            name=clean_name,
            parent_id=cat_id,
            created_by=author_name or "Сотрудник"
        )
        db.add(new_folder)
        db.commit()
        db.refresh(new_folder)
        
        return {"status": "success", "folder": {
            "id": f"folder_{new_folder.id}",
            "name": new_folder.name,
            "mimeType": "application/vnd.google-apps.folder"
        }}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@router.post("/api/documents/clean_duplicates")
def clean_duplicate_folders(request: Request, db: Session = Depends(get_db)):
    """Административная очистка дубликатов папок в базе данных"""
    try:
        all_folders = db.query(models.DocumentCategory).all()
        seen = {}
        duplicates = []
        for f in all_folders:
            key = (f.name.strip().lower(), f.parent_id)
            if key in seen:
                primary = seen[key]
                # Reassign documents from duplicate to primary
                db.query(models.Document).filter(models.Document.category_id == f.id).update(
                    {models.Document.category_id: primary.id}, synchronize_session=False
                )
                # Reassign subfolders
                db.query(models.DocumentCategory).filter(models.DocumentCategory.parent_id == f.id).update(
                    {models.DocumentCategory.parent_id: primary.id}, synchronize_session=False
                )
                duplicates.append(f)
            else:
                seen[key] = f

        for dup in duplicates:
            db.delete(dup)
        db.commit()
        return {"status": "success", "cleaned_count": len(duplicates)}
    except Exception as e:
        db.rollback()
        return {"status": "error", "message": str(e)}

def check_document_action_permission(
    db: Session,
    creator_name: Optional[str],
    user_name: Optional[str],
    user_pin: Optional[str],
    is_protected_folder_action: bool = False
):
    """
    Проверяет права доступа на действие с документом/папкой:
    - Разрешено, если автор совпадает и PIN-код валиден.
    - Разрешено администраторам (PIN 6282 или мастер-пароль).
    - Если у объекта еще не был указан создатель (старые файлы) и пользователь авторизован — действие разрешено.
    - Иначе — отказ 403 с пояснением.
    """
    clean_user = (user_name or "").strip()
    clean_pin = (user_pin or "").strip()
    clean_creator = (creator_name or "").strip()
    
    # 1. Проверка на суперпользователя / мастер-пароль
    if clean_pin == "6282":
        return True
        
    # 2. Если у объекта не указан создатель и пользователь авторизован
    if not clean_creator:
        if clean_user:
            return True
        # Если создатель неизвестен и пользователь не указан
        return True

    if not clean_user:
        raise HTTPException(
            status_code=403, 
            detail=f"Действие заблокировано. Объект создан сотрудником «{clean_creator}». Пожалуйста, авторизуйтесь под своим именем."
        )

    # 3. Проверка соответствия имени автора
    if clean_user.lower() != clean_creator.lower():
        raise HTTPException(
            status_code=403, 
            detail=f"Действие заблокировано: объект создан сотрудником «{clean_creator}». Удалять и изменять его может только автор или Администратор."
        )

    # 4. Проверка PIN-кода автора (если он задан в справочнике сотрудников)
    emp = db.query(models.PlannerEmployee).filter(models.PlannerEmployee.name == clean_user).first()
    if emp and emp.pin_code and emp.pin_code.strip():
        if emp.pin_code.strip() != clean_pin:
            raise HTTPException(status_code=401, detail="Неверный PIN-код для подтверждения действия")

    return True

@router.put("/api/documents/{item_id}/rename")
def rename_document(
    item_id: str,
    new_name: str = Form(...),
    user_name: Optional[str] = Form(None),
    user_pin: Optional[str] = Form(None),
    x_folder_password: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    try:
        new_clean_name = new_name.strip()
        if not new_clean_name:
            return {"status": "error", "message": "Имя не может быть пустым"}
            
        if item_id.startswith("folder_"):
            cat_id = int(item_id.split("_")[1])
            folder = db.query(models.DocumentCategory).filter(models.DocumentCategory.id == cat_id).first()
            if not folder:
                return {"status": "error", "message": "Папка не найдена"}
                
            protected_folder = get_protected_ancestor(db, folder.id)
            if protected_folder:
                if not x_folder_password or protected_folder.password_hash != hashlib.sha256(x_folder_password.encode()).hexdigest():
                    raise HTTPException(status_code=403, detail="Access Denied")
                    
            check_document_action_permission(db, folder.created_by, user_name, user_pin or x_folder_password)
            folder.name = new_clean_name
            db.commit()
            return {"status": "success"}
            
        elif item_id.startswith("file_"):
            file_id = int(item_id.split("_")[1])
            doc = db.query(models.Document).filter(models.Document.id == file_id).first()
            if not doc:
                return {"status": "error", "message": "Файл не найден"}
                
            if doc.category_id:
                protected_folder = get_protected_ancestor(db, doc.category_id)
                if protected_folder:
                    if not x_folder_password or protected_folder.password_hash != hashlib.sha256(x_folder_password.encode()).hexdigest():
                        raise HTTPException(status_code=403, detail="Access Denied")
                        
            check_document_action_permission(db, doc.created_by or doc.last_modified_by, user_name, user_pin or x_folder_password)
            doc.title = new_clean_name
            db.commit()
            return {"status": "success"}
            
        return {"status": "error", "message": "Неизвестный тип объекта"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        return {"status": "error", "message": str(e)}

@router.put("/api/documents/{item_id}/move")
def move_document(
    item_id: str,
    target_folder_id: Optional[str] = Form(None),
    user_name: Optional[str] = Form(None),
    user_pin: Optional[str] = Form(None),
    x_folder_password: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    try:
        target_cat_id: Optional[int] = None
        if target_folder_id and target_folder_id.strip() and target_folder_id != "root":
            if target_folder_id.startswith("folder_"):
                target_cat_id = int(target_folder_id.split("_")[1])
            elif target_folder_id.isdigit():
                target_cat_id = int(target_folder_id)
            else:
                return {"status": "error", "message": "Неверный формат идентификатора папки"}
            
            target_folder = db.query(models.DocumentCategory).filter(models.DocumentCategory.id == target_cat_id).first()
            if not target_folder:
                return {"status": "error", "message": "Целевая папка не найдена"}
                
            target_protected = get_protected_ancestor(db, target_folder.id)
            if target_protected:
                if not x_folder_password or target_protected.password_hash != hashlib.sha256(x_folder_password.encode()).hexdigest():
                    raise HTTPException(status_code=403, detail="Access Denied")

        if item_id.startswith("folder_"):
            cat_id = int(item_id.split("_")[1])
            folder = db.query(models.DocumentCategory).filter(models.DocumentCategory.id == cat_id).first()
            if not folder:
                return {"status": "error", "message": "Перемещаемая папка не найдена"}

            src_protected = get_protected_ancestor(db, folder.id)
            if src_protected:
                if not x_folder_password or src_protected.password_hash != hashlib.sha256(x_folder_password.encode()).hexdigest():
                    raise HTTPException(status_code=403, detail="Access Denied")

            check_document_action_permission(db, folder.created_by, user_name, user_pin or x_folder_password)

            if target_cat_id == folder.id:
                return {"status": "error", "message": "Нельзя переместить папку саму в себя"}

            if target_cat_id is not None:
                curr = target_cat_id
                while curr is not None:
                    if curr == folder.id:
                        return {"status": "error", "message": "Нельзя переместить папку в её собственную подпапку"}
                    parent_row = db.query(models.DocumentCategory.parent_id).filter(models.DocumentCategory.id == curr).first()
                    curr = parent_row[0] if parent_row else None

            folder.parent_id = target_cat_id
            db.commit()
            return {"status": "success", "message": "Папка успешно перемещена"}

        elif item_id.startswith("file_"):
            file_id = int(item_id.split("_")[1])
            doc = db.query(models.Document).filter(models.Document.id == file_id).first()
            if not doc:
                return {"status": "error", "message": "Файл не найден"}

            if doc.category_id:
                src_protected = get_protected_ancestor(db, doc.category_id)
                if src_protected:
                    if not x_folder_password or src_protected.password_hash != hashlib.sha256(x_folder_password.encode()).hexdigest():
                        raise HTTPException(status_code=403, detail="Access Denied")

            check_document_action_permission(db, doc.created_by or doc.last_modified_by, user_name, user_pin or x_folder_password)

            doc.category_id = target_cat_id
            db.commit()
            return {"status": "success", "message": "Файл успешно перемещен"}

        return {"status": "error", "message": "Неизвестный тип объекта"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        return {"status": "error", "message": str(e)}

@router.delete("/api/documents/{item_id}")
def delete_document(
    item_id: str, 
    user_name: Optional[str] = Query(None),
    user_pin: Optional[str] = Query(None),
    x_folder_password: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    try:
        cat_id_to_check = None
        if item_id.startswith("folder_"):
            cat_id_to_check = int(item_id.split("_")[1])
        elif item_id.startswith("file_"):
            file_id = int(item_id.split("_")[1])
            doc = db.query(models.Document).filter(models.Document.id == file_id).first()
            if doc:
                cat_id_to_check = doc.category_id
                
        if cat_id_to_check is not None:
            protected_folder = get_protected_ancestor(db, cat_id_to_check)
            if protected_folder:
                if not x_folder_password or protected_folder.password_hash != hashlib.sha256(x_folder_password.encode()).hexdigest():
                    raise HTTPException(status_code=403, detail="Access Denied")

        if item_id.startswith("folder_"):
            cat_id = int(item_id.split("_")[1])
            folder = db.query(models.DocumentCategory).filter(models.DocumentCategory.id == cat_id).first()
            if folder:
                check_document_action_permission(db, folder.created_by, user_name, user_pin or x_folder_password)

                # Proper post-order traversal (children before parents)
                def get_all_descendant_ids_post_order(f_id: int) -> list[int]:
                    result = []
                    children = db.query(models.DocumentCategory).filter(models.DocumentCategory.parent_id == f_id).all()
                    for ch in children:
                        result.extend(get_all_descendant_ids_post_order(ch.id))
                    result.append(f_id)
                    return result

                all_cat_ids_to_delete = get_all_descendant_ids_post_order(folder.id)

                # 1. Delete all records inside these folders
                db.query(models.Document).filter(models.Document.category_id.in_(all_cat_ids_to_delete)).delete(synchronize_session=False)
                db.flush()

                # 2. Break parent_id foreign key references within categories to avoid constraint violations
                db.query(models.DocumentCategory).filter(models.DocumentCategory.id.in_(all_cat_ids_to_delete)).update(
                    {models.DocumentCategory.parent_id: None}, synchronize_session=False
                )
                db.flush()

                # 3. Delete folders from database in post-order
                for c_id in all_cat_ids_to_delete:
                    f_obj = db.query(models.DocumentCategory).filter(models.DocumentCategory.id == c_id).first()
                    if f_obj:
                        db.delete(f_obj)
                        db.flush()
                        
                db.commit()
        elif item_id.startswith("file_"):
            file_id = int(item_id.split("_")[1])
            doc = db.query(models.Document).filter(models.Document.id == file_id).first()
            if doc:
                check_document_action_permission(db, doc.created_by or doc.last_modified_by, user_name, user_pin or x_folder_password)
                db.delete(doc)
                db.commit()
                
        return {"status": "success"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        return {"status": "error", "message": str(e)}

# ==========================================
# API БАЗЫ ЗНАНИЙ: ЛОКАЛЬНЫЕ ФАЙЛЫ, MS OFFICE & ВЕРСИОНИРОВАНИЕ
# ==========================================

DOCS_STORAGE_DIR = os.path.join(os.getcwd(), "uploads", "kb_docs")
os.makedirs(DOCS_STORAGE_DIR, exist_ok=True)

@router.get("/api/documents/download/{doc_id}")
def download_local_document(doc_id: int, db: Session = Depends(get_db)):
    """Отдает локальный файл документа для скачивания или открытия в MS Office"""
    doc = db.query(models.Document).filter(models.Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")
    
    if not doc.file_path or not os.path.exists(doc.file_path):
        # Если привязана только внешняя ссылка
        if doc.external_url:
            return RedirectResponse(doc.external_url)
        raise HTTPException(status_code=404, detail="Файл документа отсутствует на диске")
    
    filename = doc.title or os.path.basename(doc.file_path)
    encoded_filename = quote(filename.encode('utf-8'))
    media_type = doc.mime_type or "application/octet-stream"
    
    # PDF, изображения и текст отдаем inline для комфортного онлайн-просмотра на смартфонах и ПК
    is_inline = False
    lower_name = filename.lower()
    if lower_name.endswith(('.pdf', '.png', '.jpg', '.jpeg', '.webp', '.txt', '.svg')) or (media_type and ("pdf" in media_type or "image" in media_type or "text" in media_type)):
        is_inline = True
        
    disposition = "inline" if is_inline else "attachment"
    
    headers = {
        "Content-Disposition": f"{disposition}; filename*=UTF-8''{encoded_filename}",
        "Access-Control-Expose-Headers": "Content-Disposition",
        "Cache-Control": "public, max-age=3600" if is_inline else "no-cache, no-store, must-revalidate",
        "Accept-Ranges": "bytes"
    }
    return FileResponse(doc.file_path, media_type=media_type, headers=headers)

@router.post("/api/documents/upload_local")
async def upload_local_document(
    file: UploadFile = File(...),
    parent_id: Optional[str] = Form(None),
    author_name: Optional[str] = Form("Сотрудник"),
    x_folder_password: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    """Загрузка нового файла в локальную Базу Знаний с сохранением в uploads/kb_docs"""
    try:
        cat_id = None
        if parent_id and parent_id.startswith("folder_"):
            cat_id = int(parent_id.split("_")[1])
            
        if cat_id is not None:
            protected_folder = get_protected_ancestor(db, cat_id)
            if protected_folder:
                if not x_folder_password or protected_folder.password_hash != hashlib.sha256(x_folder_password.encode()).hexdigest():
                    raise HTTPException(status_code=403, detail="Access Denied")
        
        orig_filename = os.path.basename(file.filename)
        safe_ext = os.path.splitext(orig_filename)[1].lower()
        if safe_ext != ".pdf":
            raise HTTPException(
                status_code=400, 
                detail="Локально разрешена загрузка только PDF-документов (.pdf). Для Word/Excel файлов используйте добавление ссылки Google Docs или OneDrive."
            )
        unique_name = f"doc_{uuid.uuid4().hex[:10]}_{int(datetime.utcnow().timestamp())}{safe_ext}"
        save_path = os.path.join(DOCS_STORAGE_DIR, unique_name)
        
        content = await file.read()
        file_size = len(content)
        with open(save_path, "wb") as f_out:
            f_out.write(content)
            
        new_doc = models.Document(
            title=orig_filename,
            category_id=cat_id,
            file_path=save_path,
            mime_type=file.content_type or "application/octet-stream",
            version_number=1,
            last_modified_by=author_name or "Сотрудник",
            created_by=author_name or "Сотрудник",
            uploaded_at=datetime.utcnow()
        )
        db.add(new_doc)
        db.commit()
        db.refresh(new_doc)
        
        # Создаем начальную версию v1 в архиве
        initial_version = models.DocumentVersion(
            document_id=new_doc.id,
            version_number=1,
            file_path=save_path,
            file_size=file_size,
            mime_type=new_doc.mime_type,
            author_name=author_name or "Сотрудник",
            comment="Исходная загрузка документа",
            created_at=datetime.utcnow()
        )
        db.add(initial_version)
        db.commit()
        
        return {
            "status": "success",
            "message": "Файл успешно загружен в Базу Знаний",
            "file": {
                "id": f"file_{new_doc.id}",
                "name": new_doc.title,
                "mimeType": new_doc.mime_type,
                "version_number": new_doc.version_number,
                "last_modified_by": new_doc.last_modified_by,
                "webViewLink": f"/api/documents/download/{new_doc.id}"
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        return {"status": "error", "message": str(e)}

@router.post("/api/documents/{doc_id}/save_version")
async def save_document_version(
    doc_id: int,
    file: UploadFile = File(...),
    author_name: str = Form(...),
    comment: Optional[str] = Form(""),
    x_folder_password: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    """Загружает новую версию документа, архивирует старую и увеличивает счетчик версий"""
    try:
        doc = db.query(models.Document).filter(models.Document.id == doc_id).first()
        if not doc:
            raise HTTPException(status_code=404, detail="Документ не найден")
            
        if doc.category_id:
            protected_folder = get_protected_ancestor(db, doc.category_id)
            if protected_folder:
                if not x_folder_password or protected_folder.password_hash != hashlib.sha256(x_folder_password.encode()).hexdigest():
                    raise HTTPException(status_code=403, detail="Access Denied")
                    
        orig_filename = os.path.basename(file.filename)
        safe_ext = os.path.splitext(orig_filename)[1].lower()
        new_version_num = (doc.version_number or 1) + 1
        
        unique_name = f"doc_{doc.id}_v{new_version_num}_{uuid.uuid4().hex[:6]}{safe_ext}"
        save_path = os.path.join(DOCS_STORAGE_DIR, unique_name)
        
        content = await file.read()
        file_size = len(content)
        with open(save_path, "wb") as f_out:
            f_out.write(content)
            
        # Обновляем сам документ
        doc.file_path = save_path
        doc.mime_type = file.content_type or doc.mime_type
        doc.version_number = new_version_num
        doc.last_modified_by = author_name
        doc.locked_by_user = None
        doc.locked_at = None
        doc.uploaded_at = datetime.utcnow()
        
        # Добавляем запись в архив версий
        new_version_rec = models.DocumentVersion(
            document_id=doc.id,
            version_number=new_version_num,
            file_path=save_path,
            file_size=file_size,
            mime_type=doc.mime_type,
            author_name=author_name,
            comment=comment or f"Обновление до v{new_version_num}",
            created_at=datetime.utcnow()
        )
        db.add(new_version_rec)
        db.commit()
        db.refresh(doc)
        
        return {
            "status": "success",
            "message": f"Версия v{new_version_num} успешно сохранена",
            "version_number": new_version_num,
            "last_modified_by": doc.last_modified_by
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        return {"status": "error", "message": str(e)}

@router.get("/api/documents/{doc_id}/versions")
def get_document_versions(doc_id: int, db: Session = Depends(get_db)):
    """Возвращает историю всех версий документа"""
    try:
        doc = db.query(models.Document).filter(models.Document.id == doc_id).first()
        if not doc:
            raise HTTPException(status_code=404, detail="Документ не найден")
            
        versions = db.query(models.DocumentVersion).filter(
            models.DocumentVersion.document_id == doc_id
        ).order_by(models.DocumentVersion.version_number.desc()).all()
        
        data = []
        for v in versions:
            data.append({
                "id": v.id,
                "version_number": v.version_number,
                "author_name": v.author_name,
                "comment": v.comment or "",
                "file_size": v.file_size or 0,
                "created_at": v.created_at.strftime("%d.%m.%Y %H:%M") if v.created_at else "",
                "is_current": v.version_number == doc.version_number,
                "download_url": f"/api/documents/versions/{v.id}/download"
            })
            
        return {"status": "success", "data": data, "document_title": doc.title, "current_version": doc.version_number}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@router.get("/api/documents/versions/{version_id}/download")
def download_document_version(version_id: int, db: Session = Depends(get_db)):
    """Скачивание конкретной архивной версии документа"""
    ver = db.query(models.DocumentVersion).filter(models.DocumentVersion.id == version_id).first()
    if not ver or not ver.file_path or not os.path.exists(ver.file_path):
        raise HTTPException(status_code=404, detail="Архивная версия файла не найдена")
        
    doc = db.query(models.Document).filter(models.Document.id == ver.document_id).first()
    doc_title = doc.title if doc else "document"
    name_parts = os.path.splitext(doc_title)
    archive_filename = f"{name_parts[0]}_v{ver.version_number}{name_parts[1]}"
    encoded_filename = quote(archive_filename.encode('utf-8'))
    
    headers = {
        "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}",
        "Access-Control-Expose-Headers": "Content-Disposition"
    }
    return FileResponse(ver.file_path, media_type=ver.mime_type or "application/octet-stream", headers=headers)

@router.post("/api/documents/{doc_id}/versions/{version_id}/restore")
def restore_document_version(
    doc_id: int, 
    version_id: int,
    user_name: str = Body(..., embed=True),
    x_folder_password: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    """Откат документа к выбранной архивной версии с созданием нового шага в истории"""
    try:
        doc = db.query(models.Document).filter(models.Document.id == doc_id).first()
        if not doc:
            raise HTTPException(status_code=404, detail="Документ не найден")
            
        if doc.category_id:
            protected_folder = get_protected_ancestor(db, doc.category_id)
            if protected_folder:
                if not x_folder_password or protected_folder.password_hash != hashlib.sha256(x_folder_password.encode()).hexdigest():
                    raise HTTPException(status_code=403, detail="Access Denied")
                    
        ver = db.query(models.DocumentVersion).filter(
            models.DocumentVersion.id == version_id,
            models.DocumentVersion.document_id == doc_id
        ).first()
        if not ver or not ver.file_path or not os.path.exists(ver.file_path):
            raise HTTPException(status_code=404, detail="Архивная версия не найдена на диске")
            
        # Создаем копию файла архивной версии как новую актуальную версию
        new_version_num = (doc.version_number or 1) + 1
        safe_ext = os.path.splitext(ver.file_path)[1].lower()
        new_unique_name = f"doc_{doc.id}_v{new_version_num}_restored_{uuid.uuid4().hex[:6]}{safe_ext}"
        new_save_path = os.path.join(DOCS_STORAGE_DIR, new_unique_name)
        shutil.copy2(ver.file_path, new_save_path)
        
        file_size = os.path.getsize(new_save_path)
        
        doc.file_path = new_save_path
        doc.version_number = new_version_num
        doc.last_modified_by = user_name or "Сотрудник"
        doc.locked_by_user = None
        doc.locked_at = None
        doc.uploaded_at = datetime.utcnow()
        
        new_ver_rec = models.DocumentVersion(
            document_id=doc.id,
            version_number=new_version_num,
            file_path=new_save_path,
            file_size=file_size,
            mime_type=ver.mime_type or doc.mime_type,
            author_name=user_name or "Сотрудник",
            comment=f"Откат к версии v{ver.version_number}",
            created_at=datetime.utcnow()
        )
        db.add(new_ver_rec)
        db.commit()
        db.refresh(doc)
        
        return {
            "status": "success",
            "message": f"Документ успешно откачен к версии v{ver.version_number} (создана версия v{new_version_num})",
            "version_number": new_version_num,
            "last_modified_by": doc.last_modified_by
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        return {"status": "error", "message": str(e)}

class LockDocumentRequest(BaseModel):
    user_name: str

@router.post("/api/documents/{doc_id}/lock")
def lock_document(
    doc_id: int,
    req: LockDocumentRequest,
    db: Session = Depends(get_db)
):
    """Блокирует документ сотрудником при взятии в работу в MS Office"""
    try:
        doc = db.query(models.Document).filter(models.Document.id == doc_id).first()
        if not doc:
            raise HTTPException(status_code=404, detail="Документ не найден")
            
        if doc.locked_by_user and doc.locked_by_user != req.user_name:
            # Проверяем не устарела ли блокировка (более 4 часов)
            if doc.locked_at and (datetime.utcnow() - doc.locked_at).total_seconds() < 14400:
                return {
                    "status": "locked",
                    "locked_by": doc.locked_by_user,
                    "locked_at": doc.locked_at.strftime("%d.%m %H:%M"),
                    "message": f"Документ уже редактирует {doc.locked_by_user}"
                }
                
        doc.locked_by_user = req.user_name
        doc.locked_at = datetime.utcnow()
        db.commit()
        
        return {
            "status": "success",
            "locked_by": doc.locked_by_user,
            "locked_at": doc.locked_at.strftime("%d.%m %H:%M")
        }
    except Exception as e:
        db.rollback()
        return {"status": "error", "message": str(e)}

@router.post("/api/documents/{doc_id}/unlock")
def unlock_document(
    doc_id: int,
    user_name: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """Снимает блокировку с документа"""
    try:
        doc = db.query(models.Document).filter(models.Document.id == doc_id).first()
        if not doc:
            raise HTTPException(status_code=404, detail="Документ не найден")
            
        doc.locked_by_user = None
        doc.locked_at = None
        db.commit()
        return {"status": "success", "message": "Блокировка снята"}
    except Exception as e:
        db.rollback()
        return {"status": "error", "message": str(e)}

@router.get("/api/documents/{doc_id}/office_uri")
def get_office_uri(doc_id: int, request: Request, db: Session = Depends(get_db)):
    """Формирует нативную URI ссылку для запуска MS Office (ms-word, ms-excel, ms-powerpoint)"""
    doc = db.query(models.Document).filter(models.Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")
        
    base_url = str(request.base_url).rstrip("/")
    download_url = f"{base_url}/api/documents/download/{doc.id}"
    
    fname = (doc.title or "").lower()
    scheme = "ms-word"
    if fname.endswith(".xlsx") or fname.endswith(".xls") or fname.endswith(".xlsm") or fname.endswith(".csv"):
        scheme = "ms-excel"
    elif fname.endswith(".pptx") or fname.endswith(".ppt"):
        scheme = "ms-powerpoint"
        
    uri = f"{scheme}:ofe|u|{download_url}"
    return {
        "status": "success",
        "uri": uri,
        "download_url": download_url,
        "file_path": doc.file_path,
        "filename": doc.title,
        "scheme": scheme,
        "locked_by": doc.locked_by_user
    }