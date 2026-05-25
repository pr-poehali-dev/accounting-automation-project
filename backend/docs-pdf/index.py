"""
Генерация PDF со списком документов и их фотографиями.
Сохраняет PDF в Яндекс S3 и возвращает URL.
GET / — все документы (до 40)
GET /?ids=1,2,3 — только указанные документы
"""
import json
import os
import io
import gc
import boto3
import requests
import psycopg2
from datetime import datetime
from botocore.config import Config

SCHEMA = os.environ.get("MAIN_DB_SCHEMA", "t_p79040548_accounting_automatio")
CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
}

MAX_IMG_PX = 600
JPEG_QUALITY = 50
FONT_PATH = "/tmp/DejaVuSans.ttf"
FONT_S3_KEY = "fonts/DejaVuSans.ttf"
FONT_FALLBACK_URL = "https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf"


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def resp(status, body):
    return {"statusCode": status, "headers": CORS, "body": json.dumps(body, ensure_ascii=False, default=str)}


def get_poehali_s3():
    return boto3.client(
        "s3",
        endpoint_url="https://bucket.poehali.dev",
        aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
    )


def load_font() -> str:
    """Загружает DejaVuSans с кириллицей. Возвращает имя шрифта."""
    # Кэш
    if os.path.exists(FONT_PATH) and os.path.getsize(FONT_PATH) > 50_000:
        pass
    else:
        # Из S3 поехали
        try:
            s3 = get_poehali_s3()
            obj = s3.get_object(Bucket="files", Key=FONT_S3_KEY)
            data = obj["Body"].read()
            if len(data) > 50_000:
                with open(FONT_PATH, "wb") as f:
                    f.write(data)
                print(f"[docs-pdf] Font loaded from S3, size={len(data)}")
        except Exception as e:
            print(f"[docs-pdf] S3 font error: {e}")
            # Из интернета
            try:
                r = requests.get(FONT_FALLBACK_URL, timeout=20)
                if r.status_code == 200 and len(r.content) > 50_000:
                    with open(FONT_PATH, "wb") as f:
                        f.write(r.content)
                    # Сохраняем в S3
                    try:
                        s3 = get_poehali_s3()
                        s3.put_object(Bucket="files", Key=FONT_S3_KEY, Body=r.content, ContentType="font/ttf")
                    except Exception:
                        pass
            except Exception as e2:
                print(f"[docs-pdf] Font download failed: {e2}")

    if os.path.exists(FONT_PATH) and os.path.getsize(FONT_PATH) > 50_000:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        try:
            pdfmetrics.getFont("DejaVu")
        except Exception:
            pdfmetrics.registerFont(TTFont("DejaVu", FONT_PATH))
            pdfmetrics.registerFont(TTFont("DejaVu-Bold", FONT_PATH))
        return "DejaVu"

    return "Helvetica"


def compress_image(url: str):
    """Скачивает и сжимает до MAX_IMG_PX px, возвращает (bytes, w, h) или None."""
    from PIL import Image as PILImage
    try:
        r = requests.get(url, timeout=12)
        if r.status_code != 200:
            return None
        raw = r.content
        r = None
        img = PILImage.open(io.BytesIO(raw))
        raw = None
        img = img.convert("RGB")
        w, h = img.size
        if max(w, h) > MAX_IMG_PX:
            scale = MAX_IMG_PX / max(w, h)
            img = img.resize((int(w * scale), int(h * scale)), PILImage.LANCZOS)
            w, h = img.size
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=JPEG_QUALITY, optimize=True)
        img.close()
        gc.collect()
        return out.getvalue(), w, h
    except Exception as e:
        print(f"[docs-pdf] img err {url}: {e}")
        return None


def get_yandex_s3_cfg(conn):
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


def save_pdf(pdf_bytes: bytes, filename: str, yc) -> str:
    key = f"reports/{filename}"
    if yc:
        s3 = boto3.client(
            "s3",
            endpoint_url=yc["endpoint"],
            aws_access_key_id=yc["access_key"],
            aws_secret_access_key=yc["secret_key"],
            config=Config(s3={"addressing_style": "virtual"}),
            region_name="ru-central1",
        )
        s3.put_object(Bucket=yc["bucket"], Key=key, Body=pdf_bytes, ContentType="application/pdf",
                      ContentDisposition=f'attachment; filename="{filename}"')
        url = f"{yc['endpoint']}/{yc['bucket']}/{key}"
        print(f"[docs-pdf] Saved to Yandex S3: {url}")
        return url
    else:
        proj_key = os.environ.get("AWS_ACCESS_KEY_ID", "")
        s3 = get_poehali_s3()
        s3.put_object(Bucket="files", Key=key, Body=pdf_bytes, ContentType="application/pdf")
        url = f"https://cdn.poehali.dev/projects/{proj_key}/bucket/{key}"
        print(f"[docs-pdf] Saved to CDN: {url}")
        return url


def generate_pdf(docs: list) -> bytes:
    """Генерация PDF через canvas — постраничный рендер, минимальное потребление памяти."""
    from reportlab.pdfgen import canvas as rl_canvas
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import cm

    font = load_font()

    W, H = A4
    margin = 2 * cm
    cw = W - 2 * margin
    max_img_h = 9 * cm

    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=A4)

    now_str = datetime.now().strftime("%d.%m.%Y %H:%M")

    # Титульная страница
    c.setFont(font if font == "DejaVu" else "Helvetica-Bold", 18)
    c.drawString(margin, H - margin - 0.5*cm, "Список документов")
    c.setFont(font if font == "DejaVu" else "Helvetica", 10)
    c.setFillColorRGB(0.5, 0.5, 0.5)
    c.drawString(margin, H - margin - 1.3*cm, f"Сформирован: {now_str}   Документов: {len(docs)}")
    c.setFillColorRGB(0, 0, 0)
    c.line(margin, H - margin - 1.7*cm, W - margin, H - margin - 1.7*cm)
    c.showPage()

    # По одному документу на страницу
    for i, doc in enumerate(docs):
        name = (doc.get("name") or "Без названия")[:80]
        meta_parts = [p for p in [
            doc.get("rec_date") or str(doc.get("created_at") or "")[:10],
            doc.get("rec_type") or "",
            doc.get("rec_amount") or "",
            doc.get("rec_counterparty") or "",
        ] if p]

        y = H - margin

        # Номер и имя
        c.setFont(font if font == "DejaVu" else "Helvetica-Bold", 12)
        c.drawString(margin, y - 0.6*cm, f"{i+1}. {name}")
        y -= 1.0 * cm

        # Метаданные
        if meta_parts:
            c.setFont(font if font == "DejaVu" else "Helvetica", 8)
            c.setFillColorRGB(0.35, 0.35, 0.35)
            c.drawString(margin, y - 0.3*cm, " • ".join(meta_parts)[:100])
            c.setFillColorRGB(0, 0, 0)
            y -= 0.7 * cm

        # Разделитель
        c.setDash(2, 4)
        c.setStrokeColorRGB(0.8, 0.8, 0.8)
        c.line(margin, y, W - margin, y)
        c.setDash()
        c.setStrokeColorRGB(0, 0, 0)
        y -= 0.3 * cm

        # Фото
        s3_url = doc.get("s3_url") or ""
        if s3_url:
            result = compress_image(s3_url)
            if result:
                img_bytes, img_w, img_h = result
                try:
                    from reportlab.lib.utils import ImageReader
                    scale = min(float(cw) / img_w, float(max_img_h) / img_h, 1.0)
                    draw_w = img_w * scale
                    draw_h = img_h * scale
                    img_x = margin + (cw - draw_w) / 2
                    img_y = y - draw_h
                    c.drawImage(ImageReader(io.BytesIO(img_bytes)), img_x, img_y, width=draw_w, height=draw_h)
                except Exception as e:
                    print(f"[docs-pdf] canvas img err doc {doc.get('id')}: {e}")
                img_bytes = None
                gc.collect()

        c.showPage()

    c.save()
    result = buf.getvalue()
    buf.close()
    return result


def handler(event: dict, context) -> dict:
    """Генерирует PDF с фото документов на русском языке, сохраняет в S3."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    qs = event.get("queryStringParameters") or {}
    ids_param = qs.get("ids", "")

    conn = get_conn()
    cur = conn.cursor()

    try:
        yc = get_yandex_s3_cfg(conn)

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
            """)

        cols = ["id", "name", "s3_url", "rec_type", "rec_amount", "rec_date", "rec_counterparty", "created_at"]
        docs = [dict(zip(cols, row)) for row in cur.fetchall()]
    finally:
        cur.close()
        conn.close()

    if not docs:
        return resp(200, {"ok": False, "error": "Нет документов для генерации PDF"})

    print(f"[docs-pdf] Building PDF for {len(docs)} docs, yandex={'yes' if yc else 'no'}")
    pdf_bytes = generate_pdf(docs)

    now_str = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"Dokumenty_{now_str}.pdf"
    url = save_pdf(pdf_bytes, filename, yc)
    pdf_bytes = None
    gc.collect()

    return resp(200, {"ok": True, "url": url, "filename": filename, "count": len(docs)})