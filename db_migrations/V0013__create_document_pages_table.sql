CREATE TABLE IF NOT EXISTS t_p79040548_accounting_automatio.document_pages (
    id SERIAL PRIMARY KEY,
    document_id INTEGER NOT NULL,
    page_number INTEGER NOT NULL DEFAULT 1,
    s3_url TEXT NOT NULL,
    file_key VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_pages_doc_id ON t_p79040548_accounting_automatio.document_pages(document_id, page_number);