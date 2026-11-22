-- Цвета разделов теперь и у кабинета, не только у админки.
ALTER TABLE "User" RENAME COLUMN "adminSectionColors" TO "sectionColors";
