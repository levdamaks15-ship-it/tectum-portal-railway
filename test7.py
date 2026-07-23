import sqlite3
import json

conn = sqlite3.connect('tectum.db')
c = conn.cursor()
c.execute("SELECT id, date, shift_name, line FROM shifts WHERE date='2026-06-02' ORDER BY id")
rows = c.fetchall()

with open('test_out7.json', 'w', encoding='utf-8') as f:
    json.dump(rows, f, ensure_ascii=False)
