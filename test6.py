import re

with open('static/index.html', encoding='utf-8') as f:
    html = f.read()

selects = re.findall(r'<select.*?id="(.*?)".*?>(.*?)</select>', html, re.DOTALL)
for select_id, options_html in selects:
    options = re.findall(r'<option.*?value="(.*?)".*?>(.*?)</option>', options_html)
    print(f"Select: {select_id}")
    for val, text in options:
        print(f"  - '{val}': '{text}'")
