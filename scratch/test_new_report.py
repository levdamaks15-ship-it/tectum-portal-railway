import requests

BASE_URL = "http://127.0.0.1:8000"

def run_tests():
    session = requests.Session()
    
    # 1. Login as Admin/Master (PIN: 0000)
    res = session.post(f"{BASE_URL}/api/login/", json={"name": "Tectum Engineering", "pin": "0000"})
    assert res.status_code == 200, f"Login failed: {res.text}"
    user_info = res.json()
    master_id = user_info["id"]
    print(f"Logged in as {user_info['name']} (ID: {master_id}, Role: {user_info['role']})")
    
    # 2. Post a shift report
    report_data = {
        "date": "2026-07-11",
        "shift_name": "День",
        "line": "Линия 1",
        "master_id": master_id,
        "batch_number": "9999",
        "product_name": "Шифер 8 волн",
        
        "lfm_sheets": 2800,
        "lfm_wind_resets": 5,
        "zo_batches": 14,
        
        "warehouse_gp": 2700,
        "first_grade": 50,
        "has_defect": "yes",
        
        "ds_defect_chip": 10,
        "ds_defect_scratch": 10,
        "ds_defect_bad_cut": 10,
        "ds_defect_stick_bottom": 5,
        "ds_defect_stick_top": 5,
        "ds_defect_broken": 5,
        "ds_defect_fell_box": 1,
        "ds_defect_dent": 1,
        "ds_defect_thickness": 1,
        "ds_defect_delamination": 1,
        "ds_defect_edge": 1,
        
        "qcd_defect": 50,

        "zo_chrysotile_4_20": 1000.0,
        "zo_chrysotile_5_65": 2000.0,
        "zo_chrysotile_6_40": 3000.0,
        "zo_cement_silo1": 5000.0,
        "zo_cement_silo2": 5000.0,
        "zo_cement_silo3": 2000.0,
        "zo_cement_silo4": 2000.0,
        "zo_cellulose": 150.0,
        "zo_crushed_slate": 500.0,
        "zo_asbozurit": 0.0,
        "zo_fiberglass": 0.0,
        "zo_laprol": 50.0,
        "zo_asbocarton": 88.0,
        "zo_asb_drain": 15.0,
        "zo_cem_drain": 42.0,

        "receipt_chrysotile_4_20": 0.0,
        "receipt_chrysotile_5_65": 0.0,
        "receipt_chrysotile_6_40": 0.0,
        "receipt_cement": 0.0,
        "receipt_cellulose": 0.0,
        "receipt_crushed_slate": 0.0,
        "receipt_asbozurit": 0.0,
        "receipt_asbocarton": 0.0,
        "receipt_pallets": 0.0,
        "receipt_fiberglass": 0.0,
        "receipt_laprol": 0.0
    }
    
    # Send report
    res = session.post(f"{BASE_URL}/api/report", json=report_data)
    assert res.status_code == 200, f"Failed to post report: {res.text}"
    print("Report posted successfully!")
    
    # 3. Retrieve summary and verify details
    res = session.get(f"{BASE_URL}/api/report/summary?from_date=2026-07-11&to_date=2026-07-11")
    assert res.status_code == 200, f"Summary failed: {res.status_code} - {res.text}"
    summary = res.json()
    assert len(summary) > 0
    shift_row = [r for r in summary if r["batch_number"] == "9999"][0]
    assert shift_row["lfm_sheets"] == 2800
    assert shift_row["warehouse_gp"] == 2700
    assert shift_row["defect"] == 50
    print("Report summary verified successfully!")
    
    # 4. Retrieve materials summary and verify
    res = session.get(f"{BASE_URL}/api/report/materials_summary?start_date=2026-07-11&end_date=2026-07-11")
    assert res.status_code == 200
    mats = res.json()
    assert mats["totals"]["chrysotile_4_20"]["zo"] == 1000.0
    print("Materials summary verified successfully!")
    
    print("ALL NEW REPORT FLOW TESTS PASSED!")

if __name__ == "__main__":
    run_tests()
