"""
Загрузка документа в Reg.ru S3.
POST / — принимает base64-файл, загружает в S3, возвращает URL.
Body: { file_b64, file_name, mime_type, doc_id }
"""
import json
import os
import base64
import psycopg2
import boto3
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
    cur.execute(f"SELECT bucket_name, endpoint_url, access_key, secret_key FROM {SCHEMA}.s3_settings WHERE id=1")
    row = cur.fetchone()
    if not row or not row[2]:
        return None
    return {"bucket": row[0], "endpoint": row[1].rstrip("/"), "access_key": row[2], "secret_key": row[3]}


def handler(event: dict, context) -> dict:
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    if event.get("httpMethod") != "POST":
        return resp(405, {"error": "Method not allowed"})

    body = json.loads(event.get("body") or "{}")
    file_b64 = body.get("file_b64", "")
    file_name = body.get("file_name", "document")
    mime_type = body.get("mime_type", "application/octet-stream")
    doc_id = body.get("doc_id")

    if not file_b64:
        return resp(400, {"error": "file_b64 required"})

    conn = get_conn()
    cur = conn.cursor()

    try:
        s3cfg = get_s3_settings(cur)
        if not s3cfg:
            return resp(400, {"error": "S3 не настроен. Заполните настройки S3 в разделе Настройки."})

        # Build S3 key: documents/2026/05/filename.jpg
        now = datetime.now()
        folder = f"documents/{now.year}/{now.month:02d}"
        safe_name = file_name.replace(" ", "_")
        key = f"{folder}/{now.strftime('%H%M%S')}_{safe_name}"

        file_bytes = base64.b64decode(file_b64)

        endpoint = s3cfg["endpoint"]
        if not endpoint.startswith("http"):
            endpoint = "https://" + endpoint

        s3 = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=s3cfg["access_key"],
            aws_secret_access_key=s3cfg["secret_key"],
        )
        s3.put_object(
            Bucket=s3cfg["bucket"],
            Key=key,
            Body=file_bytes,
            ContentType=mime_type,
            ACL="public-read",
        )

        # Build public URL
        file_url = f"{endpoint}/{s3cfg['bucket']}/{key}"

        # Update document record
        if doc_id:
            cur.execute(f"UPDATE {SCHEMA}.documents SET s3_url=%s, file_key=%s WHERE id=%s", (file_url, key, doc_id))
            conn.commit()

        return resp(200, {"ok": True, "url": file_url, "key": key})

    except Exception as e:
        return resp(500, {"error": str(e)})
    finally:
        cur.close()
        conn.close()
