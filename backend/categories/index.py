"""
Статьи затрат / категории.
GET /  — список всех категорий
POST / — добавить новую категорию { name }
DELETE /?name=ГСМ — удалить пользовательскую категорию
"""
import json
import os
import psycopg2

SCHEMA = os.environ.get("MAIN_DB_SCHEMA", "t_p79040548_accounting_automatio")
CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
}


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def resp(status, body):
    return {"statusCode": status, "headers": CORS, "body": json.dumps(body, ensure_ascii=False, default=str)}


def handler(event: dict, context) -> dict:
    """Управляет статьями затрат: получение, добавление, удаление."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    method = event.get("httpMethod", "GET")
    qs = event.get("queryStringParameters") or {}
    conn = get_conn()
    cur = conn.cursor()

    try:
        if method == "GET":
            cur.execute(f"""
                SELECT name, is_default FROM {SCHEMA}.categories
                ORDER BY is_default DESC, name ASC
            """)
            rows = [{"name": r[0], "is_default": r[1]} for r in cur.fetchall()]
            return resp(200, {"categories": rows})

        if method == "POST":
            body = json.loads(event.get("body") or "{}")
            name = (body.get("name") or "").strip()
            if not name:
                return resp(400, {"error": "name required"})
            cur.execute(f"""
                INSERT INTO {SCHEMA}.categories (name, is_default)
                VALUES (%s, false)
                ON CONFLICT (name) DO NOTHING
                RETURNING name
            """, (name,))
            conn.commit()
            return resp(200, {"ok": True, "name": name})

        if method == "DELETE":
            name = qs.get("name", "").strip()
            if not name:
                return resp(400, {"error": "name required"})
            cur.execute(f"""
                DELETE FROM {SCHEMA}.categories
                WHERE name = %s AND is_default = false
            """, (name,))
            conn.commit()
            return resp(200, {"ok": True})

        return resp(405, {"error": "Method not allowed"})

    finally:
        cur.close()
        conn.close()
