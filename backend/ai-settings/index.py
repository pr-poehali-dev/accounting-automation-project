"""
Настройки ИИ: получение и обновление (модель, токены, температура, промпт).
GET / — получить текущие настройки
PUT / — обновить настройки
"""
import json
import os
import psycopg2

SCHEMA = os.environ.get("MAIN_DB_SCHEMA", "t_p79040548_accounting_automatio")
CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
}


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def resp(status, body):
    return {"statusCode": status, "headers": CORS, "body": json.dumps(body, ensure_ascii=False, default=str)}


def handler(event: dict, context) -> dict:
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    method = event.get("httpMethod", "GET")
    conn = get_conn()
    cur = conn.cursor()

    try:
        if method == "GET":
            cur.execute(f"""
                SELECT selected_model, max_tokens, temperature, system_prompt, updated_at
                FROM {SCHEMA}.ai_settings WHERE id = 1
            """)
            row = cur.fetchone()
            if not row:
                return resp(404, {"error": "Settings not found"})
            cols = ["selected_model","max_tokens","temperature","system_prompt","updated_at"]
            result = dict(zip(cols, row))
            result["temperature"] = float(result["temperature"])
            return resp(200, {"settings": result})

        if method == "PUT":
            body = json.loads(event.get("body") or "{}")
            fields = []
            params = []
            for f in ["selected_model", "max_tokens", "temperature", "system_prompt"]:
                if f in body:
                    fields.append(f"{f} = %s")
                    params.append(body[f])
            if not fields:
                return resp(400, {"error": "No fields"})
            fields.append("updated_at = NOW()")
            cur.execute(f"""
                UPDATE {SCHEMA}.ai_settings SET {', '.join(fields)} WHERE id = 1
                RETURNING selected_model, max_tokens, temperature, system_prompt
            """, params)
            conn.commit()
            row = cur.fetchone()
            cols = ["selected_model","max_tokens","temperature","system_prompt"]
            result = dict(zip(cols, row))
            result["temperature"] = float(result["temperature"])
            return resp(200, {"settings": result})

        return resp(405, {"error": "Method not allowed"})

    finally:
        cur.close()
        conn.close()
