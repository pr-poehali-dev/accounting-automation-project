-- Помечаем дублирующую транзакцию как отменённую (создана при повторном распознавании без document_id)
UPDATE t_p79040548_accounting_automatio.transactions 
SET status = 'Отменено' 
WHERE id = 14;