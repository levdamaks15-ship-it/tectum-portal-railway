from fastapi.testclient import TestClient
from main import app
from database import SessionLocal
import models
import urllib.parse

client = TestClient(app)

date = "2026-07-22"
shift_name = "День"
line = "Линия 1"

url = f"/api/shifts/by_params?date={date}&shift_name={urllib.parse.quote(shift_name)}&line={urllib.parse.quote(line)}&create_if_not_exists=true"

# First request
r1 = client.get(url)
print("Request 1:", r1.status_code, r1.json().get('id'))

# Second request
r2 = client.get(url)
print("Request 2:", r2.status_code, r2.json().get('id'))

# Third request
r3 = client.get(url)
print("Request 3:", r3.status_code, r3.json().get('id'))
