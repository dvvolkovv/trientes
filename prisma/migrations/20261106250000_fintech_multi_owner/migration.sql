-- Один аккаунт может владеть несколькими финтех-сервисами, как и несколькими
-- компаниями. Уникальный индекс по владельцу держал ограничение «один на
-- аккаунт»; вместо него — явные лимиты в серверном действии. Обычный индекс
-- добавляется: по нему идёт выборка «мои сервисы».
DROP INDEX IF EXISTS "FintechCompany_ownerUserId_key";
CREATE INDEX IF NOT EXISTS "FintechCompany_ownerUserId_idx" ON "FintechCompany"("ownerUserId");
