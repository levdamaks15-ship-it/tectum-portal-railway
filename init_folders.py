import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from models import Base, DocumentCategory

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./tectum.db")
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
db = SessionLocal()

def create_folder(name, parent_id=None):
    folder = db.query(DocumentCategory).filter_by(name=name, parent_id=parent_id).first()
    if not folder:
        folder = DocumentCategory(name=name, parent_id=parent_id)
        db.add(folder)
        db.commit()
        db.refresh(folder)
        print(f"Created folder: {name}")
    else:
        print(f"Folder already exists: {name}")
    return folder.id

def create_structure(root_name):
    print(f"\n--- Creating structure for {root_name} ---")
    root_id = create_folder(root_name)
    
    create_folder("Должностные инструкции по всем сотрудникам", root_id)
    
    tech_id = create_folder("Папка технолога", root_id)
    create_folder("ОПИ (опытно промышленные испытания)", tech_id)
    create_folder("Сырьё", tech_id)
    create_folder("Нормативные документы", tech_id)
    create_folder("Техсовет", tech_id)
    
    skk_id = create_folder("СКК", root_id)
    create_folder("Испытания, шаблоны всех видов отчётов", skk_id)
    create_folder("День качества", skk_id)
    
    techdir_id = create_folder("Техдир", root_id)
    create_folder("Смарт задачи", techdir_id)
    create_folder("Документация к оборудованию", techdir_id)
    
    nach_id = create_folder("Начальник производства", root_id)
    create_folder("Тара (чертежи и стоимость)", nach_id)
    create_folder("Обучение персонала", nach_id)
    
    ogm_id = create_folder("ОГМ", root_id)
    create_folder("Проекты и чертежи", ogm_id)
    
    create_folder("Отдел кадров", root_id)
    create_folder("Коммерческий департамент", root_id)
    create_folder("ОТ и ТБ", root_id)
    create_folder("Договора с подрядчиками", root_id)
    create_folder("Инструкция по ведению данных в облаке", root_id)

def main():
    create_structure("АЦИ")
    create_structure("АГБ")
    print("\nDone!")

if __name__ == "__main__":
    main()
