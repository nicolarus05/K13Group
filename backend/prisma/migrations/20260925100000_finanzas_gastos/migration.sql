ALTER TABLE "movimientos_financieros"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "solicitud_hash" VARCHAR(64),
  ADD COLUMN "concepto" VARCHAR(200),
  ADD COLUMN "observaciones" VARCHAR(1000),
  ADD COLUMN "categoria_nombre_snapshot" VARCHAR(100),
  ADD COLUMN "anulada_at" TIMESTAMP(3),
  ADD COLUMN "motivo_anulacion" VARCHAR(1000),
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "movimientos_financieros_fecha_cobro_idx" ON "movimientos_financieros"("fecha_cobro");
CREATE INDEX "movimientos_financieros_tipo_id_estado_id_fecha_idx" ON "movimientos_financieros"("tipo_id", "estado_id", "fecha");
CREATE INDEX "movimientos_financieros_categoria_gasto_id_fecha_idx" ON "movimientos_financieros"("categoria_gasto_id", "fecha");
CREATE INDEX "movimientos_financieros_metodo_pago_id_fecha_idx" ON "movimientos_financieros"("metodo_pago_id", "fecha");
