import sqlite3

def add_col():
    conn = sqlite3.connect("tectum.db")
    cursor = conn.cursor()
    try:
        cursor.execute("ALTER TABLE product_norms ADD COLUMN weight_kg FLOAT DEFAULT 0.0")
        conn.commit()
        print("Column added successfully.")
    except Exception as e:
        print(e)
    finally:
        conn.close()

if __name__ == "__main__":
    add_col()
