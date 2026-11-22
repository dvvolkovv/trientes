-- Слайс BV: публичные реквизиты предприятия (номер регистрации и налоговый номер),
-- своя рубрика документа и ссылка под документом.
--
-- Писано руками и применяется `migrate deploy`: этот чекаут — прод, а
-- `migrate dev` умеет предлагать сброс базы.

ALTER TABLE "Company"
  ADD COLUMN "registrationNumber" TEXT,
  ADD COLUMN "taxNumber" TEXT;

ALTER TABLE "CompanyDocument"
  ADD COLUMN "kindCustom" TEXT,
  ADD COLUMN "linkUrl" TEXT;

-- Документ без файла законен: у лицензии бывает только адрес реестра, по которому
-- её проверяют. Охранник «хотя бы одно из двух» живёт в действии, а не в колонке —
-- в базе это два независимых необязательных поля.
ALTER TABLE "CompanyDocument" ALTER COLUMN "url" DROP NOT NULL;
