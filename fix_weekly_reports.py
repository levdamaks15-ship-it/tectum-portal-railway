import re

with open("main.py", "r", encoding="utf-8") as f:
    content = f.read()

# Replace export_week loop
old_export_week = """    for s in shifts:
        pb_line = s.line.replace("Линия ", "ЛФМ-") if s.line else "ЛФМ-1"
        pb = pb_dict.get((s.date, s.shift_name, pb_line))
        
        plan_sheets = pb.plan_sheets if pb else 0
        total_sheets = pb.fact_sheets if pb else 0
        
        sum_lfm_sheets = sum(r.lfm_sheets for r in s.lfm_reports)
        sum_lfm_tons = sum(r.lfm_sheets * get_product_finished_weight_kg(db, r.product_name) / 1000.0 for r in s.lfm_reports)
        avg_w = (sum_lfm_tons / sum_lfm_sheets) if sum_lfm_sheets > 0 else (19.6/1000)
        
        plan_tons = plan_sheets * avg_w
        total_tons = total_sheets * avg_w
        
        ws.append([str(s.date), s.shift_name, s.master.name if s.master else "Н/Д", s.line, plan_sheets, total_sheets, round(plan_tons, 2), round(total_tons, 2)])"""

new_export_week = """    active_lines = set([s.line.replace("Линия ", "ЛФМ-") for s in shifts if s.line] + [pb.line for pb in plan_boards])
    if not active_lines:
        active_lines = {"ЛФМ-2"}

    for l_key in active_lines:
        for i in range(7):
            d = sd + timedelta(days=i)
            for s_name in ["День", "Ночь"]:
                plan_sheets = 0 if d.weekday() == 0 and s_name == "День" else (2700 if s_name == "День" else 3300)
                
                pb = pb_dict.get((d, s_name, l_key))
                if pb and pb.plan_sheets is not None:
                    plan_sheets = pb.plan_sheets
                    
                s = next((shift for shift in shifts if shift.date == d and shift.shift_name == s_name and (shift.line.replace("Линия ", "ЛФМ-") if shift.line else "ЛФМ-1") == l_key), None)
                total_sheets = pb.fact_sheets if pb else 0
                
                if s:
                    sum_lfm_sheets = sum(r.lfm_sheets for r in s.lfm_reports)
                    sum_lfm_tons = sum(r.lfm_sheets * get_product_finished_weight_kg(db, r.product_name) / 1000.0 for r in s.lfm_reports)
                    avg_w = (sum_lfm_tons / sum_lfm_sheets) if sum_lfm_sheets > 0 else (19.6/1000)
                    if total_sheets == 0 and sum_lfm_sheets > 0:
                        total_sheets = sum_lfm_sheets
                    master_name = s.master.name if s.master else "Н/Д"
                else:
                    avg_w = 19.6 / 1000.0
                    master_name = "Н/Д"
                    
                plan_tons = plan_sheets * avg_w
                total_tons = total_sheets * avg_w
                
                ws.append([str(d), s_name, master_name, l_key, plan_sheets, total_sheets, round(plan_tons, 2), round(total_tons, 2)])"""

if old_export_week in content:
    content = content.replace(old_export_week, new_export_week)
else:
    print("Could not find old_export_week")


old_get_weekly = """    data = []
    for s in shifts:
        pb_line = s.line.replace("Линия ", "ЛФМ-") if s.line else "ЛФМ-1"
        pb = pb_dict.get((s.date, s.shift_name, pb_line))
        
        plan_sheets = pb.plan_sheets if pb and pb.plan_sheets else get_shift_plan(db, s)
        total_sheets = pb.fact_sheets if pb else 0
        
        sum_lfm_sheets = sum(r.lfm_sheets for r in s.lfm_reports)
        sum_lfm_tons = sum(r.lfm_sheets * get_product_finished_weight_kg(db, r.product_name) / 1000.0 for r in s.lfm_reports)
        avg_w = (sum_lfm_tons / sum_lfm_sheets) if sum_lfm_sheets > 0 else (19.6/1000)
        
        if total_sheets == 0 and sum_lfm_sheets > 0:
            total_sheets = sum_lfm_sheets
            
        plan_tons = plan_sheets * avg_w
        total_tons = total_sheets * avg_w
        
        # Calculate quality (ds_defect, qcd_defect)
        if pb and (pb.first_grade or pb.defect):
            ds_first = pb.first_grade
            ds_defect = pb.defect
        else:
            ds_first = sum(b.ds_first_grade for b in s.batches)
            ds_defect = sum(b.ds_defect for b in s.batches)
            
        qcd_first = sum(b.qcd_first_grade for b in s.batches)
        qcd_defect = sum(b.qcd_defect for b in s.batches)
        
        # Determine the most severe downtime
        sanitary_note = ""
        for dt in s.downtimes:
            if dt.category == "Санитарный день":
                sanitary_note = "Санитарный день"
                if dt.duration:
                    sanitary_note += f" ({dt.duration} мин)"
                break
        
        data.append({
            "id": s.id,
            "date": str(s.date),
            "shift_name": s.shift_name,
            "master": s.master.name if s.master else "Н/Д",
            "line": s.line,
            "plan_sheets": plan_sheets,
            "fact_sheets": total_sheets,
            "plan_tons": round(plan_tons, 2),
            "fact_tons": round(total_tons, 2),
            "ds_first_grade": ds_first,
            "ds_defect": ds_defect,
            "qcd_first_grade": qcd_first,
            "qcd_defect": qcd_defect,
            "note": sanitary_note
        })"""


new_get_weekly = """    active_lines = set([s.line.replace("Линия ", "ЛФМ-") for s in shifts if s.line] + [pb.line for pb in plan_boards])
    if not active_lines:
        active_lines = {"ЛФМ-2"}
        
    data = []
    
    for l_key in active_lines:
        for i in range(7):
            d = sd + timedelta(days=i)
            day_str = str(d)
            for s_name in ["День", "Ночь"]:
                plan_sheets = 0 if d.weekday() == 0 and s_name == "День" else (2700 if s_name == "День" else 3300)
                
                pb = pb_dict.get((d, s_name, l_key))
                if pb and pb.plan_sheets is not None:
                    plan_sheets = pb.plan_sheets
                    
                s = next((shift for shift in shifts if shift.date == d and shift.shift_name == s_name and (shift.line.replace("Линия ", "ЛФМ-") if shift.line else "ЛФМ-1") == l_key), None)
                total_sheets = pb.fact_sheets if pb else 0
                
                if s:
                    sum_lfm_sheets = sum(r.lfm_sheets for r in s.lfm_reports)
                    sum_lfm_tons = sum(r.lfm_sheets * get_product_finished_weight_kg(db, r.product_name) / 1000.0 for r in s.lfm_reports)
                    avg_w = (sum_lfm_tons / sum_lfm_sheets) if sum_lfm_sheets > 0 else (19.6/1000)
                    if total_sheets == 0 and sum_lfm_sheets > 0:
                        total_sheets = sum_lfm_sheets
                        
                    if pb and (pb.first_grade or pb.defect):
                        ds_first = pb.first_grade
                        ds_defect = pb.defect
                    else:
                        ds_first = sum(b.ds_first_grade for b in s.batches)
                        ds_defect = sum(b.ds_defect for b in s.batches)
                        
                    qcd_first = sum(b.qcd_first_grade for b in s.batches)
                    qcd_defect = sum(b.qcd_defect for b in s.batches)
                    
                    sanitary_note = ""
                    for dt in s.downtimes:
                        if dt.category == "Санитарный день":
                            sanitary_note = "Санитарный день"
                            if dt.duration:
                                sanitary_note += f" ({dt.duration} мин)"
                            break
                    master_name = s.master.name if s.master else "Н/Д"
                    shift_id = s.id
                else:
                    avg_w = 19.6 / 1000.0
                    ds_first = pb.first_grade if pb else 0
                    ds_defect = pb.defect if pb else 0
                    qcd_first = 0
                    qcd_defect = 0
                    sanitary_note = "Санитарный день (план 0)" if d.weekday() == 0 and s_name == "День" else "Нет данных"
                    master_name = "Н/Д"
                    shift_id = None
                    
                plan_tons = plan_sheets * avg_w
                total_tons = total_sheets * avg_w
                
                data.append({
                    "id": shift_id,
                    "date": day_str,
                    "shift_name": s_name,
                    "master": master_name,
                    "line": l_key,
                    "plan_sheets": plan_sheets,
                    "fact_sheets": total_sheets,
                    "plan_tons": round(plan_tons, 2),
                    "fact_tons": round(total_tons, 2),
                    "ds_first_grade": ds_first,
                    "ds_defect": ds_defect,
                    "qcd_first_grade": qcd_first,
                    "qcd_defect": qcd_defect,
                    "note": sanitary_note
                })"""

if old_get_weekly in content:
    content = content.replace(old_get_weekly, new_get_weekly)
else:
    print("Could not find old_get_weekly")

with open("main.py", "w", encoding="utf-8") as f:
    f.write(content)
print("Updated main.py")
