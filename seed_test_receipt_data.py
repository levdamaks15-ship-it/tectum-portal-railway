"""
Скрипт для тестового наполнения данных прихода сырья и выгрузки в Google Sheets.

Запуск (локально с настоящим ключом):
    python seed_test_receipt_data.py --creds path/to/real_google_credentials.json

Запуск (на Railway с GOOGLE_CREDENTIALS_JSON):
    python seed_test_receipt_data.py

Без указания --creds и без GOOGLE_CREDENTIALS_JSON — только наполняет БД.
"""
import sys
import os
import argparse
import json
from datetime import date, timedelta
from database import SessionLocal
import models
import google_sheets_integration


# Временно подменяем путь к credentials, если передан аргумент --creds
_original_creds_path = None
_original_env_json = None


def patch_credentials(creds_path: str = None):
    global _original_creds_path, _original_env_json
    if creds_path:
        # Сохраняем оригинал
        _original_env_json = os.environ.get("GOOGLE_CREDENTIALS_JSON")
        # Отключаем переменную окружения, чтобы get_sheets_service() взял файл
        if "GOOGLE_CREDENTIALS_JSON" in os.environ:
            del os.environ["GOOGLE_CREDENTIALS_JSON"]
        # Подменяем путь
        _original_creds_path = google_sheets_integration.CREDENTIALS_PATH
        google_sheets_integration.CREDENTIALS_PATH = creds_path
        print(f"🔑 Использую credentials из файла: {creds_path}")


def restore_credentials():
    global _original_creds_path, _original_env_json
    if _original_creds_path:
        google_sheets_integration.CREDENTIALS_PATH = _original_creds_path
        _original_creds_path = None
    if _original_env_json:
        os.environ["GOOGLE_CREDENTIALS_JSON"] = _original_env_json
        _original_env_json = None


def seed_test_data():
    db = SessionLocal()
    try:
        # Проверяем, есть ли уже мастера в БД
        master = db.query(models.Master).filter(models.Master.role == "master").first()
        if not master:
            print("Нет мастеров в БД. Создаю тестового мастера...")
            master = models.Master(name="Тестовый Мастер", pin="1234", role="master")
            db.add(master)
            db.commit()
            db.refresh(master)

        # Проверяем, есть ли уже смены с данными прихода
        existing = db.query(models.Shift).filter(
            models.Shift.receipt_cement > 0
        ).first()

        if existing:
            print(f"В БД уже есть смены с данными прихода. Пропускаю создание тестовых данных.")
        else:
            print("Создаю тестовые смены с данными прихода сырья...")

            test_shifts = [
                {
                    "date": date.today() - timedelta(days=3),
                    "shift_name": "День",
                    "line": "Линия 1",
                    "master_id": master.id,
                    "status": "closed",
                    "receipt_chrysotile_4_20": 1500.0,
                    "receipt_chrysotile_5_65": 2000.0,
                    "receipt_chrysotile_6_40": 1000.0,
                    "receipt_cement": 8000.0,
                    "receipt_cellulose": 500.0,
                    "receipt_crushed_slate": 300.0,
                    "receipt_asbozurit": 200.0,
                    "receipt_asbocarton": 100.0,
                    "receipt_pallets": 50.0,
                    "receipt_fiberglass": 150.0,
                    "receipt_laprol": 80.0,
                },
                {
                    "date": date.today() - timedelta(days=3),
                    "shift_name": "Ночь",
                    "line": "Линия 1",
                    "master_id": master.id,
                    "status": "closed",
                    "receipt_chrysotile_4_20": 1800.0,
                    "receipt_chrysotile_5_65": 2200.0,
                    "receipt_chrysotile_6_40": 1200.0,
                    "receipt_cement": 9000.0,
                    "receipt_cellulose": 600.0,
                    "receipt_crushed_slate": 350.0,
                    "receipt_asbozurit": 250.0,
                    "receipt_asbocarton": 120.0,
                    "receipt_pallets": 60.0,
                    "receipt_fiberglass": 180.0,
                    "receipt_laprol": 90.0,
                },
                {
                    "date": date.today() - timedelta(days=2),
                    "shift_name": "День",
                    "line": "Линия 2",
                    "master_id": master.id,
                    "status": "closed",
                    "receipt_chrysotile_4_20": 1600.0,
                    "receipt_chrysotile_5_65": 2100.0,
                    "receipt_chrysotile_6_40": 1100.0,
                    "receipt_cement": 8500.0,
                    "receipt_cellulose": 550.0,
                    "receipt_crushed_slate": 320.0,
                    "receipt_asbozurit": 220.0,
                    "receipt_asbocarton": 110.0,
                    "receipt_pallets": 55.0,
                    "receipt_fiberglass": 160.0,
                    "receipt_laprol": 85.0,
                },
                {
                    "date": date.today() - timedelta(days=1),
                    "shift_name": "День",
                    "line": "Линия 1",
                    "master_id": master.id,
                    "status": "closed",
                    "receipt_chrysotile_4_20": 1400.0,
                    "receipt_chrysotile_5_65": 1900.0,
                    "receipt_chrysotile_6_40": 900.0,
                    "receipt_cement": 7500.0,
                    "receipt_cellulose": 480.0,
                    "receipt_crushed_slate": 280.0,
                    "receipt_asbozurit": 180.0,
                    "receipt_asbocarton": 95.0,
                    "receipt_pallets": 45.0,
                    "receipt_fiberglass": 140.0,
                    "receipt_laprol": 75.0,
                },
                {
                    "date": date.today() - timedelta(days=1),
                    "shift_name": "Ночь",
                    "line": "Линия 2",
                    "master_id": master.id,
                    "status": "closed",
                    "receipt_chrysotile_4_20": 1700.0,
                    "receipt_chrysotile_5_65": 2300.0,
                    "receipt_chrysotile_6_40": 1300.0,
                    "receipt_cement": 9500.0,
                    "receipt_cellulose": 650.0,
                    "receipt_crushed_slate": 380.0,
                    "receipt_asbozurit": 270.0,
                    "receipt_asbocarton": 130.0,
                    "receipt_pallets": 65.0,
                    "receipt_fiberglass": 190.0,
                    "receipt_laprol": 95.0,
                },
            ]

            for s_data in test_shifts:
                shift = models.Shift(**s_data)
                db.add(shift)

            db.commit()
            print(f"Создано {len(test_shifts)} тестовых смен.")

        # 2. Запускаем экспорт в Google Sheets
        print("\nЗапускаю экспорт данных прихода сырья в Google Sheets...")
        try:
            google_sheets_integration.export_receipt_to_google_sheets(db)
            print("✅ Экспорт выполнен успешно!")
        except FileNotFoundError as fnf:
            print(f"⚠️  Файл google_credentials.json не найден или содержит mock-данные.")
            print(f"   Подробнее: {fnf}")
        except ValueError as ve:
            if "Could not deserialize key" in str(ve) or "unsupported" in str(ve).lower():
                print(f"⚠️  google_credentials.json содержит тестовый (mock) ключ.")
            else:
                print(f"⚠️  Ошибка: {ve}")
        except Exception as e:
            print(f"⚠️  Ошибка экспорта: {e}")

        print("\n✅ Тестовые данные успешно созданы в базе данных!")
        print("📋 Чтобы экспорт заработал с реальными данными:")
        print("   1. Получите JSON-ключ сервисного аккаунта Google в https://console.cloud.google.com")
        print("   2. Поместите его в google_credentials.json (заменив mock-данные)")
        print("   3. Или задайте переменную окружения GOOGLE_CREDENTIALS_JSON")
        print("   4. Запустите этот скрипт снова: python seed_test_receipt_data.py")
        print("")
        print("💡 Либо просто откройте приложение и сохраните сменный рапорт через форму")
        print("   - выгрузка в Google Sheets сработает автоматически при наличии real-ключа.")

    except Exception as e:
        print(f"❌ Ошибка: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()


def clean_test_data():
    """Удаляет все тестовые данные, созданные этим скриптом."""
    db = SessionLocal()
    try:
        # Удаляем смены, созданные скриптом (по отсутствию batch_number и product_name, и receipt > 0)
        test_shifts = db.query(models.Shift).filter(
            (models.Shift.batch_number == None) | (models.Shift.batch_number == ""),
            (models.Shift.product_name == None) | (models.Shift.product_name == ""),
            models.Shift.receipt_cement > 0
        ).all()
        
        count = len(test_shifts)
        for shift in test_shifts:
            # Удаляем связанные данные
            db.query(models.LFMReport).filter(models.LFMReport.shift_id == shift.id).delete()
            db.query(models.Batch).filter(models.Batch.shift_id == shift.id).delete()
            db.query(models.Downtime).filter(models.Downtime.shift_id == shift.id).delete()
            db.delete(shift)
        
        db.commit()
        print(f"✅ Удалено {count} тестовых смен с данными прихода сырья.")
        
        # Удаляем тестового мастера, если он не используется
        test_master = db.query(models.Master).filter(
            models.Master.name == "Тестовый Мастер",
            models.Master.pin == "1234"
        ).first()
        if test_master:
            # Проверяем, не осталось ли у него других смен
            remaining = db.query(models.Shift).filter(models.Shift.master_id == test_master.id).count()
            if remaining == 0:
                db.delete(test_master)
                db.commit()
                print("✅ Удалён тестовый мастер.")
            else:
                print(f"ℹ️  Тестовый мастер не удалён: осталось {remaining} его смен.")
    except Exception as e:
        print(f"❌ Ошибка при очистке: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Тестовое наполнение данных прихода сырья")
    parser.add_argument("--creds", type=str, help="Путь к реальному google_credentials.json")
    parser.add_argument("--clean", action="store_true", help="Удалить все тестовые данные (созданные этим скриптом)")
    
    args = parser.parse_args()
    
    if args.clean:
        clean_test_data()
    else:
        if args.creds:
            patch_credentials(args.creds)
        seed_test_data()
        if args.creds:
            restore_credentials()
