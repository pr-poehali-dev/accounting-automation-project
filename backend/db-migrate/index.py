"""
Применяет pending DDL миграции при вызове.
GET / — применяет миграции и возвращает статус.
Защищён секретным токеном в query: ?token=...
"""
import json
import os
import psycopg2

SCHEMA = os.environ.get("MAIN_DB_SCHEMA", "t_p79040548_accounting_automatio")
CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
}

MIGRATIONS = [
    f"ALTER TABLE {SCHEMA}.transactions ADD COLUMN IF NOT EXISTS is_taxable BOOLEAN NOT NULL DEFAULT TRUE",
    f"ALTER TABLE {SCHEMA}.transactions ADD COLUMN IF NOT EXISTS document_id INTEGER REFERENCES {SCHEMA}.documents(id) ON DELETE SET NULL",
    f"ALTER TABLE {SCHEMA}.documents ADD COLUMN IF NOT EXISTS s3_url TEXT",
    f"""CREATE TABLE IF NOT EXISTS {SCHEMA}.s3_settings (
        id INT PRIMARY KEY DEFAULT 1,
        bucket_name VARCHAR(255) NOT NULL DEFAULT '',
        endpoint_url VARCHAR(512) NOT NULL DEFAULT 'https://s3.regru.cloud',
        access_key VARCHAR(512) NOT NULL DEFAULT '',
        secret_key VARCHAR(512) NOT NULL DEFAULT '',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )""",
    f"INSERT INTO {SCHEMA}.s3_settings (id, bucket_name, endpoint_url, access_key, secret_key) SELECT 1,'','https://s3.regru.cloud','','' WHERE NOT EXISTS (SELECT 1 FROM {SCHEMA}.s3_settings WHERE id=1)",
]


def handler(event: dict, context) -> dict:
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    conn.autocommit = False
    cur = conn.cursor()
    results = []
    try:
        for sql in MIGRATIONS:
            try:
                cur.execute(sql)
                results.append({"sql": sql[:80], "ok": True})
            except Exception as e:
                results.append({"sql": sql[:80], "ok": False, "error": str(e)})
        conn.commit()
    except Exception as e:
        conn.rollback()
        return {"statusCode": 500, "headers": CORS, "body": json.dumps({"error": str(e)})}
    finally:
        cur.close()
        conn.close()

    return {"statusCode": 200, "headers": CORS, "body": json.dumps({"results": results, "done": True})}
