"""
Загрузка документа в S3.
Если use_yandex=true — загружает в Яндекс Object Storage.
Если use_yandex=false — загружает в CDN поехали.dev (по умолчанию).
POST / — принимает base64-файл, загружает в S3, возвращает URL.
Body: { file_b64, file_name, mime_type, doc_id }
"""
import json
import os
import base64
import hashlib
import traceback
import psycopg2
import boto3
from botocore.config import Config
from datetime import datetime


SCHEMA = os.environ.get("MAIN_DB_SCHEMA", "t_p79040548_accounting_automatio")
CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
}


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def resp(status, body):
    return {"statusCode": status, "headers": CORS, "body": json.dumps(body, ensure_ascii=False, default=str)}


def get_s3_settings(cur):
    cur.execute(f"SELECT bucket_name, endpoint_url, access_key, secret_key, use_yandex FROM {SCHEMA}.s3_settings WHERE id=1")
    row = cur.fetchone()
    if not row:
        return None
    return {
        "bucket": row[0], "endpoint": (row[1] or "").rstrip("/"),
        "access_key": row[2], "secret_key": row[3], "use_yandex": bool(row[4]),
    }


def upload_to_yandex(endpoint, bucket, key, data, content_type, access_key, secret_key):
    """Загружает файл в Яндекс Object Storage."""
    if not endpoint.startswith("http"):
        endpoint = "https://" + endpoint
    print(f"[upload-doc] Yandex PUT {endpoint}/{bucket}/{key}, size={len(data)}")
    s3 = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(connect_timeout=10, read_timeout=20, retries={"max_attempts": 1}, s3={"addressing_style": "virtual"}),
        region_name="ru-central1",
    )
    s3.put_object(Bucket=bucket, Key=key, Body=data, ContentType=content_type, ACL="public-read")
    url = f"https://storage.yandexcloud.net/{bucket}/{key}"
    print(f"[upload-doc] Yandex OK: {url}")
    return url


def upload_to_poehali(key, data, content_type):
    """Загружает файл в CDN поехали.dev (хранилище по умолчанию)."""
    proj_key = os.environ.get("AWS_ACCESS_KEY_ID", "")
    s3 = boto3.client(
        "s3",
        endpoint_url="https://bucket.poehali.dev",
        aws_access_key_id=proj_key,
        aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY", ""),
    )
    s3.put_object(Bucket="files", Key=key, Body=data, ContentType=content_type)
    url = f"https://cdn.poehali.dev/projects/{proj_key}/bucket/{key}"
    print(f"[upload-doc] Poehali CDN OK: {url}")
    return url


def handler(event: dict, context) -> dict:
    """Загружает документ: в Яндекс S3 если включён, иначе в CDN поехали.dev."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    if event.get("httpMethod") != "POST":
        return resp(405, {"error": "Method not allowed"})

    try:
        body = json.loads(event.get("body") or "{}")
    except Exception as e:
        return resp(400, {"error": f"bad json: {e}"})

    file_b64 = body.get("file_b64", "")
    file_name = body.get("file_name", "document")
    mime_type = body.get("mime_type", "application/octet-stream")
    doc_id = body.get("doc_id")

    if not file_b64:
        return resp(400, {"error": "file_b64 required"})

    try:
        file_bytes = base64.b64decode(file_b64)
    except Exception as e:
        return resp(400, {"error": f"bad base64: {e}"})

    file_hash = hashlib.md5(file_bytes).hexdigest()

    conn = None
    cur = None
    try:
        conn = get_conn()
        cur = conn.cursor()

        # Проверка дубликата по хешу файла
        cur.execute(
            f"SELECT id, name, created_at FROM {SCHEMA}.documents WHERE file_hash=%s LIMIT 1",
            (file_hash,)
        )
        dup = cur.fetchone()
        if dup:
            return resp(409, {
                "duplicate": True,
                "existing_id": dup[0],
                "existing_name": dup[1],
                "existing_date": str(dup[2]),
                "message": f"Файл уже загружен: «{dup[1]}»"
            })

        s3cfg = get_s3_settings(cur)

        now = datetime.now()
        folder = f"documents/{now.year}/{now.month:02d}"
        safe_name = (file_name or "document").replace(" ", "_").replace("/", "_")
        key = f"{folder}/{now.strftime('%H%M%S')}_{safe_name}"

        # Выбор хранилища: Яндекс или поехали CDN
        if s3cfg and s3cfg["use_yandex"] and s3cfg["access_key"]:
            try:
                file_url = upload_to_yandex(
                    s3cfg["endpoint"] or "https://storage.yandexcloud.net",
                    s3cfg["bucket"], key, file_bytes, mime_type,
                    s3cfg["access_key"], s3cfg["secret_key"]
                )
            except Exception as e:
                print(f"[upload-doc] Yandex error, fallback to Poehali: {e}")
                file_url = upload_to_poehali(key, file_bytes, mime_type)
        else:
            file_url = upload_to_poehali(key, file_bytes, mime_type)

        if doc_id:
            try:
                cur.execute(
                    f"UPDATE {SCHEMA}.documents SET s3_url=%s, file_key=%s, file_hash=%s WHERE id=%s",
                    (file_url, key, file_hash, doc_id)
                )
                conn.commit()
            except Exception as e:
                print(f"DB update failed: {e}")

        return resp(200, {"ok": True, "url": file_url, "key": key})

    except Exception as e:
        print("UPLOAD ERROR:", traceback.format_exc())
        return resp(500, {"error": str(e)})
    finally:
        try:
            if cur: cur.close()
            if conn: conn.close()
        except Exception:
            pass