with open('main.py', 'r', encoding='utf-8') as f:
    c = f.read()

# Fix the broken f-string
old = 'print(f"Error in get_all_shifts: {err}\\ntraceback.format_exc()}")'
new = 'print(f"Error in get_all_shifts: {err}\\n{traceback.format_exc()}")'
c = c.replace(old, new)
print("Old count:", c.count(old))
print("New count:", c.count(new))

with open('main.py', 'w', encoding='utf-8') as f:
    f.write(c)
print("Done")