ALTER TABLE t_p79040548_accounting_automatio.documents
    ADD COLUMN IF NOT EXISTS is_cashless BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE t_p79040548_accounting_automatio.transactions
    ADD COLUMN IF NOT EXISTS is_cashless BOOLEAN NOT NULL DEFAULT FALSE;