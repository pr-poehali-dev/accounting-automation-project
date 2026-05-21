"""
ИИ-распознавание документов (накладные, счета, чеки, договоры).
POST / — принимает base64-изображение, возвращает структурированные поля + авто-создаёт транзакцию.
Использует DeepSeek API. Для изображений — модель с vision (deepseek-chat с multimodal).
"""
import json
import os
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

SYSTEM_PROMPT = """Ты финансовый ИИ-бухгалтер для ИП. Анализируешь фото/скан финансового документа.

ПРАВИЛА ОПРЕДЕЛЕНИЯ СТАТЬИ ЗАТРАТ (category):
- Если в документе перечисляются товары, номенклатура, складские позиции, ТМЦ, комплектующие — category: "Закупка товара"
- Если это чек АЗС, заправки, топливо (АИ-92, АИ-95, ДТ, бензин, солярка) — category: "ГСМ"
- Если в акте указаны информационные, юридические, бухгалтерские, консультационные услуги — category: "Бухгалтерские услуги"
- Если это платёж за офис, склад, помещение, аренду — category: "Аренда"
- Если зарплата, выплата сотруднику — category: "Зарплаты"
- Если реклама, маркетинг, продвижение — category: "Маркетинг"
- Если доставка, транспорт, логистика, перевозка — category: "Логистика"
- Если оборудование, техника, инструмент — category: "Оборудование"
- Во всех остальных случаях — самостоятельно проанализируй контекст и дай лаконичное название (1-3 слова)

Верни СТРОГО только JSON без лишнего текста:
{
  "amount": 24500.00,
  "date": "2026-05-21",
  "category": "ГСМ",
  "comment": "Чек АЗС Роснефть, АИ-95 50 литров",
  "doc_type": "Чек",
  "counterparty": "АЗС Роснефть",
  "inn": null,
  "type": "expense"
}

Поля:
- amount: итоговая сумма числом (только цифры и точка), null если не найдена
- date: дата в формате YYYY-MM-DD, null если не найдена
- category: статья по правилам выше
- comment: краткое описание что куплено/оплачено (1-2 предложения)
- doc_type: Чек / Накладная / Счёт-фактура / Акт / Договор / Документ
- counterparty: название продавца/поставщика, null если не найдено
- inn: ИНН контрагента, null если не найден
- type: "expense" (расход) или "income" (доход)

Если поле не определить — null. ТОЛЬКО JSON, никакого другого текста!"""


def get_api_key(conn):
    key = os.environ.get("DEEPSEEK_API_KEY", "")
    if key:
        return key
    cur = conn.cursor()
    cur.execute(f"SELECT api_key FROM {SCHEMA}.ai_settings WHERE id = 1")
    row = cur.fetchone()
    cur.close()
    return (row[0] or "") if row else ""


def call_deepseek(image_b64: str, mime_type: str, file_name: str, api_key: str) -> str:
    """Вызов DeepSeek. Для изображений используем vision endpoint."""
    if image_b64:
        # Используем deepseek-chat с multimodal (vision)
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime_type};base64,{image_b64}"},
                    },
                    {"type": "text", "text": "Распознай этот финансовый документ. Верни JSON."},
                ],
            },
        ]
        model = "deepseek-chat"
    else:
        # Fallback для PDF — только по имени файла
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Имя файла: {file_name}. Заполни что можешь, остальное null. doc_type=Документ."},
        ]
        model = "deepseek-chat"

    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": 600,
        "temperature": 0.05,
        "response_format": {"type": "json_object"},
    }
    req = urllib.request.Request(
        "https://api.deepseek.com/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=45) as r:
        data = json.loads(r.read().decode("utf-8"))
        return data["choices"][0]["message"]["content"]


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
    s = str(raw or "")
    cleaned = "".join(c for c in s if c.isdigit() or c == ".")
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except Exception:
        return None


def handler(event: dict, context) -> dict:
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    if event.get("httpMethod") != "POST":
        return {"statusCode": 405, "headers": CORS, "body": json.dumps({"error": "Method not allowed"})}

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        api_key = get_api_key(conn)
        if not api_key:
            return {
                "statusCode": 400,
                "headers": CORS,
                "body": json.dumps({"error": "API ключ не настроен. Добавьте ключ DeepSeek в Настройки → Нейросеть."}, ensure_ascii=False),
            }

        body = json.loads(event.get("body") or "{}")
        image_b64 = body.get("image_b64", "")
        mime_type = body.get("mime_type", "image/jpeg")
        file_name = body.get("file_name", "document")
        doc_id = body.get("doc_id")           # если уже создан документ
        auto_create_tx = body.get("auto_create_tx", True)  # авто-создать транзакцию

        # Вызов ИИ
        raw = call_deepseek(image_b64, mime_type, file_name, api_key)
        fields = parse_response(raw)

        amount = clean_amount(fields.get("amount"))
        tx_date = fields.get("date") or str(date_cls.today())
        # Нормализуем дату — может прийти в формате ДД.ММ.ГГГГ
        if tx_date and "." in tx_date:
            parts = tx_date.split(".")
            if len(parts) == 3 and len(parts[2]) == 4:
                tx_date = f"{parts[2]}-{parts[1]}-{parts[0]}"
        category = fields.get("category") or "Прочее"
        comment = fields.get("comment") or fields.get("description") or ""
        doc_type = fields.get("doc_type") or "Документ"
        counterparty = fields.get("counterparty")
        inn = fields.get("inn")
        tx_type = fields.get("type", "expense")

        # Обновляем запись документа если есть doc_id
        cur = conn.cursor()
        if doc_id:
            cur.execute(f"""
                UPDATE {SCHEMA}.documents
                SET status='done', rec_type=%s, rec_amount=%s, rec_date=%s,
                    rec_counterparty=%s, rec_inn=%s
                WHERE id=%s
            """, (doc_type, str(amount) if amount else None, tx_date, counterparty, inn, doc_id))

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
            "date": tx_date if fields.get("date") else None,
            "amount": amount,
            "amount_str": f"₽ {amount:,.0f}".replace(",", " ") if amount else None,
            "description": comment,
            "category": category,
            "type": tx_type,
            "transaction_id": tx_id,
            "date_found": bool(fields.get("date")),
        }

        return {
            "statusCode": 200,
            "headers": CORS,
            "body": json.dumps(result, ensure_ascii=False, default=str),
        }

    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        # DeepSeek может вернуть ошибку если модель не поддерживает vision
        msg = f"DeepSeek API ошибка {e.code}"
        try:
            err_json = json.loads(err_body)
            msg = err_json.get("error", {}).get("message", msg)
        except Exception:
            pass
        return {"statusCode": 200, "headers": CORS, "body": json.dumps({"error": msg, "detail": err_body[:300]}, ensure_ascii=False)}
    except Exception as ex:
        return {"statusCode": 200, "headers": CORS, "body": json.dumps({"error": str(ex)}, ensure_ascii=False)}
    finally:
        conn.close()
