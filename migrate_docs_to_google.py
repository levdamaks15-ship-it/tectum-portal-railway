import os
from sqlalchemy.orm import Session
from database import SessionLocal
import models
import google_drive_integration

def migrate_documents():
    db: Session = SessionLocal()
    docs = db.query(models.Document).filter(models.Document.google_drive_id == None).all()
    print(f"Найдено {len(docs)} документов для миграции в Google Drive.")
    
    success_count = 0
    for doc in docs:
        if not os.path.exists(doc.file_path):
            print(f"Файл {doc.file_path} не найден на диске, пропускаем.")
            continue
            
        print(f"Загрузка '{doc.title}'...")
        try:
            drive_info = google_drive_integration.upload_file_to_drive(doc.file_path, doc.title)
            doc.google_drive_id = drive_info["id"]
            doc.google_drive_url = drive_info["url"]
            db.commit()
            print(f" -> Успешно! ID: {doc.google_drive_id}")
            success_count += 1
        except Exception as e:
            print(f" -> Ошибка при загрузке '{doc.title}': {e}")
            db.rollback()
            
    print(f"\nМиграция завершена. Успешно мигрировано {success_count} из {len(docs)} документов.")
    db.close()

if __name__ == "__main__":
    migrate_documents()
