ALTER TABLE "suscripciones" ADD COLUMN "no_renovar" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "suscripciones_fecha_fin_id_idx" ON "suscripciones"("fecha_fin", "id");
ALTER TABLE "renovaciones"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "solicitud_id" UUID,
  ADD COLUMN "solicitud_hash" VARCHAR(64),
  ADD COLUMN "tipo_operacion" VARCHAR(20) NOT NULL DEFAULT 'RENOVACION',
  ADD COLUMN "inicio_anterior" DATE,
  ADD COLUMN "fin_anterior" DATE,
  ADD COLUMN "anulada_at" TIMESTAMP(3),
  ADD COLUMN "motivo_anulacion" TEXT;
CREATE UNIQUE INDEX "renovaciones_solicitud_id_key" ON "renovaciones"("solicitud_id");
-- Clasificar eventos históricos existentes sin generar ingresos ni modificar fechas.
UPDATE "renovaciones" SET "tipo_operacion" = 'ALTA' WHERE "origen" = 'IMPORTACION_EXCEL_ALTA';
ALTER TABLE "movimientos_financieros"
  ADD COLUMN "operacion_clave" UUID,
  ADD COLUMN "fecha_cobro" DATE,
  ADD COLUMN "fecha_prevista_cobro" DATE;
CREATE UNIQUE INDEX "movimientos_financieros_operacion_clave_key" ON "movimientos_financieros"("operacion_clave");
ALTER TABLE "recordatorios" ADD COLUMN "clave_automatica" VARCHAR(120);
CREATE UNIQUE INDEX "recordatorios_clave_automatica_key" ON "recordatorios"("clave_automatica");
CREATE INDEX "recordatorios_suscripcion_id_estado_id_idx" ON "recordatorios"("suscripcion_id", "estado_id");
