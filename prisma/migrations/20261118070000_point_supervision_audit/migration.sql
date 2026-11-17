-- Надзор над точкой — не то же, что одобрение или мягкое удаление: свои коды.
ALTER TYPE "AdminAction" ADD VALUE 'SUSPEND_POINT';
ALTER TYPE "AdminAction" ADD VALUE 'UNSUSPEND_POINT';
