import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

# Load env to get DATABASE_URL
load_dotenv()
db_url = os.getenv("DATABASE_URL")

if not db_url:
    print("ERROR: DATABASE_URL not found in .env")
    exit(1)

# PostgreSQL driver fix for sqlalchemy if needed
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)

engine = create_engine(db_url)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

print(f"Connecting to {db_url.split('@')[1]}...")
db = SessionLocal()

try:
    from sqlalchemy import text

    # Basic DB Info
    print("\n--- Основные таблицы ---")
    tables_to_check = ["shifts", "downtimes", "raw_material_receipts", "product_norms", "masters", "lfm_reports", "monthly_plan_board"]
    for t in tables_to_check:
        res = db.execute(text(f"SELECT COUNT(*) FROM {t}")).scalar()
        print(f"Таблица {t}: {res} записей")

    print("\n--- Проверка целостности данных ---")
    
    print("\n--- Смены за 29.07 ---")
    shifts = db.execute(text("SELECT id, date, shift_name, line, master_id, batch_number, product_name, plan_sheets FROM shifts WHERE date = '2026-07-29'")).fetchall()
    for s in shifts:
        downtimes = db.execute(text(f"SELECT id FROM downtimes WHERE shift_id = {s.id}")).fetchall()
        lfm = db.execute(text(f"SELECT id FROM lfm_reports WHERE shift_id = {s.id}")).fetchall()
        batches = db.execute(text(f"SELECT id FROM batches WHERE shift_id = {s.id}")).fetchall()
        print(f"Shift ID: {s.id} | Batch: {s.batch_number} | Product: {s.product_name} | Master: {s.master_id} | Plan: {s.plan_sheets} | Downtimes: {len(downtimes)} | LFM: {len(lfm)} | Batches: {len(batches)}")

    print("\n--- Проверка завершена! ---")

    print("\n--- Проверка завершена! ---")
except Exception as e:
    print(f"Ошибка при выполнении проверки: {e}")
finally:
    db.close()
