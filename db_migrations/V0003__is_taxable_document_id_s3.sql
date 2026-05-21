ALTER TABLE t_p79040548_accounting_automatio.transactions ADD COLUMN IF NOT EXISTS is_taxable BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE t_p79040548_accounting_automatio.transactions ADD COLUMN IF NOT EXISTS document_id INTEGER REFERENCES t_p79040548_accounting_automatio.documents(id) ON DELETE SET NULL;
ALTER TABLE t_p79040548_accounting_automatio.documents ADD COLUMN IF NOT EXISTS s3_url TEXT;
CREATE TABLE IF NOT EXISTS t_p79040548_accounting_automatio.s3_settings (id INT PRIMARY KEY DEFAULT 1, bucket_name VARCHAR(255) NOT NULL DEFAULT '', endpoint_url VARCHAR(512) NOT NULL DEFAULT 'https://s3.regru.cloud', access_key VARCHAR(512) NOT NULL DEFAULT '', secret_key VARCHAR(512) NOT NULL DEFAULT '', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
INSERT INTO t_p79040548_accounting_automatio.s3_settings (id, bucket_name, endpoint_url, access_key, secret_key) VALUES (1, '', 'https://s3.regru.cloud', '', '') ON CONFLICT DO NOTHING;
