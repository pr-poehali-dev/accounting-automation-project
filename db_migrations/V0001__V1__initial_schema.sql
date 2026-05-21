
-- Transactions table
CREATE TABLE t_p79040548_accounting_automatio.transactions (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    description TEXT NOT NULL,
    category VARCHAR(64) NOT NULL DEFAULT 'Прочее',
    amount NUMERIC(15, 2) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'Выполнено',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Documents table
CREATE TABLE t_p79040548_accounting_automatio.documents (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    size_label VARCHAR(32),
    file_key VARCHAR(512),
    status VARCHAR(32) NOT NULL DEFAULT 'processing',
    rec_type VARCHAR(128),
    rec_amount VARCHAR(64),
    rec_date VARCHAR(32),
    rec_counterparty VARCHAR(256),
    rec_inn VARCHAR(32),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tax reports table
CREATE TABLE t_p79040548_accounting_automatio.tax_reports (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    period VARCHAR(128) NOT NULL,
    report_type VARCHAR(64) NOT NULL DEFAULT 'Квартальный',
    status VARCHAR(32) NOT NULL DEFAULT 'Готов',
    size_label VARCHAR(32),
    file_key VARCHAR(512),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- AI settings table (single row)
CREATE TABLE t_p79040548_accounting_automatio.ai_settings (
    id INT PRIMARY KEY DEFAULT 1,
    selected_model VARCHAR(128) NOT NULL DEFAULT 'deepseek-chat',
    max_tokens INT NOT NULL DEFAULT 4096,
    temperature NUMERIC(3,2) NOT NULL DEFAULT 0.30,
    system_prompt TEXT NOT NULL DEFAULT 'Ты финансовый ИИ-ассистент для B2B компании. Отвечай профессионально, кратко и по делу. Форматируй суммы в рублях.',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default AI settings row
INSERT INTO t_p79040548_accounting_automatio.ai_settings (id) VALUES (1);
