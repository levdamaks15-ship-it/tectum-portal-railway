import re

with open('static/admin.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Remove the 'Приход сырья' div block
# It starts with <div style="flex: 1;"> and contains <h4 style="color: var(--primary-color);">Приход сырья</h4>
html = re.sub(r'\s*<div style=\"flex: 1;\">\s*<h4 style=\"color: var\(--primary-color\);\">Приход сырья</h4>.*?</div>', '', html, flags=re.DOTALL | re.IGNORECASE)

with open('static/admin.html', 'w', encoding='utf-8') as f:
    f.write(html)

with open('static/js/admin.js', 'r', encoding='utf-8') as f:
    js = f.read()

# Remove lines assigning document.getElementById('shift-edit-receipt-xxx').value = shift.receipt_xxx || 0;
js = re.sub(r'\s*document\.getElementById\(\'shift-edit-receipt-[^\']+\'\)\.value = shift\.receipt_[a-zA-Z0-9_]+ \|\| 0;', '', js)

# Remove lines parsing receipt_xxx: parseFloat(document.getElementById('shift-edit-receipt-xxx').value) || 0,
js = re.sub(r'\s*receipt_[a-zA-Z0-9_]+:\s*parseFloat\(document\.getElementById\(\'shift-edit-receipt-[^\']+\'\)\.value\) \|\| 0,', '', js)

with open('static/js/admin.js', 'w', encoding='utf-8') as f:
    f.write(js)

print('Done HTML/JS fix!')
