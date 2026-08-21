import os
import re
import json
import time
import difflib
import urllib.request
import urllib.error

# 4 строго утвержденные категории
VALID_CATEGORIES = [
    "Механические",
    "Энергетические",
    "Технологические",
    "ТО и ППР"
]

# Фоллбэк канонических участков
VALID_DEPARTMENTS = [
    "ЛФМ",
    "ВСА (Стакер)",
    "Дестакер",
    "ЗО (Заготовительное отделение)",
    "Заготовительное отделение (ЗО)",
    "Бракомешалка",
    "КВТ (Камера Воздушного Твердения)",
    "Воздушные компрессоры",
    "Воздушный компрессор",
    "Смазчик прокладок",
    "Рекуператор",
    "Дозировка",
    "Транспортерные ленты (1-3)",
    "Общезаводские"
]

# Статический фоллбэк справочника (если БД недоступна)
FALLBACK_DIRECTORY = {
    "ЛФМ": [
        "Ковшевая мешалка",
        "Гомогенизатор",
        "Сукно",
        "Сетчатый цилиндр 1",
        "Сетчатый цилиндр 2",
        "Сетчатый цилиндр 3",
        "Сетчатый цилиндр 4",
        "Вакуум - Коробка Очищающая сукно",
        "Вакуум-коробка",
        "Форматный барабан",
        "Прессовая часть",
        "Ванны (1-4)",
        "Санитарный день",
        "Общее по участку"
    ],
    "ВСА (Стакер)": [
        "Стакер",
        "Ножевой блок - Ножи (1-5)",
        "Трансбордер",
        "Общее по участку"
    ],
    "Дестакер": [
        "Дестакер",
        "Раздаточная тележка",
        "Вакуумные присоски",
        "Общее по участку"
    ],
    "ЗО (Заготовительное отделение)": [
        "Турбосмеситель",
        "Турбомешалка",
        "Гидроразбиватель",
        "Дозатор цемента",
        "Бегун",
        "Асбозурит",
        "Целлюлоза",
        "Общее по участку"
    ],
    "Дозировка": [
        "Дозировка Хризотила",
        "Растарочная машина"
    ],
    "Бракомешалка": [
        "Бракомешалка",
        "Насос бракомешалки",
        "Общее по участку"
    ],
    "КВТ (Камера Воздушного Твердения)": [
        "Камера твердения",
        "Паропровод / Клапаны",
        "Датчики КВТ",
        "Общее по участку"
    ],
    "Воздушные компрессоры": [
        "Компрессор",
        "Осушитель воздуха",
        "Общее по участку"
    ],
    "Смазчик прокладок": [
        "Смазчик",
        "Форсунки подачи масла",
        "Общее по участку"
    ],
    "Рекуператор": [
        "Рекуператор",
        "Насос рекуператора",
        "Общее по участку"
    ]
}

_CACHED_DIR_TREE = None
_CACHED_DIR_ENTRIES = None
_LAST_CACHE_TIME = 0
CACHE_TTL = 300  # 5 минут кэш справочника из БД

def get_directory_data(db=None):
    """
    Динамически загружает дерево участков, узлов и поломок из таблицы DowntimeDirectory в БД.
    Кэширует в памяти на 5 минут для исключения нагрузки на базу данных.
    """
    global _CACHED_DIR_TREE, _CACHED_DIR_ENTRIES, _LAST_CACHE_TIME
    now = time.time()
    if _CACHED_DIR_TREE is not None and (now - _LAST_CACHE_TIME < CACHE_TTL):
        return _CACHED_DIR_TREE, _CACHED_DIR_ENTRIES

    close_after = False
    if db is None:
        try:
            from database import SessionLocal
            db = SessionLocal()
            close_after = True
        except Exception:
            pass

    if db is not None:
        try:
            import models
            records = db.query(models.DowntimeDirectory).all()
            if records:
                tree = {}
                entries = []
                for r in records:
                    dept = (r.department or "").strip()
                    node = (r.node or "").strip()
                    breakdown = (r.breakdown or "").strip()
                    cat = (r.category or "").strip()
                    if not dept:
                        continue
                    if dept not in tree:
                        tree[dept] = set()
                    if node:
                        tree[dept].add(node)
                    if breakdown or node:
                        entries.append({
                            "department": dept,
                            "node": node or "Общее по участку",
                            "breakdown": breakdown,
                            "category": cat if cat in VALID_CATEGORIES else "Механические"
                        })
                tree_dict = {d: sorted(list(nodes)) for d, nodes in tree.items()}
                _CACHED_DIR_TREE = tree_dict
                _CACHED_DIR_ENTRIES = entries
                _LAST_CACHE_TIME = now
                return _CACHED_DIR_TREE, _CACHED_DIR_ENTRIES
        except Exception as e:
            print(f"Warning: could not load DowntimeDirectory from DB: {e}")
        finally:
            if close_after and db:
                db.close()

    return FALLBACK_DIRECTORY, []

def normalize_text(text: str) -> str:
    """Предварительная нормализация текста и устранение частых склеек."""
    if not text:
        return ""
    t = text.lower().replace("ё", "е")
    # Разделяем слипшиеся "2ножа" -> "2 ножа", "нож2" -> "нож 2", "1цилиндр" -> "1 цилиндр"
    t = re.sub(r'(\d+)\s*(нож|ножа|ножей)', r'\2 \1', t)
    t = re.sub(r'(нож|ножа|ножей)\s*(\d+)', r'нож \2', t)
    t = re.sub(r'(\d+)\s*(цилиндр|целиндр|цылиндр)', r'цилиндр \1', t)
    t = re.sub(r'(цилиндр|целиндр|цылиндр)\s*(\d+)', r'цилиндр \2', t)
    t = re.sub(r'(\d+)\s*(лент[аы]|лент)', r'лента \1', t)
    t = re.sub(r'(лент[аы]|лент)\s*(\d+)', r'лента \2', t)
    # Нормализуем "из за" -> "из-за"
    t = re.sub(r'\bиз\s+за\b', 'из-за', t)
    return t

def is_equipment_stop_check(text: str, default_val: bool = True) -> bool:
    """Проверяет, является ли простой остановкой оборудования или работой на ходу."""
    t = normalize_text(text)
    if any(k in t for k in ["на ходу", "без остановки", "без останов", "без простоя", "находу"]):
        return False
    return default_val

def match_node_and_dept_rule_based(text: str, db=None):
    """
    Интеллектуальное сопоставление по корням, фонетическим шаблонам и справочнику завода.
    Устойчиво к опечаткам (кампресор, мишалка, дистакер, тилежки, вакумная каробка и др.).
    """
    t = normalize_text(text)

    # 1. Санитарный день / ППР
    if re.search(r'санитарн[а-я]*|сан\s*день|сандень|ппр|регламентн[а-я]*', t):
        return "ЛФМ", "Санитарный день", "ТО и ППР"

    # 2. ВСА (Ножевой блок) - высокий приоритет перед общим дестакером
    knife_match = re.search(r'нож[а-я]*\s*([1-5])', t)
    if knife_match:
        num = knife_match.group(1)
        return "ВСА (Стакер)", f"Ножевой блок - Нож {num}", "Механические"
        
    if re.search(r'\bнож[а-я]*|\bлыж[а-я]*|\bвставк[а-я]*|\bвтулк[а-я]*', t):
        return "ВСА (Стакер)", "Ножевой блок - Ножи (1-5)", "Механические"

    # 3. Бракомешалка
    if re.search(r'брако?м[еи]шалк|шлам', t):
        if re.search(r'насос', t):
            return "Бракомешалка", "Насос бракомешалки", "Механические"
        return "Бракомешалка", "Бракомешалка", "Механические"

    # 4. Ковшевая мешалка и Гомогенизатор -> ЛФМ (согласно официальному справочнику завода)
    if re.search(r'к[оа]вшев[а-я]*\s*м[еи]шалк[а-я]*|к[оа]вш[а-я]*\s*м[еи]шалк[а-я]*|скребк[а-я]*', t) or (re.search(r'к[оа]вшев', t) and re.search(r'м[еи]шалк|закл[ие]н|скреб|завар', t)):
        return "ЛФМ", "Ковшевая мешалка", "Механические"

    if re.search(r'г[оа]м[оа]г[еи]низ[ао]т[оа]р', t):
        return "ЛФМ", "Гомогенизатор", "Механические"

    # 5. Заготовительное отделение (ЗО) и Дозировка
    if re.search(r'турбо?м[еи]шалк|турбо?см[еи]сител', t):
        return "ЗО (Заготовительное отделение)", "Турбосмеситель", "Механические"
        
    if re.search(r'гидроразбивател|гидро?разбив', t):
        return "ЗО (Заготовительное отделение)", "Гидроразбиватель", "Механические"

    if re.search(r'бегун', t):
        return "ЗО (Заготовительное отделение)", "Бегун", "Механические"

    if re.search(r'растарочн', t):
        return "Дозировка", "Растарочная машина", "Механические"

    if re.search(r'хризотил|д[оа]затор.*хриз', t):
        return "Дозировка", "Дозировка Хризотила", "Механические"

    if re.search(r'д[оа]затор[а-я]*.*(ц[еи]мент|асб[еи]ст|вод)', t):
        if 'ц' in t:
            return "ЗО (Заготовительное отделение)", "Дозатор цемента", "Механические"
        elif 'асб' in t:
            return "Дозировка", "Дозировка Хризотила", "Механические"
        else:
            return "ЗО (Заготовительное отделение)", "Дозатор воды", "Механические"
            
    if re.search(r'шнек', t):
        return "ЗО (Заготовительное отделение)", "Шнек подачи", "Механические"
        
    if re.search(r'силос', t):
        return "ЗО (Заготовительное отделение)", "Силос цемента", "Механические"

    # 6. Воздушные компрессоры
    if re.search(r'к[оа]мпр[еэи]с+ор|осушител|нет\s*возд|давлен.*возд|упало\s*давлен', t):
        cat = "Энергетические"
        if re.search(r'осушител', t):
            return "Воздушные компрессоры", "Осушитель воздуха", cat
        return "Воздушные компрессоры", "Компрессор", cat

    # 7. КВТ (Камера Воздушного Твердения)
    if re.search(r'\bквт\b|кам[еи]р[а-я]*\s*тв[еи]рден|свищ|\bнет\s*пара\b|п[ао]ропровод', t):
        if re.search(r'датчик', t):
            return "КВТ (Камера Воздушного Твердения)", "Датчики КВТ", "Энергетические"
        if re.search(r'клапан|кран|п[ао]ропровод|свищ', t):
            return "КВТ (Камера Воздушного Твердения)", "Паропровод / Клапаны", "Механические"
        return "КВТ (Камера Воздушного Твердения)", "Общее по участку", "Технологические"

    # 8. Смазчик прокладок
    if re.search(r'смазчик|пр[оа]кладок|ф[оа]рсунк[а-я]*.*масл', t):
        if re.search(r'ф[оа]рсунк', t):
            return "Смазчик прокладок", "Форсунки подачи масла", "Технологические"
        return "Смазчик прокладок", "Смазчик", "Технологические"

    # 9. Рекуператор
    if re.search(r'р[еи]куп[еи]рат[оа]р', t):
        if re.search(r'насос', t):
            return "Рекуператор", "Насос рекуператора", "Механические"
        return "Рекуператор", "Рекуператор", "Технологические"

    # 10. Дестакер и Раздаточная тележка
    if re.search(r'т[еи]леж[а-я]*|т[еи]лег[а-я]*|раздаточн[а-я]*', t):
        cat = "Технологические" if re.search(r'нет|отсу[дт]ств|не\s*хват', t) else "Механические"
        return "Дестакер", "Раздаточная тележка", cat

    if re.search(r'д[еи]стак[еи]р|разборщик', t):
        if re.search(r'присоск|вак[уа]м', t):
            return "Дестакер", "Вакуумные присоски", "Технологические"
        return "Дестакер", "Дестакер", "Механические"

    # 11. ВСА (Стакер)
    if re.search(r'стак[еи]р|укладчик|вса|трансбордер|волнировк', t):
        if re.search(r'трансбордер', t):
            return "ВСА (Стакер)", "Трансбордер", "Механические"
        return "ВСА (Стакер)", "Стакер", "Механические"

    # 12. ЛФМ (Сукно, Сетчатые цилиндры, Вакуум, Барабан, Пресс)
    if re.search(r'с[уе]кн[а-я]*|склеиван', t):
        cat = "ТО и ППР" if re.search(r'склеиван|замен|ремонт', t) else "Технологические"
        return "ЛФМ", "Сукно", cat

    cyl_match = re.search(r'(?:ц[иеы]линдр|сетк|рубашк)[а-я]*\s*([1-4])', t)
    if cyl_match:
        num = cyl_match.group(1)
        return "ЛФМ", f"Сетчатый цилиндр {num}", "Механические"
        
    if re.search(r'ц[иеы]линдр|сетк|рубашк', t):
        return "ЛФМ", "Сетчатый цилиндр 1", "Механические"

    # Коробка / Вакуум-коробка
    if re.search(r'вак[уа]+м|к[оа]робк[а-я]*', t):
        return "ЛФМ", "Вакуум - Коробка Очищающая сукно", "Технологические"

    if re.search(r'барабан|накат|ф[оа]рматн.*барабан', t):
        return "ЛФМ", "Прессовая часть - Форматный барабан", "Механические"

    if re.search(r'пресс|отжимн', t):
        return "ЛФМ", "Прессовая часть - Пресс вал", "Механические"

    if re.search(r'ванн', t):
        return "ЛФМ", "Ванны (1-4)", "Технологические"

    tape_match = re.search(r'л[еи]нт[а-я]*\s*([1-3])', t)
    if tape_match:
        num = tape_match.group(1)
        return "Транспортерные ленты (1-3)", f"Транспортерная лента {num}", "Механические"

    if re.search(r'л[еи]нт[а-я]*|тр[ао]нспорт[еи]р', t):
        return "Транспортерные ленты (1-3)", "Общее по участку", "Механические"

    # 13. Сварка / Металлоконструкции
    if re.search(r'вар[ие]л|сварк|завар[ие]т|ш[еэ]йд[еи]р', t):
        if re.search(r'рам|креплен|тяг|ограничител', t):
            return "Дестакер", "Раздаточная тележка", "Механические"
        return "Дестакер", "Дестакер", "Механические"

    # 14. Электрика и датчики общего назначения
    if re.search(r'датчик|реле|двигател|мотор|кабел|электр|авт[оа]матик', t):
        return "ЛФМ", "Общее по участку", "Энергетические"

    # Фоллбэк
    return "ЛФМ", "Общее по участку", "Механические"

def refine_category_rule_based(text: str, default_cat: str = "Механические") -> str:
    """Уточняет категорию strictly в рамках 4-х утвержденных."""
    t = normalize_text(text)
    
    # 1. ТО и ППР
    if re.search(r'санитарн|сан\s*день|ппр|регламент|комплексн.*обслуживан|планов.*замен|склеиван.*сукн', t):
        return "ТО и ППР"

    # 2. Энергетические
    if re.search(r'электр|кабел|клемм|двигател|мотор|реле|частотник|трансформатор|автомат|выбило|фаз|напряжен|коротк|датчик|квт.*датчик|компрессор|давлен.*возд|сжатый\s*воздух|упало\s*давлен', t):
        return "Энергетические"

    # 3. Технологические
    if re.search(r'промывк|очистк|чистк|засор|забил|налипан|шлам|консистенц|густот|сгуст|протек|утечк|вакуум|не\s*хват.*сырь|нет.*тилеж|нет.*тележ|отсутств.*тилеж|отсутств.*тележ|завал|сброс', t):
        return "Технологические"

    # 4. Механические
    if re.search(r'заклинил|клин|лопнул|треснул|порвал|замен.*нож|нож.*замен|завар|сварк|подшипник|редуктор|вал|шестерн|цепь|ремень|ролик|болт|шпильк|скребк|рама', t):
        return "Механические"

    if default_cat in VALID_CATEGORIES:
        return default_cat
    return "Механические"

def query_gemini_flash(text: str, db=None):
    """
    Вызов Gemini Flash AI с динамическим промптом на основе актуального справочника БД.
    Возвращает dict с department, node, category, is_equipment_downtime или None при сбое.
    """
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return None

    tree, _ = get_directory_data(db)
    
    # Формируем динамический список участков и узлов из БД
    dept_lines = [f'- "{d}"' for d in tree.keys()]
    node_lines = []
    for d, nodes in tree.items():
        sample_nodes = ", ".join([f'"{n}"' for n in nodes[:10]])
        node_lines.append(f'- {d}: {sample_nodes}')

    depts_str = "\n".join(dept_lines)
    nodes_str = "\n".join(node_lines)

    prompt = f"""Ты — главный инженер и диспетчер асбестоцементного завода Tectum.
Твоя задача — классифицировать текст простоя мастера смены (включая сленг, синтаксические и грамматические ошибки).

Официальные УЧАСТКИ завода (department):
{depts_str}

Строго 4 разрешенные КАТЕГОРИИ (category):
1. "Механические" (механика, заклинивания, сварка, подшипники, ножи, цепи, ремни, скребки)
2. "Энергетические" (электрика, двигатели, датчики, реле, компрессоры, давление воздуха, пар)
3. "Технологические" (чистка, промывка, забились трубы, налипание, вакуум, отсутствие тележек, сырье)
4. "ТО и ППР" (санитарный день, плановое ТО, регламентная замена сукон/сеток)

Официальные узлы по участкам завода (node):
{nodes_str}

Текст мастера: "{text}"

Ответь ТОЛЬКО валидным JSON объектом следующего вида:
{{
  "department": "...",
  "node": "...",
  "category": "...",
  "is_equipment_downtime": true
}}"""

    candidate_models = [
        "gemini-3.5-flash-lite",
        "gemini-flash-lite-latest",
        "gemini-3.5-flash",
        "gemini-3.7-flash",
        "gemini-flash-latest"
    ]
    
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.1,
            "responseMimeType": "application/json"
        }
    }
    encoded_payload = json.dumps(payload).encode("utf-8")

    for model_name in candidate_models:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
        req = urllib.request.Request(
            url,
            data=encoded_payload,
            headers={"Content-Type": "application/json"}
        )

        t_start = time.time()
        try:
            with urllib.request.urlopen(req, timeout=3.0) as resp:
                elapsed = time.time() - t_start
                data = json.loads(resp.read().decode("utf-8"))
                raw_json = data["candidates"][0]["content"]["parts"][0]["text"].strip()
                if raw_json.startswith("```"):
                    raw_json = re.sub(r"^```(?:json)?\s*", "", raw_json)
                    raw_json = re.sub(r"\s*```$", "", raw_json)
                parsed = json.loads(raw_json)
                
                # Валидация категории
                cat = parsed.get("category")
                if cat not in VALID_CATEGORIES:
                    cat = refine_category_rule_based(text, "Механические")
                    
                dept = parsed.get("department")
                if dept not in tree and dept not in VALID_DEPARTMENTS:
                    dept, _, _ = match_node_and_dept_rule_based(text, db)
                    
                node = parsed.get("node") or "Общее по участку"
                is_equip = parsed.get("is_equipment_downtime", True)
                
                print(f"[AI Gemini Flash] '{text[:45]}' -> Модель: {model_name} ({elapsed:.2f}s) -> [{dept}] / [{node}] / [{cat}]")
                return {
                    "department": dept,
                    "node": node,
                    "category": cat,
                    "is_equipment_downtime": is_equip
                }
        except Exception:
            continue
            
    return None

def classify_downtime_text(text: str, is_equipment_param: bool = True, db=None):
    """
    Главная точка входа для классификации текста простоя:
    1. Пробует Gemini Flash AI с динамическим заводским справочником.
    2. При отсутствии AI мгновенно срабатывает локальный нечеткий Regex/Fuzzy классификатор.
    """
    cleaned_text = (text or "").strip()
    if not cleaned_text:
        return "ЛФМ", "Общее по участку", "Механические", is_equipment_param

    # 1. Попытка через AI
    ai_result = query_gemini_flash(cleaned_text, db=db)
    if ai_result:
        return (
            ai_result["department"],
            ai_result["node"],
            ai_result["category"],
            ai_result["is_equipment_downtime"] if is_equipment_param is None else is_equipment_param
        )

    # 2. Локальный классификатор
    dept, node, cat = match_node_and_dept_rule_based(cleaned_text, db=db)
    final_cat = refine_category_rule_based(cleaned_text, cat)
    is_equip = is_equipment_stop_check(cleaned_text, is_equipment_param if is_equipment_param is not None else True)
    
    print(f"[Local Classifier] '{cleaned_text[:45]}' -> [{dept}] / [{node}] / [{final_cat}]")
    return dept, node, final_cat, is_equip
