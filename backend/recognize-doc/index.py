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

ANALYSIS_PROMPT = """Ты финансовый ИИ-бухгалтер для ИП России. Тебе дан финансовый документ (накладная, чек, счёт) — текст или фото.
ТВОЯ ГЛАВНАЯ ЗАДАЧА — НАЙТИ ИТОГОВУЮ СУММУ и КОЛИЧЕСТВО ПОЗИЦИЙ.

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
1) ПЕРВЫМ ДЕЛОМ ищи строку «Итого выполнено», «Итого», «ИТОГО», «Всего к оплате», «К оплате», «Итого с НДС», «Всего», «на сумму», «ОПЛАТА», «Оплачено», «Стоимость услуг».
   Берёшь число РЯДОМ С ЭТИМ СЛОВОМ (справа или ниже). Это и есть amount.
2) Если есть сумма ПРОПИСЬЮ — например «Тринадцать тысяч пятьсот пятьдесят шесть рублей» — расшифруй её и используй как основной источник.
3) Формат чисел: «13 556,93» / «13556,93» / «13 556.93» — убери пробелы, замени запятую на точку → 13556.93.
4) НИКОГДА не возвращай null если в тексте есть хоть одно число с «Итого» или сумма прописью.
5) Если несколько «Итого» — ищи «Итого выполнено услуг», «Итого к оплате» — это приоритет перед просто «Итого».
6) Игнорируй НДС, цены отдельных позиций, количества (шт), артикулы (длинные коды).
7) НЕЛЬЗЯ суммировать числа из последней колонки самому — бери только из строки «Итого»/«Всего».
8) ВНИМАНИЕ — банковские чеки/квитанции: нужна СУММА ОПЕРАЦИИ, а НЕ комиссия банка.
   Комиссия банка («Комиссия за операцию», «Комиссия: X руб») — ИГНОРИРОВАТЬ.
9) ВНИМАНИЕ — транспортные акты, акты выдачи груза (СДЭК, Байкал, ПЭК и др.):
   Документ содержит поля «Объявленная ценность», «Страховой сбор», «НДС» — ЭТО НЕ СУММА ОПЛАТЫ!
   Нужна строка «Итого выполнено услуг на сумму» или «Стоимость доставки» или «Итого к оплате».
   «Объявленная ценность груза» (страховая стоимость товара) — ИГНОРИРОВАТЬ.
   Пример: «Итого выполнено услуг на сумму: 13 556,93» → amount=13556.93, а не 100000.

ПРАВИЛА КОЛИЧЕСТВА ПОЗИЦИЙ — КРИТИЧЕСКИ ВАЖНО:
1) Ищи фразу «Всего наименований N» или «Итого наименований N» — это точное число позиций.
2) Если такой фразы нет — посчитай количество пронумерованных строк в таблице товаров (1, 2, 3... последний номер).
3) Если документ многостраничный (несколько фото) — считай ОБЩЕЕ количество по всем страницам.
4) Номер последней строки в таблице = количество позиций. Не считай итоговые строки.

ПРАВИЛА ДАТЫ — КРИТИЧЕСКИ ВАЖНО:
1) Дата в российских документах всегда в формате ДД.ММ.ГГГГ (например 20.10.2025 = 20 октября 2025).
2) НИКОГДА не путай день и месяц! Первые два цифры — ДЕНЬ, следующие — МЕСЯЦ.
3) Примеры: «20.10.2025» → "2025-10-20", «05.03.2024» → "2024-03-05", «31.01.2025» → "2025-01-31".
4) Если дата написана словами: «20 октября 2025 г.» → "2025-10-20".
5) Верни дату в формате YYYY-MM-DD.

Верни ТОЛЬКО JSON без лишнего текста:
{"amount":30039.26,"date":"2025-10-20","category":"Закупка товара","comment":"Накладная — 52 позиции товара, итого 30 039 руб","doc_type":"Накладная","counterparty":"ИП Гришин Сергей Викторович","inn":null,"type":"expense"}"""

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
    cur.execute(f"""SELECT api_key, gemini_api_key, yandex_api_key, yandex_folder_id,
                          proxyapi_key, vision_provider
                   FROM {SCHEMA}.ai_settings WHERE id=1""")
    row = cur.fetchone()
    cur.close()
    deepseek_key = (row[0] if row else "") or os.environ.get("DEEPSEEK_API_KEY", "")
    gemini_key = (row[1] if row else "") or os.environ.get("GEMINI_API_KEY", "")
    yandex_key = (row[2] if row else "") or os.environ.get("YANDEX_API_KEY", "")
    yandex_folder = (row[3] if row else "") or os.environ.get("YANDEX_FOLDER_ID", "")
    proxyapi_key = (row[4] if row else "") or os.environ.get("PROXYAPI_KEY", "")
    vision_provider = (row[5] if row else "") or "proxyapi-gpt-4o"
    return deepseek_key, gemini_key, yandex_key, yandex_folder, proxyapi_key, vision_provider


# ── ProxyAPI Vision (OpenAI/Claude/Gemini через единый ключ) ─────────────

PROXYAPI_BASE = "https://api.proxyapi.ru"


def call_proxyapi_vision(images: list, file_name: str, proxyapi_key: str, vision_provider: str) -> dict:
    """Распознавание документа через ProxyAPI с поддержкой vision (multimodal)."""
    prompt_text = ANALYSIS_PROMPT + f"\n\nДокумент «{file_name}» ({len(images)} стр.). ВАЖНО: документ может быть многостраничным — все страницы уже приложены. Найди строку «Итого»/«Всего» (обычно в конце документа) и возьми сумму оттуда. Найди фразу «Всего наименований N» или подсчитай последний номер строки в таблице — это количество позиций. Верни JSON."

    if vision_provider.startswith("proxyapi-gpt") or vision_provider.startswith("proxyapi-gemini"):
        # OpenAI-совместимый формат (chat completions)
        if vision_provider.startswith("proxyapi-gpt"):
            model_map = {
                "proxyapi-gpt-4o": "gpt-4o",
                "proxyapi-gpt-4o-mini": "gpt-4o-mini",
                "proxyapi-gpt-4-turbo": "gpt-4-turbo",
            }
            real_model = model_map.get(vision_provider, "gpt-4o")
            url = f"{PROXYAPI_BASE}/openai/v1/chat/completions"
            content = [{"type": "text", "text": prompt_text}]
            for img in images[:5]:
                content.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:{img.get('mime', 'image/jpeg')};base64,{img['b64']}"}
                })
            payload = {
                "model": real_model,
                "messages": [{"role": "user", "content": content}],
                "max_tokens": 1000,
                "temperature": 0.05,
                "response_format": {"type": "json_object"},
            }
            headers = {"Content-Type": "application/json", "Authorization": f"Bearer {proxyapi_key}"}
        else:
            # Gemini через ProxyAPI
            model_map = {
                "proxyapi-gemini-1.5-pro": "gemini-1.5-pro",
                "proxyapi-gemini-2.0-flash": "gemini-2.0-flash",
            }
            real_model = model_map.get(vision_provider, "gemini-2.0-flash")
            url = f"{PROXYAPI_BASE}/google/v1beta/models/{real_model}:generateContent"
            parts = [{"text": prompt_text}]
            for img in images[:5]:
                parts.append({"inline_data": {"mime_type": img.get("mime", "image/jpeg"), "data": img["b64"]}})
            payload = {
                "contents": [{"parts": parts}],
                "generationConfig": {"temperature": 0.05, "maxOutputTokens": 1000, "responseMimeType": "application/json"},
            }
            headers = {"Content-Type": "application/json", "Authorization": f"Bearer {proxyapi_key}"}

    elif vision_provider.startswith("proxyapi-claude"):
        model_map = {
            "proxyapi-claude-3-5-sonnet": "claude-3-5-sonnet-20241022",
            "proxyapi-claude-3-haiku": "claude-3-haiku-20240307",
        }
        real_model = model_map.get(vision_provider, "claude-3-5-sonnet-20241022")
        url = f"{PROXYAPI_BASE}/anthropic/v1/messages"
        content = []
        for img in images[:5]:
            content.append({
                "type": "image",
                "source": {"type": "base64", "media_type": img.get("mime", "image/jpeg"), "data": img["b64"]}
            })
        content.append({"type": "text", "text": prompt_text})
        payload = {
            "model": real_model,
            "max_tokens": 1000,
            "messages": [{"role": "user", "content": content}],
        }
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {proxyapi_key}",
            "anthropic-version": "2023-06-01",
        }
    else:
        raise Exception(f"Unknown ProxyAPI vision provider: {vision_provider}")

    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            resp_data = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        body_err = e.read().decode("utf-8", errors="replace")
        raise Exception(f"ProxyAPI HTTP {e.code}: {body_err[:300]}")

    # Извлекаем текст в зависимости от провайдера
    if vision_provider.startswith("proxyapi-gpt"):
        text = resp_data["choices"][0]["message"]["content"]
    elif vision_provider.startswith("proxyapi-claude"):
        text = resp_data["content"][0]["text"]
    else:  # gemini
        text = resp_data["candidates"][0]["content"]["parts"][0]["text"]

    result = parse_json(text)
    result["_ocr_text"] = text[:3000]
    return result


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
    parts.append({"text": ANALYSIS_PROMPT + f"\n\nДокумент «{file_name}» ({len(images)} стр.). Найди строку «Итого»/«Всего» — возьми сумму оттуда. Найди фразу «Всего наименований N» или последний номер строки в таблице — это количество позиций. Верни JSON."})
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
        deepseek_key, gemini_key, yandex_key, yandex_folder, proxyapi_key, vision_provider = get_keys(conn)
        body = json.loads(event.get("body") or "{}")
        images_list = body.get("images", [])
        image_b64 = body.get("image_b64", "")
        image_url = body.get("image_url", "")
        excel_b64 = body.get("excel_b64", "")
        mime_type = body.get("mime_type", "image/jpeg")
        file_name = body.get("file_name", "document")
        doc_id = body.get("doc_id")
        auto_create_tx = body.get("auto_create_tx", True)

        # Если передан URL — скачиваем изображение на бэкенде (обходит CORS браузера)
        if image_url and not image_b64 and not images_list:
            try:
                req = urllib.request.Request(image_url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=30) as r:
                    img_data = r.read()
                image_b64 = base64.b64encode(img_data).decode()
                mime_type = "image/jpeg"
                print(f"[recognize-doc] Downloaded image from URL, size={len(img_data)} bytes")
            except Exception as e:
                return {"statusCode": 400, "headers": CORS,
                        "body": json.dumps({"error": f"Не удалось скачать изображение по ссылке: {e}"}, ensure_ascii=False)}

        if not yandex_key and not gemini_key and not deepseek_key and not proxyapi_key:
            return {"statusCode": 400, "headers": CORS,
                    "body": json.dumps({"error": "Ни один API ключ не добавлен. Зайдите в Настройки и добавьте ключ ProxyAPI, Gemini или Яндекс."}, ensure_ascii=False)}

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

        # 1. ProxyAPI Vision (приоритет — самый точный для русских накладных через GPT-4o / Claude / Gemini)
        proxyapi_failed = False
        if proxyapi_key and vision_provider.startswith("proxyapi-") and all_imgs:
            try:
                fields = call_proxyapi_vision(all_imgs, file_name, proxyapi_key, vision_provider)
                provider_used = f"proxyapi:{vision_provider}"
            except Exception as e:
                err_str = str(e)
                error_details.append(f"ProxyAPI: {err_str}")
                if "401" in err_str or "403" in err_str:
                    proxyapi_failed = True

        # 2. Яндекс Vision + YandexGPT
        yandex_auth_failed = False
        if not fields.get("doc_type") and yandex_key and yandex_folder and all_imgs:
            try:
                fields = call_yandex(all_imgs, file_name, yandex_key, yandex_folder)
                provider_used = "yandex"
            except Exception as e:
                err_str = str(e)
                error_details.append(f"Yandex: {err_str}")
                if "401" in err_str:
                    yandex_auth_failed = True

        # 3. Gemini Flash (свой ключ)
        if not fields.get("doc_type") and gemini_key and all_imgs:
            try:
                if len(all_imgs) > 1:
                    fields = call_gemini_multi(all_imgs, file_name, gemini_key)
                else:
                    fields = call_gemini_vision(all_imgs[0]["b64"], all_imgs[0]["mime"], gemini_key)
                provider_used = "gemini"
            except Exception as e:
                error_details.append(f"Gemini: {e}")

        # 4. DeepSeek text (последний fallback — без vision)
        if not fields.get("doc_type"):
            if proxyapi_failed and not yandex_key and not gemini_key:
                return {"statusCode": 400, "headers": CORS,
                        "body": json.dumps({"error": f"ProxyAPI ключ недействителен или нет доступа. Подробно: {'; '.join(error_details)}"}, ensure_ascii=False)}
            if yandex_auth_failed and not proxyapi_key and not gemini_key:
                return {"statusCode": 400, "headers": CORS,
                        "body": json.dumps({"error": "Яндекс API ключ недействителен (401)."}, ensure_ascii=False)}
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

        # ── Защита от дублей по сумме + дате ─────────────────────────────
        if amount and date_found and tx_date:
            cur.execute(f"""
                SELECT d.id, d.name, d.rec_date FROM {SCHEMA}.documents d
                WHERE d.rec_date = %s
                  AND d.rec_amount = %s
                  AND d.status = 'done'
                  AND (%s IS NULL OR d.id != %s)
                LIMIT 1
            """, (tx_date, f"₽ {amount:,.0f}".replace(",", " "), doc_id, doc_id))
            dup = cur.fetchone()
            if dup:
                # Помечаем текущий документ как дубль
                if doc_id:
                    cur.execute(f"UPDATE {SCHEMA}.documents SET status='error' WHERE id=%s", (doc_id,))
                    conn.commit()
                cur.close()
                return {"statusCode": 200, "headers": CORS,
                        "body": json.dumps({
                            "duplicate": True,
                            "existing_id": dup[0],
                            "existing_name": dup[1],
                            "existing_date": str(dup[2]),
                            "amount": amount,
                            "date": tx_date,
                            "warning": f"Документ с такой же суммой {amount:,.0f} ₽ и датой {tx_date} уже существует: «{dup[1]}»"
                        }, ensure_ascii=False)}

        if doc_id:
            amt_str = f"₽ {amount:,.0f}".replace(",", " ") if amount else None
            cur.execute(f"""UPDATE {SCHEMA}.documents
                SET status='done', rec_type=%s, rec_amount=%s, rec_date=%s, rec_counterparty=%s, rec_inn=%s
                WHERE id=%s""", (doc_type, amt_str, tx_date if date_found else None, counterparty, inn, doc_id))

        tx_id = None
        if auto_create_tx and amount:
            sign = -1 if tx_type == "expense" else 1
            desc = comment or f"{doc_type}: {counterparty or file_name}"
            # Если для этого документа уже есть транзакция — обновляем её, а не создаём новую
            if doc_id:
                cur.execute(f"""SELECT id FROM {SCHEMA}.transactions
                    WHERE document_id=%s AND status != 'Отменено' LIMIT 1""", (doc_id,))
                existing = cur.fetchone()
                if existing:
                    tx_id = existing[0]
                    cur.execute(f"""UPDATE {SCHEMA}.transactions
                        SET date=%s, description=%s, category=%s, amount=%s, status='Выполнено'
                        WHERE id=%s""", (tx_date, desc[:500], category, amount * sign, tx_id))
                else:
                    cur.execute(f"""INSERT INTO {SCHEMA}.transactions
                            (date, description, category, amount, status, is_taxable, document_id)
                        VALUES (%s,%s,%s,%s,'Выполнено',TRUE,%s) RETURNING id""",
                                (tx_date, desc[:500], category, amount * sign, doc_id))
                    row = cur.fetchone()
                    if row:
                        tx_id = row[0]
            else:
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