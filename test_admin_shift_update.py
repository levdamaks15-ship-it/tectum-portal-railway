import sys
import os
from datetime import datetime
from main import admin_update_shift_report, get_db, SessionLocal
import models
import schemas
from fastapi import BackgroundTasks, HTTPException

class MockRequest:
    def __init__(self, session_data):
        self.session = session_data

def run_test():
    db = SessionLocal()
    try:
        print("1. Подготовка тестовых данных...")
        # 1. Находим или создаем тестового администратора
        admin = db.query(models.Master).filter(models.Master.role == "admin").first()
        if not admin:
            admin = models.Master(name="Тестовый Админ", role="admin", pin="9999", is_active=True)
            db.add(admin)
            db.commit()
            db.refresh(admin)
        print(f"   Администратор для теста: {admin.name} (ID: {admin.id})")

        # 2. Находим или создаем тестового мастера смены
        master = db.query(models.Master).filter(models.Master.role == "master").first()
        if not master:
            master = models.Master(name="Тестовый Мастер", role="master", pin="1111", is_active=True)
            db.add(master)
            db.commit()
            db.refresh(master)

        # 3. Создаем тестовую смену с исходными данными
        test_date = "2026-07-27"
        # Очищаем старые тестовые данные за эту дату, если есть
        old_shifts = db.query(models.Shift).filter(models.Shift.date == test_date, models.Shift.batch_number == "TEST-BATCH-001").all()
        for s in old_shifts:
            db.query(models.LFMReport).filter(models.LFMReport.shift_id == s.id).delete()
            db.query(models.Batch).filter(models.Batch.shift_id == s.id).delete()
            db.query(models.Downtime).filter(models.Downtime.shift_id == s.id).delete()
            db.query(models.RawMaterialReceipt).filter(models.RawMaterialReceipt.shift_id == s.id).delete()
            db.delete(s)
        db.commit()

        shift = models.Shift(
            date=test_date,
            shift_name="День",
            line="1",
            master_id=master.id,
            status="active",
            product_name="Шифер 8 волн рифленый",
            batch_number="TEST-BATCH-001",
            zo_cement_silo1=100.0,
            zo_cellulose=50.0
        )
        db.add(shift)
        db.commit()
        db.refresh(shift)
        shift_id = shift.id
        print(f"   Создана тестовая смена ID {shift_id} (Партия: {shift.batch_number})")

        # Создаем исходный LFMReport
        lfm = models.LFMReport(
            shift_id=shift_id,
            product_name="Шифер 8 волн рифленый",
            lfm_sheets=1000,
            transferred_to_warehouse=950,
            formed_1st_grade=900,
            formed_defect=0
        )
        db.add(lfm)
        # Создаем исходный Batch
        batch = models.Batch(
            shift_id=shift_id,
            batch_number="TEST-BATCH-001",
            product_name="Шифер 8 волн рифленый",
            status="stacked",
            ds_condition=950,
            ds_first_grade=900,
            ds_defect=0
        )
        db.add(batch)
        db.commit()

        print("2. Выполнение запроса PUT /api/admin/shift_report/{shift_id} ...")
        req = MockRequest({"user_id": admin.id, "user_role": "admin"})
        bg = BackgroundTasks()
        
        # Подготавливаем данные для обновления
        update_data = schemas.AdminShiftReportUpdate(
            date="2026-07-28",
            shift_name="Ночь",
            line="2",
            master_id=master.id,
            batch_number="TEST-BATCH-002-UPDATED",
            product_name="Шифер 7 волн 3500*980",
            status="closed",
            lfm_sheets=1200,
            warehouse_gp=1100,
            first_grade=1050,
            has_defect="yes",
            qcd_defect=10,
            zo_cement_silo1=150.5,
            zo_cellulose=60.0,
            ds_defect_chip=5,
            ds_defect_scratch=3
        )

        res = admin_update_shift_report(shift_id=shift_id, data=update_data, request=req, background_tasks=bg, db=db)
        print(f"   Ответ API: {res}")
        assert res.get("status") == "ok", f"Ожидался status ok, получено {res}"

        print("3. Проверка обновленных данных в БД...")
        updated_shift = db.query(models.Shift).get(shift_id)
        assert str(updated_shift.date) == "2026-07-28", f"Неверная дата: {updated_shift.date}"
        assert updated_shift.shift_name == "Ночь", f"Неверная смена: {updated_shift.shift_name}"
        assert updated_shift.line == "2", f"Неверная линия: {updated_shift.line}"
        assert updated_shift.batch_number == "TEST-BATCH-002-UPDATED", f"Неверный номер партии: {updated_shift.batch_number}"
        assert updated_shift.product_name == "Шифер 7 волн 3500*980", f"Неверный продукт: {updated_shift.product_name}"
        assert updated_shift.status == "closed", f"Неверный статус: {updated_shift.status}"
        assert updated_shift.zo_cement_silo1 == 150.5, f"Неверный цемент: {updated_shift.zo_cement_silo1}"
        assert updated_shift.zo_cellulose == 60.0, f"Неверная целлюлоза: {updated_shift.zo_cellulose}"
        print("   -> Метаданные смены и сырье успешно обновлены.")

        updated_lfm = db.query(models.LFMReport).filter(models.LFMReport.shift_id == shift_id).first()
        assert updated_lfm.lfm_sheets == 1200, f"Неверное кол-во листов ЛФМ: {updated_lfm.lfm_sheets}"
        assert updated_lfm.transferred_to_warehouse == 1100, f"Неверный склад ГП: {updated_lfm.transferred_to_warehouse}"
        assert updated_lfm.formed_1st_grade == 1050, f"Неверный 1-й сорт: {updated_lfm.formed_1st_grade}"
        assert updated_lfm.formed_defect == 10, f"Неверный брак ОТК: {updated_lfm.formed_defect}"
        assert updated_lfm.product_name == "Шифер 7 волн 3500*980", f"Неверный продукт ЛФМ: {updated_lfm.product_name}"
        print("   -> Отчет ЛФМ успешно обновлен.")

        updated_batch = db.query(models.Batch).filter(models.Batch.shift_id == shift_id).first()
        assert updated_batch.batch_number == "TEST-BATCH-002-UPDATED", f"Неверная партия в Batch: {updated_batch.batch_number}"
        assert updated_batch.product_name == "Шифер 7 волн 3500*980", f"Неверный продукт в Batch: {updated_batch.product_name}"
        assert updated_batch.ds_condition == 1100, f"Неверный ds_condition: {updated_batch.ds_condition}"
        assert updated_batch.ds_first_grade == 1050, f"Неверный ds_first_grade: {updated_batch.ds_first_grade}"
        assert updated_batch.ds_defect_chip == 5, f"Неверный скол: {updated_batch.ds_defect_chip}"
        assert updated_batch.ds_defect_scratch == 3, f"Неверная царапина: {updated_batch.ds_defect_scratch}"
        assert updated_batch.ds_defect == 8, f"Неверная сумма брака (ожидалось 5+3=8): {updated_batch.ds_defect}"
        print("   -> Запись партии (Batch) и детализация брака успешно обновлены.")

        print("4. Проверка создания записи в AuditLog...")
        audit = db.query(models.AuditLog).filter(models.AuditLog.action.like(f"%{shift_id}%")).order_by(models.AuditLog.id.desc()).first()
        assert audit is not None, "Запись в AuditLog не найдена!"
        print(f"   -> Найдена запись в AuditLog: [{audit.timestamp}] {audit.user_name} - {audit.action}\n      Детали: {audit.details}")

        print("\n=== ВСЕ ТЕСТЫ УСПЕШНО ПРОЙДЕНЫ! ===")

        # 5. Очистка тестовых данных
        print("5. Очистка тестовых данных...")
        db.query(models.LFMReport).filter(models.LFMReport.shift_id == shift_id).delete()
        db.query(models.Batch).filter(models.Batch.shift_id == shift_id).delete()
        db.query(models.Shift).filter(models.Shift.id == shift_id).delete()
        db.commit()
        print("   -> Тестовые данные удалены.")

    except Exception as e:
        print(f"\n[ОШИБКА] Тест завершился с ошибкой: {e}")
        db.rollback()
        sys.exit(1)
    finally:
        db.close()

if __name__ == "__main__":
    run_test()
