ALTER TABLE t_p79040548_accounting_automatio.ai_settings
  ADD COLUMN IF NOT EXISTS yandex_api_key TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS yandex_folder_id TEXT NOT NULL DEFAULT '';