with open('main.py', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace('mats.r_cem', 'mats_rec.r_cem if mats_rec else 0')
content = content.replace('mats.z_cem', 'mats_zo.z_cem if mats_zo else 0')
content = content.replace('mats.r_cel', 'mats_rec.r_cel if mats_rec else 0')
content = content.replace('mats.z_cel', 'mats_zo.z_cel if mats_zo else 0')

with open('main.py', 'w', encoding='utf-8') as f:
    f.write(content)
