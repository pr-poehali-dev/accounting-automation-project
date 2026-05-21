"""
Генерация PDF-отчёта для налоговой.
GET /?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD&taxable_only=1
Возвращает PDF base64 или бинарный файл.
"""
import json
import os
import io
import base64
import psycopg2
import urllib.request
from datetime import date

SCHEMA = os.environ.get("MAIN_DB_SCHEMA", "t_p79040548_accounting_automatio")
CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def fmt_rub(n):
    try:
        return f"{float(n):,.2f} ₽".replace(",", " ")
    except Exception:
        return str(n)


def fmt_date(d):
    try:
        if hasattr(d, "strftime"):
            return d.strftime("%d.%m.%Y")
        return str(d)[:10]
    except Exception:
        return str(d)


def generate_pdf_bytes(transactions, date_from, date_to, income_total, expense_total):
    """Генерирует PDF через reportlab."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import cm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    import urllib.request
    import tempfile

    # Download DejaVu font for Cyrillic support
    font_url = "https://github.com/dejavu-fonts/dejavu-fonts/raw/master/ttf/DejaVuSans.ttf"
    font_path = "/tmp/DejaVuSans.ttf"
    if not os.path.exists(font_path):
        try:
            urllib.request.urlretrieve(font_url, font_path)
        except Exception:
            font_path = None

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
                             rightMargin=1.5*cm, leftMargin=1.5*cm,
                             topMargin=2*cm, bottomMargin=2*cm)

    styles = getSampleStyleSheet()

    if font_path and os.path.exists(font_path):
        pdfmetrics.registerFont(TTFont("DejaVu", font_path))
        base_font = "DejaVu"
    else:
        base_font = "Helvetica"

    title_style = ParagraphStyle("title", fontName=base_font, fontSize=14, spaceAfter=8, alignment=1)
    sub_style = ParagraphStyle("sub", fontName=base_font, fontSize=10, spaceAfter=4, textColor=colors.grey)
    normal_style = ParagraphStyle("normal", fontName=base_font, fontSize=9)

    story = []

    # Title
    story.append(Paragraph(f"Финансовый отчёт ИП", title_style))
    story.append(Paragraph(f"Период: {fmt_date(date_from)} — {fmt_date(date_to)}", sub_style))
    story.append(Spacer(1, 0.5*cm))

    # Table header
    col_widths = [2.5*cm, 2.5*cm, 4*cm, 6*cm, 3*cm]
    header = [["Дата", "Тип", "Статья", "Описание", "Сумма"]]
    data = header[:]

    for tx in transactions:
        tx_type = "Доход" if float(tx["amount"]) >= 0 else "Расход"
        data.append([
            fmt_date(tx["date"]),
            tx_type,
            str(tx["category"] or ""),
            str(tx["description"] or "")[:80],
            fmt_rub(abs(float(tx["amount"]))),
        ])

    # Totals
    data.append(["", "", "", "ИТОГО ДОХОДОВ:", fmt_rub(income_total)])
    data.append(["", "", "", "ИТОГО РАСХОДОВ:", fmt_rub(expense_total)])
    data.append(["", "", "", "ЧИСТАЯ ПРИБЫЛЬ:", fmt_rub(income_total - expense_total)])

    table = Table(data, colWidths=col_widths, repeatRows=1)
    n = len(data)
    table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), base_font),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a1a2e")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), base_font),
        ("FONTSIZE", (0, 0), (-1, 0), 9),
        ("GRID", (0, 0), (-1, n-4), 0.5, colors.lightgrey),
        ("ROWBACKGROUNDS", (0, 1), (-1, n-4), [colors.white, colors.HexColor("#f5f5f5")]),
        ("ALIGN", (4, 0), (4, -1), "RIGHT"),
        ("FONTNAME", (0, n-3), (-1, -1), base_font),
        ("FONTSIZE", (0, n-3), (-1, -1), 9),
        ("BACKGROUND", (0, n-3), (-1, -1), colors.HexColor("#f0f0e0")),
        ("LINEABOVE", (0, n-3), (-1, n-3), 1.5, colors.black),
    ]))
    story.append(table)

    story.append(Spacer(1, 1*cm))
    story.append(Paragraph(f"Документ сформирован: {date.today().strftime('%d.%m.%Y')}", sub_style))

    doc.build(story)
    return buf.getvalue()


def handler(event: dict, context) -> dict:
    cors_headers = {**CORS, "Content-Type": "application/json"}
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": {**CORS}, "body": ""}

    qs = event.get("queryStringParameters") or {}
    date_from = qs.get("date_from", "")
    date_to = qs.get("date_to", date.today().isoformat())
    taxable_only = qs.get("taxable_only", "1") == "1"

    conn = get_conn()
    cur = conn.cursor()
    try:
        conditions = ["1=1"]
        params = []
        if date_from:
            conditions.append("date >= %s"); params.append(date_from)
        if date_to:
            conditions.append("date <= %s"); params.append(date_to)
        if taxable_only:
            conditions.append("is_taxable = TRUE")
        conditions.append("status != 'Отменено'")
        where = " AND ".join(conditions)

        cur.execute(f"""
            SELECT id, date, description, category, amount, status, document_id
            FROM {SCHEMA}.transactions
            WHERE {where}
            ORDER BY date ASC, id ASC
        """, params)

        cols = ["id","date","description","category","amount","status","document_id"]
        txs = [dict(zip(cols, r)) for r in cur.fetchall()]

        # Fetch s3_url for linked documents
        for tx in txs:
            tx["s3_url"] = None
            tx["doc_name"] = None
            if tx.get("document_id"):
                cur.execute(f"SELECT s3_url, name FROM {SCHEMA}.documents WHERE id=%s", (tx["document_id"],))
                doc_row = cur.fetchone()
                if doc_row:
                    tx["s3_url"] = doc_row[0]
                    tx["doc_name"] = doc_row[1]

        income_total = sum(float(t["amount"]) for t in txs if float(t["amount"]) > 0)
        expense_total = sum(abs(float(t["amount"])) for t in txs if float(t["amount"]) < 0)

        try:
            pdf_bytes = generate_pdf_bytes(txs, date_from or "начало", date_to, income_total, expense_total)
        except ImportError:
            return {
                "statusCode": 500,
                "headers": cors_headers,
                "body": json.dumps({"error": "reportlab не установлен"}, ensure_ascii=False),
            }

        period = f"{(date_from or 'all')}_{date_to}"
        filename = f"Otchet_IP_{period}.pdf"

        return {
            "statusCode": 200,
            "headers": {
                **CORS,
                "Content-Type": "application/pdf",
                "Content-Disposition": f'attachment; filename="{filename}"',
            },
            "body": base64.b64encode(pdf_bytes).decode("ascii"),
            "isBase64Encoded": True,
        }
    finally:
        cur.close()
        conn.close()