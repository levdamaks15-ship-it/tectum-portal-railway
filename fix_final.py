with open('main.py', 'r', encoding='utf-8') as f:
    c = f.read()

# 1. Remove chained selectinload for RawMaterialReceipt.master (column doesn't exist on PG)
old_chain = 'selectinload(models.Shift.receipts).selectinload(models.RawMaterialReceipt.master),'
new_chain = 'selectinload(models.Shift.receipts),'
c = c.replace(old_chain, new_chain)
print("1. Removed chained selectinload for RawMaterialReceipt.master:", old_chain not in c)

# 2. Fix PG migration for master_id - replace blind except with proper check
old_migration = '''    # PG version
    try:
        db = SessionLocal()
        driver = db.bind.dialect.name if db.bind else 'unknown'
        if driver == 'postgresql':
            db.execute(text("ALTER TABLE raw_material_receipts ADD COLUMN master_id INTEGER REFERENCES masters(id);"))
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()'''

new_migration = '''    # PG version - ensure master_id column exists
    try:
        db = SessionLocal()
        driver = db.bind.dialect.name if db.bind else 'unknown'
        if driver == 'postgresql':
            from sqlalchemy import text
            col_exists = db.execute(text(
                "SELECT column_name FROM information_schema.columns WHERE table_name='raw_material_receipts' AND column_name='master_id'"
            )).fetchone()
            if not col_exists:
                print("Adding master_id column to raw_material_receipts on PostgreSQL...")
                db.execute(text("ALTER TABLE raw_material_receipts ADD COLUMN master_id INTEGER REFERENCES masters(id);"))
                db.commit()
                print("master_id column added successfully.")
    except Exception as e:
        print(f"Warning: could not add master_id column: {e}")
        db.rollback()
    finally:
        db.close()'''

c = c.replace(old_migration, new_migration)
print("2. Fixed PG migration:", old_migration not in c)

with open('main.py', 'w', encoding='utf-8') as f:
    f.write(c)
print("Done")