import os
import sys
from database import SessionLocal
import models
import google_sheets_integration

def main():
    print("=== Проверка сохранности данных в БД ===")
    db = SessionLocal()
    try:
        shifts = db.query(models.Shift).all()
        downtimes = db.query(models.Downtime).all()
        receipts = db.query(models.RawMaterialReceipt).all()
        norms = db.query(models.ProductNorm).all()
        plan_boards = db.query(models.MonthlyPlanBoard).all()
        
        print(f"Найдено смен: {len(shifts)}")
        print(f"Найдено простоев: {len(downtimes)}")
        print(f"Найдено приходов сырья: {len(receipts)}")
        print(f"Найдено нормативов: {len(norms)}")
        print(f"Найдено записей план-факт доски: {len(plan_boards)}")
        
        print("\n=== Начало миграции данных в Google Sheets ===")
        
        print("1. Экспорт сводного отчета (sync_report_to_google_sheets)...")
        google_sheets_integration.sync_report_to_google_sheets(db)
        
        print("2. Экспорт простоев (export_downtimes_to_google_sheets)...")
        google_sheets_integration.export_downtimes_to_google_sheets(db)
        
        print("3. Экспорт приходов сырья (export_receipt_to_google_sheets)...")
        google_sheets_integration.export_receipt_to_google_sheets(db)
        
        print("4. Экспорт нормативов (export_norms_to_google_sheets)...")
        google_sheets_integration.export_norms_to_google_sheets(db)
        
        print("5. Экспорт справочника простоев (export_downtime_directory_to_google_sheets)...")
        google_sheets_integration.export_downtime_directory_to_google_sheets(db)
        
        print("\n=== Миграция успешно завершена! Все данные сохранены. ===")
        
    except Exception as e:
        print(f"Ошибка во время проверки и миграции: {e}")
        sys.exit(1)
    finally:
        db.close()

if __name__ == "__main__":
    main()
