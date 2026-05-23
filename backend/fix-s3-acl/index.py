"""
Исправляет права доступа (ACL=public-read) для файлов документов в Яндекс S3.
POST / — проставляет public-read на все объекты в папке documents/
"""
import json
import os
import psycopg2
import boto3
import requests
from botocore.config import Config

SCHEMA = os.environ.get("MAIN_DB_SCHEMA", "t_p79040548_accounting_automatio")
CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
}


def resp(status, body):
    return {"statusCode": status, "headers": CORS, "body": json.dumps(body, ensure_ascii=False, default=str)}


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def get_s3_settings(cur):
    cur.execute(f"SELECT bucket_name, endpoint_url, access_key, secret_key FROM {SCHEMA}.s3_settings WHERE id=1")
    row = cur.fetchone()
    if not row:
        return None
    endpoint = (row[1] or "https://storage.yandexcloud.net").rstrip("/")
    if not endpoint.startswith("http"):
        endpoint = "https://" + endpoint
    return {"bucket": row[0], "endpoint": endpoint, "access_key": row[2], "secret_key": row[3]}


def handler(event: dict, context) -> dict:
    """Выставляет ACL=public-read для всех документов в Яндекс S3."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    conn = get_conn()
    cur = conn.cursor()
    try:
        cfg = get_s3_settings(cur)
        if not cfg:
            return resp(400, {"error": "Настройки S3 не найдены"})

        s3 = boto3.client(
            "s3",
            endpoint_url=cfg["endpoint"],
            aws_access_key_id=cfg["access_key"],
            aws_secret_access_key=cfg["secret_key"],
            config=Config(s3={"addressing_style": "virtual"}, connect_timeout=10, read_timeout=20),
            region_name="ru-central1",
        )

        # Берём все яндексовые документы из БД
        cur.execute(f"""
            SELECT id, file_key, s3_url FROM {SCHEMA}.documents
            WHERE s3_url LIKE '%storage.yandexcloud%' AND file_key IS NOT NULL
        """)
        docs = cur.fetchall()

        fixed = []
        errors = []

        for doc_id, file_key, s3_url in docs:
            try:
                s3.put_object_acl(Bucket=cfg["bucket"], Key=file_key, ACL="public-read")
                fixed.append(doc_id)
                print(f"[fix-acl] OK doc {doc_id}: {file_key}")
            except Exception as e:
                print(f"[fix-acl] Error doc {doc_id}: {e}")
                errors.append({"id": doc_id, "key": file_key, "error": str(e)})

        return resp(200, {
            "ok": True,
            "fixed": len(fixed),
            "errors_count": len(errors),
            "errors": errors[:10],
        })
    finally:
        cur.close()
        conn.close()
