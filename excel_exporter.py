import io
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from datetime import datetime
from sqlalchemy.orm import Session
import models

def get_product_finished_weight_kg(db: Session, product_name: str) -> float:
    norm = db.query(models.ProductNorm).filter(models.ProductNorm.product_name == product_name).first()
    if not norm or not norm.weight_kg:
        return 19.6
    return norm.weight_kg

def get_shift_plan(db: Session, shift) -> int:
    if shift.plan_sheets is not None and shift.plan_sheets > 0:
        return shift.plan_sheets
    sanitary_downtime = 0
    for dt in shift.downtimes:
        if dt.category == "Санитарный день":
            sanitary_downtime += dt.duration or 0
    if sanitary_downtime > 0:
        return 0
    if getattr(shift, "date", None) and shift.date.weekday() == 0 and shift.shift_name == "День":
        return 0
    return 2700 if shift.shift_name == "День" else 3300

def generate_shift_excel_passport(shift_id: int, db: Session) -> tuple[bytes, str]:
    shift = db.query(models.Shift).filter(models.Shift.id == shift_id).first()
    if not shift:
        raise ValueError(f"Shift with id {shift_id} not found")
        
    master_name = shift.master.name if shift.master else "Неизвестно"
    date_str = shift.date.strftime("%Y-%m-%d") if shift.date else "Неизвестно"
    shift_name = shift.shift_name or "Неизвестно"
    line_name = shift.line or "Неизвестно"
    
    wb = openpyxl.Workbook()
    # Remove default sheet
    wb.remove(wb.active)
    
    # Styles Definition
    font_title = Font(name="Calibri", size=16, bold=True, color="1F4E78")
    font_section = Font(name="Calibri", size=12, bold=True, color="1F4E78")
    font_header = Font(name="Calibri", size=10, bold=True, color="FFFFFF")
    font_bold = Font(name="Calibri", size=10, bold=True)
    font_regular = Font(name="Calibri", size=10)
    font_small = Font(name="Calibri", size=9, italic=True)
    
    fill_header = PatternFill(start_color="1F4E78", end_color="1F4E78", fill_type="solid")
    fill_sub_total = PatternFill(start_color="D9E1F2", end_color="D9E1F2", fill_type="solid")
    fill_alert = PatternFill(start_color="FCE4D6", end_color="FCE4D6", fill_type="solid")
    
    align_center = Alignment(horizontal="center", vertical="center", wrap_text=True)
    align_left = Alignment(horizontal="left", vertical="center")
    align_right = Alignment(horizontal="right", vertical="center")
    
    thin_border_side = Side(border_style="thin", color="D9D9D9")
    double_border_side = Side(border_style="double", color="333333")
    
    border_all = Border(left=thin_border_side, right=thin_border_side, top=thin_border_side, bottom=thin_border_side)
    border_total = Border(top=thin_border_side, bottom=double_border_side)

    # ----------------------------------------------------
    # TAB 1: Паспорт смены (Общая сводка)
    # ----------------------------------------------------
    ws_sum = wb.create_sheet(title="Паспорт смены")
    ws_sum.views.sheetView[0].showGridLines = True
    
    ws_sum.append([])
    ws_sum.cell(row=2, column=1, value=f"ПАСПОРТ СМЕНЫ № {shift_id}").font = font_title
    ws_sum.append([])
    
    # General Info Table
    info_data = [
        ("Дата смены", shift.date, "yyyy-mm-dd"),
        ("Название смены", shift_name, None),
        ("Мастер смены", master_name, None),
        ("Линия", line_name, None),
        ("Статус", "Закрыта" if shift.status == "closed" else "Активна", None)
    ]
    
    curr_row = 4
    for label, val, num_fmt in info_data:
        c1 = ws_sum.cell(row=curr_row, column=1, value=label)
        c1.font = font_bold
        c1.border = border_all
        c2 = ws_sum.cell(row=curr_row, column=2, value=val)
        c2.font = font_regular
        c2.border = border_all
        if num_fmt:
            c2.number_format = num_fmt
        curr_row += 1
        
    curr_row += 2
    ws_sum.cell(row=curr_row, column=1, value="Производственные показатели смены").font = font_section
    curr_row += 1
    
    # Headers
    prod_headers = ["Показатель", "План", "Факт", "% выполнения", "Ед. изм."]
    for col_idx, h in enumerate(prod_headers, start=1):
        cell = ws_sum.cell(row=curr_row, column=col_idx, value=h)
        cell.font = font_header
        cell.fill = fill_header
        cell.alignment = align_center
        cell.border = border_all
    
    curr_row += 1
    
    plan_sheets = get_shift_plan(db, shift)
    fact_sheets = sum(r.lfm_sheets for r in shift.lfm_reports)
    total_tons = sum(r.lfm_sheets * get_product_finished_weight_kg(db, r.product_name) / 1000.0 for r in shift.lfm_reports)
    plan_tons = plan_sheets * 19.6 / 1000.0 # Standard fallback
    
    pct_sheets = (fact_sheets / plan_sheets) if plan_sheets > 0 else 0
    pct_tons = (total_tons / plan_tons) if plan_tons > 0 else 0
    
    prod_metrics = [
        ("Выработка (Листы)", plan_sheets, fact_sheets, pct_sheets, "Листы", "0", "0", "0.0%"),
        ("Выработка (Тонны)", plan_tons, total_tons, pct_tons, "Тонны", "#,##0.00", "#,##0.00", "0.0%"),
        ("Общий брак Дестакера", 0, sum(b.ds_defect for b in shift.batches), None, "Листы", "0", "0", ""),
        ("Общий брак СКК (ОТК)", 0, sum(b.qcd_defect for b in shift.batches), None, "Листы", "0", "0", ""),
        ("Длительность простоев", 0, sum(d.duration for d in shift.downtimes), None, "Минут", "0", "0", "")
    ]
    
    for label, plan, fact, pct, unit, f_plan, f_fact, f_pct in prod_metrics:
        ws_sum.cell(row=curr_row, column=1, value=label).font = font_bold
        ws_sum.cell(row=curr_row, column=1).border = border_all
        
        c_plan = ws_sum.cell(row=curr_row, column=2, value=plan if plan > 0 or label.startswith("Выработка") else "-")
        c_plan.font = font_regular
        c_plan.border = border_all
        c_plan.alignment = align_right
        if f_plan and plan > 0: c_plan.number_format = f_plan
        
        c_fact = ws_sum.cell(row=curr_row, column=3, value=fact)
        c_fact.font = font_regular
        c_fact.border = border_all
        c_fact.alignment = align_right
        if f_fact: c_fact.number_format = f_fact
        
        c_pct = ws_sum.cell(row=curr_row, column=4, value=pct if pct is not None else "-")
        c_pct.font = font_regular
        c_pct.border = border_all
        c_pct.alignment = align_right
        if f_pct and pct is not None: c_pct.number_format = f_pct
        
        c_unit = ws_sum.cell(row=curr_row, column=5, value=unit)
        c_unit.font = font_small
        c_unit.border = border_all
        c_unit.alignment = align_center
        
        curr_row += 1
        
    curr_row += 2
    ws_sum.cell(row=curr_row, column=1, value="Детализация по маркам выпускаемой продукции (ЛФМ)").font = font_section
    curr_row += 1
    
    lfm_headers = ["Марка продукции", "Сформовано (Листов)", "Сбросы наката (шт)", "Сливы цемента (кг)", "Сливы асбеста (кг)"]
    for col_idx, h in enumerate(lfm_headers, start=1):
        cell = ws_sum.cell(row=curr_row, column=col_idx, value=h)
        cell.font = font_header
        cell.fill = fill_header
        cell.alignment = align_center
        cell.border = border_all
    curr_row += 1
    
    for r in shift.lfm_reports:
        ws_sum.cell(row=curr_row, column=1, value=r.product_name).font = font_regular
        ws_sum.cell(row=curr_row, column=1).border = border_all
        
        c_sh = ws_sum.cell(row=curr_row, column=2, value=r.lfm_sheets)
        c_sh.font = font_regular
        c_sh.border = border_all
        c_sh.alignment = align_right
        c_sh.number_format = "0"
        
        c_wr = ws_sum.cell(row=curr_row, column=3, value=r.lfm_wind_resets)
        c_wr.font = font_regular
        c_wr.border = border_all
        c_wr.alignment = align_right
        c_wr.number_format = "0"
        
        ws_sum.cell(row=curr_row, column=4, value="-").font = font_regular
        ws_sum.cell(row=curr_row, column=4).border = border_all
        ws_sum.cell(row=curr_row, column=4).alignment = align_center
        
        ws_sum.cell(row=curr_row, column=5, value="-").font = font_regular
        ws_sum.cell(row=curr_row, column=5).border = border_all
        ws_sum.cell(row=curr_row, column=5).alignment = align_center
        curr_row += 1
        
    # Total row for LFM
    ws_sum.cell(row=curr_row, column=1, value="ИТОГО СМЕНА").font = font_bold
    ws_sum.cell(row=curr_row, column=1).fill = fill_sub_total
    ws_sum.cell(row=curr_row, column=1).border = border_all
    
    c_sh_tot = ws_sum.cell(row=curr_row, column=2, value=fact_sheets)
    c_sh_tot.font = font_bold
    c_sh_tot.fill = fill_sub_total
    c_sh_tot.border = border_all
    c_sh_tot.alignment = align_right
    
    c_wr_tot = ws_sum.cell(row=curr_row, column=3, value=sum(r.lfm_wind_resets for r in shift.lfm_reports))
    c_wr_tot.font = font_bold
    c_wr_tot.fill = fill_sub_total
    c_wr_tot.border = border_all
    c_wr_tot.alignment = align_right
    
    c_cd_tot = ws_sum.cell(row=curr_row, column=4, value=shift.lfm_cem_drain or 0)
    c_cd_tot.font = font_bold
    c_cd_tot.fill = fill_sub_total
    c_cd_tot.border = border_all
    c_cd_tot.alignment = align_right
    c_cd_tot.number_format = "#,##0.0"
    
    c_ad_tot = ws_sum.cell(row=curr_row, column=5, value=shift.lfm_asb_drain or 0)
    c_ad_tot.font = font_bold
    c_ad_tot.fill = fill_sub_total
    c_ad_tot.border = border_all
    c_ad_tot.alignment = align_right
    c_ad_tot.number_format = "#,##0.0"

    # ----------------------------------------------------
    # TAB 2: Движение сырья
    # ----------------------------------------------------
    ws_mat = wb.create_sheet(title="Движение сырья")
    ws_mat.views.sheetView[0].showGridLines = True
    
    ws_mat.append([])
    ws_mat.cell(row=2, column=1, value="БАЛАНС ДВИЖЕНИЯ СЫРЬЯ").font = font_title
    ws_mat.append([])
    
    mat_headers = [
        "Наименование сырья", "Приход на склад (кг)", "Расход ЗО факт (кг)", 
        "Норма расхода теория (кг)", "Отклонение (кг)", "Отклонение (%)", 
        "Удельный факт (кг/лист)", "Удельная норма (кг/лист)"
    ]
    
    for col_idx, h in enumerate(mat_headers, start=1):
        cell = ws_mat.cell(row=4, column=col_idx, value=h)
        cell.font = font_header
        cell.fill = fill_header
        cell.alignment = align_center
        cell.border = border_all
        
    # Calculate Theoretical Material Usage
    product_counts = {}
    for r in shift.lfm_reports:
        product_counts[r.product_name] = product_counts.get(r.product_name, 0) + r.lfm_sheets
        
    theoretical = {
        "chrysotile_4_20": 0.0, "chrysotile_5_65": 0.0, "chrysotile_6_40": 0.0,
        "cement": 0.0, "cellulose": 0.0, "crushed_slate": 0.0,
        "asbozurit": 0.0, "fiberglass": 0.0
    }
    for prod_name, sheets in product_counts.items():
        norm = db.query(models.ProductNorm).filter(models.ProductNorm.product_name == prod_name).first()
        if norm:
            theoretical["chrysotile_4_20"] += sheets * norm.norm_chrysotile_4_20
            theoretical["chrysotile_5_65"] += sheets * norm.norm_chrysotile_5_65
            theoretical["chrysotile_6_40"] += sheets * norm.norm_chrysotile_6_40
            theoretical["cement"] += sheets * norm.norm_cement
            theoretical["cellulose"] += sheets * norm.norm_cellulose
            theoretical["crushed_slate"] += sheets * norm.norm_crushed_slate
            theoretical["asbozurit"] += sheets * norm.norm_asbozurit
            theoretical["fiberglass"] += sheets * norm.norm_fiberglass
            
    mapping = [
        ("Хризотил 4-20", shift.receipt_chrysotile_4_20, shift.zo_chrysotile_4_20, theoretical["chrysotile_4_20"]),
        ("Хризотил 5-65", shift.receipt_chrysotile_5_65, shift.zo_chrysotile_5_65, theoretical["chrysotile_5_65"]),
        ("Хризотил 6-40", shift.receipt_chrysotile_6_40, shift.zo_chrysotile_6_40, theoretical["chrysotile_6_40"]),
        ("Цемент", shift.receipt_cement, shift.zo_cement, theoretical["cement"]),
        ("Целлюлоза", shift.receipt_cellulose, shift.zo_cellulose, theoretical["cellulose"]),
        ("Дробленый шифер", shift.receipt_crushed_slate, shift.zo_crushed_slate, theoretical["crushed_slate"]),
        ("Асбозурит", shift.receipt_asbozurit, shift.zo_asbozurit, theoretical["asbozurit"]),
        ("Стекловолокно", shift.receipt_fiberglass, shift.zo_fiberglass, theoretical["fiberglass"]),
        ("Лапрол", shift.receipt_laprol, shift.zo_laprol, 0.0),
        ("Асбокартон", 0.0, shift.zo_asbocarton, 0.0)
    ]
    
    curr_row = 5
    for mat_name, receipt, actual, theory in mapping:
        r_val = receipt or 0.0
        a_val = actual or 0.0
        t_val = theory or 0.0
        
        dev = a_val - t_val
        dev_pct = (dev / t_val) if t_val > 0 else 0
        
        unit_act = (a_val / fact_sheets) if fact_sheets > 0 else 0
        unit_norm = (t_val / fact_sheets) if fact_sheets > 0 else 0
        
        ws_mat.cell(row=curr_row, column=1, value=mat_name).font = font_bold
        ws_mat.cell(row=curr_row, column=1).border = border_all
        
        c_rec = ws_mat.cell(row=curr_row, column=2, value=r_val)
        c_rec.font = font_regular
        c_rec.border = border_all
        c_rec.alignment = align_right
        c_rec.number_format = "#,##0.0"
        
        c_act = ws_mat.cell(row=curr_row, column=3, value=a_val)
        c_act.font = font_regular
        c_act.border = border_all
        c_act.alignment = align_right
        c_act.number_format = "#,##0.0"
        
        c_theo = ws_mat.cell(row=curr_row, column=4, value=t_val if mat_name not in ["Лапрол", "Асбокартон"] else "-")
        c_theo.font = font_regular
        c_theo.border = border_all
        c_theo.alignment = align_right
        if mat_name not in ["Лапрол", "Асboкартон"]: c_theo.number_format = "#,##0.0"
        
        c_dev = ws_mat.cell(row=curr_row, column=5, value=dev if mat_name not in ["Лапрол", "Асбокартон"] else "-")
        c_dev.font = font_bold
        c_dev.border = border_all
        c_dev.alignment = align_right
        if mat_name not in ["Лапрол", "Асбокартон"]:
            c_dev.number_format = "#,##0.0"
            if dev > 0:
                c_dev.fill = fill_alert
                
        c_dev_p = ws_mat.cell(row=curr_row, column=6, value=dev_pct if mat_name not in ["Лапрол", "Асбокартон"] else "-")
        c_dev_p.font = font_regular
        c_dev_p.border = border_all
        c_dev_p.alignment = align_right
        if mat_name not in ["Лапрол", "Асбокартон"]:
            c_dev_p.number_format = "0.0%"
            if dev_pct > 0:
                c_dev_p.fill = fill_alert
                
        c_uact = ws_mat.cell(row=curr_row, column=7, value=unit_act)
        c_uact.font = font_regular
        c_uact.border = border_all
        c_uact.alignment = align_right
        c_uact.number_format = "0.000"
        
        c_unorm = ws_mat.cell(row=curr_row, column=8, value=unit_norm if mat_name not in ["Лапрол", "Асбокартон"] else "-")
        c_unorm.font = font_regular
        c_unorm.border = border_all
        c_unorm.alignment = align_right
        if mat_name not in ["Лапрол", "Асбокартон"]: c_unorm.number_format = "0.000"
        
        curr_row += 1
        
    curr_row += 2
    ws_mat.cell(row=curr_row, column=1, value="Детализация по замесам ЗО и цементу").font = font_section
    curr_row += 1
    
    cement_details = [
        ("Расход Цемента (Силос 1)", shift.zo_cement_silo1 or 0.0),
        ("Расход Цемента (Силос 2)", shift.zo_cement_silo2 or 0.0),
        ("Расход Цемента (Силос 3)", shift.zo_cement_silo3 or 0.0),
        ("Расход Цемента (Силос 4)", shift.zo_cement_silo4 or 0.0),
        ("Всего замесов ЗО", shift.zo_batches or 0)
    ]
    
    for label, val in cement_details:
        c1 = ws_mat.cell(row=curr_row, column=1, value=label)
        c1.font = font_bold
        c1.border = border_all
        c2 = ws_mat.cell(row=curr_row, column=2, value=val)
        c2.font = font_regular
        c2.border = border_all
        c2.alignment = align_right
        if "замесов" in label:
            c2.number_format = "0"
        else:
            c2.number_format = "#,##0.0"
        curr_row += 1
        
    # Average cement per batch calculation
    total_cement = (shift.zo_cement_silo1 or 0) + (shift.zo_cement_silo2 or 0) + (shift.zo_cement_silo3 or 0) + (shift.zo_cement_silo4 or 0)
    batches = shift.zo_batches or 0
    avg_cement = (total_cement / batches) if batches > 0 else 0.0
    
    c1 = ws_mat.cell(row=curr_row, column=1, value="Средний замес (Цемент)")
    c1.font = font_bold
    c1.border = border_all
    c2 = ws_mat.cell(row=curr_row, column=2, value=avg_cement)
    c2.font = font_bold
    c2.border = border_all
    c2.alignment = align_right
    c2.number_format = "#,##0.0"

    # ----------------------------------------------------
    # TAB 3: Партии и Брак
    # ----------------------------------------------------
    ws_bat = wb.create_sheet(title="Партии и Брак")
    ws_bat.views.sheetView[0].showGridLines = True
    
    ws_bat.append([])
    ws_bat.cell(row=2, column=1, value="РЕЗУЛЬТАТЫ СОРТИРОВКИ ПАРТИЙ").font = font_title
    ws_bat.append([])
    
    batch_headers = [
        "№ Партии", "Вид продукции", "Статус", "Стакер (листов)", 
        "Дестакер: Кондиция", "Дестакер: 1 сорт", "Дестакер: Брак",
        "СКК: Кондиция", "СКК: 1 сорт", "СКК: Брак", "Расхождение СКК/Дестакер"
    ]
    
    for col_idx, h in enumerate(batch_headers, start=1):
        cell = ws_bat.cell(row=4, column=col_idx, value=h)
        cell.font = font_header
        cell.fill = fill_header
        cell.alignment = align_center
        cell.border = border_all
        
    curr_row = 5
    batches_list = shift.batches
    
    for b in batches_list:
        ws_bat.cell(row=curr_row, column=1, value=b.batch_number).font = font_bold
        ws_bat.cell(row=curr_row, column=1).border = border_all
        ws_bat.cell(row=curr_row, column=1).alignment = align_center
        
        ws_bat.cell(row=curr_row, column=2, value=b.product_name).font = font_regular
        ws_bat.cell(row=curr_row, column=2).border = border_all
        
        ws_bat.cell(row=curr_row, column=3, value=b.status).font = font_small
        ws_bat.cell(row=curr_row, column=3).border = border_all
        ws_bat.cell(row=curr_row, column=3).alignment = align_center
        
        st_sheets = b.stacked_stacks or 0
        c_st = ws_bat.cell(row=curr_row, column=4, value=st_sheets)
        c_st.font = font_regular
        c_st.border = border_all
        c_st.alignment = align_right
        c_st.number_format = "0"
        
        # Destacker
        ws_bat.cell(row=curr_row, column=5, value=b.ds_condition).font = font_regular
        ws_bat.cell(row=curr_row, column=5).border = border_all
        ws_bat.cell(row=curr_row, column=5).alignment = align_right
        
        ws_bat.cell(row=curr_row, column=6, value=b.ds_first_grade).font = font_regular
        ws_bat.cell(row=curr_row, column=6).border = border_all
        ws_bat.cell(row=curr_row, column=6).alignment = align_right
        
        ws_bat.cell(row=curr_row, column=7, value=b.ds_defect).font = font_regular
        ws_bat.cell(row=curr_row, column=7).border = border_all
        ws_bat.cell(row=curr_row, column=7).alignment = align_right
        
        # QCD
        ws_bat.cell(row=curr_row, column=8, value=b.qcd_condition).font = font_regular
        ws_bat.cell(row=curr_row, column=8).border = border_all
        ws_bat.cell(row=curr_row, column=8).alignment = align_right
        
        ws_bat.cell(row=curr_row, column=9, value=b.qcd_first_grade).font = font_regular
        ws_bat.cell(row=curr_row, column=9).border = border_all
        ws_bat.cell(row=curr_row, column=9).alignment = align_right
        
        ws_bat.cell(row=curr_row, column=10, value=b.qcd_defect).font = font_regular
        ws_bat.cell(row=curr_row, column=10).border = border_all
        ws_bat.cell(row=curr_row, column=10).alignment = align_right
        
        # Highlight discrepancy
        has_disc = False
        disc_text = "Нет"
        if b.status == "qcd_checked":
            if (b.ds_defect != b.qcd_defect) or (b.ds_condition != b.qcd_condition) or (b.ds_first_grade != b.qcd_first_grade):
                has_disc = True
                disc_text = "Да (!)"
                
        c_disc = ws_bat.cell(row=curr_row, column=11, value=disc_text)
        c_disc.font = font_bold if has_disc else font_regular
        c_disc.border = border_all
        c_disc.alignment = align_center
        if has_disc:
            c_disc.fill = fill_alert
            
        curr_row += 1
        
    curr_row += 2
    ws_bat.cell(row=curr_row, column=1, value="Детализация брака по дефектам (Разборщик)").font = font_section
    curr_row += 1
    
    defect_headers = [
        "№ Партии", "Скол", "Сдир", "Плохой рез", "Налип снизу", "Налип сверху",
        "Сломан", "Упал коробки", "Вмятина", "Не соотв. толщ.", "Расслоение", "Кромка", "ИТОГО БРАК"
    ]
    
    for col_idx, h in enumerate(defect_headers, start=1):
        cell = ws_bat.cell(row=curr_row, column=col_idx, value=h)
        cell.font = font_header
        cell.fill = fill_header
        cell.alignment = align_center
        cell.border = border_all
    curr_row += 1
    
    for b in batches_list:
        ws_bat.cell(row=curr_row, column=1, value=b.batch_number).font = font_bold
        ws_bat.cell(row=curr_row, column=1).border = border_all
        ws_bat.cell(row=curr_row, column=1).alignment = align_center
        
        defects = [
            b.ds_defect_chip, b.ds_defect_scratch, b.ds_defect_bad_cut, b.ds_defect_stick_bottom,
            b.ds_defect_stick_top, b.ds_defect_broken, b.ds_defect_fell_box, b.ds_defect_dent,
            b.ds_defect_thickness, b.ds_defect_delamination, b.ds_defect_edge
        ]
        
        for col_idx, d_val in enumerate(defects, start=2):
            c_d = ws_bat.cell(row=curr_row, column=col_idx, value=d_val)
            c_d.font = font_regular
            c_d.border = border_all
            c_d.alignment = align_right
            if d_val > 0:
                c_d.font = font_bold
                
        c_tot = ws_bat.cell(row=curr_row, column=13, value=b.ds_defect)
        c_tot.font = font_bold
        c_tot.border = border_all
        c_tot.alignment = align_right
        c_tot.fill = fill_sub_total
        
        curr_row += 1

    # ----------------------------------------------------
    # TAB 4: Журнал простоев
    # ----------------------------------------------------
    ws_down = wb.create_sheet(title="Простои смены")
    ws_down.views.sheetView[0].showGridLines = True
    
    ws_down.append([])
    ws_down.cell(row=2, column=1, value="ЖУРНАЛ ПРОСТОЕВ ЗА СМЕНУ").font = font_title
    ws_down.append([])
    
    down_headers = [
        "Начало", "Окончание", "Длительность (мин)", "Участок (Департамент)", 
        "Оборудование (Узел)", "Причина (Неисправность)", "Описание / Аналитика", 
        "Категория", "Ущерб (Тонны)", "Ущерб (Тенге)", "Простой оборуд."
    ]
    
    for col_idx, h in enumerate(down_headers, start=1):
        cell = ws_down.cell(row=4, column=col_idx, value=h)
        cell.font = font_header
        cell.fill = fill_header
        cell.alignment = align_center
        cell.border = border_all
        
    curr_row = 5
    for d in shift.downtimes:
        ws_down.cell(row=curr_row, column=1, value=d.start_time).font = font_regular
        ws_down.cell(row=curr_row, column=1).border = border_all
        ws_down.cell(row=curr_row, column=1).alignment = align_center
        
        ws_down.cell(row=curr_row, column=2, value=d.end_time or "Активен").font = font_regular
        ws_down.cell(row=curr_row, column=2).border = border_all
        ws_down.cell(row=curr_row, column=2).alignment = align_center
        
        c_dur = ws_down.cell(row=curr_row, column=3, value=d.duration)
        c_dur.font = font_regular
        c_dur.border = border_all
        c_dur.alignment = align_right
        c_dur.number_format = "0"
        
        ws_down.cell(row=curr_row, column=4, value=d.department).font = font_regular
        ws_down.cell(row=curr_row, column=4).border = border_all
        
        ws_down.cell(row=curr_row, column=5, value=d.node).font = font_regular
        ws_down.cell(row=curr_row, column=5).border = border_all
        
        ws_down.cell(row=curr_row, column=6, value=d.description).font = font_regular
        ws_down.cell(row=curr_row, column=6).border = border_all
        
        ws_down.cell(row=curr_row, column=7, value="").font = font_regular
        ws_down.cell(row=curr_row, column=7).border = border_all
        
        ws_down.cell(row=curr_row, column=8, value=d.category).font = font_small
        ws_down.cell(row=curr_row, column=8).border = border_all
        ws_down.cell(row=curr_row, column=8).alignment = align_center
        
        c_t = ws_down.cell(row=curr_row, column=9, value=d.lost_tons)
        c_t.font = font_regular
        c_t.border = border_all
        c_t.alignment = align_right
        c_t.number_format = "#,##0.00"
        
        c_tg = ws_down.cell(row=curr_row, column=10, value=d.lost_tenge)
        c_tg.font = font_regular
        c_tg.border = border_all
        c_tg.alignment = align_right
        c_tg.number_format = "#,##0"
        
        is_eq_text = "Да" if d.is_equipment_downtime else "Нет"
        c_eq = ws_down.cell(row=curr_row, column=11, value=is_eq_text)
        c_eq.font = font_regular
        c_eq.border = border_all
        c_eq.alignment = align_center
        
        curr_row += 1
        
    for sheet in wb.worksheets:
        for col in sheet.columns:
            max_len = 0
            for cell in col:
                val_str = str(cell.value or '')
                if cell.number_format and '%' in cell.number_format:
                    val_str += '   '
                if len(val_str) > max_len:
                    max_len = len(val_str)
            col_letter = get_column_letter(col[0].column)
            sheet.column_dimensions[col_letter].width = max(max_len + 3, 11)
            
    out = io.BytesIO()
    wb.save(out)
    
    clean_master = master_name.replace(" ", "_").replace(".", "")
    filename = f"Паспорт_Смены_{shift_id}_{date_str}_{shift_name}_{clean_master}.xlsx"
    return out.getvalue(), filename

def create_initial_directories_xlsx(db: Session) -> bytes:
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    
    ws_norm = wb.create_sheet(title="Нормативы")
    ws_norm.views.sheetView[0].showGridLines = True
    
    norm_headers = [
        "Продукция", "Вес готового листа (кг)", 
        "Норма Хризотил 4-20", "Норма Хризотил 5-65", "Норма Хризотил 6-40",
        "Норма Цемент", "Норма Целлюлоза", "Норма Дробленый шифер", 
        "Норма Асбозурит", "Норма Стекловолокно"
    ]
    ws_norm.append(norm_headers)
    
    norms = db.query(models.ProductNorm).all()
    for n in norms:
        ws_norm.append([
            n.product_name, n.weight_kg or 19.6,
            n.norm_chrysotile_4_20 or 0.0, n.norm_chrysotile_5_65 or 0.0, n.norm_chrysotile_6_40 or 0.0,
            n.norm_cement or 0.0, n.norm_cellulose or 0.0, n.norm_crushed_slate or 0.0,
            n.norm_asbozurit or 0.0, n.norm_fiberglass or 0.0
        ])
        
    ws_dir = wb.create_sheet(title="Справочник простоев")
    ws_dir.views.sheetView[0].showGridLines = True
    
    dir_headers = ["Участок", "Оборудование", "Неисправность/Причина", "Категория", "Комментарий"]
    ws_dir.append(dir_headers)
    
    entries = db.query(models.DowntimeDirectory).all()
    for e in entries:
        ws_dir.append([
            e.department, e.node, e.breakdown, e.category or "Механические", e.comment or ""
        ])
        
    font_header = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    fill_header = PatternFill(start_color="1F4E78", end_color="1F4E78", fill_type="solid")
    align_center = Alignment(horizontal="center", vertical="center", wrap_text=True)
    
    for sheet in wb.worksheets:
        sheet.row_dimensions[1].height = 25
        for col_idx in range(1, sheet.max_column + 1):
            cell = sheet.cell(row=1, column=col_idx)
            cell.font = font_header
            cell.fill = fill_header
            cell.alignment = align_center
            
        for col in sheet.columns:
            max_len = 0
            for cell in col:
                val_str = str(cell.value or '')
                if len(val_str) > max_len:
                    max_len = len(val_str)
            col_letter = get_column_letter(col[0].column)
            sheet.column_dimensions[col_letter].width = max(max_len + 3, 12)
            
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()

def sync_directories_from_excel_bytes(file_bytes: bytes, db: Session):
    wb = openpyxl.load_workbook(io.BytesIO(file_bytes))
    
    if "Нормативы" in wb.sheetnames:
        ws_norm = wb["Нормативы"]
        header_row = [cell.value for cell in ws_norm[1]]
        if header_row and "Продукция" in header_row:
            db.query(models.ProductNorm).delete()
            for row_idx in range(2, ws_norm.max_row + 1):
                p_name = ws_norm.cell(row=row_idx, column=1).value
                if not p_name: continue
                p_name = str(p_name).strip()
                
                weight = float(ws_norm.cell(row=row_idx, column=2).value or 0.0)
                n_c4 = float(ws_norm.cell(row=row_idx, column=3).value or 0.0)
                n_c5 = float(ws_norm.cell(row=row_idx, column=4).value or 0.0)
                n_c6 = float(ws_norm.cell(row=row_idx, column=5).value or 0.0)
                n_cem = float(ws_norm.cell(row=row_idx, column=6).value or 0.0)
                n_cel = float(ws_norm.cell(row=row_idx, column=7).value or 0.0)
                n_sl = float(ws_norm.cell(row=row_idx, column=8).value or 0.0)
                n_asb = float(ws_norm.cell(row=row_idx, column=9).value or 0.0)
                n_fib = float(ws_norm.cell(row=row_idx, column=10).value or 0.0)
                
                db.add(models.ProductNorm(
                    product_name=p_name,
                    weight_kg=weight,
                    norm_chrysotile_4_20=n_c4,
                    norm_chrysotile_5_65=n_c5,
                    norm_chrysotile_6_40=n_c6,
                    norm_cement=n_cem,
                    norm_cellulose=n_cel,
                    norm_crushed_slate=n_sl,
                    norm_asbozurit=n_asb,
                    norm_fiberglass=n_fib
                ))
            db.commit()
            print("Successfully synced Norms from Excel.")
            
    if "Справочник простоев" in wb.sheetnames:
        ws_dir = wb["Справочник простоев"]
        header_row = [cell.value for cell in ws_dir[1]]
        if header_row and "Участок" in header_row:
            db.query(models.DowntimeDirectory).delete()
            for row_idx in range(2, ws_dir.max_row + 1):
                dept = ws_dir.cell(row=row_idx, column=1).value
                node = ws_dir.cell(row=row_idx, column=2).value
                bd = ws_dir.cell(row=row_idx, column=3).value
                if not dept or not bd: continue
                
                dept = str(dept).strip()
                node = str(node).strip() if node else "Общее"
                bd = str(bd).strip()
                cat = str(ws_dir.cell(row=row_idx, column=4).value or "Механические").strip()
                comm = str(ws_dir.cell(row=row_idx, column=5).value or "").strip()
                
                db.add(models.DowntimeDirectory(
                    department=dept,
                    node=node,
                    breakdown=bd,
                    category=cat,
                    comment=comm
                ))
            db.commit()
            print("Successfully synced Downtimes Directory from Excel.")
