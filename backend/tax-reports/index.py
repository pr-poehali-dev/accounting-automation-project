"""
Налоговые отчёты: список, создание, удаление.
GET / — список отчётов
GET /summary — сводка налогов (доходы, расходы, база, НДС)
POST / — создать отчёт
DELETE /?id=N — удалить
"""
import json
import os
import psycopg2
from datetime import date

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
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    method = event.get("httpMethod", "GET")
    path = event.get("path", "/")
    qs = event.get("queryStringParameters") or {}
    conn = get_conn()
    cur = conn.cursor()

    try:
        # GET /?action=summary — налоговая сводка за период
        if method == "GET" and qs.get("action") == "summary":
            date_from = qs.get("date_from")
            date_to = qs.get("date_to")
            conditions = ["status != 'Отменено'"]
            params = []
            if date_from:
                conditions.append("date >= %s")
                params.append(date_from)
            if date_to:
                conditions.append("date <= %s")
                params.append(date_to)
            where = "WHERE " + " AND ".join(conditions)

            cur.execute(f"""
                SELECT
                    COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS income,
                    COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0) AS expense,
                    COALESCE(SUM(CASE WHEN amount < 0 AND is_cashless = TRUE THEN ABS(amount) ELSE 0 END), 0) AS expense_cashless
                FROM {SCHEMA}.transactions {where}
            """, params)
            income, expense, expense_cashless = cur.fetchone()
            income = float(income)
            expense = float(expense)
            expense_cashless = float(expense_cashless)
            base = income - expense
            vat = round(base * 0.20 if base > 0 else 0, 2)

            return resp(200, {
                "income": income,
                "expense": expense,
                "expense_cashless": expense_cashless,
                "tax_base": base,
                "vat": vat,
            })

        # GET / — list reports
        if method == "GET":
            cur.execute(f"""
                SELECT id, name, period, report_type, status, size_label, created_at
                FROM {SCHEMA}.tax_reports
                ORDER BY created_at DESC
            """)
            cols = ["id","name","period","report_type","status","size_label","created_at"]
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]
            return resp(200, {"reports": rows})

        # POST / — create report record
        if method == "POST":
            body = json.loads(event.get("body") or "{}")
            cur.execute(f"""
                INSERT INTO {SCHEMA}.tax_reports (name, period, report_type, status, size_label)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id, name, period, report_type, status, size_label, created_at
            """, (
                body.get("name", "Отчёт"),
                body.get("period", ""),
                body.get("report_type", "Квартальный"),
                body.get("status", "Готов"),
                body.get("size_label", "—"),
            ))
            conn.commit()
            cols = ["id","name","period","report_type","status","size_label","created_at"]
            row = dict(zip(cols, cur.fetchone()))
            return resp(201, {"report": row})

        # DELETE /?id=N
        if method == "DELETE":
            rep_id = qs.get("id")
            if not rep_id:
                return resp(400, {"error": "id required"})
            cur.execute(f"DELETE FROM {SCHEMA}.tax_reports WHERE id = %s RETURNING id", (rep_id,))
            conn.commit()
            if not cur.fetchone():
                return resp(404, {"error": "Not found"})
            return resp(200, {"ok": True})

        return resp(405, {"error": "Method not allowed"})

    finally:
        cur.close()
        conn.close()