with open('main.py', 'r', encoding='utf-8') as f:
    content = f.read()

old_mats_query = '''    mats_query = db.query(
        func.sum(models.Shift.receipt_chrysotile_4_20).label('r_4_20'),
        func.sum(models.Shift.receipt_chrysotile_5_65).label('r_5_65'),
        func.sum(models.Shift.receipt_chrysotile_6_40).label('r_6_40'),
        func.sum(models.Shift.zo_chrysotile_4_20).label('z_4_20'),
        func.sum(models.Shift.zo_chrysotile_5_65).label('z_5_65'),
        func.sum(models.Shift.zo_chrysotile_6_40).label('z_6_40'),
        func.sum(models.Shift.receipt_cement).label('r_cem'),
        func.sum(models.Shift.zo_cement).label('z_cem'),
        func.sum(models.Shift.receipt_cellulose).label('r_cel'),
        func.sum(models.Shift.zo_cellulose).label('z_cel')
    )'''

new_mats_query = '''    mats_query_receipt = db.query(
        func.sum(models.RawMaterialReceipt.chrysotile_4_20).label('r_4_20'),
        func.sum(models.RawMaterialReceipt.chrysotile_5_65).label('r_5_65'),
        func.sum(models.RawMaterialReceipt.chrysotile_6_40).label('r_6_40'),
        func.sum(models.RawMaterialReceipt.cement).label('r_cem'),
        func.sum(models.RawMaterialReceipt.cellulose).label('r_cel')
    ).select_from(models.RawMaterialReceipt).join(models.Shift, models.Shift.id == models.RawMaterialReceipt.shift_id)

    mats_query_zo = db.query(
        func.sum(models.Shift.zo_chrysotile_4_20).label('z_4_20'),
        func.sum(models.Shift.zo_chrysotile_5_65).label('z_5_65'),
        func.sum(models.Shift.zo_chrysotile_6_40).label('z_6_40'),
        func.sum(models.Shift.zo_cement).label('z_cem'),
        func.sum(models.Shift.zo_cellulose).label('z_cel')
    )'''

content = content.replace(old_mats_query, new_mats_query)

old_mats_filter = '''        mats_query = mats_query.filter(models.Shift.master_id == user_id)'''
new_mats_filter = '''        mats_query_receipt = mats_query_receipt.filter(models.Shift.master_id == user_id)
        mats_query_zo = mats_query_zo.filter(models.Shift.master_id == user_id)'''
content = content.replace(old_mats_filter, new_mats_filter)

old_mats_exec = '''    mats = mats_query.first()'''
new_mats_exec = '''    mats_rec = mats_query_receipt.first()
    mats_zo = mats_query_zo.first()'''
content = content.replace(old_mats_exec, new_mats_exec)

old_mats_assign = '''    rec_asb = (mats.r_4_20 or 0) + (mats.r_5_65 or 0) + (mats.r_6_40 or 0)
    zo_asb = (mats.z_4_20 or 0) + (mats.z_5_65 or 0) + (mats.z_6_40 or 0)'''
new_mats_assign = '''    rec_asb = (mats_rec.r_4_20 or 0) + (mats_rec.r_5_65 or 0) + (mats_rec.r_6_40 or 0) if mats_rec else 0
    zo_asb = (mats_zo.z_4_20 or 0) + (mats_zo.z_5_65 or 0) + (mats_zo.z_6_40 or 0) if mats_zo else 0'''
content = content.replace(old_mats_assign, new_mats_assign)

with open('main.py', 'w', encoding='utf-8') as f:
    f.write(content)
