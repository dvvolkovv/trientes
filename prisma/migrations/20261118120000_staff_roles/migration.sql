-- Роль сотрудника и роль владельца. Значение ADMIN остаётся в типе: убрать его
-- внутри одной миграции нельзя, а оставить бесправным значило бы запереть живую
-- запись владельца. Политика читает ADMIN как OWNER (src/lib/authz/policy.ts).
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'STAFF';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'OWNER';
