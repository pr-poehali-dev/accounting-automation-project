"""
ИИ-чат для финансовой панели — проксирует запросы к DeepSeek API.
"""
import json
import os
import urllib.request
import urllib.error


def handler(event: dict, context) -> dict:
    cors_headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Content-Type": "application/json",
    }

    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": cors_headers, "body": ""}

    if event.get("httpMethod") != "POST":
        return {"statusCode": 405, "headers": cors_headers, "body": json.dumps({"error": "Method not allowed"})}

    api_key = os.environ.get("DEEPSEEK_API_KEY", "")
    if not api_key:
        return {
            "statusCode": 500,
            "headers": cors_headers,
            "body": json.dumps({"error": "DEEPSEEK_API_KEY не настроен. Добавьте ключ в Настройках платформы."}),
        }

    body = json.loads(event.get("body") or "{}")
    messages = body.get("messages", [])
    model = body.get("model", "deepseek-chat")

    system_prompt = (
        "Ты финансовый ИИ-ассистент для B2B компании ФинансПро. "
        "Помогаешь анализировать финансы, объяснять данные, создавать операции и отчёты. "
        "Отвечай профессионально, кратко и по делу. "
        "Форматируй суммы в рублях (₽). "
        "Используй markdown для выделения важных данных — **жирный** для ключевых цифр."
    )

    payload = {
        "model": model,
        "messages": [{"role": "system", "content": system_prompt}] + messages,
        "max_tokens": 1024,
        "temperature": 0.3,
        "stream": False,
    }

    url = "https://api.deepseek.com/v1/chat/completions"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            reply = result["choices"][0]["message"]["content"]
            return {
                "statusCode": 200,
                "headers": cors_headers,
                "body": json.dumps({"reply": reply, "model": model}),
            }
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8")
        return {
            "statusCode": e.code,
            "headers": cors_headers,
            "body": json.dumps({"error": f"DeepSeek API ошибка {e.code}", "detail": err_body}),
        }
    except Exception as e:
        return {
            "statusCode": 500,
            "headers": cors_headers,
            "body": json.dumps({"error": str(e)}),
        }
