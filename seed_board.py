import os
import datetime
from sqlalchemy.orm import Session
from database import SessionLocal, engine, Base
from models import Master, Shift, LFMReport, ProductNorm

def seed_board():
    db = SessionLocal()
    
    # Сначала добавим мастеров, если их нет
    masters = ["Бекбосынов Р.", "Монаев С.", "Султанұлы С.", "Дауылбай М."]
    for m in masters:
        user = db.query(Master).filter(Master.name == m).first()
        if not user:
            db.add(Master(name=m, role="master", pin="0000"))
    
    db.commit()
    
    board_data = [
        {
            "master": "Бекбосынов Р.",
            "shifts": [
                ("2026-06-04", "День", 390),
                ("2026-06-05", "Ночь", 3200),
                ("2026-06-08", "День", 2690),
                ("2026-06-09", "Ночь", 3144),
                ("2026-06-12", "День", 1992),
                ("2026-06-13", "Ночь", 2850),
                ("2026-06-20", "День", 2480),
            ]
        },
        {
            "master": "Монаев С.",
            "shifts": [
                ("2026-06-03", "День", 800),
                ("2026-06-04", "Ночь", 2280),
                ("2026-06-07", "День", 1890),
                ("2026-06-08", "Ночь", 2780),
                ("2026-06-11", "День", 2280),
                ("2026-06-12", "Ночь", 2296),
                ("2026-06-15", "День", 1100),
                ("2026-06-16", "Ночь", 2242),
            ]
        },
        {
            "master": "Султанұлы С.",
            "shifts": [
                ("2026-06-02", "Ночь", 990),
                ("2026-06-05", "День", 2488),
                ("2026-06-06", "Ночь", 2856),
                ("2026-06-09", "День", 2150),
                ("2026-06-10", "Ночь", 2250),
                ("2026-06-13", "День", 1180),
                ("2026-06-14", "Ночь", 2730),
                ("2026-06-17", "День", 2290),
                ("2026-06-18", "Ночь", 2780),
            ]
        },
        {
            "master": "Дауылбай М.",
            "shifts": [
                ("2026-06-02", "День", 140),
                ("2026-06-03", "Ночь", 1420),
                ("2026-06-06", "День", 2800),
                ("2026-06-07", "Ночь", 3070),
                ("2026-06-10", "День", 768),
                ("2026-06-11", "Ночь", 3200),
                ("2026-06-14", "День", 2070),
                ("2026-06-15", "Ночь", 2600),
                ("2026-06-18", "День", 940),
                ("2026-06-20", "Ночь", 3140),
                ("2026-06-23", "День", 541),
            ]
        }
    ]
    
    # Check if there's already a product norm for 'Шифер 8 волн'
    norm = db.query(ProductNorm).filter(ProductNorm.product_name == "Шифер 8 волн").first()
    if not norm:
        norm = ProductNorm(product_name="Шифер 8 волн", weight_kg=18.2)
        db.add(norm)
        db.commit()
        db.refresh(norm)

    for item in board_data:
        master_name = item["master"]
        # Find master
        master = db.query(Master).filter(Master.name == master_name).first()
        if not master:
            continue
            
        for shift_date_str, shift_name, fact in item["shifts"]:
            shift_date = datetime.datetime.strptime(shift_date_str, "%Y-%m-%d").date()
            # Проверим, есть ли уже такая смена
            existing = db.query(Shift).filter(
                Shift.master_id == master.id,
                Shift.date == shift_date,
                Shift.shift_name == shift_name
            ).first()
            
            if not existing:
                s = Shift(
                    date=shift_date,
                    shift_name=shift_name,
                    line="ЛФМ-1", # Допустим ЛФМ-1 по умолчанию
                    master_id=master.id,
                    status="closed"
                )
                db.add(s)
                db.commit()
                db.refresh(s)
                
                # Добавим рапорт LFM для факта
                rep = LFMReport(
                    shift_id=s.id,
                    product_name="Шифер 8 волн",
                    lfm_sheets=fact,
                    lfm_wind_resets=0
                )
                db.add(rep)
                db.commit()

    print("Данные с доски успешно добавлены!")
    db.close()

if __name__ == "__main__":
    seed_board()
