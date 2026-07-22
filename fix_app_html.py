with open('static/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Remove receipts table
import re
content = re.sub(r'<div class="table-responsive".*?<table class="tectum-table" id="receipts-table">.*?</table>.*?</div>', '', content, flags=re.DOTALL)

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(content)
