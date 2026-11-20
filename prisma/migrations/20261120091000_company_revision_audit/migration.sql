-- Коды аудита для решений по правке карточки предприятия (слайс BM).
ALTER TYPE "AdminAction" ADD VALUE IF NOT EXISTS 'APPROVE_COMPANY_REVISION';
ALTER TYPE "AdminAction" ADD VALUE IF NOT EXISTS 'REJECT_COMPANY_REVISION';
