with open('google_sheets_integration.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the data generation loop for export_receipt_to_google_sheets
old_loop = '''    # 3. Сбор данных и отправка (по всем сменам, у которых есть хотя бы один приход)
    # Сортировка смен: сначала по дате по возрастанию, затем по id (id растет с течением времени)
    shifts = db.query(models.Shift).filter(models.Shift.receipts.any()).order_by(models.Shift.date.asc(), models.Shift.id.asc()).all()

    rows_data = []
    rows_data.append(headers)

    for s in shifts:
        date_str = s.date.strftime("%d.%m.%Y") if s.date else ""
        
        sum_chrysotile_4_20 = sum(r.chrysotile_4_20 for r in s.receipts)
        sum_chrysotile_5_65 = sum(r.chrysotile_5_65 for r in s.receipts)
        sum_chrysotile_6_40 = sum(r.chrysotile_6_40 for r in s.receipts)
        sum_cement_silo1 = sum(r.cement_silo1 for r in s.receipts)
        sum_cement_silo2 = sum(r.cement_silo2 for r in s.receipts)
        sum_cement_silo3 = sum(r.cement_silo3 for r in s.receipts)
        sum_cement_silo4 = sum(r.cement_silo4 for r in s.receipts)
        sum_cellulose = sum(r.cellulose for r in s.receipts)
        sum_crushed_slate = sum(r.crushed_slate for r in s.receipts)
        sum_asbozurit = sum(r.asbozurit for r in s.receipts)
        sum_asbocarton = sum(r.asbocarton for r in s.receipts)
        sum_pallets = sum(r.pallets for r in s.receipts)
        sum_fiberglass = sum(r.fiberglass for r in s.receipts)
        sum_laprol = sum(r.laprol for r in s.receipts)
        
        row = [
            date_str,
            s.shift_name or "",
            s.line or "",
            s.master.name if s.master else "",
            sum_chrysotile_4_20,
            sum_chrysotile_5_65,
            sum_chrysotile_6_40,
            sum_cement_silo1,
            sum_cement_silo2,
            sum_cement_silo3,
            sum_cement_silo4,
            sum_cellulose,
            sum_crushed_slate,
            sum_asbozurit,
            sum_asbocarton,
            sum_pallets,
            sum_fiberglass,
            sum_laprol
        ]
        rows_data.append(row)'''

new_loop = '''    # 3. Сбор данных и отправка (по каждому приходу отдельная строка)
    receipts = db.query(models.RawMaterialReceipt).join(models.Shift).order_by(models.Shift.date.asc(), models.RawMaterialReceipt.id.asc()).all()

    rows_data = []
    rows_data.append(headers)

    for r in receipts:
        s = r.shift
        date_str = s.date.strftime("%d.%m.%Y") if s and s.date else ""
        
        # Determine master: check receipt.master first, fallback to shift.master
        m_name = ""
        if r.master:
            m_name = r.master.name
        elif s and s.master:
            m_name = s.master.name
            
        row = [
            date_str,
            s.shift_name if s else "",
            s.line if s else "",
            m_name,
            r.chrysotile_4_20,
            r.chrysotile_5_65,
            r.chrysotile_6_40,
            r.cement_silo1,
            r.cement_silo2,
            r.cement_silo3,
            r.cement_silo4,
            r.cellulose,
            r.crushed_slate,
            r.asbozurit,
            r.asbocarton,
            r.pallets,
            r.fiberglass,
            r.laprol
        ]
        rows_data.append(row)'''

content = content.replace(old_loop, new_loop)

with open('google_sheets_integration.py', 'w', encoding='utf-8') as f:
    f.write(content)
