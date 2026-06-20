import os
import database
import models
from database import engine

db_path = "tectum.db"
if os.path.exists(db_path):
    os.remove(db_path)
    print("Старая база данных удалена.")

models.Base.metadata.create_all(bind=engine)
print("Новая схема базы данных Enterprise создана.")
