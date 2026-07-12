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

def generate_flat_report(db: Session) -> bytes:
    shifts = db.query(models.Shift).filter(models.Shift.status == "closed").order_by(models.Shift.date.asc(), models.Shift.id.asc()).all()
    
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Сводный отчет"
    
    headers = [
        "Дата", "№ партии", "Линия", "Смена", "Мастер", "Наименование продукта",
        "Количество замесов", "Формовка (листы)", "Формовка (тонны)",
        "Кондиция (на склад)", "1-сорт", "Брак", "Сбросы наката",
        "Слив асб. (кг)", "Слив цем. (кг)",
        "Расход Хризотила 4-20 (кг)", "Расход Хризотила 5-65 (кг)", "Расход Хризотила 6-40 (кг)", "Расход Хризотила общ. (кг)",
        "Расход Цемента С1 (кг)", "Расход Цемента С2 (кг)", "Расход Цемента С3 (кг)", "Расход Цемента С4 (кг)", "Расход Цемента общ. (кг)",
        "Расход Асбокартона (кг)", "Расход Лапрола (кг)", "Расход Целлюлозы (кг)", "Расход Стекловолокна (кг)",
        "Расход Дробленого шифера (кг)", "Расход Асбозурита (кг)",
        "Отклонение Хризотила 4-20 (%)", "Отклонение Хризотила 5-65 (%)", "Отклонение Хризотила 6-40 (%)", "Отклонение Хризотила общ. (%)",
        "Отклонение Цемента общ. (%)", "Отклонение Асбокартона (%)", "Отклонение Лапрола (%)", "Отклонение Целлюлозы (%)",
        "Отклонение Стекловолокна (%)", "Отклонение Дробленого шифера (%)", "Отклонение Асбозурита (%)"
    ]
    
    # Header styling (navy blue theme)
    header_fill = PatternFill(start_color="1F4E78", end_color="1F4E78", fill_type="solid")
    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    center_align = Alignment(horizontal="center", vertical="center", wrap_text=True)
    border_thin = Border(
        left=Side(style='thin', color='BFBFBF'),
        right=Side(style='thin', color='BFBFBF'),
        top=Side(style='thin', color='BFBFBF'),
        bottom=Side(style='thin', color='BFBFBF')
    )
    
    ws.append(headers)
    
    # Format header row
    ws.row_dimensions[1].height = 28
    for col_idx in range(1, len(headers) + 1):
        cell = ws.cell(row=1, column=col_idx)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = center_align
        cell.border = border_thin
        
    # Content rows style
    red_fill = PatternFill(start_color="FCE4D6", end_color="FCE4D6", fill_type="solid") # Soft pastel red
    green_fill = PatternFill(start_color="E2EFDA", end_color="E2EFDA", fill_type="solid") # Soft pastel green
    
    for s in shifts:
        # Date
        date_str = s.date.strftime("%d.%m.%Y") if s.date else ""
        
        # Batch numbers
        batch_numbers = ", ".join(b.batch_number for b in s.batches if b.batch_number)
        
        # Products
        product_names = ", ".join(set(r.product_name for r in s.lfm_reports if r.product_name))
        
        # Formovka sheets and tons
        formovka_sheets = sum(r.lfm_sheets for r in s.lfm_reports)
        formovka_tons = sum(r.lfm_sheets * get_product_finished_weight_kg(db, r.product_name) for r in s.lfm_reports) / 1000.0
        
        # Quality (QCD / СКК)
        qcd_condition = sum(b.qcd_condition for b in s.batches)
        qcd_first = sum(b.qcd_first_grade for b in s.batches)
        qcd_defect = sum(b.qcd_defect for b in s.batches)
        
        # Wind resets
        wind_resets = sum(r.lfm_wind_resets for r in s.lfm_reports)
        
        # Raw materials theoretical norms sum
        theory = {
            "chrysotile_4_20": 0.0, "chrysotile_5_65": 0.0, "chrysotile_6_40": 0.0,
            "cement": 0.0, "cellulose": 0.0, "crushed_slate": 0.0,
            "asbozurit": 0.0, "fiberglass": 0.0, "asbocarton": 0.0, "laprol": 0.0
        }
        for r in s.lfm_reports:
            norm = db.query(models.ProductNorm).filter(models.ProductNorm.product_name == r.product_name).first()
            if norm:
                theory["chrysotile_4_20"] += r.lfm_sheets * (norm.norm_chrysotile_4_20 or 0.0)
                theory["chrysotile_5_65"] += r.lfm_sheets * (norm.norm_chrysotile_5_65 or 0.0)
                theory["chrysotile_6_40"] += r.lfm_sheets * (norm.norm_chrysotile_6_40 or 0.0)
                theory["cement"] += r.lfm_sheets * (norm.norm_cement or 0.0)
                theory["cellulose"] += r.lfm_sheets * (norm.norm_cellulose or 0.0)
                theory["crushed_slate"] += r.lfm_sheets * (norm.norm_crushed_slate or 0.0)
                theory["asbozurit"] += r.lfm_sheets * (norm.norm_asbozurit or 0.0)
                theory["fiberglass"] += r.lfm_sheets * (norm.norm_fiberglass or 0.0)
                
        # Factual consumption
        fact = {
            "chrysotile_4_20": s.zo_chrysotile_4_20 or 0.0,
            "chrysotile_5_65": s.zo_chrysotile_5_65 or 0.0,
            "chrysotile_6_40": s.zo_chrysotile_6_40 or 0.0,
            "cement_silo1": s.zo_cement_silo1 or 0.0,
            "cement_silo2": s.zo_cement_silo2 or 0.0,
            "cement_silo3": s.zo_cement_silo3 or 0.0,
            "cement_silo4": s.zo_cement_silo4 or 0.0,
            "asbocarton": s.zo_asbocarton or 0.0,
            "laprol": s.zo_laprol or 0.0,
            "cellulose": s.zo_cellulose or 0.0,
            "fiberglass": s.zo_fiberglass or 0.0,
            "crushed_slate": s.zo_crushed_slate or 0.0,
            "asbozurit": s.zo_asbozurit or 0.0,
        }
        
        total_fact_asbestos = fact["chrysotile_4_20"] + fact["chrysotile_5_65"] + fact["chrysotile_6_40"]
        total_theo_asbestos = theory["chrysotile_4_20"] + theory["chrysotile_5_65"] + theory["chrysotile_6_40"]
        
        total_fact_cement = fact["cement_silo1"] + fact["cement_silo2"] + fact["cement_silo3"] + fact["cement_silo4"]
        theory_cement = theory["cement"]
        
        # Percentage deviation helper
        def get_pct_deviation(fact_val, theo_val):
            if theo_val <= 0:
                if fact_val == 0:
                    return 0.0
                return 100.0
            return ((fact_val - theo_val) / theo_val) * 100.0
            
        row_data = [
            date_str,
            batch_numbers,
            s.line or "",
            s.shift_name or "",
            s.master.name if s.master else "",
            product_names,
            s.zo_batches or 0,
            formovka_sheets,
            round(formovka_tons, 3),
            qcd_condition,
            qcd_first,
            qcd_defect,
            wind_resets,
            s.zo_asb_drain or 0.0,
            s.zo_cem_drain or 0.0,
            fact["chrysotile_4_20"],
            fact["chrysotile_5_65"],
            fact["chrysotile_6_40"],
            total_fact_asbestos,
            fact["cement_silo1"],
            fact["cement_silo2"],
            fact["cement_silo3"],
            fact["cement_silo4"],
            total_fact_cement,
            fact["asbocarton"],
            fact["laprol"],
            fact["cellulose"],
            fact["fiberglass"],
            fact["crushed_slate"],
            fact["asbozurit"],
            # Deviations (in %!)
            get_pct_deviation(fact["chrysotile_4_20"], theory["chrysotile_4_20"]),
            get_pct_deviation(fact["chrysotile_5_65"], theory["chrysotile_5_65"]),
            get_pct_deviation(fact["chrysotile_6_40"], theory["chrysotile_6_40"]),
            get_pct_deviation(total_fact_asbestos, total_theo_asbestos),
            get_pct_deviation(total_fact_cement, theory_cement),
            get_pct_deviation(fact["asbocarton"], theory["asbocarton"]),
            get_pct_deviation(fact["laprol"], theory["laprol"]),
            get_pct_deviation(fact["cellulose"], theory["cellulose"]),
            get_pct_deviation(fact["fiberglass"], theory["fiberglass"]),
            get_pct_deviation(fact["crushed_slate"], theory["crushed_slate"]),
            get_pct_deviation(fact["asbozurit"], theory["asbozurit"])
        ]
        
        ws.append(row_data)
        
        curr_row = ws.max_row
        
        # Style cells
        for col_idx in range(1, len(headers) + 1):
            cell = ws.cell(row=curr_row, column=col_idx)
            cell.border = border_thin
            
            # Alignments
            if col_idx in [1, 2, 3, 4, 5, 6]:
                cell.alignment = Alignment(horizontal="left")
            else:
                cell.alignment = Alignment(horizontal="right")
                
            # Defect cell (col 12)
            if col_idx == 12:
                val = cell.value
                if val == 0:
                    cell.fill = green_fill
                else:
                    cell.fill = red_fill
                    
            # Deviation cols (cols 31 to 41)
            if col_idx in range(31, 42):
                val = cell.value
                if val is not None and isinstance(val, (int, float)):
                    # Format as percentage string with sign
                    sign = "+" if val > 0 else ""
                    cell.value = f"{sign}{val:.2f}%"
                    # Deviation color rules: > 0.1% red, otherwise green
                    if val > 0.1:
                        cell.fill = red_fill
                    else:
                        cell.fill = green_fill
                        
    # Auto-fit column widths
    for col in ws.columns:
        max_len = 0
        for cell in col:
            val_str = str(cell.value or '')
            if len(val_str) > max_len:
                max_len = len(val_str)
        col_letter = get_column_letter(col[0].column)
        ws.column_dimensions[col_letter].width = max(max_len + 3, 11)
        
    # Enable Autofilter
    if ws.max_row > 1:
        ws.auto_filter.ref = f"A1:AO{ws.max_row}"
        
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()

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
