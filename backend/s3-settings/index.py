"""
Настройки Яндекс Object Storage: получение, обновление, тест подключения.
GET /              — текущие настройки (секретный ключ замаскирован)
PUT /              — сохранить настройки
GET /?action=test  — проверить подключение к бакету
"""
import json
import os
import psycopg2
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError, NoCredentialsError

SCHEMA = os.environ.get("MAIN_DB_SCHEMA", "t_p79040548_accounting_automatio")
CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
}

YANDEX_ENDPOINT = "https://storage.yandexcloud.net"


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def resp(status, body):
    return {"statusCode": status, "headers": CORS, "body": json.dumps(body, ensure_ascii=False, default=str)}


def mask(s):
    if not s:
        return ""
    if len(s) <= 8:
        return "●" * len(s)
    return s[:4] + "●" * (len(s) - 8) + s[-4:]


def get_settings(cur):
    cur.execute(f"SELECT bucket_name, endpoint_url, access_key, secret_key, use_yandex FROM {SCHEMA}.s3_settings WHERE id=1")
    row = cur.fetchone()
    if not row:
        return None
    return {"bucket_name": row[0], "endpoint_url": row[1], "access_key": row[2], "secret_key": row[3], "use_yandex": bool(row[4])}


def handler(event: dict, context) -> dict:
    """Управляет настройками Яндекс Object Storage: чтение, сохранение, тест подключения."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    method = event.get("httpMethod", "GET")
    qs = event.get("queryStringParameters") or {}

    conn = get_conn()
    cur = conn.cursor()

    try:
        # GET /?action=test — тест подключения
        if method == "GET" and qs.get("action") == "test":
            s = get_settings(cur)
            if not s or not s["access_key"] or not s["bucket_name"]:
                return resp(200, {"ok": False, "error": "Настройки Яндекс S3 не заполнены"})
            try:
                endpoint = s["endpoint_url"].rstrip("/") if s["endpoint_url"] else YANDEX_ENDPOINT
                if not endpoint.startswith("http"):
                    endpoint = "https://" + endpoint
                client = boto3.client(
                    "s3",
                    endpoint_url=endpoint,
                    aws_access_key_id=s["access_key"],
                    aws_secret_access_key=s["secret_key"],
                    config=Config(
                        connect_timeout=8,
                        read_timeout=10,
                        s3={"addressing_style": "virtual"},
                    ),
                    region_name="ru-central1",
                )
                # list_objects надёжнее чем head_bucket для проверки доступа
                client.list_objects_v2(Bucket=s["bucket_name"], MaxKeys=1)
                return resp(200, {"ok": True, "message": f"Подключение к бакету «{s['bucket_name']}» успешно!"})
            except ClientError as e:
                code = e.response["Error"]["Code"]
                msg = e.response["Error"].get("Message", str(e))
                return resp(200, {"ok": False, "error": f"Ошибка {code}: {msg}"})
            except NoCredentialsError:
                return resp(200, {"ok": False, "error": "Неверный Access Key ID или Secret Key"})
            except Exception as e:
                return resp(200, {"ok": False, "error": str(e)})

        # GET / — получить текущие настройки
        if method == "GET":
            s = get_settings(cur)
            if not s:
                return resp(200, {"settings": {
                    "bucket_name": "", "endpoint_url": YANDEX_ENDPOINT,
                    "access_key": "", "secret_key_masked": "",
                    "configured": False, "use_yandex": False,
                }})
            return resp(200, {"settings": {
                "bucket_name": s["bucket_name"],
                "endpoint_url": s["endpoint_url"] or YANDEX_ENDPOINT,
                "access_key": s["access_key"],
                "secret_key_masked": mask(s["secret_key"]),
                "configured": bool(s["access_key"] and s["bucket_name"]),
                "use_yandex": s["use_yandex"],
            }})

        # PUT / — сохранить настройки
        if method == "PUT":
            body = json.loads(event.get("body") or "{}")
            s = get_settings(cur)
            bucket = body.get("bucket_name", s["bucket_name"] if s else "")
            endpoint = body.get("endpoint_url", s["endpoint_url"] if s else YANDEX_ENDPOINT) or YANDEX_ENDPOINT
            access = body.get("access_key", s["access_key"] if s else "")
            secret = body.get("secret_key") or (s["secret_key"] if s else "")
            use_yandex = body.get("use_yandex", s["use_yandex"] if s else False)

            if s:
                cur.execute(f"""
                    UPDATE {SCHEMA}.s3_settings
                    SET bucket_name=%s, endpoint_url=%s, access_key=%s, secret_key=%s, use_yandex=%s, updated_at=NOW()
                    WHERE id=1
                """, (bucket, endpoint, access, secret, use_yandex))
            else:
                cur.execute(f"""
                    INSERT INTO {SCHEMA}.s3_settings (id, bucket_name, endpoint_url, access_key, secret_key, use_yandex)
                    VALUES (1, %s, %s, %s, %s, %s)
                """, (bucket, endpoint, access, secret, use_yandex))
            conn.commit()
            return resp(200, {"ok": True, "settings": {
                "bucket_name": bucket, "endpoint_url": endpoint,
                "access_key": access, "secret_key_masked": mask(secret),
                "use_yandex": use_yandex,
            }})

        return resp(405, {"error": "Method not allowed"})

    finally:
        cur.close()
        conn.close()