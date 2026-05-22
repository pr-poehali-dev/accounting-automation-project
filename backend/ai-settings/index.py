"""
Настройки ИИ: получение и обновление (модель, ключи, токены, температура, промпт).
GET /           — получить настройки (ключ возвращается замаскированным)
PUT /           — обновить настройки (если api_key/proxyapi_key/... передан — сохраняется)
GET /?action=test — проверить подключение к выбранной модели + Vision-провайдер
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

# Прямые эндпоинты (если у пользователя свой ключ напрямую к провайдеру)
DIRECT_ENDPOINTS = {
    "deepseek-chat": "https://api.deepseek.com/v1/chat/completions",
    "deepseek-reasoner": "https://api.deepseek.com/v1/chat/completions",
    "gpt-4o": "https://api.openai.com/v1/chat/completions",
    "gpt-4o-mini": "https://api.openai.com/v1/chat/completions",
    "gpt-4-turbo": "https://api.openai.com/v1/chat/completions",
    "claude-3-5-sonnet": "https://api.anthropic.com/v1/messages",
    "gemini-pro": "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent",
}

# ProxyAPI: один ключ, все провайдеры. Модель имеет префикс proxyapi-
PROXYAPI_BASE = "https://api.proxyapi.ru"
PROXYAPI_ENDPOINTS = {
    "proxyapi-gpt-4o": f"{PROXYAPI_BASE}/openai/v1/chat/completions",
    "proxyapi-gpt-4o-mini": f"{PROXYAPI_BASE}/openai/v1/chat/completions",
    "proxyapi-gpt-4-turbo": f"{PROXYAPI_BASE}/openai/v1/chat/completions",
    "proxyapi-claude-3-5-sonnet": f"{PROXYAPI_BASE}/anthropic/v1/messages",
    "proxyapi-claude-3-haiku": f"{PROXYAPI_BASE}/anthropic/v1/messages",
    "proxyapi-gemini-1.5-pro": f"{PROXYAPI_BASE}/google/v1beta/models/gemini-1.5-pro:generateContent",
    "proxyapi-gemini-2.0-flash": f"{PROXYAPI_BASE}/google/v1beta/models/gemini-2.0-flash:generateContent",
}

PROXYAPI_MODEL_NAMES = {
    "proxyapi-gpt-4o": "gpt-4o",
    "proxyapi-gpt-4o-mini": "gpt-4o-mini",
    "proxyapi-gpt-4-turbo": "gpt-4-turbo",
    "proxyapi-claude-3-5-sonnet": "claude-3-5-sonnet-20241022",
    "proxyapi-claude-3-haiku": "claude-3-haiku-20240307",
    "proxyapi-gemini-1.5-pro": "gemini-1.5-pro",
    "proxyapi-gemini-2.0-flash": "gemini-2.0-flash",
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


def test_proxyapi(model: str, proxyapi_key: str) -> dict:
    """Проверка ключа ProxyAPI на выбранной модели."""
    if not proxyapi_key:
        return {"ok": False, "error": "Ключ ProxyAPI не задан"}
    if model not in PROXYAPI_ENDPOINTS:
        return {"ok": False, "error": f"Модель {model} не поддерживается"}

    url = PROXYAPI_ENDPOINTS[model]
    real_model = PROXYAPI_MODEL_NAMES[model]

    if model.startswith("proxyapi-gpt"):
        payload = {"model": real_model, "messages": [{"role": "user", "content": "ping"}], "max_tokens": 5}
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {proxyapi_key}"}
    elif model.startswith("proxyapi-claude"):
        payload = {"model": real_model, "max_tokens": 5, "messages": [{"role": "user", "content": "ping"}]}
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {proxyapi_key}", "anthropic-version": "2023-06-01"}
    else:  # gemini
        payload = {"contents": [{"parts": [{"text": "ping"}]}]}
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {proxyapi_key}"}

    try:
        req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=20) as r:
            return {"ok": True, "status": r.status}
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            err_data = json.loads(body)
            msg = err_data.get("error", {}).get("message") if isinstance(err_data.get("error"), dict) else err_data.get("error") or err_data.get("message") or body[:300]
        except Exception:
            msg = body[:300]
        return {"ok": False, "error": f"HTTP {e.code}: {msg}"}
    except Exception as ex:
        return {"ok": False, "error": str(ex)}


def test_direct(model: str, api_key: str) -> dict:
    """Старая проверка для прямых ключей (DeepSeek, OpenAI и т.д.)."""
    url = DIRECT_ENDPOINTS.get(model)
    if not url:
        return {"ok": False, "error": f"Модель {model} не поддерживается"}
    if not api_key:
        return {"ok": False, "error": "API ключ не задан"}

    if model.startswith("deepseek") or model.startswith("gpt"):
        payload = {"model": model, "messages": [{"role": "user", "content": "ping"}], "max_tokens": 5}
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}
    elif model.startswith("claude"):
        payload = {"model": "claude-3-5-sonnet-20241022", "max_tokens": 5, "messages": [{"role": "user", "content": "ping"}]}
        headers = {"Content-Type": "application/json", "x-api-key": api_key, "anthropic-version": "2023-06-01"}
    else:
        url = url + f"?key={api_key}"
        payload = {"contents": [{"parts": [{"text": "ping"}]}]}
        headers = {"Content-Type": "application/json"}

    try:
        req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
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


def test_yandex(yandex_key: str, yandex_folder: str) -> dict:
    if not yandex_key:
        return {"ok": None, "error": "Ключ не задан"}
    if not yandex_folder:
        return {"ok": False, "error": "Folder ID не задан"}
    url = "https://ocr.api.cloud.yandex.net/ocr/v1/recognizeText"
    dummy_b64 = (
        "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////"
        "////////////////////////////////////////////////////2wBDAf//////////"
        "////////////////////////////////////////////////////////////////////"
        "//////////////wAARCAAKAAoDASIAAhEBAxEB/8QAFAABAQAAAAAAAAAAAAAAAAAAAAr"
        "/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAA"
        "AAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL+AB//Z"
    )
    payload = {"mimeType": "JPEG", "languageCodes": ["ru"], "model": "page", "content": dummy_b64}
    try:
        req = urllib.request.Request(
            url, data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Api-Key {yandex_key}",
                "x-folder-id": yandex_folder,
                "x-data-logging-enabled": "false",
            }, method="POST",
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            return {"ok": True, "status": r.status}
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        if e.code == 400:
            return {"ok": True, "status": 400, "note": "Ключ валиден"}
        if e.code == 401:
            return {"ok": False, "error": "Ключ недействителен (401)."}
        if e.code == 403:
            return {"ok": False, "error": "Нет прав (403). Проверьте роли сервисного аккаунта."}
        return {"ok": False, "error": f"HTTP {e.code}: {body[:200]}"}
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
        if method == "GET" and qs.get("action") == "test":
            cur.execute(f"""
                SELECT selected_model, api_key, gemini_api_key, yandex_api_key, yandex_folder_id,
                       proxyapi_key, vision_provider
                FROM {SCHEMA}.ai_settings WHERE id = 1
            """)
            row = cur.fetchone()
            if not row:
                return resp(404, {"ok": False, "error": "Настройки не найдены"})
            model = row[0]
            deepseek_key = row[1] or os.environ.get("DEEPSEEK_API_KEY", "")
            gemini_key = row[2] or os.environ.get("GEMINI_API_KEY", "")
            yandex_key = row[3] or os.environ.get("YANDEX_API_KEY", "")
            yandex_folder = row[4] or os.environ.get("YANDEX_FOLDER_ID", "")
            proxyapi_key = row[5] or os.environ.get("PROXYAPI_KEY", "")
            vision_provider = row[6] or "proxyapi-gpt-4o"

            # ИИ-чат
            if model.startswith("proxyapi-"):
                ai_result = test_proxyapi(model, proxyapi_key)
            elif model.startswith("gemini"):
                ai_result = test_direct(model, gemini_key)
            else:
                ai_result = test_direct(model, deepseek_key)

            # Vision (распознавание документов)
            if vision_provider.startswith("proxyapi-"):
                vision_result = test_proxyapi(vision_provider, proxyapi_key)
            elif vision_provider == "yandex":
                vision_result = test_yandex(yandex_key, yandex_folder)
            elif vision_provider == "gemini":
                if gemini_key:
                    vision_result = test_direct("gemini-pro", gemini_key)
                else:
                    vision_result = {"ok": None, "error": "Ключ Gemini не задан"}
            else:
                vision_result = {"ok": None, "error": "Vision-провайдер не выбран"}

            overall_ok = bool(ai_result.get("ok")) and bool(vision_result.get("ok"))

            return resp(200, {
                "ok": overall_ok,
                "ai_model": model,
                "ai": ai_result,
                "vision_provider": vision_provider,
                "vision": vision_result,
                "yandex": vision_result,  # совместимость
                "error": None if overall_ok else (vision_result.get("error") or ai_result.get("error")),
            })

        if method == "GET":
            cur.execute(f"""
                SELECT selected_model, max_tokens, temperature, system_prompt, api_key, updated_at, gemini_api_key,
                       yandex_api_key, yandex_folder_id, proxyapi_key, vision_provider
                FROM {SCHEMA}.ai_settings WHERE id = 1
            """)
            row = cur.fetchone()
            if not row:
                return resp(404, {"error": "Settings not found"})
            gemini_key = row[6] or os.environ.get("GEMINI_API_KEY", "")
            yandex_key = row[7] or os.environ.get("YANDEX_API_KEY", "")
            yandex_folder = row[8] or os.environ.get("YANDEX_FOLDER_ID", "")
            proxyapi_key = row[9] or os.environ.get("PROXYAPI_KEY", "")
            vision_provider = row[10] or "proxyapi-gpt-4o"
            result = {
                "selected_model": row[0],
                "max_tokens": row[1],
                "temperature": float(row[2]),
                "system_prompt": row[3],
                "api_key_set": bool(row[4] or os.environ.get("DEEPSEEK_API_KEY")),
                "api_key_masked": mask_key(row[4] or os.environ.get("DEEPSEEK_API_KEY", "")),
                "gemini_key_set": bool(gemini_key),
                "gemini_key_masked": mask_key(gemini_key),
                "yandex_key_set": bool(yandex_key),
                "yandex_key_masked": mask_key(yandex_key),
                "yandex_folder_set": bool(yandex_folder),
                "yandex_folder_masked": mask_key(yandex_folder),
                "proxyapi_key_set": bool(proxyapi_key),
                "proxyapi_key_masked": mask_key(proxyapi_key),
                "vision_provider": vision_provider,
                "updated_at": str(row[5]),
            }
            return resp(200, {"settings": result})

        if method == "PUT":
            body = json.loads(event.get("body") or "{}")
            fields = []
            params = []
            for f in ["selected_model", "max_tokens", "temperature", "system_prompt", "vision_provider"]:
                if f in body and body[f] is not None:
                    fields.append(f"{f} = %s")
                    params.append(body[f])
            if body.get("api_key"):
                fields.append("api_key = %s"); params.append(body["api_key"])
            if body.get("gemini_api_key"):
                fields.append("gemini_api_key = %s"); params.append(body["gemini_api_key"])
            if body.get("yandex_api_key"):
                fields.append("yandex_api_key = %s"); params.append(body["yandex_api_key"])
            if body.get("yandex_folder_id"):
                fields.append("yandex_folder_id = %s"); params.append(body["yandex_folder_id"])
            if body.get("proxyapi_key"):
                fields.append("proxyapi_key = %s"); params.append(body["proxyapi_key"])
            if not fields:
                return resp(400, {"error": "No fields"})
            fields.append("updated_at = NOW()")
            params.append(1)
            cur.execute(f"""
                UPDATE {SCHEMA}.ai_settings SET {', '.join(fields)} WHERE id = %s
                RETURNING selected_model, max_tokens, temperature, system_prompt, api_key, gemini_api_key,
                          yandex_api_key, yandex_folder_id, proxyapi_key, vision_provider
            """, params)
            conn.commit()
            row = cur.fetchone()
            gemini_key = row[5] or ""
            yandex_key = row[6] or os.environ.get("YANDEX_API_KEY", "")
            yandex_folder = row[7] or os.environ.get("YANDEX_FOLDER_ID", "")
            proxyapi_key = row[8] or ""
            vision_provider = row[9] or "proxyapi-gpt-4o"
            result = {
                "selected_model": row[0],
                "max_tokens": row[1],
                "temperature": float(row[2]),
                "system_prompt": row[3],
                "api_key_set": bool(row[4] or os.environ.get("DEEPSEEK_API_KEY")),
                "api_key_masked": mask_key(row[4] or os.environ.get("DEEPSEEK_API_KEY", "")),
                "gemini_key_set": bool(gemini_key),
                "gemini_key_masked": mask_key(gemini_key),
                "yandex_key_set": bool(yandex_key),
                "yandex_key_masked": mask_key(yandex_key),
                "yandex_folder_set": bool(yandex_folder),
                "yandex_folder_masked": mask_key(yandex_folder),
                "proxyapi_key_set": bool(proxyapi_key),
                "proxyapi_key_masked": mask_key(proxyapi_key),
                "vision_provider": vision_provider,
            }
            return resp(200, {"settings": result})

        return resp(405, {"error": "Method not allowed"})

    finally:
        cur.close()
        conn.close()
