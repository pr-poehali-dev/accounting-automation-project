"""
Миграция файлов документов из CDN поехали.dev в Яндекс Object Storage.
POST / — запускает перенос всех документов, чьи URL начинаются с cdn.poehali.dev.
Возвращает статистику: сколько перенесено, сколько пропущено, ошибки.
"""
import json
import os
import requests
import psycopg2
import boto3
from botocore.config import Config

SCHEMA = os.environ.get("MAIN_DB_SCHEMA", "t_p79040548_accounting_automatio")
CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
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
    if not row:
        return None
    return {"bucket": row[0], "endpoint": (row[1] or "").rstrip("/"), "access_key": row[2], "secret_key": row[3]}


def make_yandex_client(s3cfg):
    endpoint = s3cfg["endpoint"]
    if not endpoint.startswith("http"):
        endpoint = "https://" + endpoint
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=s3cfg["access_key"],
        aws_secret_access_key=s3cfg["secret_key"],
        config=Config(connect_timeout=15, read_timeout=30, retries={"max_attempts": 2}, s3={"addressing_style": "virtual"}),
        region_name="ru-central1",
    ), endpoint


def handler(event: dict, context) -> dict:
    """Переносит файлы документов из CDN поехали.dev в Яндекс Object Storage и обновляет URL в БД."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    conn = get_conn()
    cur = conn.cursor()

    try:
        s3cfg = get_s3_settings(cur)
        if not s3cfg or not s3cfg["access_key"] or not s3cfg["bucket"]:
            return resp(400, {"error": "Настройки Яндекс S3 не заполнены"})

        s3_client, endpoint = make_yandex_client(s3cfg)
        bucket = s3cfg["bucket"]

        # Получаем все документы с CDN URL
        cur.execute(f"""
            SELECT id, name, s3_url, file_key
            FROM {SCHEMA}.documents
            WHERE s3_url LIKE 'https://cdn.poehali.dev/%'
            ORDER BY id
        """)
        docs = cur.fetchall()

        migrated = []
        skipped = []
        errors = []

        for doc_id, doc_name, cdn_url, file_key in docs:
            try:
                print(f"[migrate] Downloading doc {doc_id}: {cdn_url}")
                r = requests.get(cdn_url, timeout=20)
                if r.status_code != 200:
                    errors.append({"id": doc_id, "name": doc_name, "error": f"HTTP {r.status_code} при скачивании"})
                    continue

                content_type = r.headers.get("Content-Type", "image/jpeg")
                key = file_key or f"documents/{doc_id}/{doc_name}"

                s3_client.put_object(
                    Bucket=bucket,
                    Key=key,
                    Body=r.content,
                    ContentType=content_type,
                )

                # Формируем новый URL в Яндексе
                new_url = f"https://storage.yandexcloud.net/{bucket}/{key}"
                print(f"[migrate] Uploaded to Yandex: {new_url}")

                cur.execute(
                    f"UPDATE {SCHEMA}.documents SET s3_url=%s WHERE id=%s",
                    (new_url, doc_id)
                )
                conn.commit()

                migrated.append({"id": doc_id, "name": doc_name, "new_url": new_url})

            except Exception as e:
                errors.append({"id": doc_id, "name": doc_name, "error": str(e)})
                print(f"[migrate] Error doc {doc_id}: {e}")

        return resp(200, {
            "ok": True,
            "total": len(docs),
            "migrated": len(migrated),
            "skipped": len(skipped),
            "errors_count": len(errors),
            "migrated_docs": migrated,
            "errors": errors,
        })

    finally:
        cur.close()
        conn.close()
