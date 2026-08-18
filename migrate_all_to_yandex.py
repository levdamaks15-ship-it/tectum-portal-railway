import os
import re
import urllib.request
import json
import database, models, r2_integration, yandex_disk_integration

def build_category_path(db, cat_id: int) -> str:
    """Recursively builds human-readable path: e.g. /Tectum/АЦИ/Главный технолог"""
    path_parts = []
    curr_id = cat_id
    while curr_id:
        cat = db.query(models.DocumentCategory).filter(models.DocumentCategory.id == curr_id).first()
        if not cat:
            break
        # Clean folder name
        clean_name = re.sub(r'[\\/:*?"<>|]', '_', cat.name.strip())
        path_parts.insert(0, clean_name)
        curr_id = cat.parent_id
    
    if path_parts:
        return "/Tectum/" + "/".join(path_parts)
    return "/Tectum/Общие документы"

def sync_all_folders_and_files():
    db = database.SessionLocal()
    try:
        print("=== 1. Создание полной структуры папок в Яндекс.Диске ===")
        categories = db.query(models.DocumentCategory).all()
        for cat in categories:
            folder_path = build_category_path(db, cat.id)
            print(f"Ensuring Yandex folder: {folder_path}")
            yandex_disk_integration.ensure_yandex_folder(folder_path)

        print("\n=== 2. Перенос всех файлов из базы/R2 в Яндекс.Диск ===")
        docs = db.query(models.Document).all()
        s3 = r2_integration.get_r2_client()

        for doc in docs:
            folder_path = build_category_path(db, doc.category_id) if doc.category_id else "/Tectum/Общие документы"
            clean_filename = re.sub(r'[\\/:*?"<>|]', '_', doc.title.strip())
            remote_path = f"{folder_path}/{clean_filename}"

            print(f"\nProcessing doc #{doc.id}: '{doc.title}' -> '{remote_path}'")
            file_bytes = None
            
            # 1. Try download from R2
            if doc.r2_key:
                try:
                    obj = s3.get_object(Bucket=r2_integration.R2_BUCKET_NAME, Key=doc.r2_key)
                    file_bytes = obj['Body'].read()
                except Exception as e:
                    print(f"  Failed to read R2 ({doc.r2_key}): {e}")

            # 2. Try download from local
            if not file_bytes and doc.file_path and os.path.exists(doc.file_path):
                try:
                    with open(doc.file_path, "rb") as f:
                        file_bytes = f.read()
                except Exception as e:
                    print(f"  Failed to read local file ({doc.file_path}): {e}")

            # 3. Upload to Yandex Disk
            if file_bytes:
                pub_url = yandex_disk_integration.upload_file_to_yandex_disk(file_bytes, remote_path)
                if pub_url:
                    doc.yandex_path = remote_path
                    doc.yandex_url = pub_url
                    db.commit()
                    print(f"  [OK] Uploaded and Published: {pub_url}")
                else:
                    print("  [ERROR] Failed to upload to Yandex Disk")
            else:
                print("  [WARN] No binary data found for this document")

        print("\n=== Синхронизация с Яндекс.Диском успешно завершена! ===")
    finally:
        db.close()

if __name__ == "__main__":
    sync_all_folders_and_files()
