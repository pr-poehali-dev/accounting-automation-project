"""
Генерация PDF-отчётов для налоговой.
GET /?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD&taxable_only=1&vat_rate=20&mode=report — финансовый отчёт
GET /?...&mode=docs — PDF с фото первичных документов
"""
import json
import os
import io
import base64
import psycopg2
import urllib.request
import boto3
from datetime import date

SCHEMA = os.environ.get("MAIN_DB_SCHEMA", "t_p79040548_accounting_automatio")
CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}

FONT_PATH = "/tmp/DejaVuSans.ttf"
# Шрифт хранится в S3 проекта — всегда доступен
FONT_S3_KEY = "fonts/DejaVuSans.ttf"
# Запасные публичные URL
FONT_FALLBACK_URLS = [
    "https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf",
    "https://raw.githubusercontent.com/dejavu-fonts/dejavu-fonts/master/ttf/DejaVuSans.ttf",
]


def get_s3():
    """CDN поехали.dev — используется только для шрифта."""
    return boto3.client(
        "s3",
        endpoint_url="https://bucket.poehali.dev",
        aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
    )


def get_yandex_s3_cfg():
    """Читает настройки Яндекс S3 из БД. Возвращает dict или None."""
    conn = get_conn()
    cur = conn.cursor()
    try:
        cur.execute(f"SELECT bucket_name, endpoint_url, access_key, secret_key, use_yandex FROM {SCHEMA}.s3_settings WHERE id=1")
        row = cur.fetchone()
        if not row or not row[4] or not row[2]:
            return None
        endpoint = (row[1] or "https://storage.yandexcloud.net").rstrip("/")
        if not endpoint.startswith("http"):
            endpoint = "https://" + endpoint
        return {"bucket": row[0], "endpoint": endpoint, "access_key": row[2], "secret_key": row[3]}
    finally:
        cur.close()
        conn.close()


def save_pdf(pdf_bytes: bytes, filename: str) -> str:
    """Сохраняет PDF: сначала пробует Яндекс S3, иначе — CDN поехали."""
    from botocore.config import Config
    yc = get_yandex_s3_cfg()
    if yc:
        s3 = boto3.client(
            "s3",
            endpoint_url=yc["endpoint"],
            aws_access_key_id=yc["access_key"],
            aws_secret_access_key=yc["secret_key"],
            config=Config(s3={"addressing_style": "virtual"}),
            region_name="ru-central1",
        )
        key = f"reports/{filename}"
        s3.put_object(
            Bucket=yc["bucket"],
            Key=key,
            Body=pdf_bytes,
            ContentType="application/pdf",
            ContentDisposition=f'attachment; filename="{filename}"',
        )
        url = f"{yc['endpoint']}/{yc['bucket']}/{key}"
        print(f"[pdf] Saved to Yandex S3: {url}, size={len(pdf_bytes)}")
        return url
    else:
        s3 = get_s3()
        key = f"reports/{filename}"
        proj_key = os.environ.get("AWS_ACCESS_KEY_ID", "")
        s3.put_object(
            Bucket="files",
            Key=key,
            Body=pdf_bytes,
            ContentType="application/pdf",
            ContentDisposition=f'attachment; filename="{filename}"',
        )
        url = f"https://cdn.poehali.dev/projects/{proj_key}/bucket/{key}"
        print(f"[pdf] Saved to Poehali CDN: {url}, size={len(pdf_bytes)}")
        return url


def is_valid_ttf(data: bytes) -> bool:
    return len(data) > 50_000 and data[:4] in (
        b'\x00\x01\x00\x00', b'true', b'OTTO', b'\x00\x00\x01\x00'
    )


def download_font() -> bool:
    """Загружает шрифт: кэш → S3 → внешние URL → сохраняет в S3."""
    # 1. Локальный кэш
    if os.path.exists(FONT_PATH) and os.path.getsize(FONT_PATH) > 50_000:
        with open(FONT_PATH, "rb") as f:
            if is_valid_ttf(f.read()):
                return True
        os.remove(FONT_PATH)

    # 2. Из S3 проекта
    try:
        s3 = get_s3()
        obj = s3.get_object(Bucket="files", Key=FONT_S3_KEY)
        data = obj["Body"].read()
        if is_valid_ttf(data):
            with open(FONT_PATH, "wb") as f:
                f.write(data)
            print(f"[pdf] Font loaded from S3, size={len(data)}")
            return True
    except Exception as e:
        print(f"[pdf] S3 font not found: {e}")

    # 3. Внешние URL → сохраняем в S3 для следующих вызовов
    for url in FONT_FALLBACK_URLS:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=25) as r:
                data = r.read()
            if is_valid_ttf(data):
                with open(FONT_PATH, "wb") as f:
                    f.write(data)
                # Сохраняем в S3 чтобы больше не качать
                try:
                    s3 = get_s3()
                    s3.put_object(Bucket="files", Key=FONT_S3_KEY, Body=data, ContentType="font/ttf")
                    print(f"[pdf] Font saved to S3 from {url}")
                except Exception as se:
                    print(f"[pdf] Could not save font to S3: {se}")
                return True
        except Exception as e:
            print(f"[pdf] Font URL failed {url}: {e}")
    return False


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def fmt_rub(n):
    try:
        v = float(n)
        sign = "-" if v < 0 else ""
        return f"{sign}{abs(v):,.2f} ₽".replace(",", " ")
    except Exception:
        return str(n)


def fmt_date(d):
    try:
        if hasattr(d, "strftime"):
            return d.strftime("%d.%m.%Y")
        s = str(d)[:10]
        if "-" in s:
            p = s.split("-")
            return f"{p[2]}.{p[1]}.{p[0]}"
        return s
    except Exception:
        return str(d)


def fetch_image_bytes(url: str) -> bytes | None:
    if not url:
        return None
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.read()
    except Exception:
        return None


def get_font():
    """Возвращает (font_name, font_ok)."""
    font_ok = download_font()
    if font_ok:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        try:
            # Проверяем — уже зарегистрирован?
            pdfmetrics.getFont("DejaVu")
            return "DejaVu", True
        except Exception:
            pass
        try:
            pdfmetrics.registerFont(TTFont("DejaVu", FONT_PATH))
            pdfmetrics.registerFont(TTFont("DejaVu-Bold", FONT_PATH))
            return "DejaVu", True
        except Exception as e:
            print(f"[pdf] Font register error: {e}")
    return "Helvetica", False


def make_paragraph(text, font, size=9, bold=False, color=None, align=0):
    from reportlab.platypus import Paragraph
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib import colors as rl_colors
    color = color or rl_colors.black
    style = ParagraphStyle(
        "s",
        fontName=font,
        fontSize=size,
        textColor=color,
        alignment=align,
        leading=size * 1.45,
        wordWrap="CJK",
    )
    txt = f"<b>{text}</b>" if bold else text
    return Paragraph(txt, style)


def generate_report_pdf(transactions, date_from, date_to, income_total, expense_total, vat_rate, expense_cashless=0) -> bytes:
    """PDF финансового отчёта (без фото)."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import cm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Spacer

    font, _ = get_font()

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        rightMargin=1.5 * cm, leftMargin=1.5 * cm,
        topMargin=2 * cm, bottomMargin=2 * cm,
        title="Финансовый отчёт ИП",
    )

    def P(text, size=9, bold=False, color=colors.black, align=0):
        return make_paragraph(text, font, size, bold, color, align)

    story = []
    story.append(P("Финансовый отчёт ИП", size=18, bold=True, align=1))
    story.append(P(f"Период: {fmt_date(date_from)} — {fmt_date(date_to)}", size=10, color=colors.grey, align=1))
    story.append(Spacer(1, 0.7 * cm))

    hdr = ["Дата", "Тип", "Статья затрат", "Описание", "Сумма"]
    col_widths = [2.3 * cm, 1.8 * cm, 3.5 * cm, 6.2 * cm, 3.2 * cm]

    data = [hdr]
    for tx in transactions:
        amt = float(tx["amount"])
        tx_type = "Доход" if amt >= 0 else "Расход"
        data.append([
            fmt_date(tx["date"]),
            tx_type,
            str(tx.get("category") or "")[:35],
            str(tx.get("description") or "")[:80],
            fmt_rub(abs(amt)),
        ])

    net = income_total - expense_total
    vat_amount = net * vat_rate / 100 if vat_rate > 0 else 0

    data.append(["", "", "", "ИТОГО ДОХОДОВ:", fmt_rub(income_total)])
    data.append(["", "", "", "ИТОГО РАСХОДОВ:", fmt_rub(expense_total)])
    data.append(["", "", "", "ЧИСТАЯ ПРИБЫЛЬ:", fmt_rub(net)])
    if vat_rate > 0:
        data.append(["", "", "", f"НДС {int(vat_rate)}%:", fmt_rub(vat_amount)])

    n = len(data)
    totals_start = n - (4 if vat_rate > 0 else 3)

    # Параграфы для переноса текста в ячейках
    for i in range(1, totals_start):
        row = data[i]
        data[i] = [
            P(row[0], size=8),
            P(row[1], size=8),
            P(row[2], size=8),
            P(row[3], size=8),
            P(row[4], size=8, align=2),
        ]
    for i in range(totals_start, n):
        row = data[i]
        data[i] = ["", "", "", P(row[3], size=9, bold=True, align=2), P(row[4], size=9, bold=True, align=2)]
    # Заголовок
    data[0] = [P(h, size=9, bold=True, color=colors.white) for h in hdr]

    table = Table(data, colWidths=col_widths, repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a1a2e")),
        ("ROWBACKGROUNDS", (0, 1), (-1, totals_start - 1), [colors.white, colors.HexColor("#f8f8f8")]),
        ("GRID", (0, 0), (-1, totals_start - 1), 0.4, colors.HexColor("#cccccc")),
        ("LINEABOVE", (0, totals_start), (-1, totals_start), 1.5, colors.black),
        ("BACKGROUND", (0, totals_start), (-1, -1), colors.HexColor("#f0f0e0")),
        ("ALIGN", (4, 0), (4, -1), "RIGHT"),
        ("ALIGN", (3, totals_start), (-1, -1), "RIGHT"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(table)
    story.append(Spacer(1, 0.8 * cm))

    # ── Разбивка расходов по статьям затрат ──────────────────
    expense_txs = [tx for tx in transactions if float(tx["amount"]) < 0]
    if expense_txs:
        by_cat: dict = {}
        for tx in expense_txs:
            cat = str(tx.get("category") or "Прочее")
            by_cat[cat] = by_cat.get(cat, 0) + abs(float(tx["amount"]))
        sorted_cats = sorted(by_cat.items(), key=lambda x: x[1], reverse=True)
        total_exp = sum(v for _, v in sorted_cats)

        story.append(P("Расходы по статьям затрат", size=13, bold=True))
        story.append(Spacer(1, 0.3 * cm))

        cat_hdr = ["Статья затрат", "Сумма", "Доля"]
        cat_col_widths = [8 * cm, 4 * cm, 3 * cm]
        cat_data = [[P(h, size=9, bold=True, color=colors.white) for h in cat_hdr]]
        for cat, s in sorted_cats:
            pct = f"{s / total_exp * 100:.1f}%" if total_exp > 0 else "—"
            cat_data.append([
                P(cat[:50], size=9),
                P(fmt_rub(s), size=9, align=2),
                P(pct, size=9, align=2),
            ])
        # Итого
        cat_data.append([
            P("ИТОГО РАСХОДОВ", size=9, bold=True),
            P(fmt_rub(total_exp), size=9, bold=True, align=2),
            P("100%", size=9, bold=True, align=2),
        ])
        has_cashless_row = expense_cashless > 0
        if has_cashless_row:
            pct_cashless = f"{expense_cashless / total_exp * 100:.1f}%" if total_exp > 0 else "—"
            cat_data.append([
                P("  В т.ч. по безналичному расчёту", size=9, bold=False, color=colors.HexColor("#1a56db")),
                P(fmt_rub(expense_cashless), size=9, bold=False, align=2, color=colors.HexColor("#1a56db")),
                P(pct_cashless, size=9, bold=False, align=2, color=colors.HexColor("#1a56db")),
            ])

        totals_rows = 2 if has_cashless_row else 1

        cat_table = Table(cat_data, colWidths=cat_col_widths, repeatRows=1)
        cat_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a1a2e")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -(totals_rows + 1)), [colors.white, colors.HexColor("#f8f8f8")]),
            ("GRID", (0, 0), (-1, -(totals_rows + 1)), 0.4, colors.HexColor("#cccccc")),
            ("LINEABOVE", (0, -(totals_rows)), (-1, -(totals_rows)), 1.5, colors.black),
            ("BACKGROUND", (0, -(totals_rows)), (-1, -(totals_rows)), colors.HexColor("#f0f0e0")),
            ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        story.append(cat_table)
        story.append(Spacer(1, 0.8 * cm))

    story.append(P(f"Документ сформирован: {date.today().strftime('%d.%m.%Y')}", size=8, color=colors.grey))

    doc.build(story)
    return buf.getvalue()


def generate_docs_pdf(transactions, date_from, date_to) -> bytes:
    """PDF с фото первичных документов."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import cm
    from reportlab.platypus import (
        SimpleDocTemplate, Spacer, Image, PageBreak, KeepTogether,
    )

    font, _ = get_font()

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        rightMargin=1.5 * cm, leftMargin=1.5 * cm,
        topMargin=2 * cm, bottomMargin=2 * cm,
        title="Первичные документы",
    )

    def P(text, size=9, bold=False, color=colors.black, align=0):
        return make_paragraph(text, font, size, bold, color, align)

    story = []
    story.append(P("Приложение: Первичные документы", size=16, bold=True, align=1))
    story.append(P(f"Период: {fmt_date(date_from)} — {fmt_date(date_to)}", size=10, color=colors.grey, align=1))
    story.append(Spacer(1, 0.5 * cm))

    page_width = A4[0] - 3 * cm
    max_img_h = 22 * cm

    docs_with_images = [tx for tx in transactions if tx.get("s3_url")]
    if not docs_with_images:
        story.append(Spacer(1, 2 * cm))
        story.append(P("Фотографии документов отсутствуют.", size=11, color=colors.grey, align=1))
    else:
        for i, tx in enumerate(docs_with_images, 1):
            img_bytes = fetch_image_bytes(tx["s3_url"])
            if not img_bytes:
                continue
            try:
                img_buf = io.BytesIO(img_bytes)
                img = Image(img_buf, width=page_width, height=max_img_h, kind="proportional")
                caption = (
                    f"{i}. {fmt_date(tx['date'])}  |  "
                    f"{tx.get('category') or '—'}  |  "
                    f"{fmt_rub(abs(float(tx['amount'])))}  |  "
                    f"{str(tx.get('description') or '')[:70]}"
                )
                block = KeepTogether([
                    P(caption, size=8, color=colors.HexColor("#555555")),
                    Spacer(1, 0.2 * cm),
                    img,
                    Spacer(1, 0.6 * cm),
                ])
                story.append(block)
                if i < len(docs_with_images):
                    story.append(PageBreak())
            except Exception as e:
                print(f"[pdf] Image error for tx {tx.get('id')}: {e}")
                continue

    story.append(Spacer(1, 0.5 * cm))
    story.append(P(f"Документ сформирован: {date.today().strftime('%d.%m.%Y')}", size=8, color=colors.grey))
    doc.build(story)
    return buf.getvalue()


def fetch_transactions(date_from, date_to, taxable_only):
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
        conditions.append("t.status != 'Отменено'")
        where = " AND ".join(conditions)

        cur.execute(f"""
            SELECT t.id, t.date, t.description, t.category, t.amount, t.status, t.document_id,
                   d.s3_url, t.is_cashless
            FROM {SCHEMA}.transactions t
            LEFT JOIN {SCHEMA}.documents d ON d.id = t.document_id
            WHERE {where}
            ORDER BY t.date ASC, t.id ASC
        """, params)

        cols = ["id", "date", "description", "category", "amount", "status", "document_id", "s3_url", "is_cashless"]
        txs = [dict(zip(cols, r)) for r in cur.fetchall()]
        return txs
    finally:
        cur.close()
        conn.close()


def handler(event: dict, context) -> dict:
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    qs = event.get("queryStringParameters") or {}
    date_from = qs.get("date_from", "")
    date_to = qs.get("date_to", date.today().isoformat())
    taxable_only = qs.get("taxable_only", "1") == "1"
    mode = qs.get("mode", "report")  # report | docs
    try:
        vat_rate = float(qs.get("vat_rate", "20"))
    except Exception:
        vat_rate = 20.0

    try:
        txs = fetch_transactions(date_from, date_to, taxable_only)

        income_total = sum(float(t["amount"]) for t in txs if float(t["amount"]) > 0)
        expense_total = sum(abs(float(t["amount"])) for t in txs if float(t["amount"]) < 0)
        expense_cashless = sum(abs(float(t["amount"])) for t in txs if float(t["amount"]) < 0 and t.get("is_cashless"))

        period = f"{(date_from or 'all')}_{date_to}"

        if mode == "docs":
            pdf_bytes = generate_docs_pdf(txs, date_from or "2000-01-01", date_to)
            filename = f"Dokumenty_IP_{period}.pdf"
        else:
            pdf_bytes = generate_report_pdf(txs, date_from or "2000-01-01", date_to, income_total, expense_total, vat_rate, expense_cashless)
            filename = f"Otchet_IP_{period}.pdf"

        # Сохраняем PDF в Яндекс S3 (или CDN если Яндекс не настроен)
        download_url = save_pdf(pdf_bytes, filename)

        return {
            "statusCode": 200,
            "headers": {
                **CORS,
                "Content-Type": "application/json",
            },
            "body": json.dumps({"url": download_url, "filename": filename}),
        }
    except Exception as ex:
        import traceback
        print(f"[pdf] Error: {traceback.format_exc()}")
        return {
            "statusCode": 500,
            "headers": {**CORS, "Content-Type": "application/json"},
            "body": json.dumps({"error": str(ex)}, ensure_ascii=False),
        }