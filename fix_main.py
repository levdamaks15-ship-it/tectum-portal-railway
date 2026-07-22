with open('main.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Add migration to lifespan
migration_str = '''        try:
            if driver == 'postgresql':
                db.execute(text("ALTER TABLE raw_material_receipts ADD COLUMN master_id INTEGER REFERENCES masters(id);"))
            else:
                db.execute(text("ALTER TABLE raw_material_receipts ADD COLUMN master_id INTEGER REFERENCES masters(id);"))
            db.commit()
            print("Added master_id to raw_material_receipts")
        except Exception:
            db.rollback()'''
insert_pos = content.find('try:\\n            if driver == \\'postgresql\\':\\n                db.execute(text("ALTER TABLE shifts ADD COLUMN receipt_chrysotile_4_20 FLOAT DEFAULT 0.0;"))')
content = content[:insert_pos] + migration_str + '\\n\\n        ' + content[insert_pos:]

# Update add_raw_material_receipt
old_receipt_create = '''    receipt = models.RawMaterialReceipt(
        shift_id=shift.id,
        chrysotile_4_20=data.chrysotile_4_20,'''

new_receipt_create = '''    receipt = models.RawMaterialReceipt(
        shift_id=shift.id,
        master_id=data.master_id,
        chrysotile_4_20=data.chrysotile_4_20,'''

content = content.replace(old_receipt_create, new_receipt_create)

with open('main.py', 'w', encoding='utf-8') as f:
    f.write(content)
