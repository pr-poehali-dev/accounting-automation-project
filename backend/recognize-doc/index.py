"""
ИИ-распознавание документов.
Порядок: Gemini Flash (vision, бесплатный) → DeepSeek vision → DeepSeek текст.
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

ANALYSIS_PROMPT = """Ты финансовый ИИ-бухгалтер для ИП России. Смотришь на фото финансового документа.

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
- Таблица с наименованиями товаров, артикулами, ценами → "Накладная"
- Слова «накладная», «ТОРГ-12», «УПД», «ТМЦ» → "Накладная"
- Кассовый чек, ФФД, QR-код ФНС → "Чек"
- Счёт-фактура, УПД → "Счёт-фактура"
- Акт выполненных работ → "Акт"

ПРАВИЛА СУММЫ:
- Ищи строки «Итого», «Всего», «ИТОГО», «К оплате», «на сумму»
- «28 132,00» или «28 132.00» → верни 28132.00 (убери пробелы, замени запятую на точку)

Верни ТОЛЬКО JSON без лишнего текста:
{"amount":28132.00,"date":"2026-05-21","category":"Закупка товара","comment":"Накладная — 21 позиция товара","doc_type":"Накладная","counterparty":"ООО Поставщик","inn":null,"type":"expense"}"""

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
    cur.execute(f"SELECT api_key, gemini_api_key FROM {SCHEMA}.ai_settings WHERE id=1")
    row = cur.fetchone()
    cur.close()
    if not row:
        return "", ""
    deepseek_key = os.environ.get("DEEPSEEK_API_KEY", "") or (row[0] or "")
    gemini_key = os.environ.get("GEMINI_API_KEY", "") or (row[1] or "")
    return deepseek_key, gemini_key


def call_gemini_vision(image_b64: str, mime: str, gemini_key: str) -> dict:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={gemini_key}"
    payload = {
        "contents": [{"parts": [
            {"inline_data": {"mime_type": mime, "data": image_b64}},
            {"text": ANALYSIS_PROMPT + "\n\nПроанализируй документ на фото. Верни JSON."}
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


def call_deepseek_text(file_name: str, deepseek_key: str) -> dict:
    if not deepseek_key:
        return {"doc_type": "Документ", "category": "Прочее",
                "comment": "Добавьте Gemini API Key в Настройки → Нейросеть для распознавания фото"}
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


def apply_rules(doc_type: str, category: str) -> str:
    if category and category not in ("Прочее", "", None):
        return category
    dt = (doc_type or "").lower()
    for key, cat in TYPE_TO_CATEGORY.items():
        if key in dt:
            return cat
    if any(x in dt for x in ("наклад", "торг", "упд", "тмц")):
        return "Закупка товара"
    if "чек" in dt and any(x in dt for x in ("азс", "запр", "топлив", "бенз")):
        return "ГСМ"
    return category or "Прочее"


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


def preprocess(b64: str) -> tuple:
    try:
        from PIL import Image, ImageEnhance, ImageFilter
        img = Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")
        img = img.filter(ImageFilter.SHARPEN)
        img = ImageEnhance.Contrast(img).enhance(1.2)
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=88)
        return base64.b64encode(buf.getvalue()).decode(), "image/jpeg"
    except Exception:
        return b64, "image/jpeg"


def handler(event: dict, context) -> dict:
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}
    if event.get("httpMethod") != "POST":
        return {"statusCode": 405, "headers": CORS, "body": json.dumps({"error": "Method not allowed"})}

    conn = get_conn()
    try:
        deepseek_key, gemini_key = get_keys(conn)
        body = json.loads(event.get("body") or "{}")
        images_list = body.get("images", [])
        image_b64 = body.get("image_b64", "")
        mime_type = body.get("mime_type", "image/jpeg")
        file_name = body.get("file_name", "document")
        doc_id = body.get("doc_id")
        auto_create_tx = body.get("auto_create_tx", True)

        if not gemini_key and not deepseek_key:
            return {"statusCode": 400, "headers": CORS,
                    "body": json.dumps({"error": "Добавьте Gemini API Key в Настройки → Нейросеть (бесплатно на aistudio.google.com)"}, ensure_ascii=False)}

        fields = {}
        provider_used = "none"

        # 1. Gemini Flash Vision — основной
        if gemini_key:
            try:
                if images_list:
                    proc = [{"b64": preprocess(i.get("b64", ""))[0], "mime": "image/jpeg"} for i in images_list[:5]]
                    fields = call_gemini_multi(proc, file_name, gemini_key)
                elif image_b64:
                    pb, pm = preprocess(image_b64)
                    fields = call_gemini_vision(pb, pm, gemini_key)
                provider_used = "gemini"
            except Exception as e:
                fields = {"_gemini_error": str(e)}

        # 2. DeepSeek vision fallback
        if not fields.get("doc_type") and deepseek_key and image_b64:
            try:
                pb, pm = preprocess(image_b64)
                payload = {
                    "model": "deepseek-chat",
                    "messages": [
                        {"role": "system", "content": ANALYSIS_PROMPT},
                        {"role": "user", "content": [
                            {"type": "image_url", "image_url": {"url": f"data:{pm};base64,{pb}", "detail": "high"}},
                            {"type": "text", "text": "Верни JSON."},
                        ]},
                    ],
                    "max_tokens": 700, "temperature": 0.05,
                }
                req = urllib.request.Request("https://api.deepseek.com/v1/chat/completions",
                                              data=json.dumps(payload).encode(),
                                              headers={"Content-Type": "application/json", "Authorization": f"Bearer {deepseek_key}"},
                                              method="POST")
                with urllib.request.urlopen(req, timeout=50) as r:
                    resp = json.loads(r.read().decode())
                fields = parse_json(resp["choices"][0]["message"]["content"])
                provider_used = "deepseek-vision"
            except Exception:
                pass

        # 3. Text-only fallback
        if not fields.get("doc_type"):
            fields = call_deepseek_text(file_name, deepseek_key)
            provider_used = "deepseek-text"

        amount = clean_amount(fields.get("amount"))
        tx_date, date_found = normalize_date(fields.get("date"))
        doc_type = fields.get("doc_type") or "Документ"
        category = apply_rules(doc_type, fields.get("category") or "")
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
                VALUES (%s, %s, %s, %s, 'Выполнено', TRUE, %s) RETURNING id""",
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
