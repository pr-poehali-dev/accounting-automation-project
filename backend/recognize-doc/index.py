"""
ИИ-распознавание документов (накладные, счета, чеки, договоры).
POST / — принимает base64-изображение, выполняет OCR, передаёт текст в DeepSeek.
Авто-создаёт транзакцию в БД.
"""
import json
import os
import base64
import re
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

SYSTEM_PROMPT = """Ты финансовый ИИ-бухгалтер для ИП России. Тебе даётся текст, извлечённый из фото/скана финансового документа (накладная, чек, счёт).

ПРАВИЛА ОПРЕДЕЛЕНИЯ СТАТЬИ ЗАТРАТ (category):
- Номенклатура, товары, позиции ТМЦ, складские позиции → "Закупка товара"
- АЗС, топливо, бензин АИ-92/95, ДТ, солярка → "ГСМ"
- Юридические, бухгалтерские, консультационные услуги → "Бухгалтерские услуги"
- Офис, склад, помещение, аренда → "Аренда"
- Зарплата, выплата сотрудникам → "Зарплаты"
- Реклама, маркетинг, продвижение → "Маркетинг"
- Доставка, транспорт, логистика → "Логистика"
- Оборудование, техника, инструмент → "Оборудование"
- Иначе — сформулируй сам (1-3 слова)

ВАЖНО ПО СУММЕ:
- Ищи строки "Итого", "Всего", "ИТОГО", "Сумма", "К оплате", "на сумму"
- Сумма может быть записана как "28 132,00" или "28132.00" или "28 132.00" — убери пробелы, замени запятую на точку
- Верни только число, например: 28132.00

Верни СТРОГО только JSON:
{
  "amount": 28132.00,
  "date": "2026-05-21",
  "category": "Закупка товара",
  "comment": "Накладная ТАМ000 — 21 наименование товара",
  "doc_type": "Накладная",
  "counterparty": "ООО Поставщик",
  "inn": null,
  "type": "expense"
}

Поля:
- amount: число с точкой, БЕЗ пробелов и символов. null если не найдено
- date: YYYY-MM-DD. null если не найдено
- category: по правилам выше
- comment: что куплено/оплачено (1-2 предложения)
- doc_type: Чек / Накладная / Счёт-фактура / Акт / Договор / Документ
- counterparty: продавец/поставщик или null
- inn: ИНН или null
- type: "expense" или "income"

ТОЛЬКО JSON, никакого другого текста!"""


def get_api_key(conn):
    key = os.environ.get("DEEPSEEK_API_KEY", "")
    if key:
        return key
    cur = conn.cursor()
    cur.execute(f"SELECT api_key FROM {SCHEMA}.ai_settings WHERE id = 1")
    row = cur.fetchone()
    cur.close()
    return (row[0] or "") if row else ""


def extract_text_from_image(image_b64: str) -> str:
    """OCR через pytesseract."""
    try:
        import pytesseract
        from PIL import Image
        import io
        img_bytes = base64.b64decode(image_b64)
        img = Image.open(io.BytesIO(img_bytes))
        # Увеличиваем контрастность для лучшего OCR
        img = img.convert("L")  # grayscale
        text = pytesseract.image_to_string(img, lang="rus+eng", config="--psm 6")
        return text.strip()
    except Exception as e:
        return f"[OCR недоступен: {e}]"


def _post_deepseek(messages: list, api_key: str, timeout: int = 55) -> str:
    payload = {
        "model": "deepseek-chat",
        "messages": messages,
        "max_tokens": 700,
        "temperature": 0.05,
        "response_format": {"type": "json_object"},
    }
    req = urllib.request.Request(
        "https://api.deepseek.com/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = json.loads(r.read().decode("utf-8"))
        return data["choices"][0]["message"]["content"]


def call_ai(image_b64: str, mime_type: str, file_name: str, api_key: str) -> str:
    """OCR → DeepSeek text."""
    if image_b64:
        ocr_text = extract_text_from_image(image_b64)
        user_content = (
            f"Имя файла: «{file_name}»\n\n"
            f"Текст распознан из изображения (OCR):\n```\n{ocr_text[:3000]}\n```\n\n"
            "Проанализируй и верни JSON."
        )
    else:
        user_content = (
            f"Имя файла документа: «{file_name}».\n"
            "Определи тип документа по имени файла. Числовые поля — null."
        )

    return _post_deepseek([
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ], api_key)


def parse_response(text: str) -> dict:
    text = text.strip()
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


def clean_amount(raw) -> float | None:
    """Парсит сумму: '28 132,00' → 28132.0, '28132.00' → 28132.0"""
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return float(raw) if raw > 0 else None
    s = str(raw).strip()
    # Убираем валютные символы и лишние слова
    s = re.sub(r"[₽руб\.RUBrub\s]", " ", s, flags=re.IGNORECASE)
    s = s.strip()
    # Формат: 28 132,00 или 28 132.00 — пробел как разделитель тысяч
    # Если есть и пробел и запятая/точка — убираем пробелы, меняем запятую на точку
    if re.match(r"^\d[\d\s]*[,\.]\d{2}$", s):
        s = s.replace(" ", "").replace(",", ".")
    else:
        # Просто убираем всё кроме цифр, точки, запятой
        s = re.sub(r"[^\d,\.]", "", s)
        # Если запятая — десятичный разделитель (последняя)
        if s.count(",") == 1 and s.count(".") == 0:
            s = s.replace(",", ".")
        elif s.count(",") >= 1:
            # Запятая как разделитель тысяч: 28,132.00 → убираем запятые
            s = s.replace(",", "")
    if not s:
        return None
    try:
        val = float(s)
        return val if val > 0 else None
    except Exception:
        return None


def normalize_date(raw: str | None) -> tuple[str, bool]:
    """Возвращает (iso_date, was_found)."""
    today = str(date_cls.today())
    if not raw:
        return today, False
    raw = str(raw).strip()
    # уже ISO
    if re.match(r"^\d{4}-\d{2}-\d{2}$", raw):
        return raw, True
    # ДД.ММ.ГГГГ
    m = re.match(r"^(\d{2})\.(\d{2})\.(\d{4})$", raw)
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}", True
    # ДД.ММ.ГГ
    m = re.match(r"^(\d{2})\.(\d{2})\.(\d{2})$", raw)
    if m:
        year = f"20{m.group(3)}"
        return f"{year}-{m.group(2)}-{m.group(1)}", True
    # ГГГГ.ММ.ДД
    m = re.match(r"^(\d{4})\.(\d{2})\.(\d{2})$", raw)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}", True
    return today, False


def handler(event: dict, context) -> dict:
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    if event.get("httpMethod") != "POST":
        return {"statusCode": 405, "headers": CORS,
                "body": json.dumps({"error": "Method not allowed"})}

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        api_key = get_api_key(conn)
        if not api_key:
            return {
                "statusCode": 400, "headers": CORS,
                "body": json.dumps({"error": "API ключ не настроен. Добавьте ключ DeepSeek в Настройки → Нейросеть."}, ensure_ascii=False),
            }

        body = json.loads(event.get("body") or "{}")
        image_b64 = body.get("image_b64", "")
        mime_type = body.get("mime_type", "image/jpeg")
        file_name = body.get("file_name", "document")
        doc_id = body.get("doc_id")
        auto_create_tx = body.get("auto_create_tx", True)

        raw = call_ai(image_b64, mime_type, file_name, api_key)
        fields = parse_response(raw)

        amount = clean_amount(fields.get("amount"))
        tx_date, date_found = normalize_date(fields.get("date"))
        category = fields.get("category") or "Прочее"
        comment = fields.get("comment") or fields.get("description") or ""
        doc_type = fields.get("doc_type") or "Документ"
        counterparty = fields.get("counterparty")
        inn = fields.get("inn")
        tx_type = fields.get("type", "expense")

        cur = conn.cursor()

        # Обновляем документ
        if doc_id:
            amt_str = None
            if amount:
                amt_str = f"₽ {amount:,.0f}".replace(",", " ")
            cur.execute(f"""
                UPDATE {SCHEMA}.documents
                SET status='done', rec_type=%s, rec_amount=%s, rec_date=%s,
                    rec_counterparty=%s, rec_inn=%s
                WHERE id=%s
            """, (doc_type, amt_str, tx_date if date_found else None, counterparty, inn, doc_id))

        # Авто-создаём транзакцию
        tx_id = None
        if auto_create_tx and amount:
            sign = -1 if tx_type == "expense" else 1
            tx_amount = amount * sign
            desc = comment or f"{doc_type}: {counterparty or file_name}"
            cur.execute(f"""
                INSERT INTO {SCHEMA}.transactions
                    (date, description, category, amount, status, is_taxable, document_id)
                VALUES (%s, %s, %s, %s, 'Выполнено', TRUE, %s)
                RETURNING id
            """, (tx_date, desc[:500], category, tx_amount, doc_id))
            row = cur.fetchone()
            if row:
                tx_id = row[0]

        conn.commit()
        cur.close()

        result = {
            "doc_type": doc_type,
            "counterparty": counterparty,
            "inn": inn,
            "date": tx_date if date_found else None,
            "amount": amount,
            "amount_str": f"₽ {amount:,.0f}".replace(",", " ") if amount else None,
            "description": comment,
            "category": category,
            "type": tx_type,
            "transaction_id": tx_id,
            "date_found": date_found,
        }

        return {
            "statusCode": 200, "headers": CORS,
            "body": json.dumps(result, ensure_ascii=False, default=str),
        }

    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        msg = f"DeepSeek API ошибка {e.code}"
        try:
            err_json = json.loads(err_body)
            msg = err_json.get("error", {}).get("message", msg)
        except Exception:
            pass
        return {"statusCode": 200, "headers": CORS,
                "body": json.dumps({"error": msg, "detail": err_body[:300]}, ensure_ascii=False)}
    except Exception as ex:
        return {"statusCode": 200, "headers": CORS,
                "body": json.dumps({"error": str(ex)}, ensure_ascii=False)}
    finally:
        conn.close()
