from database import SessionLocal, engine, Base
import models

def seed_norms():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    
    norms_data = [
        {
            "product_name": "Шифер 7 волн",
            "weight_kg": 17.07,
            "norm_chrysotile_5_65": 2.01,
            "norm_cement": 13.01,
            "norm_fiberglass": 0.04,
            "norm_cellulose": 0.201,
            "norm_asbozurit": 0.101,
            "norm_crushed_slate": 0.201
        },
        {
            "product_name": "Шифер 7 волн 3500*980",
            "weight_kg": 34.14,
            "norm_chrysotile_5_65": 4.03,
            "norm_cement": 26.01,
            "norm_fiberglass": 0.08,
            "norm_cellulose": 0.402,
            "norm_asbozurit": 0.201,
            "norm_crushed_slate": 0.402
        },
        {
            "product_name": "Шифер 8 волн",
            "weight_kg": 19.60,
            "norm_chrysotile_5_65": 2.31,
            "norm_cement": 14.93,
            "norm_fiberglass": 0.046,
            "norm_cellulose": 0.231,
            "norm_asbozurit": 0.115,
            "norm_crushed_slate": 0.231
        },
        {
            "product_name": "Шифер 8 волн глад",
            "weight_kg": 19.60,
            "norm_chrysotile_5_65": 2.31,
            "norm_cement": 14.93,
            "norm_fiberglass": 0.046,
            "norm_cellulose": 0.231,
            "norm_asbozurit": 0.115,
            "norm_crushed_slate": 0.231
        },
        {
            "product_name": "Шифер 8 волн рифленый",
            "weight_kg": 19.60,
            "norm_chrysotile_5_65": 2.31,
            "norm_cement": 14.93,
            "norm_fiberglass": 0.046,
            "norm_cellulose": 0.231,
            "norm_asbozurit": 0.115,
            "norm_crushed_slate": 0.231
        },
        {
            "product_name": "Шифер плоский 10 мм",
            "weight_kg": 34.99,
            "norm_chrysotile_5_65": 4.14,
            "norm_cement": 26.73,
            "norm_fiberglass": 0.0,
            "norm_cellulose": 0.413,
            "norm_asbozurit": 0.207,
            "norm_crushed_slate": 0.413
        },
        {
            "product_name": "Шифер плоский 8 мм",
            "weight_kg": 27.99,
            "norm_chrysotile_5_65": 3.31,
            "norm_cement": 21.38,
            "norm_fiberglass": 0.0,
            "norm_cellulose": 0.331,
            "norm_asbozurit": 0.165,
            "norm_crushed_slate": 0.331
        },
        {
            "product_name": "Шифер плоский 6 мм",
            "weight_kg": 21.00,
            "norm_chrysotile_5_65": 2.48,
            "norm_cement": 16.04,
            "norm_fiberglass": 0.0,
            "norm_cellulose": 0.248,
            "norm_asbozurit": 0.124,
            "norm_crushed_slate": 0.248
        },
        {
            "product_name": "Шифер РП 1750*930",
            "weight_kg": 17.43,
            "norm_chrysotile_5_65": 2.06,
            "norm_cement": 13.28,
            "norm_fiberglass": 0.041,
            "norm_cellulose": 0.205,
            "norm_asbozurit": 0.103,
            "norm_crushed_slate": 0.205
        }
    ]

    for data in norms_data:
        existing = db.query(models.ProductNorm).filter(models.ProductNorm.product_name == data["product_name"]).first()
        if not existing:
            norm = models.ProductNorm(**data)
            db.add(norm)
            print(f"Added norm for {data['product_name']}")
        else:
            for key, val in data.items():
                setattr(existing, key, val)
            print(f"Updated norm for {data['product_name']}")
            
    db.commit()
    db.close()
    print("Seed completed.")

if __name__ == "__main__":
    seed_norms()
