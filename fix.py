import re

with open('main.py', 'r', encoding='utf-8') as f:
    content = f.read()

def fix_func(func_name, code):
    match = re.search(f'def {func_name}.*?(?=^def |\\Z)', code, re.MULTILINE | re.DOTALL)
    if not match: return code
    func_code = match.group(0)
    
    def repl(m):
        field = m.group(1)
        return f'sum(r.{field} for r in shift.receipts)'
        
    new_func_code = re.sub(r'shift\.receipt_([a-zA-Z0-9_]+)', repl, func_code)
    return code.replace(func_code, new_func_code)

content = fix_func('get_report_summary', content)
content = fix_func('get_materials_summary', content)

# Remove the assignments
content = re.sub(r'\s*shift\.receipt_[a-zA-Z0-9_]+\s*=\s*data\.[a-zA-Z0-9_]+', '', content)

# Remove the old_values/new_values entries in admin_update_shift
content = re.sub(r'\s*\"receipt_[a-zA-Z0-9_]+\":\s*shift\.receipt_[a-zA-Z0-9_]+,?', '', content)

with open('main.py', 'w', encoding='utf-8') as f:
    f.write(content)
print('Done!')
