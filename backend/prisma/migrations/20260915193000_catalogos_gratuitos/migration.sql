ALTER TABLE "metodos_pago" ADD COLUMN "es_gratuito" BOOLEAN NOT NULL DEFAULT false;
UPDATE "metodos_pago" SET "es_gratuito" = true WHERE lower(trim(nombre)) = 'gratis';
ALTER TABLE "referencias" ALTER COLUMN "nombre" TYPE VARCHAR(150);
ALTER TABLE "renovaciones" ALTER COLUMN "referencia_nombre_snapshot" TYPE VARCHAR(150);
ALTER TABLE "movimientos_financieros" ALTER COLUMN "referencia_nombre_snapshot" TYPE VARCHAR(150);
