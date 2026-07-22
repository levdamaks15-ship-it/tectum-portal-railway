import re

with open('main.py', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace('''except Exception as e:
        import traceback
        driver = db.bind.dialect.name if db.bind else 'unknown'
        err_msg = f"Database error on driver '{driver}': {str(e)}\\n{traceback.format_exc()}"
        print(err_msg)
        raise HTTPException(status_code=500, detail=err_msg)''', '''except Exception as e:
        import traceback
        print(f"Error in get_plan_board: {str(e)}\\n{traceback.format_exc()}")
        return []''')

with open('main.py', 'w', encoding='utf-8') as f:
    f.write(content)
