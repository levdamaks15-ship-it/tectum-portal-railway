with open('main.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Refactor the dictionary creation in get_report_summary
old_block = '''            "raw_materials": {
                    "chrysotile_4_20": shift.receipt_chrysotile_4_20 if not is_other_master else 0.0,
                    "chrysotile_5_65": shift.receipt_chrysotile_5_65 if not is_other_master else 0.0,
                    "chrysotile_6_40": shift.receipt_chrysotile_6_40 if not is_other_master else 0.0,
                    "cement": shift.receipt_cement if not is_other_master else 0.0,
                    "cellulose": shift.receipt_cellulose if not is_other_master else 0.0,
                    "crushed_slate": shift.receipt_crushed_slate if not is_other_master else 0.0,
                    "asbozurit": shift.receipt_asbozurit if not is_other_master else 0.0,
                    "asbocarton": shift.receipt_asbocarton if not is_other_master else 0.0,
                    "pallets": shift.receipt_pallets if not is_other_master else 0.0,
                    "fiberglass": shift.receipt_fiberglass if not is_other_master else 0.0,
                    "laprol": shift.receipt_laprol if not is_other_master else 0.0
                },'''

new_block = '''            "raw_materials": {
                    "chrysotile_4_20": sum((r.chrysotile_4_20 or 0.0) for r in shift.receipts) if not is_other_master else 0.0,
                    "chrysotile_5_65": sum((r.chrysotile_5_65 or 0.0) for r in shift.receipts) if not is_other_master else 0.0,
                    "chrysotile_6_40": sum((r.chrysotile_6_40 or 0.0) for r in shift.receipts) if not is_other_master else 0.0,
                    "cement": sum((r.cement or 0.0) for r in shift.receipts) if not is_other_master else 0.0,
                    "cellulose": sum((r.cellulose or 0.0) for r in shift.receipts) if not is_other_master else 0.0,
                    "crushed_slate": sum((r.crushed_slate or 0.0) for r in shift.receipts) if not is_other_master else 0.0,
                    "asbozurit": sum((r.asbozurit or 0.0) for r in shift.receipts) if not is_other_master else 0.0,
                    "asbocarton": sum((r.asbocarton or 0.0) for r in shift.receipts) if not is_other_master else 0.0,
                    "pallets": sum((r.pallets or 0.0) for r in shift.receipts) if not is_other_master else 0.0,
                    "fiberglass": sum((r.fiberglass or 0.0) for r in shift.receipts) if not is_other_master else 0.0,
                    "laprol": sum((r.laprol or 0.0) for r in shift.receipts) if not is_other_master else 0.0
                },'''

content = content.replace(old_block, new_block)

# And another block
old_block_2 = '''            "raw_materials": {
                "chrysotile_4_20": {"receipt": shift.receipt_chrysotile_4_20 or 0.0, "zo": shift.zo_chrysotile_4_20 or 0.0},
                "chrysotile_5_65": {"receipt": shift.receipt_chrysotile_5_65 or 0.0, "zo": shift.zo_chrysotile_5_65 or 0.0},
                "chrysotile_6_40": {"receipt": shift.receipt_chrysotile_6_40 or 0.0, "zo": shift.zo_chrysotile_6_40 or 0.0},
                "cement": {"receipt": shift.receipt_cement or 0.0, "zo": zo_cem},
                "cellulose": {"receipt": shift.receipt_cellulose or 0.0, "zo": shift.zo_cellulose or 0.0},
                "crushed_slate": {"receipt": shift.receipt_crushed_slate or 0.0, "zo": shift.zo_crushed_slate or 0.0},
                "asbozurit": {"receipt": shift.receipt_asbozurit or 0.0, "zo": shift.zo_asbozurit or 0.0},
                "asbocarton": {"receipt": shift.receipt_asbocarton or 0.0, "zo": shift.zo_asbocarton or 0.0},
                "fiberglass": {"receipt": shift.receipt_fiberglass or 0.0, "zo": shift.zo_fiberglass or 0.0},
                "laprol": {"receipt": shift.receipt_laprol or 0.0, "zo": shift.zo_laprol or 0.0}
            }'''

new_block_2 = '''            "raw_materials": {
                "chrysotile_4_20": {"receipt": sum((r.chrysotile_4_20 or 0.0) for r in shift.receipts), "zo": shift.zo_chrysotile_4_20 or 0.0},
                "chrysotile_5_65": {"receipt": sum((r.chrysotile_5_65 or 0.0) for r in shift.receipts), "zo": shift.zo_chrysotile_5_65 or 0.0},
                "chrysotile_6_40": {"receipt": sum((r.chrysotile_6_40 or 0.0) for r in shift.receipts), "zo": shift.zo_chrysotile_6_40 or 0.0},
                "cement": {"receipt": sum((r.cement or 0.0) for r in shift.receipts), "zo": zo_cem},
                "cellulose": {"receipt": sum((r.cellulose or 0.0) for r in shift.receipts), "zo": shift.zo_cellulose or 0.0},
                "crushed_slate": {"receipt": sum((r.crushed_slate or 0.0) for r in shift.receipts), "zo": shift.zo_crushed_slate or 0.0},
                "asbozurit": {"receipt": sum((r.asbozurit or 0.0) for r in shift.receipts), "zo": shift.zo_asbozurit or 0.0},
                "asbocarton": {"receipt": sum((r.asbocarton or 0.0) for r in shift.receipts), "zo": shift.zo_asbocarton or 0.0},
                "fiberglass": {"receipt": sum((r.fiberglass or 0.0) for r in shift.receipts), "zo": shift.zo_fiberglass or 0.0},
                "laprol": {"receipt": sum((r.laprol or 0.0) for r in shift.receipts), "zo": shift.zo_laprol or 0.0}
            }'''

content = content.replace(old_block_2, new_block_2)

old_block_3 = '''            "receipt_chrysotile_4_20": shift.receipt_chrysotile_4_20,
            "receipt_chrysotile_5_65": shift.receipt_chrysotile_5_65,
            "receipt_chrysotile_6_40": shift.receipt_chrysotile_6_40,
            "receipt_cement": shift.receipt_cement,
            "receipt_cellulose": shift.receipt_cellulose,
            "receipt_crushed_slate": shift.receipt_crushed_slate,
            "receipt_asbozurit": shift.receipt_asbozurit,
            "receipt_asbocarton": shift.receipt_asbocarton,
            "receipt_pallets": shift.receipt_pallets,
            "receipt_fiberglass": shift.receipt_fiberglass,
            "receipt_laprol": shift.receipt_laprol'''

new_block_3 = '''            "receipt_chrysotile_4_20": sum((r.chrysotile_4_20 or 0.0) for r in shift.receipts) if shift.receipts else 0.0,
            "receipt_chrysotile_5_65": sum((r.chrysotile_5_65 or 0.0) for r in shift.receipts) if shift.receipts else 0.0,
            "receipt_chrysotile_6_40": sum((r.chrysotile_6_40 or 0.0) for r in shift.receipts) if shift.receipts else 0.0,
            "receipt_cement": sum((r.cement or 0.0) for r in shift.receipts) if shift.receipts else 0.0,
            "receipt_cellulose": sum((r.cellulose or 0.0) for r in shift.receipts) if shift.receipts else 0.0,
            "receipt_crushed_slate": sum((r.crushed_slate or 0.0) for r in shift.receipts) if shift.receipts else 0.0,
            "receipt_asbozurit": sum((r.asbozurit or 0.0) for r in shift.receipts) if shift.receipts else 0.0,
            "receipt_asbocarton": sum((r.asbocarton or 0.0) for r in shift.receipts) if shift.receipts else 0.0,
            "receipt_pallets": sum((r.pallets or 0.0) for r in shift.receipts) if shift.receipts else 0.0,
            "receipt_fiberglass": sum((r.fiberglass or 0.0) for r in shift.receipts) if shift.receipts else 0.0,
            "receipt_laprol": sum((r.laprol or 0.0) for r in shift.receipts) if shift.receipts else 0.0'''
            
content = content.replace(old_block_3, new_block_3)

# Remove the legacy fields assignment in get_all_shifts or update_shift
old_block_4 = '''    shift.receipt_chrysotile_4_20 = data.chrysotile_4_20
    shift.receipt_chrysotile_5_65 = data.chrysotile_5_65
    shift.receipt_chrysotile_6_40 = data.chrysotile_6_40
    shift.receipt_cement = data.cement
    shift.receipt_cellulose = data.cellulose
    shift.receipt_crushed_slate = data.crushed_slate
    shift.receipt_asbozurit = data.asbozurit
    shift.receipt_asbocarton = data.asbocarton
    shift.receipt_pallets = data.pallets
    shift.receipt_fiberglass = data.fiberglass
    shift.receipt_laprol = data.laprol'''

content = content.replace(old_block_4, "")

old_block_5 = '''    shift.receipt_chrysotile_4_20 = data.receipt_chrysotile_4_20
    shift.receipt_chrysotile_5_65 = data.receipt_chrysotile_5_65
    shift.receipt_chrysotile_6_40 = data.receipt_chrysotile_6_40
    shift.receipt_cement = data.receipt_cement
    shift.receipt_cellulose = data.receipt_cellulose
    shift.receipt_crushed_slate = data.receipt_crushed_slate
    shift.receipt_asbocarton = data.receipt_asbocarton
    shift.receipt_pallets = data.receipt_pallets
    shift.receipt_fiberglass = data.receipt_fiberglass
    shift.receipt_laprol = data.receipt_laprol'''
content = content.replace(old_block_5, "")

with open('main.py', 'w', encoding='utf-8') as f:
    f.write(content)
