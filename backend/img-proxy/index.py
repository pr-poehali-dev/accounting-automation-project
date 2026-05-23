"""
Прокси для изображений из Яндекс S3 — добавляет CORS заголовки.
GET /?url=https://storage.yandexcloud.net/... — возвращает изображение
"""
import os
import base64
import json
import requests

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}

ALLOWED_HOSTS = [
    "storage.yandexcloud.net",
    "cdn.poehali.dev",
    "bucket.poehali.dev",
]


def handler(event: dict, context) -> dict:
    """Проксирует изображение из S3, добавляя CORS заголовки для браузера."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": {**CORS, "Content-Type": "text/plain"}, "body": ""}

    qs = event.get("queryStringParameters") or {}
    url = qs.get("url", "")

    if not url:
        return {"statusCode": 400, "headers": {**CORS, "Content-Type": "application/json"},
                "body": json.dumps({"error": "url required"})}

    # Проверяем что URL из разрешённых источников
    allowed = any(host in url for host in ALLOWED_HOSTS)
    if not allowed:
        return {"statusCode": 403, "headers": {**CORS, "Content-Type": "application/json"},
                "body": json.dumps({"error": "forbidden host"})}

    try:
        r = requests.get(url, timeout=15, headers={"User-Agent": "Mozilla/5.0"})
        if r.status_code != 200:
            return {"statusCode": r.status_code, "headers": {**CORS, "Content-Type": "application/json"},
                    "body": json.dumps({"error": f"upstream {r.status_code}"})}

        content_type = r.headers.get("Content-Type", "image/jpeg")
        img_b64 = base64.b64encode(r.content).decode("utf-8")

        return {
            "statusCode": 200,
            "headers": {
                **CORS,
                "Content-Type": content_type,
                "Cache-Control": "public, max-age=86400",
            },
            "body": img_b64,
            "isBase64Encoded": True,
        }
    except Exception as e:
        return {"statusCode": 502, "headers": {**CORS, "Content-Type": "application/json"},
                "body": json.dumps({"error": str(e)})}
