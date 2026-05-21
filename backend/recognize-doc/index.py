"""
ИИ-распознавание документов.
POST / — принимает base64-изображение, отправляет напрямую в DeepSeek Vision,
авто-создаёт транзакцию в БД.
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

# Правила маппинга типа → категория (постфактум, если ИИ ошибся)
DOC_TYPE_CATEGORY_MAP = {
    "накладная": "Закупка товара",
    "товарная накладная": "Закупка товара",
    "торг-12": "Закупка товара",
    "упд": "Закупка товара",
    "счёт-фактура": "Закупка товара",
    "счет-фактура": "Закупка товара",
    "чек азс": "ГСМ",
    "чек заправки": "ГСМ",
    "акт": "Бухгалтерские услуги",
    "договор аренды": "Аренда",
}

SYSTEM_PROMPT = """Ты финансовый ИИ-бухгалтер для ИП России. Анализируешь фото/скан документа.

ПРАВИЛА ОПРЕДЕЛЕНИЯ СТАТЬИ ЗАТРАТ (category):
- Есть список товаров/номенклатуры/позиций ТМЦ → "Закупка товара"
- АЗС, топливо, бензин АИ-92/95, ДТ, солярка → "ГСМ"
- Юридические, бухгалтерские, консультационные услуги → "Бухгалтерские услуги"
- Офис, склад, помещение, аренда → "Аренда"
- Зарплата, выплата сотрудникам → "Зарплаты"
- Реклама, маркетинг, продвижение → "Маркетинг"
- Доставка, транспорт, логистика → "Логистика"
- Оборудование, техника, инструмент → "Оборудование"
- Иначе — краткое название (1-3 слова)

ПРАВИЛА ДЛЯ ТИПА ДОКУМЕНТА (doc_type):
- Если видишь таблицу с номенклатурой товаров, наименованиями, ценами → "Накладная"
- Если документ содержит слова "накладная", "ТОРГ", "ТМЦ" → "Накладная"
- Если это чек с кассовым аппаратом, ФФД → "Чек"
- Если это счёт-фактура, УПД → "Счёт-фактура"
- Если это акт выполненных работ/услуг → "Акт"

КРИТИЧЕСКИ ВАЖНО ДЛЯ СУММЫ:
- Ищи строки "Итого", "Всего", "ИТОГО", "Сумма", "К оплате", "на сумму", "ИТОГО:"
- Число может быть написано: "28 132,00" или "28132.00" или "28 132.00"
- Убери пробелы внутри числа, замени запятую на точку → верни 28132.00
- Если сумма не найдена, опиши что видишь в поле comment

Верни СТРОГО только JSON:
{
  "amount": 28132.00,
  "date": "2026-05-21",
  "category": "Закупка товара",
  "comment": "Накладная ТАМ000 — 21 наименование товара, итого 28132 руб",
  "doc_type": "Накладная",
  "counterparty": "ООО Поставщик",
  "inn": null,
  "type": "expense"
}

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


def preprocess_image(image_b64: str, target_size: int = 1600) -> tuple[str, str]:
    """Улучшает качество изображения для распознавания."""
    try:
        from PIL import Image, ImageEnhance, ImageFilter
        img_bytes = base64.b64decode(image_b64)
        img = Image.open(io.BytesIO(img_bytes))

        # Конвертируем в RGB если нужно
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")

        # Масштабируем до нужного размера (увеличиваем мелкий текст)
        w, h = img.size
        if max(w, h) < target_size:
            scale = target_size / max(w, h)
            img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)

        # Повышаем резкость и контрастность
        img = img.filter(ImageFilter.SHARPEN)
        img = ImageEnhance.Contrast(img).enhance(1.3)
        img = ImageEnhance.Sharpness(img).enhance(1.5)

        # Сжимаем обратно
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=88, optimize=True)
        result_b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        return result_b64, "image/jpeg"
    except Exception:
        return image_b64, "image/jpeg"


def call_deepseek_vision(image_b64: str, mime: str, api_key: str) -> str:
    """Отправляет изображение напрямую в DeepSeek Vision (deepseek-vl2 или compatible)."""
    # DeepSeek не поддерживает vision в deepseek-chat, пробуем через openrouter-совместимый
    # или через прямой base64 URL
    data_url = f"data:{mime};base64,{image_b64}"

    payload = {
        "model": "deepseek-chat",
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": data_url, "detail": "high"},
                    },
                    {
                        "type": "text",
                        "text": (
                            "Внимательно изучи этот финансовый документ.\n"
                            "Найди ИТОГОВУЮ сумму (строка Итого/Всего/К оплате).\n"
                            "Определи тип документа (накладная/чек/счёт и т.д.).\n"
                            "Верни JSON."
                        ),
                    },
                ],
            },
        ],
        "max_tokens": 800,
        "temperature": 0.05,
    }
    req = urllib.request.Request(
        "https://api.deepseek.com/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=55) as r:
        resp = json.loads(r.read().decode("utf-8"))
        return resp["choices"][0]["message"]["content"]


def call_deepseek_text_with_desc(image_b64: str, file_name: str, api_key: str) -> str:
    """Fallback: просим ИИ угадать по имени файла если vision не прошёл."""
    payload = {
        "model": "deepseek-chat",
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    f"Имя файла: «{file_name}».\n"
                    "По имени файла определи тип документа и категорию. "
                    "amount, date, counterparty, inn — null. "
                    "comment: «Документ не распознан — введите сумму вручную»."
                ),
            },
        ],
        "max_tokens": 400,
        "temperature": 0.05,
        "response_format": {"type": "json_object"},
    }
    req = urllib.request.Request(
        "https://api.deepseek.com/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        resp = json.loads(r.read().decode("utf-8"))
        return resp["choices"][0]["message"]["content"]


def call_ai_multi(images: list, file_name: str, api_key: str) -> str:
    """Несколько страниц: vision для каждой, объединяем результаты."""
    results = []
    for idx, img in enumerate(images[:5]):  # не более 5 страниц
        b64 = img.get("b64", "")
        mime = img.get("mime", "image/jpeg")
        if not b64:
            continue
        b64_proc, mime_proc = preprocess_image(b64, 1600)
        try:
            raw = call_deepseek_vision(b64_proc, mime_proc, api_key)
            parsed = parse_response(raw)
            results.append(parsed)
        except Exception:
            continue

    if not results:
        return call_deepseek_text_with_desc("", file_name, api_key)

    # Берём первую страницу как основу
    merged = results[0]

    # Если сумма не найдена на первой — ищем на остальных
    if not merged.get("amount"):
        for r in results[1:]:
            if r.get("amount"):
                merged["amount"] = r["amount"]
                break

    # Если тип не определён — берём из любой страницы где определён
    if merged.get("doc_type") in (None, "Документ", ""):
        for r in results[1:]:
            if r.get("doc_type") and r["doc_type"] != "Документ":
                merged["doc_type"] = r["doc_type"]
                break

    return json.dumps(merged, ensure_ascii=False)


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


def apply_category_rules(doc_type: str, category: str) -> str:
    """Если категория 'Прочее' — применяем правила по типу документа."""
    if category and category not in ("Прочее", "", None):
        return category
    dt = (doc_type or "").lower().strip()
    for key, cat in DOC_TYPE_CATEGORY_MAP.items():
        if key in dt:
            return cat
    # Если это накладная — всегда Закупка товара
    if "наклад" in dt or "торг" in dt or "упд" in dt or "тмц" in dt:
        return "Закупка товара"
    if "чек" in dt and ("азс" in dt or "запр" in dt or "бенз" in dt):
        return "ГСМ"
    return category or "Прочее"


def clean_amount(raw) -> float | None:
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return float(raw) if raw > 0 else None
    s = str(raw).strip()
    # Убираем валюту и слова
    s = re.sub(r"[₽руб\.RUBrub]", "", s, flags=re.IGNORECASE).strip()
    # Формат: 28 132,00 — пробел как разделитель тысяч
    if re.match(r"^\d[\d\s]*[,\.]\d{2}$", s):
        s = s.replace(" ", "").replace(",", ".")
    else:
        s = re.sub(r"[^\d,\.]", "", s)
        if s.count(",") == 1 and s.count(".") == 0:
            s = s.replace(",", ".")
        elif s.count(",") >= 1 and "." not in s:
            # 28,132 — американский формат
            s = s.replace(",", "")
        elif s.count(",") >= 1:
            s = s.replace(",", "")
    if not s:
        return None
    try:
        val = float(s)
        return val if val > 0 else None
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
        images_list = body.get("images", [])
        file_name = body.get("file_name", "document")
        doc_id = body.get("doc_id")
        auto_create_tx = body.get("auto_create_tx", True)

        # Мультистраничный режим
        if images_list:
            raw = call_ai_multi(images_list, file_name, api_key)
            fields = parse_response(raw)
        else:
            image_b64 = body.get("image_b64", "")
            mime_type = body.get("mime_type", "image/jpeg")

            if image_b64:
                # Улучшаем качество изображения
                proc_b64, proc_mime = preprocess_image(image_b64, 1600)
                try:
                    raw = call_deepseek_vision(proc_b64, proc_mime, api_key)
                    fields = parse_response(raw)
                except urllib.error.HTTPError as e:
                    # Vision не поддерживается — fallback
                    err_b = e.read().decode("utf-8", errors="replace")
                    if e.code in (400, 422, 415):
                        raw = call_deepseek_text_with_desc(image_b64, file_name, api_key)
                        fields = parse_response(raw)
                        fields["_vision_failed"] = True
                    else:
                        raise
            else:
                raw = call_deepseek_text_with_desc("", file_name, api_key)
                fields = parse_response(raw)

        amount = clean_amount(fields.get("amount"))
        tx_date, date_found = normalize_date(fields.get("date"))
        doc_type = fields.get("doc_type") or "Документ"
        raw_category = fields.get("category") or "Прочее"

        # Применяем правило: если тип накладная → Закупка товара, если Прочее
        category = apply_category_rules(doc_type, raw_category)
        comment = fields.get("comment") or fields.get("description") or ""
        counterparty = fields.get("counterparty")
        inn = fields.get("inn")
        tx_type = fields.get("type", "expense")

        cur = conn.cursor()

        if doc_id:
            amt_str = f"₽ {amount:,.0f}".replace(",", " ") if amount else None
            cur.execute(f"""
                UPDATE {SCHEMA}.documents
                SET status='done', rec_type=%s, rec_amount=%s, rec_date=%s,
                    rec_counterparty=%s, rec_inn=%s
                WHERE id=%s
            """, (doc_type, amt_str, tx_date if date_found else None, counterparty, inn, doc_id))

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

        return {
            "statusCode": 200, "headers": CORS,
            "body": json.dumps({
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
                "vision_failed": fields.get("_vision_failed", False),
            }, ensure_ascii=False, default=str),
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
                "body": json.dumps({"error": msg}, ensure_ascii=False)}
    except Exception as ex:
        return {"statusCode": 200, "headers": CORS,
                "body": json.dumps({"error": str(ex)}, ensure_ascii=False)}
    finally:
        conn.close()
