with open('main.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace r.cement with (r.cement_silo1 or 0) + (r.cement_silo2 or 0) + (r.cement_silo3 or 0) + (r.cement_silo4 or 0)
content = content.replace(
    'r.cement or 0.0', 
    '((r.cement_silo1 or 0.0) + (r.cement_silo2 or 0.0) + (r.cement_silo3 or 0.0) + (r.cement_silo4 or 0.0))'
)

# And in Mats query
old_mats_cem = "func.sum(models.RawMaterialReceipt.cement).label('r_cem')"
new_mats_cem = "func.sum(models.RawMaterialReceipt.cement_silo1 + models.RawMaterialReceipt.cement_silo2 + models.RawMaterialReceipt.cement_silo3 + models.RawMaterialReceipt.cement_silo4).label('r_cem')"
content = content.replace(old_mats_cem, new_mats_cem)

with open('main.py', 'w', encoding='utf-8') as f:
    f.write(content)
