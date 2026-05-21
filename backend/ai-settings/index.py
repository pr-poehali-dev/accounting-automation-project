"""
Настройки ИИ: получение и обновление (модель, ключ, токены, температура, промпт).
GET /           — получить настройки (ключ возвращается замаскированным)
PUT /           — обновить настройки (если api_key передан — сохраняется)
GET /?action=test — проверить подключение к выбранной модели
"""
import json
import os
import psycopg2
import urllib.request
import urllib.error

SCHEMA = os.environ.get("MAIN_DB_SCHEMA", "t_p79040548_accounting_automatio")
CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
}

ENDPOINTS = {
    "deepseek-chat": "https://api.deepseek.com/v1/chat/completions",
    "deepseek-reasoner": "https://api.deepseek.com/v1/chat/completions",
    "gpt-4o": "https://api.openai.com/v1/chat/completions",
    "gpt-4-turbo": "https://api.openai.com/v1/chat/completions",
    "claude-3-5-sonnet": "https://api.anthropic.com/v1/messages",
    "gemini-pro": "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent",
}


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def resp(status, body):
    return {"statusCode": status, "headers": CORS, "body": json.dumps(body, ensure_ascii=False, default=str)}


def mask_key(key: str) -> str:
    if not key:
        return ""
    if len(key) <= 8:
        return "●" * len(key)
    return key[:4] + "●" * (len(key) - 8) + key[-4:]


def test_connection(model: str, api_key: str) -> dict:
    url = ENDPOINTS.get(model)
    if not url:
        return {"ok": False, "error": f"Модель {model} не поддерживается"}
    if not api_key:
        return {"ok": False, "error": "API ключ не задан"}

    # Build minimal request per provider
    if model.startswith("deepseek") or model.startswith("gpt"):
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": "ping"}],
            "max_tokens": 5,
        }
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        }
    elif model.startswith("claude"):
        payload = {
            "model": "claude-3-5-sonnet-20241022",
            "max_tokens": 5,
            "messages": [{"role": "user", "content": "ping"}],
        }
        headers = {
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        }
    else:
        # Gemini
        url = url + f"?key={api_key}"
        payload = {"contents": [{"parts": [{"text": "ping"}]}]}
        headers = {"Content-Type": "application/json"}

    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            return {"ok": True, "status": r.status}
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            err_data = json.loads(body)
            msg = err_data.get("error", {}).get("message") or err_data.get("error") or body[:200]
        except Exception:
            msg = body[:200]
        return {"ok": False, "error": f"HTTP {e.code}: {msg}"}
    except Exception as ex:
        return {"ok": False, "error": str(ex)}


def handler(event: dict, context) -> dict:
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    method = event.get("httpMethod", "GET")
    qs = event.get("queryStringParameters") or {}
    conn = get_conn()
    cur = conn.cursor()

    try:
        # GET /?action=test
        if method == "GET" and qs.get("action") == "test":
            cur.execute(f"SELECT selected_model, api_key FROM {SCHEMA}.ai_settings WHERE id = 1")
            row = cur.fetchone()
            if not row:
                return resp(404, {"ok": False, "error": "Настройки не найдены"})
            model, api_key = row[0], row[1] or ""

            # Prefer DEEPSEEK_API_KEY secret if model is deepseek and no manual key set
            if model.startswith("deepseek") and not api_key:
                api_key = os.environ.get("DEEPSEEK_API_KEY", "")

            result = test_connection(model, api_key)
            return resp(200, result)

        # GET /
        if method == "GET":
            cur.execute(f"""
                SELECT selected_model, max_tokens, temperature, system_prompt, api_key, updated_at, gemini_api_key
                FROM {SCHEMA}.ai_settings WHERE id = 1
            """)
            row = cur.fetchone()
            if not row:
                return resp(404, {"error": "Settings not found"})
            gemini_key = row[6] or os.environ.get("GEMINI_API_KEY", "")
            result = {
                "selected_model": row[0],
                "max_tokens": row[1],
                "temperature": float(row[2]),
                "system_prompt": row[3],
                "api_key_set": bool(row[4] or os.environ.get("DEEPSEEK_API_KEY")),
                "api_key_masked": mask_key(row[4] or os.environ.get("DEEPSEEK_API_KEY", "")),
                "gemini_key_set": bool(gemini_key),
                "gemini_key_masked": mask_key(gemini_key),
                "updated_at": str(row[5]),
            }
            return resp(200, {"settings": result})

        # PUT /
        if method == "PUT":
            body = json.loads(event.get("body") or "{}")
            fields = []
            params = []
            for f in ["selected_model", "max_tokens", "temperature", "system_prompt"]:
                if f in body:
                    fields.append(f"{f} = %s")
                    params.append(body[f])
            if body.get("api_key"):
                fields.append("api_key = %s")
                params.append(body["api_key"])
            if body.get("gemini_api_key"):
                fields.append("gemini_api_key = %s")
                params.append(body["gemini_api_key"])
            if not fields:
                return resp(400, {"error": "No fields"})
            fields.append("updated_at = NOW()")
            params.append(1)
            cur.execute(f"""
                UPDATE {SCHEMA}.ai_settings SET {', '.join(fields)} WHERE id = %s
                RETURNING selected_model, max_tokens, temperature, system_prompt, api_key, gemini_api_key
            """, params)
            conn.commit()
            row = cur.fetchone()
            gemini_key = row[5] or ""
            result = {
                "selected_model": row[0],
                "max_tokens": row[1],
                "temperature": float(row[2]),
                "system_prompt": row[3],
                "api_key_set": bool(row[4] or os.environ.get("DEEPSEEK_API_KEY")),
                "api_key_masked": mask_key(row[4] or os.environ.get("DEEPSEEK_API_KEY", "")),
                "gemini_key_set": bool(gemini_key),
                "gemini_key_masked": mask_key(gemini_key),
            }
            return resp(200, {"settings": result})

        return resp(405, {"error": "Method not allowed"})

    finally:
        cur.close()
        conn.close()