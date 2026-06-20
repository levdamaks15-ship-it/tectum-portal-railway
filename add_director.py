import sqlite3
import os

db_path = os.path.join(os.path.dirname(__file__), 'tectum.db')
conn = sqlite3.connect(db_path)
cursor = conn.cursor()
cursor.execute("INSERT INTO masters (name, pin, role) SELECT 'Директор', '7777', 'director' WHERE NOT EXISTS (SELECT 1 FROM masters WHERE role='director')")
conn.commit()
conn.close()
print("Director added successfully.")
