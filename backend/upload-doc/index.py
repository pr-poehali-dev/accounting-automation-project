"""
Загрузка документа в S3 (project CDN или Reg.ru).
POST / — принимает base64-файл, загружает в S3, возвращает URL.
Body: { file_b64, file_name, mime_type, doc_id }
"""
import json
import os
import base64
import hashlib
import hmac
import traceback
import psycopg2
import boto3
from datetime import datetime, timezone
from urllib.request import Request, urlopen
from urllib.error import URLError

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
    return {"bucket": row[0], "endpoint": (row[1] or "").rstrip("/"), "access_key": row[2], "secret_key": row[3]}


def _sign(key, msg):
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def _get_signature_key(secret_key, date_stamp, region, service):
    k_date = _sign(("AWS4" + secret_key).encode("utf-8"), date_stamp)
    k_region = _sign(k_date, region)
    k_service = _sign(k_region, service)
    k_signing = _sign(k_service, "aws4_request")
    return k_signing


def upload_via_presigned_put(endpoint, bucket, key, data, content_type, access_key, secret_key):
    """Загружает файл в S3 через чистый HTTP PUT с AWS Signature V4 (без boto3)."""
    region = "us-east-1"
    service = "s3"
    now = datetime.now(timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")

    url = f"{endpoint}/{bucket}/{key}"
    payload_hash = hashlib.sha256(data).hexdigest()

    canonical_headers = (
        f"content-type:{content_type}\n"
        f"host:{endpoint.replace('https://','').replace('http://','')}\n"
        f"x-amz-content-sha256:{payload_hash}\n"
        f"x-amz-date:{amz_date}\n"
    )
    signed_headers = "content-type;host;x-amz-content-sha256;x-amz-date"
    canonical_request = "\n".join([
        "PUT", f"/{bucket}/{key}", "",
        canonical_headers, signed_headers, payload_hash
    ])

    credential_scope = f"{date_stamp}/{region}/{service}/aws4_request"
    string_to_sign = "\n".join([
        "AWS4-HMAC-SHA256", amz_date, credential_scope,
        hashlib.sha256(canonical_request.encode("utf-8")).hexdigest()
    ])

    signing_key = _get_signature_key(secret_key, date_stamp, region, service)
    signature = hmac.new(signing_key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

    auth = (
        f"AWS4-HMAC-SHA256 Credential={access_key}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )

    req = Request(url, data=data, method="PUT")
    req.add_header("Content-Type", content_type)
    req.add_header("x-amz-date", amz_date)
    req.add_header("x-amz-content-sha256", payload_hash)
    req.add_header("Authorization", auth)

    resp_obj = urlopen(req, timeout=15)
    return resp_obj.status


def upload_to_project_s3(key, data, content_type):
    """Сохраняем в S3 проекта (poehali.dev CDN) — всегда доступен."""
    proj_key = os.environ.get("AWS_ACCESS_KEY_ID", "")
    s3p = boto3.client(
        "s3",
        endpoint_url="https://bucket.poehali.dev",
        aws_access_key_id=proj_key,
        aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY", ""),
    )
    s3p.put_object(Bucket="files", Key=key, Body=data, ContentType=content_type)
    url = f"https://cdn.poehali.dev/projects/{proj_key}/bucket/{key}"
    print(f"[upload-doc] Saved to project S3: {url}")
    return url


def handler(event: dict, context) -> dict:
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

    conn = None
    cur = None
    try:
        conn = get_conn()
        cur = conn.cursor()
        s3cfg = get_s3_settings(cur)

        now = datetime.now()
        folder = f"documents/{now.year}/{now.month:02d}"
        safe_name = (file_name or "document").replace(" ", "_").replace("/", "_")
        key = f"{folder}/{now.strftime('%H%M%S')}_{safe_name}"

        if s3cfg:
            endpoint = s3cfg["endpoint"]
            if not endpoint.startswith("http"):
                endpoint = "https://" + endpoint
            try:
                status_code = upload_via_presigned_put(
                    endpoint, s3cfg["bucket"], key,
                    file_bytes, mime_type,
                    s3cfg["access_key"], s3cfg["secret_key"]
                )
                file_url = f"{endpoint}/{s3cfg['bucket']}/{key}"
                print(f"[upload-doc] Uploaded to Reg.ru S3 (HTTP {status_code}): {file_url}")
            except URLError as e:
                print(f"[upload-doc] Reg.ru S3 URLError: {e} — fallback to project S3")
                file_url = upload_to_project_s3(key, file_bytes, mime_type)
            except Exception as e:
                print(f"[upload-doc] Reg.ru S3 error ({type(e).__name__}: {e}) — fallback to project S3")
                file_url = upload_to_project_s3(key, file_bytes, mime_type)
        else:
            file_url = upload_to_project_s3(key, file_bytes, mime_type)

        if doc_id:
            try:
                cur.execute(
                    f"UPDATE {SCHEMA}.documents SET s3_url=%s, file_key=%s WHERE id=%s",
                    (file_url, key, doc_id)
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
            if cur:
                cur.close()
            if conn:
                conn.close()
        except Exception:
            pass
