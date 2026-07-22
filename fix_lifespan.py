with open('main.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix the end of the file
bad_string = '''        raise HTTPException(500, f"Ошибка очистки: {str(e)}")        try:
            if driver == 'postgresql':
                db.execute(text("ALTER TABLE raw_material_receipts ADD COLUMN master_id INTEGER REFERENCES masters(id);"))
            else:
                db.execute(text("ALTER TABLE raw_material_receipts ADD COLUMN master_id INTEGER;"))
            db.commit()
            print("Added master_id to raw_material_receipts")
        except Exception:
            db.rollback()
'''
content = content.replace(bad_string, '        raise HTTPException(500, f"Ошибка очистки: {str(e)}")\n')

# Add migration to lifespan correctly
migration_str = '''    try:
        conn = sqlite3.connect("tectum.db")
        conn.execute("ALTER TABLE raw_material_receipts ADD COLUMN master_id INTEGER;")
        conn.commit()
        conn.close()
    except: pass
    
    # PG version
    try:
        db = SessionLocal()
        driver = db.bind.dialect.name if db.bind else 'unknown'
        if driver == 'postgresql':
            db.execute(text("ALTER TABLE raw_material_receipts ADD COLUMN master_id INTEGER REFERENCES masters(id);"))
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()
'''
insert_pos = content.find('try:\n        conn = sqlite3.connect("tectum.db")\n        conn.execute("ALTER TABLE shifts ADD COLUMN batch_number')
if insert_pos != -1:
    content = content[:insert_pos] + migration_str + '\n    ' + content[insert_pos:]
else:
    print("Could not find lifespan insert position!")

with open('main.py', 'w', encoding='utf-8') as f:
    f.write(content)
