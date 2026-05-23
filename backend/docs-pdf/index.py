"""
Генерация PDF со списком документов и их фотографиями.
GET / — генерирует PDF и возвращает base64-строку для скачивания.
GET /?ids=1,2,3 — только указанные документы.
"""
import json
import os
import io
import gc
import base64
import requests
import psycopg2
from datetime import datetime

SCHEMA = os.environ.get("MAIN_DB_SCHEMA", "t_p79040548_accounting_automatio")
CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
}

# Максимальный размер стороны картинки в PDF (пикселей)
MAX_IMG_PX = 1200
JPEG_QUALITY = 65


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def resp(status, body):
    return {"statusCode": status, "headers": CORS, "body": json.dumps(body, ensure_ascii=False, default=str)}


def download_and_compress(url: str):
    """Скачивает изображение и сжимает до MAX_IMG_PX, возвращает bytes JPEG или None."""
    from PIL import Image as PILImage
    try:
        r = requests.get(url, timeout=15)
        if r.status_code != 200:
            return None
        raw = r.content
        r = None  # освобождаем память от ответа
        pil_img = PILImage.open(io.BytesIO(raw))
        raw = None
        gc.collect()
        pil_img = pil_img.convert("RGB")
        # Ресайз если больше MAX_IMG_PX
        w, h = pil_img.size
        if max(w, h) > MAX_IMG_PX:
            scale = MAX_IMG_PX / max(w, h)
            pil_img = pil_img.resize((int(w * scale), int(h * scale)), PILImage.LANCZOS)
        out = io.BytesIO()
        pil_img.save(out, format="JPEG", quality=JPEG_QUALITY, optimize=True)
        pil_img.close()
        pil_img = None
        gc.collect()
        return out.getvalue()
    except Exception as e:
        print(f"[docs-pdf] img error {url}: {e}")
        return None


def generate_pdf(docs: list) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import cm
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image, HRFlowable

    buf = io.BytesIO()
    pdf_doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=2*cm,
        rightMargin=2*cm,
        topMargin=2*cm,
        bottomMargin=2*cm,
    )

    W, H = A4
    content_width = W - 4*cm

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("title", parent=styles["Normal"], fontSize=16, fontName="Helvetica-Bold", spaceAfter=6)
    subtitle_style = ParagraphStyle("subtitle", parent=styles["Normal"], fontSize=9, fontName="Helvetica", textColor=colors.grey, spaceAfter=16)
    doc_name_style = ParagraphStyle("docname", parent=styles["Normal"], fontSize=11, fontName="Helvetica-Bold", spaceAfter=2)
    doc_meta_style = ParagraphStyle("docmeta", parent=styles["Normal"], fontSize=8, fontName="Helvetica", textColor=colors.HexColor("#666666"), spaceAfter=6)

    story = []
    now_str = datetime.now().strftime("%d.%m.%Y %H:%M")
    story.append(Paragraph("Список документов", title_style))
    story.append(Paragraph(f"Сформирован: {now_str} • Документов: {len(docs)}", subtitle_style))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#e5e7eb")))
    story.append(Spacer(1, 0.4*cm))

    for i, doc in enumerate(docs):
        name = doc.get("name") or "Без названия"
        rec_type = doc.get("rec_type") or ""
        rec_amount = doc.get("rec_amount") or ""
        rec_date = doc.get("rec_date") or str(doc.get("created_at") or "")[:10]
        rec_counterparty = doc.get("rec_counterparty") or ""
        s3_url = doc.get("s3_url") or ""

        safe_name = name.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        story.append(Paragraph(f"{i+1}. {safe_name}", doc_name_style))

        meta_parts = [p for p in [rec_date, rec_type, rec_amount, rec_counterparty] if p]
        if meta_parts:
            safe_meta = " • ".join(meta_parts).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            story.append(Paragraph(safe_meta, doc_meta_style))

        if s3_url:
            img_bytes = download_and_compress(s3_url)
            if img_bytes:
                try:
                    from PIL import Image as PILImage
                    tmp = PILImage.open(io.BytesIO(img_bytes))
                    img_w_px, img_h_px = tmp.size
                    tmp.close()
                    max_w = float(content_width)
                    max_h = float(10 * cm)
                    scale = min(max_w / img_w_px, max_h / img_h_px, 1.0)
                    rl_img = Image(io.BytesIO(img_bytes), width=img_w_px * scale, height=img_h_px * scale)
                    story.append(rl_img)
                except Exception as e:
                    print(f"[docs-pdf] rl image error doc {doc.get('id')}: {e}")
                img_bytes = None
                gc.collect()

        story.append(Spacer(1, 0.3*cm))
        story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#e5e7eb"), dash=(2, 4)))
        story.append(Spacer(1, 0.3*cm))

    pdf_doc.build(story)
    result = buf.getvalue()
    buf.close()
    return result


def handler(event: dict, context) -> dict:
    """Генерирует PDF со списком документов и их фотографиями (сжатыми)."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    qs = event.get("queryStringParameters") or {}
    ids_param = qs.get("ids", "")

    conn = get_conn()
    cur = conn.cursor()

    try:
        if ids_param:
            id_list = [int(x.strip()) for x in ids_param.split(",") if x.strip().isdigit()]
            if not id_list:
                return resp(400, {"error": "Некорректные ids"})
            placeholders = ",".join(["%s"] * len(id_list))
            cur.execute(f"""
                SELECT id, name, s3_url, rec_type, rec_amount, rec_date, rec_counterparty, created_at
                FROM {SCHEMA}.documents
                WHERE id IN ({placeholders}) AND status = 'done'
                ORDER BY created_at DESC
            """, id_list)
        else:
            cur.execute(f"""
                SELECT id, name, s3_url, rec_type, rec_amount, rec_date, rec_counterparty, created_at
                FROM {SCHEMA}.documents
                WHERE status = 'done' AND s3_url IS NOT NULL
                ORDER BY created_at DESC
                LIMIT 50
            """)

        cols = ["id", "name", "s3_url", "rec_type", "rec_amount", "rec_date", "rec_counterparty", "created_at"]
        docs = [dict(zip(cols, row)) for row in cur.fetchall()]
        cur.close()
        conn.close()

        if not docs:
            return resp(200, {"ok": False, "error": "Нет документов для генерации PDF"})

        print(f"[docs-pdf] Generating PDF for {len(docs)} docs")
        pdf_bytes = generate_pdf(docs)
        pdf_b64 = base64.b64encode(pdf_bytes).decode("utf-8")
        pdf_bytes = None
        gc.collect()

        now_str = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"documents_{now_str}.pdf"

        return resp(200, {
            "ok": True,
            "filename": filename,
            "pdf_b64": pdf_b64,
            "count": len(docs),
        })

    except Exception as e:
        import traceback
        print("DOCS-PDF ERROR:", traceback.format_exc())
        return resp(500, {"ok": False, "error": str(e)})
    finally:
        try:
            if not cur.closed:
                cur.close()
            if not conn.closed:
                conn.close()
        except Exception:
            pass
