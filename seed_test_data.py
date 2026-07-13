import sys
import os

# Добавляем путь к корню проекта, чтобы импорты работали
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from database import SessionLocal
import models
from datetime import datetime

def seed_test_data():
    db = SessionLocal()

    # Смена 1: 04.06.2026
    shift1 = models.Shift(
        date=datetime.strptime("04.06.2026", "%d.%m.%Y").date(),
        shift_name="День",
        line="Линия 2",
        master_id=1,  # Мастер
        # Приход не важен для отклонений сырья (важен только ЗО)
        zo_chrysotile_5_65=4766.0,
        zo_cement_silo1=15000.0,
        zo_cement_silo2=15048.0,
        zo_cement_silo3=0,
        zo_cement_silo4=0,
        zo_cement=30048.0,
        zo_cellulose=705.0,
        zo_crushed_slate=470.0,
        zo_asbozurit=235.0,
        zo_fiberglass=94.0,
        zo_laprol=0,
        zo_batches=50,
        zo_submitted=False
    )
    db.add(shift1)
    db.commit()

    # ЛФМ
    lfm1 = models.LFMReport(
        shift_id=shift1.id,
        product_name="Шифер 7 волн",
        lfm_sheets=2280,
        lfm_wind_resets=123
    )
    db.add(lfm1)

    # Партия
    batch1 = models.Batch(
        shift_id=shift1.id,
        batch_number="B-0406-1",
        product_name="Шифер 7 волн",
        stacked_stacks=22, # примерно 2200 листов
        status="qcd_checked",
        # Дестакер
        ds_condition=2200,
        ds_first_grade=50,
        ds_defect=30,
        # СКК
        qcd_condition=2200,
        qcd_first_grade=50,
        qcd_defect=30
    )
    db.add(batch1)
    db.commit()

    # Смена 2: 15.06.2026
    shift2 = models.Shift(
        date=datetime.strptime("15.06.2026", "%d.%m.%Y").date(),
        shift_name="День",
        line="Линия 2",
        master_id=1,
        zo_chrysotile_5_65=6241.0,
        zo_cement_silo1=0,
        zo_cement_silo2=0,
        zo_cement_silo3=20000.0,
        zo_cement_silo4=19659.0,
        zo_cement=39659.0,
        zo_cellulose=620.0,
        zo_crushed_slate=0.0,
        zo_asbozurit=310.0,
        zo_fiberglass=124.0,
        zo_laprol=1590.0,
        zo_batches=53,
        zo_submitted=False
    )
    db.add(shift2)
    db.commit()

    # ЛФМ 15.06
    lfm2 = models.LFMReport(
        shift_id=shift2.id,
        product_name="Шифер 8 волн глад",
        lfm_sheets=2600,
        lfm_wind_resets=150
    )
    db.add(lfm2)

    # Партия
    batch2 = models.Batch(
        shift_id=shift2.id,
        batch_number="B-1506-1",
        product_name="Шифер 8 волн глад",
        stacked_stacks=26,
        status="qcd_checked",
        ds_condition=2550,
        ds_first_grade=30,
        ds_defect=20,
        qcd_condition=2550,
        qcd_first_grade=30,
        qcd_defect=20
    )
    db.add(batch2)
    db.commit()
    id1 = shift1.id
    id2 = shift2.id
    db.close()
    
    print(f"Shift 04.06 ID: {id1}")
    print(f"Shift 15.06 ID: {id2}")

if __name__ == '__main__':
    seed_test_data()
