"""
CRUD операций: список, создание, обновление, удаление.
GET / — список с фильтрами (search, category, date_from, date_to)
POST / — создать операцию
PUT /?id=N — обновить
DELETE /?id=N — удалить
GET /summary — сводка для дашборда (баланс, доходы, расходы месяц/год)
"""
import json
import os
import psycopg2
from datetime import date

SCHEMA = os.environ.get("MAIN_DB_SCHEMA", "t_p79040548_accounting_automatio")
CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
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
        # GET /?action=summary
        if method == "GET" and qs.get("action") == "summary":
            today = date.today()
            chart_year = int(qs.get("year", today.year))
            month_start = today.replace(day=1)
            year_start = today.replace(month=1, day=1)

            cur.execute(f"""
                SELECT
                    COALESCE(SUM(amount), 0) AS total_balance,
                    COALESCE(SUM(CASE WHEN amount > 0 AND date >= %s THEN amount ELSE 0 END), 0) AS income_month,
                    COALESCE(SUM(CASE WHEN amount < 0 AND date >= %s THEN ABS(amount) ELSE 0 END), 0) AS expense_month,
                    COALESCE(SUM(CASE WHEN amount > 0 AND date >= %s THEN amount ELSE 0 END), 0) AS income_year,
                    COALESCE(SUM(CASE WHEN amount < 0 AND date >= %s THEN ABS(amount) ELSE 0 END), 0) AS expense_year
                FROM {SCHEMA}.transactions
                WHERE status != 'Отменено'
            """, (month_start, month_start, year_start, year_start))
            row = cur.fetchone()
            total_balance, income_month, expense_month, income_year, expense_year = row

            # Monthly chart for selected year
            cur.execute(f"""
                SELECT
                    EXTRACT(MONTH FROM date)::int AS m,
                    COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS income,
                    COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0) AS expense
                FROM {SCHEMA}.transactions
                WHERE EXTRACT(YEAR FROM date) = %s AND status != 'Отменено'
                GROUP BY m ORDER BY m
            """, (chart_year,))
            months_data = {r[0]: {"income": float(r[1]), "expense": float(r[2])} for r in cur.fetchall()}

            month_names = ["Янв","Фев","Мар","Апр","Май","Июн","Июл","Авг","Сен","Окт","Ноя","Дек"]
            chart = [
                {
                    "month": month_names[i],
                    "доход": months_data.get(i+1, {}).get("income", 0),
                    "расход": months_data.get(i+1, {}).get("expense", 0),
                }
                for i in range(12)
            ]

            # Category breakdown (expenses)
            cur.execute(f"""
                SELECT category, SUM(ABS(amount)) AS total
                FROM {SCHEMA}.transactions
                WHERE amount < 0 AND status != 'Отменено'
                GROUP BY category ORDER BY total DESC LIMIT 8
            """)
            categories = [{"name": r[0], "сумма": float(r[1])} for r in cur.fetchall()]

            return resp(200, {
                "balance": float(total_balance),
                "income_month": float(income_month),
                "expense_month": float(expense_month),
                "income_year": float(income_year),
                "expense_year": float(expense_year),
                "profit_month": float(income_month) - float(expense_month),
                "chart": chart,
                "categories": categories,
            })

        # GET / — list
        if method == "GET":
            conditions = []
            params = []
            if qs.get("search"):
                conditions.append("(description ILIKE %s OR CAST(id AS TEXT) ILIKE %s)")
                params += [f"%{qs['search']}%", f"%{qs['search']}%"]
            if qs.get("category") and qs["category"] != "Все":
                conditions.append("category = %s")
                params.append(qs["category"])
            if qs.get("date_from"):
                conditions.append("date >= %s")
                params.append(qs["date_from"])
            if qs.get("date_to"):
                conditions.append("date <= %s")
                params.append(qs["date_to"])

            where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
            cur.execute(f"""
                SELECT id, date, description, category, amount, status, is_taxable, document_id, created_at
                FROM {SCHEMA}.transactions
                {where}
                ORDER BY date DESC, id DESC
                LIMIT 200
            """, params)
            cols = ["id","date","description","category","amount","status","is_taxable","document_id","created_at"]
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]
            for r in rows:
                r["amount"] = float(r["amount"])
            return resp(200, {"transactions": rows, "total": len(rows)})

        # POST / — create
        if method == "POST":
            body = json.loads(event.get("body") or "{}")
            is_taxable = body.get("is_taxable", True)
            is_cashless = body.get("is_cashless", False)
            document_id = body.get("document_id")
            cur.execute(f"""
                INSERT INTO {SCHEMA}.transactions (date, description, category, amount, status, is_taxable, is_cashless, document_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id, date, description, category, amount, status, is_taxable, is_cashless, document_id, created_at
            """, (
                body.get("date", str(date.today())),
                body["description"],
                body.get("category", "Прочее"),
                float(body["amount"]),
                body.get("status", "Выполнено"),
                is_taxable,
                is_cashless,
                document_id,
            ))
            conn.commit()
            cols = ["id","date","description","category","amount","status","is_taxable","is_cashless","document_id","created_at"]
            row = dict(zip(cols, cur.fetchone()))
            row["amount"] = float(row["amount"])
            return resp(201, {"transaction": row})

        # PUT /?id=N — update
        if method == "PUT":
            tx_id = qs.get("id")
            if not tx_id:
                return resp(400, {"error": "id required"})
            body = json.loads(event.get("body") or "{}")
            fields = []
            params = []
            for f in ["date", "description", "category", "amount", "status", "is_taxable", "is_cashless", "document_id"]:
                if f in body:
                    fields.append(f"{f} = %s")
                    params.append(body[f])
            if not fields:
                return resp(400, {"error": "No fields to update"})
            params += [tx_id]
            cur.execute(f"""
                UPDATE {SCHEMA}.transactions SET {', '.join(fields)}, updated_at = NOW()
                WHERE id = %s
                RETURNING id, date, description, category, amount, status
            """, params)
            conn.commit()
            row = cur.fetchone()
            if not row:
                return resp(404, {"error": "Not found"})
            cols = ["id","date","description","category","amount","status"]
            result = dict(zip(cols, row))
            result["amount"] = float(result["amount"])
            return resp(200, {"transaction": result})

        # DELETE /?id=N
        if method == "DELETE":
            tx_id = qs.get("id")
            if not tx_id:
                return resp(400, {"error": "id required"})
            cur.execute(f"DELETE FROM {SCHEMA}.transactions WHERE id = %s RETURNING id", (tx_id,))
            conn.commit()
            if not cur.fetchone():
                return resp(404, {"error": "Not found"})
            return resp(200, {"ok": True})

        return resp(405, {"error": "Method not allowed"})

    finally:
        cur.close()
        conn.close()