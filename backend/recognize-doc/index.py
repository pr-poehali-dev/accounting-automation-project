"""
ИИ-распознавание документов (накладные, счета, чеки, договоры).
POST / — принимает base64-изображение или текст, возвращает структурированные поля.
Использует DeepSeek API (vision или text).
"""
import json
import os
import base64
import urllib.request
import urllib.error
import psycopg2

SCHEMA = os.environ.get("MAIN_DB_SCHEMA", "t_p79040548_accounting_automatio")
CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
}

SYSTEM_PROMPT = """Ты финансовый ИИ для распознавания документов.
Тебе присылают фото или скан финансового документа (накладная, счёт-фактура, чек, договор, акт).
Извлеки структурированные данные и верни ТОЛЬКО JSON без лишнего текста.

Формат ответа:
{
  "doc_type": "тип документа (Счёт-фактура / Накладная / Чек / Договор / Акт / Документ)",
  "counterparty": "название контрагента / продавца / поставщика",
  "inn": "ИНН контрагента если есть, иначе null",
  "date": "дата документа в формате ДД.ММ.ГГГГ, если найдена",
  "amount": "итоговая сумма числом без пробелов и символов (только цифры и точка), например 48500.00",
  "description": "краткое описание: что куплено/оплачено (1-2 предложения)",
  "category": "категория расхода из списка: Услуги / Аренда / Зарплаты / Оборудование / Маркетинг / Логистика / Прочее"
}

Если какое-то поле не удаётся определить — поставь null.
Отвечай ТОЛЬКО JSON, никакого другого текста."""


def get_api_key():
    # Сначала из переменной окружения (секрет платформы)
    key = os.environ.get("DEEPSEEK_API_KEY", "")
    if key:
        return key
    # Затем из БД (сохранённый вручную)
    try:
        conn = psycopg2.connect(os.environ["DATABASE_URL"])
        cur = conn.cursor()
        cur.execute(f"SELECT api_key FROM {SCHEMA}.ai_settings WHERE id = 1")
        row = cur.fetchone()
        cur.close()
        conn.close()
        return (row[0] or "") if row else ""
    except Exception:
        return ""


def call_deepseek_vision(image_b64: str, mime_type: str, api_key: str) -> str:
    """Вызов DeepSeek с изображением через chat completions."""
    payload = {
        "model": "deepseek-chat",
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime_type};base64,{image_b64}"},
                    },
                    {"type": "text", "text": "Распознай этот финансовый документ и верни JSON."},
                ],
            },
        ],
        "max_tokens": 512,
        "temperature": 0.1,
    }
    req = urllib.request.Request(
        "https://api.deepseek.com/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))["choices"][0]["message"]["content"]


def call_deepseek_text(description: str, api_key: str) -> str:
    """Вызов DeepSeek только с текстовым описанием (fallback для PDF)."""
    payload = {
        "model": "deepseek-chat",
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Распознай документ по описанию имени файла: {description}. Если имя файла не даёт информации — заполни поля значениями null кроме doc_type=Документ."},
        ],
        "max_tokens": 512,
        "temperature": 0.1,
    }
    req = urllib.request.Request(
        "https://api.deepseek.com/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))["choices"][0]["message"]["content"]


def parse_ai_response(text: str) -> dict:
    """Парсим JSON из ответа ИИ, игнорируя лишний текст вокруг."""
    text = text.strip()
    # Найдём JSON-блок
    start = text.find("{")
    end = text.rfind("}") + 1
    if start >= 0 and end > start:
        try:
            return json.loads(text[start:end])
        except Exception:
            pass
    return {}


def handler(event: dict, context) -> dict:
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    if event.get("httpMethod") != "POST":
        return {"statusCode": 405, "headers": CORS, "body": json.dumps({"error": "Method not allowed"})}

    api_key = get_api_key()
    if not api_key:
        return {
            "statusCode": 400,
            "headers": CORS,
            "body": json.dumps({
                "error": "API ключ не настроен. Добавьте DEEPSEEK_API_KEY в Настройки → API Ключ."
            }, ensure_ascii=False),
        }

    body = json.loads(event.get("body") or "{}")
    image_b64 = body.get("image_b64", "")   # base64 строка изображения
    mime_type = body.get("mime_type", "image/jpeg")  # image/jpeg, image/png
    file_name = body.get("file_name", "document")

    try:
        if image_b64:
            raw = call_deepseek_vision(image_b64, mime_type, api_key)
        else:
            raw = call_deepseek_text(file_name, api_key)

        fields = parse_ai_response(raw)

        # Normalize amount — убираем всё кроме цифр и точки
        amount_raw = str(fields.get("amount") or "")
        amount_clean = "".join(c for c in amount_raw if c.isdigit() or c == ".")
        amount_float = None
        if amount_clean:
            try:
                amount_float = float(amount_clean)
            except Exception:
                pass

        result = {
            "doc_type": fields.get("doc_type") or "Документ",
            "counterparty": fields.get("counterparty"),
            "inn": fields.get("inn"),
            "date": fields.get("date"),
            "amount": amount_float,
            "amount_str": f"₽ {amount_float:,.0f}".replace(",", " ") if amount_float else None,
            "description": fields.get("description"),
            "category": fields.get("category") or "Прочее",
            "raw": raw,
        }

        return {
            "statusCode": 200,
            "headers": CORS,
            "body": json.dumps(result, ensure_ascii=False, default=str),
        }

    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")
        return {
            "statusCode": e.code,
            "headers": CORS,
            "body": json.dumps({"error": f"DeepSeek API ошибка {e.code}", "detail": err[:300]}, ensure_ascii=False),
        }
    except Exception as ex:
        return {
            "statusCode": 500,
            "headers": CORS,
            "body": json.dumps({"error": str(ex)}, ensure_ascii=False),
        }
