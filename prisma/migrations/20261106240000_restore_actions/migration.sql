-- Восстановление мягко удалённых компаний и точек админом. Отдельные значения
-- в журнале: восстановление так же значимо для аудита, как удаление.
ALTER TYPE "AdminAction" ADD VALUE 'RESTORE_COMPANY';
ALTER TYPE "AdminAction" ADD VALUE 'RESTORE_POINT';
