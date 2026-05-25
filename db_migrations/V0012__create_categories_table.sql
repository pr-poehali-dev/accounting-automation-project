CREATE TABLE IF NOT EXISTS t_p79040548_accounting_automatio.categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO t_p79040548_accounting_automatio.categories (name, is_default) VALUES
  ('Закупка товара', true),
  ('Услуги', true),
  ('Аренда', true),
  ('Зарплаты', true),
  ('Оборудование', true),
  ('Маркетинг', true),
  ('Логистика', true),
  ('Прочее', true),
  ('Выручка', true),
  ('ГСМ', false),
  ('Расходы ГСМ', false),
  ('Канцтовары', false),
  ('Пакеты', false)
ON CONFLICT (name) DO NOTHING;