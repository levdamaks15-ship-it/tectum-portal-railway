import re

with open('main.py', 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
i = 0
while i < len(lines):
    line = lines[i]
    
    # get_all_shifts
    if line.startswith('def get_all_shifts('):
        new_lines.append(line)
        i += 1
        new_lines.append('    try:\n')
        new_lines.append('    ' + lines[i])
        new_lines.append('    except Exception as err:\n')
        new_lines.append('        print(f"Error: {err}")\n')
        new_lines.append('        return []\n')
        i += 1
        continue
        
    # get_report_summary
    if line.startswith('def get_report_summary('):
        new_lines.append(line)
        while 'query = db.query(models.Shift)' not in lines[i]:
            i += 1
            new_lines.append(lines[i])
        
        new_lines.pop()
        new_lines.append('    try:\n')
        new_lines.append('        query = db.query(models.Shift)\n')
        
        i += 1
        while '    return result' not in lines[i]:
            l = lines[i]
            if 'Н/Д' in l and 'shift.master.name' in l:
                l = l.replace('Н/Д', 'Мастер удалён')
            new_lines.append('    ' + l if l.strip() else l)
            i += 1
            
        new_lines.append('    except Exception as err:\n')
        new_lines.append('        print(f"Error: {err}")\n')
        new_lines.append(lines[i])
        i += 1
        continue
        
    # get_materials_summary
    if line.startswith('def get_materials_summary('):
        new_lines.append(line)
        while 'query = db.query(models.Shift)' not in lines[i]:
            i += 1
            new_lines.append(lines[i])
            
        new_lines.pop()
        new_lines.append('    try:\n')
        new_lines.append('        query = db.query(models.Shift)\n')
        
        i += 1
        while '    return {' not in lines[i]:
            l = lines[i]
            new_lines.append('    ' + l if l.strip() else l)
            i += 1
            
        new_lines.append('    except Exception as err:\n')
        new_lines.append('        print(f"Error: {err}")\n')
        new_lines.append(lines[i])
        i += 1
        continue

    new_lines.append(line)
    i += 1

with open('main.py', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)
