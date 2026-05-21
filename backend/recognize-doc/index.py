"""
ИИ-распознавание документов.
Порядок: Yandex Vision OCR → YandexGPT → DeepSeek текст fallback.
POST / — принимает base64-изображение, авто-создаёт транзакцию в БД.
"""
import json
import os
import base64
import re
import io
import urllib.request
import urllib.error
import psycopg2
from datetime import date as date_cls

SCHEMA = os.environ.get("MAIN_DB_SCHEMA", "t_p79040548_accounting_automatio")
CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
}

ANALYSIS_PROMPT = """Ты финансовый ИИ-бухгалтер для ИП России. Тебе дан текст, извлечённый из финансового документа (накладная, чек, счёт).

ПРАВИЛА КАТЕГОРИИ (category):
- Таблица с товарами / номенклатура / позиции ТМЦ → "Закупка товара"
- АЗС, топливо, бензин АИ-92/95, ДТ, солярка → "ГСМ"
- Юридические, бухгалтерские, консультационные услуги → "Бухгалтерские услуги"
- Офис, склад, помещение, аренда → "Аренда"
- Зарплата / выплата → "Зарплаты"
- Реклама, маркетинг → "Маркетинг"
- Доставка, транспорт → "Логистика"
- Оборудование, техника → "Оборудование"
- Иначе — 1-3 слова своими словами

ПРАВИЛА ТИПА (doc_type):
- Есть наименования товаров, артикулы, цены — таблица → "Накладная"
- Слова «накладная», «ТОРГ-12», «УПД», «ТМЦ» → "Накладная"
- Кассовый чек, ФФД, QR-код ФНС → "Чек"
- Счёт-фактура, УПД → "Счёт-фактура"
- Акт выполненных работ → "Акт"

ПРАВИЛА СУММЫ — КРИТИЧЕСКИ ВАЖНО, ОБЯЗАТЕЛЬНО ВЕРНИ ЧИСЛО:
1) ПЕРВЫМ ДЕЛОМ ищи слова: «Итого», «ИТОГО», «Всего к оплате», «К оплате», «Итого с НДС», «Всего», «на сумму», «Сумма».
   Берёшь число РЯДОМ С ЭТИМ СЛОВОМ (справа или ниже). Это и есть amount.
2) Если есть сумма ПРОПИСЬЮ — например «Двадцать восемь тысяч сто тридцать два рубля 00 копеек» — расшифруй её и
   используй как контроль/основной источник: 28132.00.
3) Формат чисел: «28 132,00» / «28132,00» / «28 132.00» — убери пробелы, замени запятую на точку → 28132.00.
4) НИКОГДА не возвращай null если в тексте есть хоть одно число с «Итого» или сумма прописью.
5) Если несколько чисел — выбирай МАКСИМАЛЬНОЕ из тех, что стоят рядом со словом «Итого/Всего/К оплате».
6) Игнорируй НДС, цены отдельных позиций, количества (шт), артикулы (длинные коды).

Верни ТОЛЬКО JSON без лишнего текста:
{"amount":28132.00,"date":"2026-05-21","category":"Закупка товара","comment":"Накладная — 38 позиций товара, итого 28 132 руб","doc_type":"Накладная","counterparty":"Склад Дили","inn":null,"type":"expense"}"""

TYPE_TO_CATEGORY = {
    "накладная": "Закупка товара",
    "торг": "Закупка товара",
    "упд": "Закупка товара",
    "счёт-фактура": "Закупка товара",
    "счет-фактура": "Закупка товара",
}


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def get_keys(conn):
    cur = conn.cursor()
    cur.execute(f"SELECT api_key, gemini_api_key, yandex_api_key, yandex_folder_id FROM {SCHEMA}.ai_settings WHERE id=1")
    row = cur.fetchone()
    cur.close()
    deepseek_key = (row[0] if row else "") or os.environ.get("DEEPSEEK_API_KEY", "")
    gemini_key = (row[1] if row else "") or os.environ.get("GEMINI_API_KEY", "")
    yandex_key = (row[2] if row else "") or os.environ.get("YANDEX_API_KEY", "")
    yandex_folder = (row[3] if row else "") or os.environ.get("YANDEX_FOLDER_ID", "")
    return deepseek_key, gemini_key, yandex_key, yandex_folder


# ── Yandex Vision OCR ──────────────────────────────────────────────────────

def yandex_ocr(image_b64: str, yandex_key: str, yandex_folder: str) -> str:
    """Извлекает текст из изображения через Yandex Vision OCR."""
    url = "https://ocr.api.cloud.yandex.net/ocr/v1/recognizeText"
    payload = {
        "mimeType": "JPEG",
        "languageCodes": ["ru", "en"],
        "model": "page",
        "content": image_b64,
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Api-Key {yandex_key}",
            "x-folder-id": yandex_folder,
            "x-data-logging-enabled": "false",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            resp = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body_err = e.read().decode("utf-8", errors="replace")
        raise Exception(f"Яндекс Vision HTTP {e.code}: {body_err[:200]}")

    # Собираем весь текст из блоков
    lines = []
    result = resp.get("result", {})
    for block in result.get("textAnnotation", {}).get("blocks", []):
        for line in block.get("lines", []):
            words = [w.get("text", "") for w in line.get("words", [])]
            if words:
                lines.append(" ".join(words))
    return "\n".join(lines)


# ── YandexGPT анализ текста ───────────────────────────────────────────────

def yandex_gpt_analyze(ocr_text: str, file_name: str, yandex_key: str, yandex_folder: str) -> dict:
    """Анализирует OCR-текст через YandexGPT и возвращает структурированные данные."""
    url = "https://llm.api.cloud.yandex.net/foundationModels/v1/completion"
    payload = {
        "modelUri": f"gpt://{yandex_folder}/yandexgpt/latest",
        "completionOptions": {
            "stream": False,
            "temperature": 0.05,
            "maxTokens": 800,
        },
        "messages": [
            {"role": "system", "text": ANALYSIS_PROMPT},
            {
                "role": "user",
                "text": (
                    f"Имя файла: «{file_name}»\n\n"
                    f"Текст документа (OCR):\n```\n{ocr_text[:5000]}\n```\n\n"
                    "Найди ИТОГОВУЮ сумму и заполни все поля. Верни JSON."
                ),
            },
        ],
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Api-Key {yandex_key}",
            "x-folder-id": yandex_folder,
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=45) as r:
        resp = json.loads(r.read().decode("utf-8"))
    text = resp["result"]["alternatives"][0]["message"]["text"]
    return parse_json(text)


def call_yandex(images: list, file_name: str, yandex_key: str, yandex_folder: str) -> dict:
    """OCR всех страниц → объединяем текст → YandexGPT анализирует. Возвращает поля + ocr_text."""
    all_texts = []
    for idx, img in enumerate(images[:5]):
        b64 = img.get("b64", "")
        if not b64:
            continue
        try:
            pb, _ = preprocess(b64)
            text = yandex_ocr(pb, yandex_key, yandex_folder)
            if text.strip():
                all_texts.append(f"=== Страница {idx + 1} ===\n{text}")
        except Exception as e:
            all_texts.append(f"=== Страница {idx + 1} === [ошибка OCR: {e}]")

    combined = "\n\n".join(all_texts) if all_texts else "[текст не извлечён]"
    result = yandex_gpt_analyze(combined, file_name, yandex_key, yandex_folder)
    result["_ocr_text"] = combined
    return result


# ── Регулярка: ищем итоговую сумму в OCR-тексте ─────────────────────────

AMOUNT_KEYWORDS = [
    r"итого\s+к\s+оплат[еay]",
    r"всего\s+к\s+оплат[еay]",
    r"к\s+оплат[еay]",
    r"итого[\s:]+с\s+ндс",
    r"итого\s+с\s+ндс",
    r"всего\s+с\s+ндс",
    r"итого",
    r"всего",
    r"сумма",
]

# ── Парсер суммы прописью (русский) ─────────────────────────────────────

WORD_UNITS = {
    "ноль": 0, "один": 1, "одна": 1, "два": 2, "две": 2, "три": 3, "четыре": 4,
    "пять": 5, "шесть": 6, "семь": 7, "восемь": 8, "девять": 9,
    "десять": 10, "одиннадцать": 11, "двенадцать": 12, "тринадцать": 13,
    "четырнадцать": 14, "пятнадцать": 15, "шестнадцать": 16,
    "семнадцать": 17, "восемнадцать": 18, "девятнадцать": 19,
}
WORD_TENS = {
    "двадцать": 20, "тридцать": 30, "сорок": 40, "пятьдесят": 50,
    "шестьдесят": 60, "семьдесят": 70, "восемьдесят": 80, "девяносто": 90,
}
WORD_HUNDREDS = {
    "сто": 100, "двести": 200, "триста": 300, "четыреста": 400,
    "пятьсот": 500, "шестьсот": 600, "семьсот": 700, "восемьсот": 800, "девятьсот": 900,
}
WORD_THOUSAND = {"тысяча", "тысячи", "тысяч"}
WORD_MILLION = {"миллион", "миллиона", "миллионов"}


def parse_words_to_number(words: list) -> int:
    """Парсит список русских слов-числительных в число. Возвращает 0 если не получилось."""
    total = 0
    current = 0
    for w in words:
        w = w.lower().strip(".,")
        if w in WORD_UNITS:
            current += WORD_UNITS[w]
        elif w in WORD_TENS:
            current += WORD_TENS[w]
        elif w in WORD_HUNDREDS:
            current += WORD_HUNDREDS[w]
        elif w in WORD_THOUSAND:
            total += (current or 1) * 1000
            current = 0
        elif w in WORD_MILLION:
            total += (current or 1) * 1_000_000
            current = 0
    return total + current


def find_amount_in_words(text: str) -> float | None:
    """Ищет 'Тридцать восемь тысяч семьсот семьдесят шесть рублей 00 копеек' и расшифровывает в число."""
    if not text:
        return None
    text_low = text.lower()
    # Берём всё от слов-числительных до 'рублей'/'руб'
    # Расширенный паттерн: подряд идущие русские числительные + рубль
    pattern = (
        r"((?:двадцать|тридцать|сорок|пятьдесят|шестьдесят|семьдесят|восемьдесят|девяносто|"
        r"сто|двести|триста|четыреста|пятьсот|шестьсот|семьсот|восемьсот|девятьсот|"
        r"один|одна|два|две|три|четыре|пять|шесть|семь|восемь|девять|"
        r"десять|одиннадцать|двенадцать|тринадцать|четырнадцать|пятнадцать|"
        r"шестнадцать|семнадцать|восемнадцать|девятнадцать|тысяч[аи]?|миллион[аов]?"
        r")(?:[\s\-]+(?:двадцать|тридцать|сорок|пятьдесят|шестьдесят|семьдесят|восемьдесят|девяносто|"
        r"сто|двести|триста|четыреста|пятьсот|шестьсот|семьсот|восемьсот|девятьсот|"
        r"один|одна|два|две|три|четыре|пять|шесть|семь|восемь|девять|"
        r"десять|одиннадцать|двенадцать|тринадцать|четырнадцать|пятнадцать|"
        r"шестнадцать|семнадцать|восемнадцать|девятнадцать|тысяч[аи]?|миллион[аов]?))+"
        r"\s+рубл"
    )
    best = 0
    for m in re.finditer(pattern, text_low):
        phrase = m.group(0).replace("рубл", "").strip()
        words = re.split(r"[\s\-]+", phrase)
        val = parse_words_to_number(words)
        if val > best:
            best = val
    # Парсим копейки если есть: "рублей 50 копеек" → 0.50
    return float(best) if best > 0 else None


def find_total_in_text(text: str) -> float | None:
    """Эвристика: ищем итоговую сумму. Сначала по ключевому слову, потом сумма прописью,
    потом — самое крупное число в нижней трети документа."""
    if not text:
        return None
    text_low = text.lower()
    # 1. Поиск по ключевым словам
    num_re = r"(\d{1,3}(?:[\s\u00a0]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)"
    candidates = []
    for priority, kw in enumerate(AMOUNT_KEYWORDS):
        for m in re.finditer(kw, text_low):
            window = text[m.end(): m.end() + 200]
            num_match = re.search(num_re, window)
            if num_match:
                raw = num_match.group(1)
                cleaned = raw.replace("\u00a0", "").replace(" ", "").replace(",", ".")
                try:
                    val = float(cleaned)
                    if val > 0:
                        candidates.append((priority, val))
                except Exception:
                    pass
    if candidates:
        candidates.sort(key=lambda x: (x[0], -x[1]))
        return candidates[0][1]

    # 2. Поиск суммы прописью
    words_amount = find_amount_in_words(text)
    if words_amount:
        return words_amount

    # 3. Fallback: самое крупное число в нижней трети текста (там обычно "Итого")
    lines = text.split("\n")
    if len(lines) > 3:
        bottom_third = "\n".join(lines[int(len(lines) * 0.6):])
        bottom_nums = []
        for m in re.finditer(num_re, bottom_third):
            raw = m.group(1)
            cleaned = raw.replace("\u00a0", "").replace(" ", "").replace(",", ".")
            try:
                val = float(cleaned)
                # Игнорируем номера телефонов, ИНН, банковские (>10 цифр в исходнике)
                if val > 100 and len(raw.replace(" ", "").replace(",", "").replace(".", "")) <= 9:
                    bottom_nums.append(val)
            except Exception:
                pass
        if bottom_nums:
            return max(bottom_nums)
    return None


# ── Gemini Flash Vision (запасной) ────────────────────────────────────────

def call_gemini_vision(image_b64: str, mime: str, gemini_key: str) -> dict:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={gemini_key}"
    payload = {
        "contents": [{"parts": [
            {"inline_data": {"mime_type": mime, "data": image_b64}},
            {"text": ANALYSIS_PROMPT + "\n\nПроанализируй документ на фото. Верни JSON."},
        ]}],
        "generationConfig": {"temperature": 0.05, "maxOutputTokens": 800, "responseMimeType": "application/json"},
    }
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                  headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=55) as r:
        resp = json.loads(r.read().decode())
    text = resp["candidates"][0]["content"]["parts"][0]["text"]
    return parse_json(text)


def call_gemini_multi(images: list, file_name: str, gemini_key: str) -> dict:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={gemini_key}"
    parts = [{"inline_data": {"mime_type": img.get("mime", "image/jpeg"), "data": img["b64"]}} for img in images[:5]]
    parts.append({"text": ANALYSIS_PROMPT + f"\n\nДокумент «{file_name}» ({len(images)} стр.). Найди итоговую сумму. Верни JSON."})
    payload = {
        "contents": [{"parts": parts}],
        "generationConfig": {"temperature": 0.05, "maxOutputTokens": 800, "responseMimeType": "application/json"},
    }
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                  headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=60) as r:
        resp = json.loads(r.read().decode())
    text = resp["candidates"][0]["content"]["parts"][0]["text"]
    return parse_json(text)


# ── DeepSeek fallback (только текст) ─────────────────────────────────────

def call_deepseek_text(file_name: str, deepseek_key: str) -> dict:
    if not deepseek_key:
        return {"doc_type": "Документ", "category": "Прочее",
                "comment": "Нет ключей ИИ. Добавьте Яндекс ключ в Настройки → Нейросеть"}
    payload = {
        "model": "deepseek-chat",
        "messages": [
            {"role": "system", "content": ANALYSIS_PROMPT},
            {"role": "user", "content": f"Имя файла: «{file_name}». Числовые поля null. Только тип и категория."},
        ],
        "max_tokens": 300, "temperature": 0.05,
        "response_format": {"type": "json_object"},
    }
    req = urllib.request.Request("https://api.deepseek.com/v1/chat/completions",
                                  data=json.dumps(payload).encode(),
                                  headers={"Content-Type": "application/json", "Authorization": f"Bearer {deepseek_key}"},
                                  method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        resp = json.loads(r.read().decode())
    return parse_json(resp["choices"][0]["message"]["content"])


# ── Утилиты ───────────────────────────────────────────────────────────────

def parse_json(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text).strip()
    start = text.find("{")
    end = text.rfind("}") + 1
    if start >= 0 and end > start:
        try:
            return json.loads(text[start:end])
        except Exception:
            pass
    try:
        return json.loads(text)
    except Exception:
        return {}


def apply_rules(doc_type: str, category: str, ocr_text: str = "") -> str:
    """Постобработка категории: если ИИ вернул 'Прочее' — пытаемся определить по типу и тексту."""
    text_low = (ocr_text or "").lower()
    dt = (doc_type or "").lower()

    # Сильные сигналы по тексту документа — приоритет над тем, что вернул ИИ
    if any(x in text_low for x in ("азс", "аи-92", "аи-95", "аи-98", "дизель", "дт ", "бензин",
                                     "топливо", "лукойл", "роснефть", "газпромнефть", "татнефть",
                                     "башнефть", "shell", "shell ", "neste")):
        return "ГСМ"
    if any(x in text_low for x in ("товарный чек", "товарная накладная", "торг-12", "торг 12",
                                     "накладная №", "накладная no", "тмц", "номенклатура")):
        return "Закупка товара"
    if any(x in text_low for x in ("аренда помещен", "арендная плата", "арендодател")):
        return "Аренда"
    if any(x in text_low for x in ("бухгалтерск", "юридическ", "консультац", "аудиторск")):
        return "Бухгалтерские услуги"
    if any(x in text_low for x in ("реклам", "маркетинг", "продвижени", "контекст", "директ", "таргет")):
        return "Маркетинг"
    if any(x in text_low for x in ("доставк", "транспортн", "логистик", "перевозк")):
        return "Логистика"
    if any(x in text_low for x in ("зарплат", "оплата труда", "аванс работник")):
        return "Зарплаты"
    if any(x in text_low for x in ("оборудовани", "станок", "техника", "инструмент")):
        return "Оборудование"

    # Если ИИ дал валидную категорию — оставляем
    if category and category not in ("Прочее", "", None):
        return category

    # По типу документа
    for key, cat in TYPE_TO_CATEGORY.items():
        if key in dt:
            return cat
    if any(x in dt for x in ("наклад", "торг", "упд", "тмц")):
        return "Закупка товара"
    if "чек" in dt and any(x in dt for x in ("азс", "запр", "топлив", "бенз")):
        return "ГСМ"
    return category or "Прочее"


def detect_doc_type(ocr_text: str, current_type: str = "") -> str:
    """Определяет тип документа по тексту. Возвращает текущий если не нашли."""
    text_low = (ocr_text or "").lower()
    # Накладная — наличие товарной таблицы
    if any(x in text_low for x in ("товарная накладная", "товарный чек", "торг-12", "торг 12",
                                     "накладная №", "накладная no", "накладная n")):
        return "Накладная"
    # УПД / Счёт-фактура
    if any(x in text_low for x in ("упд", "счёт-фактур", "счет-фактур", "счет фактур")):
        return "Счёт-фактура"
    # Акт
    if "акт выполненных работ" in text_low or "акт оказания услуг" in text_low:
        return "Акт"
    # Чек кассовый
    if "кассовый чек" in text_low or "фискальный чек" in text_low or "ффд" in text_low:
        return "Чек"
    # Просто "чек" + товары → накладная (товарный чек)
    if "чек" in text_low and any(x in text_low for x in ("товар", "наименован", "кол-во", "цена", "сумма")):
        return "Накладная"
    return current_type or "Документ"


def clean_amount(raw) -> float | None:
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        v = float(raw)
        return v if v > 0 else None
    s = str(raw).strip()
    s = re.sub(r"[₽руб\.RUBrub]", "", s, flags=re.IGNORECASE).strip()
    if re.match(r"^\d[\d\s]*[,\.]\d{2}$", s):
        s = s.replace(" ", "").replace(",", ".")
    else:
        s = re.sub(r"[^\d,\.]", "", s)
        if s.count(",") == 1 and "." not in s:
            s = s.replace(",", ".")
        elif s.count(",") >= 1:
            s = s.replace(",", "")
    try:
        v = float(s)
        return v if v > 0 else None
    except Exception:
        return None


def normalize_date(raw) -> tuple:
    today = str(date_cls.today())
    if not raw:
        return today, False
    raw = str(raw).strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}$", raw):
        return raw, True
    m = re.match(r"^(\d{2})\.(\d{2})\.(\d{4})$", raw)
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}", True
    m = re.match(r"^(\d{2})\.(\d{2})\.(\d{2})$", raw)
    if m:
        return f"20{m.group(3)}-{m.group(2)}-{m.group(1)}", True
    return today, False


def extract_excel_text(excel_b64: str, file_name: str) -> str:
    """Извлекает текст из xls/xlsx — все ячейки всех листов."""
    data = base64.b64decode(excel_b64)
    is_xlsx = file_name.lower().endswith(".xlsx")
    lines = []
    if is_xlsx:
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True, read_only=True)
        for ws in wb.worksheets:
            lines.append(f"=== Лист: {ws.title} ===")
            for row in ws.iter_rows(values_only=True):
                row_text = " | ".join(str(c) for c in row if c is not None)
                if row_text.strip():
                    lines.append(row_text)
    else:
        import xlrd
        wb = xlrd.open_workbook(file_contents=data)
        for sheet in wb.sheets():
            lines.append(f"=== Лист: {sheet.name} ===")
            for r in range(sheet.nrows):
                row_vals = [sheet.cell_value(r, c) for c in range(sheet.ncols)]
                row_text = " | ".join(str(v) for v in row_vals if v not in (None, ""))
                if row_text.strip():
                    lines.append(row_text)
    return "\n".join(lines)


def analyze_text_with_ai(text: str, file_name: str, deepseek_key: str,
                          yandex_key: str, yandex_folder: str, gemini_key: str) -> dict:
    """Анализирует текст таблицы через любой доступный ИИ (без vision)."""
    user_msg = (
        f"Имя файла: «{file_name}»\n\n"
        f"Содержимое таблицы (Excel):\n```\n{text[:5000]}\n```\n\n"
        "Найди ИТОГОВУЮ сумму к оплате, дату и контрагента. Верни JSON."
    )
    # 1. YandexGPT
    if yandex_key and yandex_folder:
        try:
            return yandex_gpt_analyze(text, file_name, yandex_key, yandex_folder)
        except Exception:
            pass
    # 2. DeepSeek
    if deepseek_key:
        try:
            payload = {
                "model": "deepseek-chat",
                "messages": [
                    {"role": "system", "content": ANALYSIS_PROMPT},
                    {"role": "user", "content": user_msg},
                ],
                "max_tokens": 500, "temperature": 0.05,
                "response_format": {"type": "json_object"},
            }
            req = urllib.request.Request("https://api.deepseek.com/v1/chat/completions",
                                          data=json.dumps(payload).encode(),
                                          headers={"Content-Type": "application/json",
                                                   "Authorization": f"Bearer {deepseek_key}"},
                                          method="POST")
            with urllib.request.urlopen(req, timeout=30) as r:
                resp = json.loads(r.read().decode())
            return parse_json(resp["choices"][0]["message"]["content"])
        except Exception:
            pass
    # 3. Gemini
    if gemini_key:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={gemini_key}"
            payload = {
                "contents": [{"parts": [{"text": ANALYSIS_PROMPT + "\n\n" + user_msg}]}],
                "generationConfig": {"temperature": 0.05, "maxOutputTokens": 500, "responseMimeType": "application/json"},
            }
            req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                          headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=45) as r:
                resp = json.loads(r.read().decode())
            return parse_json(resp["candidates"][0]["content"]["parts"][0]["text"])
        except Exception:
            pass
    return {}


def preprocess(b64: str) -> tuple:
    try:
        from PIL import Image, ImageEnhance, ImageFilter
        img = Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")
        img = img.filter(ImageFilter.SHARPEN)
        img = ImageEnhance.Contrast(img).enhance(1.2)
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=90)
        return base64.b64encode(buf.getvalue()).decode(), "image/jpeg"
    except Exception:
        return b64, "image/jpeg"


# ── Handler ───────────────────────────────────────────────────────────────

def handler(event: dict, context) -> dict:
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}
    if event.get("httpMethod") != "POST":
        return {"statusCode": 405, "headers": CORS, "body": json.dumps({"error": "Method not allowed"})}

    conn = get_conn()
    try:
        deepseek_key, gemini_key, yandex_key, yandex_folder = get_keys(conn)
        body = json.loads(event.get("body") or "{}")
        images_list = body.get("images", [])
        image_b64 = body.get("image_b64", "")
        excel_b64 = body.get("excel_b64", "")
        mime_type = body.get("mime_type", "image/jpeg")
        file_name = body.get("file_name", "document")
        doc_id = body.get("doc_id")
        auto_create_tx = body.get("auto_create_tx", True)

        if not yandex_key and not gemini_key and not deepseek_key:
            return {"statusCode": 400, "headers": CORS,
                    "body": json.dumps({"error": "Яндекс API ключ не добавлен. Зайдите в Настройки и добавьте ключ."}, ensure_ascii=False)}

        fields = {}
        provider_used = "none"
        error_details = []

        # ── Excel ветка ───────────────────────────────────────
        if excel_b64:
            try:
                text = extract_excel_text(excel_b64, file_name)
                fields = analyze_text_with_ai(text, file_name, deepseek_key, yandex_key, yandex_folder, gemini_key)
                provider_used = "excel-ai"
            except Exception as e:
                error_details.append(f"Excel: {e}")
                fields = {"doc_type": "Таблица Excel", "category": "Прочее",
                          "comment": f"Не удалось прочитать файл: {e}"}

        # Подготавливаем список изображений
        if images_list:
            all_imgs = [{"b64": preprocess(i.get("b64", ""))[0], "mime": "image/jpeg"} for i in images_list[:5] if i.get("b64")]
        elif image_b64:
            pb, pm = preprocess(image_b64)
            all_imgs = [{"b64": pb, "mime": pm}]
        else:
            all_imgs = []

        # 1. Яндекс Vision + YandexGPT (основной)
        yandex_auth_failed = False
        if yandex_key and yandex_folder and all_imgs:
            try:
                fields = call_yandex(all_imgs, file_name, yandex_key, yandex_folder)
                provider_used = "yandex"
            except Exception as e:
                err_str = str(e)
                error_details.append(f"Yandex: {err_str}")
                if "401" in err_str:
                    yandex_auth_failed = True

        # Если Яндекс — единственный ключ и он не прошёл аутентификацию — сразу ошибка
        if yandex_auth_failed and not gemini_key and not deepseek_key:
            return {"statusCode": 400, "headers": CORS,
                    "body": json.dumps({"error": "Яндекс API ключ недействителен (401). Проверьте ключ в Настройках → Нейросеть."}, ensure_ascii=False)}

        # 2. Gemini Flash (запасной с vision)
        if not fields.get("doc_type") and gemini_key and all_imgs:
            try:
                if len(all_imgs) > 1:
                    fields = call_gemini_multi(all_imgs, file_name, gemini_key)
                else:
                    fields = call_gemini_vision(all_imgs[0]["b64"], all_imgs[0]["mime"], gemini_key)
                provider_used = "gemini"
            except Exception as e:
                error_details.append(f"Gemini: {e}")

        # 3. DeepSeek text (последний fallback)
        if not fields.get("doc_type"):
            if yandex_auth_failed:
                return {"statusCode": 400, "headers": CORS,
                        "body": json.dumps({"error": "Яндекс API ключ недействителен (401). Обновите ключ в Настройках → Нейросеть."}, ensure_ascii=False)}
            fields = call_deepseek_text(file_name, deepseek_key)
            provider_used = "deepseek-text"

        amount = clean_amount(fields.get("amount"))
        # Если ИИ не нашёл сумму — пробуем сами вытащить её регуляркой из OCR-текста
        ocr_text = fields.get("_ocr_text", "")
        ai_amount_raw = fields.get("amount")
        print(f"[recognize-doc] provider={provider_used} ai_amount={ai_amount_raw} ocr_len={len(ocr_text)}")
        if ocr_text:
            print(f"[recognize-doc] OCR_TEXT:\n{ocr_text[:2000]}")
        if not amount and ocr_text:
            heuristic_amount = find_total_in_text(ocr_text)
            print(f"[recognize-doc] heuristic_amount={heuristic_amount}")
            if heuristic_amount:
                amount = heuristic_amount
                provider_used = f"{provider_used}+regex"
        tx_date, date_found = normalize_date(fields.get("date"))
        # Тип документа: подсказываем по OCR-тексту
        doc_type = detect_doc_type(ocr_text, fields.get("doc_type") or "")
        # Категория: используем расширенный apply_rules с анализом текста
        category = apply_rules(doc_type, fields.get("category") or "", ocr_text)
        comment = fields.get("comment") or fields.get("description") or ""
        counterparty = fields.get("counterparty")
        inn = fields.get("inn")
        tx_type = fields.get("type", "expense")

        cur = conn.cursor()
        if doc_id:
            amt_str = f"₽ {amount:,.0f}".replace(",", " ") if amount else None
            cur.execute(f"""UPDATE {SCHEMA}.documents
                SET status='done', rec_type=%s, rec_amount=%s, rec_date=%s, rec_counterparty=%s, rec_inn=%s
                WHERE id=%s""", (doc_type, amt_str, tx_date if date_found else None, counterparty, inn, doc_id))

        tx_id = None
        if auto_create_tx and amount:
            sign = -1 if tx_type == "expense" else 1
            desc = comment or f"{doc_type}: {counterparty or file_name}"
            cur.execute(f"""INSERT INTO {SCHEMA}.transactions
                    (date, description, category, amount, status, is_taxable, document_id)
                VALUES (%s,%s,%s,%s,'Выполнено',TRUE,%s) RETURNING id""",
                        (tx_date, desc[:500], category, amount * sign, doc_id))
            row = cur.fetchone()
            if row:
                tx_id = row[0]

        conn.commit()
        cur.close()

        return {"statusCode": 200, "headers": CORS,
                "body": json.dumps({
                    "doc_type": doc_type, "counterparty": counterparty, "inn": inn,
                    "date": tx_date if date_found else None,
                    "amount": amount,
                    "amount_str": f"₽ {amount:,.0f}".replace(",", " ") if amount else None,
                    "description": comment, "category": category, "type": tx_type,
                    "transaction_id": tx_id, "date_found": date_found, "provider": provider_used,
                }, ensure_ascii=False, default=str)}

    except Exception as ex:
        return {"statusCode": 200, "headers": CORS,
                "body": json.dumps({"error": str(ex)}, ensure_ascii=False)}
    finally:
        conn.close()