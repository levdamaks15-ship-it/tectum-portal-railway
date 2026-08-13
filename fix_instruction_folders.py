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

def main():
    folders_to_delete = db.query(DocumentCategory).filter(DocumentCategory.name == "Инструкция по ведению данных в облаке").all()
    for f in folders_to_delete:
        print(f"Deleting folder: {f.name} (id: {f.id})")
        db.delete(f)
    db.commit()
    print("Done!")

if __name__ == "__main__":
    main()
