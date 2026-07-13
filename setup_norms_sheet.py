import sys
from database import SessionLocal
import google_sheets_integration

def setup_norms_sheet():
    print("Создание и экспорт листа 'Нормативы' в Google Таблицу...")
    db = SessionLocal()
    try:
        google_sheets_integration.export_norms_to_google_sheets(db)
        print("Вкладка 'Нормативы' успешно создана в Google Sheets!")
    except Exception as e:
        print(f"Ошибка при экспорте норм: {e}")
        sys.exit(1)
    finally:
        db.close()

if __name__ == "__main__":
    setup_norms_sheet()
