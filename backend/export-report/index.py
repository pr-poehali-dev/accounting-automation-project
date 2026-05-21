"""
Экспорт отчётов и операций в CSV.
GET /?type=transactions&date_from=...&date_to=...&category=... — выгрузка операций
GET /?type=tax&date_from=...&date_to=... — налоговый отчёт
"""
import json
import os
import csv
import io
import base64
import psycopg2
from datetime import date

SCHEMA = os.environ.get("MAIN_DB_SCHEMA", "t_p79040548_accounting_automatio")
CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def resp_csv(filename: str, content: str):
    b64 = base64.b64encode(content.encode("utf-8-sig")).decode("ascii")
    return {
        "statusCode": 200,
        "headers": {
            **CORS,
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
        "body": b64,
        "isBase64Encoded": True,
    }


def resp_json(status, body):
    return {
        "statusCode": status,
        "headers": {**CORS, "Content-Type": "application/json"},
        "body": json.dumps(body, ensure_ascii=False, default=str),
    }


def fmt_amount(n) -> str:
    try:
        return f"{float(n):,.2f}".replace(",", " ")
    except Exception:
        return str(n)


def handler(event: dict, context) -> dict:
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    qs = event.get("queryStringParameters") or {}
    report_type = qs.get("type", "transactions")
    date_from = qs.get("date_from", "")
    date_to = qs.get("date_to", "")
    category = qs.get("category", "")

    conn = get_conn()
    cur = conn.cursor()

    try:
        today = date.today().strftime("%Y-%m-%d")

        if report_type == "transactions":
            conditions = []
            params = []
            if date_from:
                conditions.append("date >= %s")
                params.append(date_from)
            if date_to:
                conditions.append("date <= %s")
                params.append(date_to)
            if category and category != "Все":
                conditions.append("category = %s")
                params.append(category)
            where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

            cur.execute(f"""
                SELECT date, id, description, category, amount, status
                FROM {SCHEMA}.transactions
                {where}
                ORDER BY date DESC, id DESC
            """, params)
            rows = cur.fetchall()

            buf = io.StringIO()
            w = csv.writer(buf, delimiter=";")
            w.writerow(["Дата", "ID", "Описание", "Категория", "Сумма (руб.)", "Тип", "Статус"])
            total_income = 0.0
            total_expense = 0.0
            for r in rows:
                dt, rid, desc, cat, amount, status = r
                amount_f = float(amount)
                tx_type = "Доход" if amount_f >= 0 else "Расход"
                if amount_f >= 0:
                    total_income += amount_f
                else:
                    total_expense += abs(amount_f)
                w.writerow([
                    str(dt)[:10],
                    rid,
                    desc,
                    cat,
                    fmt_amount(abs(amount_f)),
                    tx_type,
                    status,
                ])
            w.writerow([])
            w.writerow(["ИТОГО ДОХОДЫ", "", "", "", fmt_amount(total_income), "", ""])
            w.writerow(["ИТОГО РАСХОДЫ", "", "", "", fmt_amount(total_expense), "", ""])
            w.writerow(["ПРИБЫЛЬ", "", "", "", fmt_amount(total_income - total_expense), "", ""])

            period = f"{date_from or 'начало'}_{date_to or today}"
            return resp_csv(f"операции_{period}.csv", buf.getvalue())

        elif report_type == "tax":
            conditions = ["status != 'Отменено'"]
            params = []
            if date_from:
                conditions.append("date >= %s")
                params.append(date_from)
            if date_to:
                conditions.append("date <= %s")
                params.append(date_to)
            where = "WHERE " + " AND ".join(conditions)

            # Summary
            cur.execute(f"""
                SELECT
                    COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0)
                FROM {SCHEMA}.transactions {where}
            """, params)
            income, expense = [float(x) for x in cur.fetchone()]
            tax_base = income - expense
            vat = round(tax_base * 0.20 if tax_base > 0 else 0, 2)

            # By category
            cur.execute(f"""
                SELECT category,
                    COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS inc,
                    COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0) AS exp
                FROM {SCHEMA}.transactions {where}
                GROUP BY category ORDER BY exp DESC
            """, params)
            cats = cur.fetchall()

            # All transactions for period
            cur.execute(f"""
                SELECT date, description, category, amount, status
                FROM {SCHEMA}.transactions {where}
                ORDER BY date DESC
            """, params)
            txs = cur.fetchall()

            buf = io.StringIO()
            w = csv.writer(buf, delimiter=";")

            # Header
            period_label = f"{date_from or 'начало'} — {date_to or today}"
            w.writerow([f"НАЛОГОВЫЙ ОТЧЁТ ЗА ПЕРИОД: {period_label}"])
            w.writerow([f"Дата формирования: {today}"])
            w.writerow([])

            w.writerow(["СВОДКА"])
            w.writerow(["Показатель", "Сумма (руб.)"])
            w.writerow(["Доходы", fmt_amount(income)])
            w.writerow(["Расходы", fmt_amount(expense)])
            w.writerow(["Налогооблагаемая база", fmt_amount(tax_base)])
            w.writerow(["НДС 20% (оценка)", fmt_amount(vat)])
            w.writerow([])

            w.writerow(["РАСХОДЫ ПО КАТЕГОРИЯМ"])
            w.writerow(["Категория", "Доходы (руб.)", "Расходы (руб.)"])
            for c in cats:
                w.writerow([c[0], fmt_amount(c[1]), fmt_amount(c[2])])
            w.writerow([])

            w.writerow(["ВСЕ ОПЕРАЦИИ ЗА ПЕРИОД"])
            w.writerow(["Дата", "Описание", "Категория", "Сумма (руб.)", "Тип", "Статус"])
            for t in txs:
                dt, desc, cat, amount, status = t
                amount_f = float(amount)
                w.writerow([
                    str(dt)[:10],
                    desc,
                    cat,
                    fmt_amount(abs(amount_f)),
                    "Доход" if amount_f >= 0 else "Расход",
                    status,
                ])

            period = f"{date_from or 'начало'}_{date_to or today}"
            return resp_csv(f"налоговый_отчет_{period}.csv", buf.getvalue())

        else:
            return resp_json(400, {"error": f"Unknown type: {report_type}"})

    finally:
        cur.close()
        conn.close()
