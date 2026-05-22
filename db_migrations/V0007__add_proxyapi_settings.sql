ALTER TABLE t_p79040548_accounting_automatio.ai_settings
  ADD COLUMN IF NOT EXISTS proxyapi_key TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS vision_provider VARCHAR(64) NOT NULL DEFAULT 'proxyapi-gpt4o';
