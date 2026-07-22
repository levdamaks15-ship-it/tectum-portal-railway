import re

with open('main.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace mats.r_ and mats.z_ in get_dashboard_stats
old_materials_dict = '''            "materials": {
                "Хризотил": {"receipt": rec_asb, "zo": zo_asb},
                "Цемент": {"receipt": mats.r_cem or 0, "zo": mats.z_cem or 0},
                "Целлюлоза": {"receipt": mats.r_cel or 0, "zo": mats.z_cel or 0}
            }'''
new_materials_dict = '''            "materials": {
                "Хризотил": {"receipt": rec_asb, "zo": zo_asb},
                "Цемент": {"receipt": mats_rec.r_cem or 0 if mats_rec else 0, "zo": mats_zo.z_cem or 0 if mats_zo else 0},
                "Целлюлоза": {"receipt": mats_rec.r_cel or 0 if mats_rec else 0, "zo": mats_zo.z_cel or 0 if mats_zo else 0}
            }'''
content = content.replace(old_materials_dict, new_materials_dict)

with open('main.py', 'w', encoding='utf-8') as f:
    f.write(content)
