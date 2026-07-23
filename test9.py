from main import get_shift_by_params
from database import SessionLocal

class MockRequest:
    @property
    def session(self):
        return {"user_id": 1, "user_role": "admin"}

db = SessionLocal()
req = MockRequest()

date = "2026-07-22"
shift_name = "День"
line = "Линия 1"

try:
    s1 = get_shift_by_params(date, shift_name, line, req, 1, True, db)
    print("Call 1 ID:", s1.id)
    s2 = get_shift_by_params(date, shift_name, line, req, 1, True, db)
    print("Call 2 ID:", s2.id)
except Exception as e:
    print("Error:", e)
