import sys
import os
from database import SessionLocal
import google_sheets_integration

def test_sync():
    print("Запуск тестовой синхронизации...")
    db = SessionLocal()
    try:
        # Проверяем, что функция импортируется и запускается без синтаксических ошибок
        # Поскольку у нас mock-данные в .env, она должна завершиться с сообщением о пропуске
        google_sheets_integration.sync_report_to_google_sheets(db)
        print("Тест выполнен успешно!")
    except Exception as e:
        print(f"Ошибка во время теста: {e}")
        sys.exit(1)
    finally:
        db.close()

if __name__ == "__main__":
    test_sync()
