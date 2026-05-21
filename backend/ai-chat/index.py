"""
ИИ-чат для финансовой панели — проксирует запросы к DeepSeek/Gemini/YandexGPT.
Ключ берётся из таблицы ai_settings (с фоллбеком на переменные окружения).
"""
import json
import os
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


def resp(status, body):
    return {"statusCode": status, "headers": CORS, "body": json.dumps(body, ensure_ascii=False)}


def get_settings():
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    cur = conn.cursor()
    cur.execute(f"""
        SELECT selected_model, api_key, gemini_api_key, yandex_api_key, yandex_folder_id,
               max_tokens, temperature, system_prompt
        FROM {SCHEMA}.ai_settings WHERE id = 1
    """)
    row = cur.fetchone()
    cur.close()
    conn.close()
    if not row:
        return None
    return {
        "selected_model": row[0],
        "deepseek_key": (row[1] or os.environ.get("DEEPSEEK_API_KEY", "")),
        "gemini_key": (row[2] or os.environ.get("GEMINI_API_KEY", "")),
        "yandex_key": (row[3] or os.environ.get("YANDEX_API_KEY", "")),
        "yandex_folder": (row[4] or os.environ.get("YANDEX_FOLDER_ID", "")),
        "max_tokens": row[5] or 1024,
        "temperature": float(row[6] or 0.3),
        "system_prompt": row[7] or "",
    }


DEFAULT_SYSTEM = (
    "Ты финансовый ИИ-ассистент для B2B компании ФинансПро. "
    "Помогаешь анализировать финансы, объяснять данные, создавать операции и отчёты. "
    "Отвечай профессионально, кратко и по делу. "
    "Форматируй суммы в рублях (₽). "
    "Используй markdown для выделения важных данных — **жирный** для ключевых цифр."
)


def call_deepseek(model, messages, api_key, system_prompt, max_tokens, temperature):
    payload = {
        "model": model,
        "messages": [{"role": "system", "content": system_prompt}] + messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": False,
    }
    req = urllib.request.Request(
        "https://api.deepseek.com/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        result = json.loads(r.read().decode("utf-8"))
    return result["choices"][0]["message"]["content"]


def call_gemini(model, messages, api_key, system_prompt, max_tokens, temperature):
    gemini_model = "gemini-1.5-pro" if "pro" in model else "gemini-2.0-flash"
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{gemini_model}:generateContent?key={api_key}"
    contents = []
    for m in messages:
        role = "user" if m.get("role") == "user" else "model"
        contents.append({"role": role, "parts": [{"text": m.get("content", "")}]})
    payload = {
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "contents": contents,
        "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens},
    }
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        result = json.loads(r.read().decode("utf-8"))
    return result["candidates"][0]["content"]["parts"][0]["text"]


def call_yandexgpt(messages, api_key, folder_id, system_prompt, max_tokens, temperature):
    url = "https://llm.api.cloud.yandex.net/foundationModels/v1/completion"
    yandex_messages = [{"role": "system", "text": system_prompt}]
    for m in messages:
        yandex_messages.append({"role": m.get("role", "user"), "text": m.get("content", "")})
    payload = {
        "modelUri": f"gpt://{folder_id}/yandexgpt/latest",
        "completionOptions": {"stream": False, "temperature": temperature, "maxTokens": max_tokens},
        "messages": yandex_messages,
    }
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Api-Key {api_key}", "x-folder-id": folder_id},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        result = json.loads(r.read().decode("utf-8"))
    return result["result"]["alternatives"][0]["message"]["text"]


def handler(event: dict, context) -> dict:
    """ИИ-чат: маршрутизирует запросы к выбранной модели (DeepSeek/Gemini/YandexGPT)."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    if event.get("httpMethod") != "POST":
        return resp(405, {"error": "Method not allowed"})

    body = json.loads(event.get("body") or "{}")
    messages = body.get("messages", [])
    requested_model = body.get("model")

    settings = get_settings()
    if not settings:
        return resp(500, {"error": "Настройки ИИ не найдены. Откройте раздел Настройки."})

    model = requested_model or settings["selected_model"]
    system_prompt = settings["system_prompt"] or DEFAULT_SYSTEM
    max_tokens = settings["max_tokens"]
    temperature = settings["temperature"]

    try:
        if model.startswith("deepseek"):
            if not settings["deepseek_key"]:
                return resp(400, {"error": "Ключ DeepSeek не задан. Откройте Настройки и добавьте ключ."})
            reply = call_deepseek(model, messages, settings["deepseek_key"], system_prompt, max_tokens, temperature)
        elif model.startswith("gemini"):
            if not settings["gemini_key"]:
                return resp(400, {"error": "Ключ Gemini не задан. Откройте Настройки и добавьте ключ."})
            reply = call_gemini(model, messages, settings["gemini_key"], system_prompt, max_tokens, temperature)
        elif model.startswith("yandex"):
            if not settings["yandex_key"] or not settings["yandex_folder"]:
                return resp(400, {"error": "Не задан ключ или Folder ID Яндекс. Откройте Настройки."})
            reply = call_yandexgpt(messages, settings["yandex_key"], settings["yandex_folder"],
                                    system_prompt, max_tokens, temperature)
        else:
            return resp(400, {"error": f"Модель {model} не поддерживается"})

        return resp(200, {"reply": reply, "model": model})

    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        return resp(e.code, {"error": f"API ошибка {e.code}", "detail": err_body[:500]})
    except Exception as e:
        return resp(500, {"error": str(e)})
