import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from models import DocumentCategory

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./tectum.db")
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
db = SessionLocal()

def main():
    # 1. Rename existing folders
    renames = {
        "Техдир": "Технический директор",
        "Папка технолога": "Главный технолог",
        "СКК": "Служба контроля качества"
    }
    
    for old_name, new_name in renames.items():
        folders = db.query(DocumentCategory).filter(DocumentCategory.name == old_name).all()
        for f in folders:
            f.name = new_name
            print(f"Renamed '{old_name}' to '{new_name}' (id: {f.id})")
    
    # 2. Add "Финансовый директор" under ACI and AGB
    for parent_name in ["АЦИ", "АГБ"]:
        parent = db.query(DocumentCategory).filter(DocumentCategory.name == parent_name, DocumentCategory.parent_id == None).first()
        if parent:
            existing = db.query(DocumentCategory).filter(DocumentCategory.name == "Финансовый директор", DocumentCategory.parent_id == parent.id).first()
            if not existing:
                new_f = DocumentCategory(name="Финансовый директор", parent_id=parent.id)
                db.add(new_f)
                print(f"Created 'Финансовый директор' under {parent_name}")
            else:
                print(f"'Финансовый директор' already exists under {parent_name}")
                
    db.commit()
    print("Done renaming and creating!")

if __name__ == "__main__":
    main()
