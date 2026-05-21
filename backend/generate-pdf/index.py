"""
Генерация PDF-отчёта для налоговой.
GET /?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD&taxable_only=1&vat_rate=20
Возвращает PDF с таблицей операций + фото документов.
"""
import json
import os
import io
import base64
import psycopg2
import urllib.request
import urllib.error
from datetime import date

SCHEMA = os.environ.get("MAIN_DB_SCHEMA", "t_p79040548_accounting_automatio")
CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}

# Надёжные зеркала для шрифта с кириллицей
FONT_URLS = [
    "https://cdn.jsdelivr.net/npm/@fontsource/dejavu-sans@4.5.0/files/dejavu-sans-latin-400-normal.woff2",
    "https://github.com/dejavu-fonts/dejavu-fonts/raw/refs/heads/master/ttf/DejaVuSans.ttf",
    "https://raw.githubusercontent.com/Mosman1418/DejaVuSans/master/DejaVuSans.ttf",
]
FONT_PATH = "/tmp/DejaVuSans.ttf"


def download_font() -> bool:
    if os.path.exists(FONT_PATH) and os.path.getsize(FONT_PATH) > 100_000:
        return True
    for url in FONT_URLS:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=10) as r:
                data = r.read()
            if len(data) > 100_000:
                with open(FONT_PATH, "wb") as f:
                    f.write(data)
                return True
        except Exception:
            continue
    return False


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def fmt_rub(n):
    try:
        v = float(n)
        return f"{v:,.2f} RUB".replace(",", " ")
    except Exception:
        return str(n)


def fmt_date(d):
    try:
        if hasattr(d, "strftime"):
            return d.strftime("%d.%m.%Y")
        s = str(d)[:10]
        if "-" in s:
            parts = s.split("-")
            return f"{parts[2]}.{parts[1]}.{parts[0]}"
        return s
    except Exception:
        return str(d)


def fetch_image_bytes(url: str) -> bytes | None:
    """Скачивает изображение по URL, возвращает bytes или None."""
    if not url:
        return None
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=8) as r:
            return r.read()
    except Exception:
        return None


def generate_pdf_bytes(transactions, date_from, date_to, income_total, expense_total, vat_rate):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import cm
    from reportlab.platypus import (
        SimpleDocTemplate, Table, TableStyle, Paragraph,
        Spacer, Image, PageBreak, KeepTogether,
    )
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    # --- Шрифт ---
    font_ok = download_font()
    if font_ok:
        try:
            pdfmetrics.registerFont(TTFont("DejaVu", FONT_PATH))
            base_font = "DejaVu"
        except Exception:
            base_font = "Helvetica"
    else:
        base_font = "Helvetica"

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        rightMargin=1.5 * cm, leftMargin=1.5 * cm,
        topMargin=2 * cm, bottomMargin=2 * cm,
    )

    def P(text, size=9, bold=False, color=colors.black, align=0):
        return Paragraph(
            f"<b>{text}</b>" if bold else text,
            ParagraphStyle("p", fontName=base_font, fontSize=size,
                           textColor=color, alignment=align, leading=size * 1.4),
        )

    story = []

    # === Страница 1: Финансовый отчёт ===
    story.append(P("Finansovyj otchet IP" if base_font == "Helvetica" else "Финансовый отчёт ИП",
                   size=16, bold=True, align=1))
    period_label = f"{fmt_date(date_from)} -- {fmt_date(date_to)}" if base_font == "Helvetica" else f"Период: {fmt_date(date_from)} — {fmt_date(date_to)}"
    story.append(P(period_label, size=10, color=colors.grey, align=1))
    story.append(Spacer(1, 0.6 * cm))

    # Таблица операций
    col_widths = [2.2 * cm, 2.2 * cm, 3.5 * cm, 6.0 * cm, 3.1 * cm]

    def safe(s, maxlen=80):
        return str(s or "")[:maxlen]

    if base_font == "Helvetica":
        hdr = ["Data", "Tip", "Statia", "Opisanie", "Summa"]
        totals_labels = ["ITOGO DOKHODOV:", "ITOGO RASKHODOV:", "CHISTAYA PRIBYL:"]
    else:
        hdr = ["Дата", "Тип", "Статья", "Описание", "Сумма"]
        totals_labels = ["ИТОГО ДОХОДОВ:", "ИТОГО РАСХОДОВ:", "ЧИСТАЯ ПРИБЫЛЬ:"]

    data = [hdr]
    for tx in transactions:
        amt = float(tx["amount"])
        tx_type = ("Доход" if amt >= 0 else "Расход") if base_font != "Helvetica" else ("+" if amt >= 0 else "-")
        data.append([
            fmt_date(tx["date"]),
            tx_type,
            safe(tx["category"], 30),
            safe(tx["description"], 70),
            fmt_rub(abs(amt)),
        ])

    net = income_total - expense_total
    vat_amount = net * vat_rate / 100 if vat_rate > 0 else 0

    data.append(["", "", "", totals_labels[0], fmt_rub(income_total)])
    data.append(["", "", "", totals_labels[1], fmt_rub(expense_total)])
    data.append(["", "", "", totals_labels[2], fmt_rub(net)])
    if vat_rate > 0:
        vat_label = f"NDS {vat_rate}%:" if base_font == "Helvetica" else f"НДС {vat_rate}%:"
        data.append(["", "", "", vat_label, fmt_rub(vat_amount)])

    n = len(data)
    totals_start = n - (4 if vat_rate > 0 else 3)

    table = Table(data, colWidths=col_widths, repeatRows=1)
    table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), base_font),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a1a2e")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, 0), 9),
        ("GRID", (0, 0), (-1, totals_start - 1), 0.5, colors.lightgrey),
        ("ROWBACKGROUNDS", (0, 1), (-1, totals_start - 1),
         [colors.white, colors.HexColor("#f5f5f5")]),
        ("ALIGN", (4, 0), (4, -1), "RIGHT"),
        ("ALIGN", (3, totals_start), (3, -1), "RIGHT"),
        ("FONTNAME", (0, totals_start), (-1, -1), base_font),
        ("FONTSIZE", (0, totals_start), (-1, -1), 9),
        ("BACKGROUND", (0, totals_start), (-1, -1), colors.HexColor("#f0f0e0")),
        ("LINEABOVE", (0, totals_start), (-1, totals_start), 1.5, colors.black),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(table)

    story.append(Spacer(1, 0.8 * cm))
    gen_label = f"Dokument sformirovan: {date.today().strftime('%d.%m.%Y')}" if base_font == "Helvetica" \
        else f"Документ сформирован: {date.today().strftime('%d.%m.%Y')}"
    story.append(P(gen_label, size=8, color=colors.grey))

    # === Страницы с фото документов ===
    docs_with_images = [
        tx for tx in transactions
        if tx.get("s3_url") or tx.get("previewB64")
    ]

    if docs_with_images:
        story.append(PageBreak())
        attach_title = "Prilozhenie: Dokumenty" if base_font == "Helvetica" else "Приложение: Первичные документы"
        story.append(P(attach_title, size=14, bold=True, align=1))
        story.append(Spacer(1, 0.4 * cm))

        page_width = A4[0] - 3 * cm  # ширина контента
        max_img_h = 18 * cm

        for i, tx in enumerate(docs_with_images, 1):
            img_bytes = None
            if tx.get("s3_url"):
                img_bytes = fetch_image_bytes(tx["s3_url"])

            if not img_bytes:
                continue

            try:
                img_buf = io.BytesIO(img_bytes)
                img = Image(img_buf, width=page_width, height=max_img_h, kind="proportional")

                caption = (
                    f"{i}. {fmt_date(tx['date'])} | {tx.get('category', '')} | "
                    f"{fmt_rub(abs(float(tx['amount'])))} | {safe(tx.get('description', ''), 60)}"
                )
                block = KeepTogether([
                    P(caption, size=8, color=colors.grey),
                    Spacer(1, 0.2 * cm),
                    img,
                    Spacer(1, 0.5 * cm),
                ])
                story.append(block)

                # Новая страница после каждого 2-го документа
                if i % 2 == 0 and i < len(docs_with_images):
                    story.append(PageBreak())
            except Exception:
                continue

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
    try:
        vat_rate = float(qs.get("vat_rate", "20"))
    except Exception:
        vat_rate = 20.0

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

        cols = ["id", "date", "description", "category", "amount", "status", "document_id"]
        txs = [dict(zip(cols, r)) for r in cur.fetchall()]

        for tx in txs:
            tx["s3_url"] = None
            tx["doc_name"] = None
            if tx.get("document_id"):
                cur.execute(
                    f"SELECT s3_url, name FROM {SCHEMA}.documents WHERE id=%s",
                    (tx["document_id"],),
                )
                doc_row = cur.fetchone()
                if doc_row:
                    tx["s3_url"] = doc_row[0]
                    tx["doc_name"] = doc_row[1]

        income_total = sum(float(t["amount"]) for t in txs if float(t["amount"]) > 0)
        expense_total = sum(abs(float(t["amount"])) for t in txs if float(t["amount"]) < 0)

        try:
            pdf_bytes = generate_pdf_bytes(
                txs, date_from or "2000-01-01", date_to,
                income_total, expense_total, vat_rate,
            )
        except Exception as e:
            return {
                "statusCode": 500,
                "headers": cors_headers,
                "body": json.dumps({"error": str(e)}, ensure_ascii=False),
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
