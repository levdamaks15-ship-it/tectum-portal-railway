import requests

BASE_URL = "http://127.0.0.1:8000"

def run_tests():
    session = requests.Session()
    
    # 1. Login as Admin/Master (PIN: 0000)
    res = session.post(f"{BASE_URL}/api/login/", json={"name": "Админ", "pin": "0000"})
    assert res.status_code == 200, f"Login failed: {res.text}"
    user_info = res.json()
    master_id = user_info["id"]
    print(f"Logged in as {user_info['name']} (ID: {master_id}, Role: {user_info['role']})")
    
    # 2. Check for active shifts
    res = session.get(f"{BASE_URL}/api/shifts/active")
    assert res.status_code == 200
    active_shifts = res.json()
    
    created_shift = False
    if not active_shifts:
        print("No active shifts. Creating a test shift...")
        res = session.post(f"{BASE_URL}/api/shifts/", json={
            "date": "2026-06-30",
            "shift_name": "День",
            "line": "Линия 1",
            "master_id": master_id
        })
        assert res.status_code == 200, f"Failed to create shift: {res.text}"
        shift = res.json()
        shift_id = shift["id"]
        created_shift = True
        print(f"Created active test shift {shift_id}")
    else:
        shift_id = active_shifts[0]["id"]
        print(f"Using existing active shift {shift_id}")
        
    try:
        # 3. Update ZO with asbocarton
        zo_data = {
            "chrysotile_4_20": 100.0,
            "chrysotile_5_65": 200.0,
            "chrysotile_6_40": 300.0,
            "cement": 1000.0,
            "cement_silo1": 250.0,
            "cement_silo2": 250.0,
            "cement_silo3": 250.0,
            "cement_silo4": 250.0,
            "cellulose": 15.0,
            "crushed_slate": 50.0,
            "asbozurit": 0.0,
            "fiberglass": 0.0,
            "laprol": 5.0,
            "asbocarton": 88.5,  # New field
            "asb_drain": 15.2,
            "cem_drain": 42.1,
            "batches": 5,
            "submitted": True
        }
        res = session.post(f"{BASE_URL}/api/shifts/{shift_id}/zo", json=zo_data)
        assert res.status_code == 200, f"ZO update failed: {res.text}"
        print("ZO updated successfully")
        
        # 5. Get materials report and verify values
        res = session.get(f"{BASE_URL}/api/shifts/{shift_id}/materials_report")
        assert res.status_code == 200
        report = res.json()
        
        asbocarton_details = [d for d in report["details"] if d["material"] == "Асбокартон"]
        assert len(asbocarton_details) == 1
        assert asbocarton_details[0]["actual"] == 88.5
        print("Asbocarton confirmed in materials report!")
        
        # 6. Get shift details and confirm ZO drains
        res = session.get(f"{BASE_URL}/api/shifts/{shift_id}")
        assert res.status_code == 200
        s_val = res.json()
        assert s_val["zo_asb_drain"] == 15.2
        assert s_val["zo_cem_drain"] == 42.1
        assert s_val["zo_asbocarton"] == 88.5
        print("ZO drains and zo_asbocarton confirmed in shift model fields!")
        
        print("ALL TESTS PASSED SUCCESSFULLY!")
        
    finally:
        if created_shift:
            print("Cleaning up: closing the test shift...")
            res = session.put(f"{BASE_URL}/api/shifts/{shift_id}/close")
            assert res.status_code == 200
            print("Test shift closed successfully")

if __name__ == "__main__":
    run_tests()
