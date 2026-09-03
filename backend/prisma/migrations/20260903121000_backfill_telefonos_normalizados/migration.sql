UPDATE "clientes"
SET "telefono_normalizado" = NULLIF(regexp_replace("telefono", '[^0-9]', '', 'g'), '')
WHERE "telefono" IS NOT NULL
  AND "telefono_normalizado" IS NULL;
