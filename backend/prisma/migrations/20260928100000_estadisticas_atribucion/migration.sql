-- Identificadores históricos, no relaciones con la configuración mutable.
-- No deducir IDs antiguos a partir de nombres reutilizables o del servidor actual.
ALTER TABLE "renovaciones"
 ADD COLUMN "atribucion_verificada" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "producto_id_snapshot" UUID,
 ADD COLUMN "servidor_id_snapshot" UUID,
 ADD COLUMN "referencia_id_snapshot" UUID;
ALTER TABLE "movimientos_financieros"
 ADD COLUMN "atribucion_verificada" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "producto_id_snapshot" UUID,
 ADD COLUMN "servidor_id_snapshot" UUID,
 ADD COLUMN "referencia_id_snapshot" UUID;
CREATE INDEX "renovaciones_fin_anterior_idx" ON "renovaciones" ("fin_anterior");
CREATE INDEX "renovaciones_fecha_operacion_idx" ON "renovaciones" ("fecha_operacion");
