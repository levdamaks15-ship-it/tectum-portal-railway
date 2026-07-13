import sys
from database import SessionLocal
import google_sheets_integration

def setup_downtimes_sheet():
    print("Создание и экспорт листа 'Справочник простоев' в Google Таблицу...")
    db = SessionLocal()
    try:
        google_sheets_integration.export_downtime_directory_to_google_sheets(db)
        print("Вкладка 'Справочник простоев' успешно создана в Google Sheets!")
    except Exception as e:
        print(f"Ошибка при экспорте справочника простоев: {e}")
        sys.exit(1)
    finally:
        db.close()

if __name__ == "__main__":
    setup_downtimes_sheet()
