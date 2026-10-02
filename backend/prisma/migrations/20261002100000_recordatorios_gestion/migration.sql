ALTER TABLE "recordatorios"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "origen" VARCHAR(20) NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN "fecha_original" DATE,
  ADD COLUMN "solicitud_id" UUID,
  ADD COLUMN "solicitud_hash" VARCHAR(64),
  ADD COLUMN "cerrado_at" TIMESTAMP(3),
  ADD COLUMN "motivo" VARCHAR(1000),
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "movimiento_id" UUID;
UPDATE "recordatorios" SET "fecha_original" = "fecha",
  "origen" = CASE WHEN "clave_automatica" IS NOT NULL THEN 'AUTOMATICO' ELSE 'LEGACY' END;
UPDATE "recordatorios" r SET "movimiento_id" = m.id
FROM "movimientos_financieros" m
WHERE r.clave_automatica = 'C:' || m.renovacion_id::text
  AND r.suscripcion_id = m.suscripcion_id;
ALTER TABLE "recordatorios" ADD CONSTRAINT "recordatorios_movimiento_id_fkey"
  FOREIGN KEY ("movimiento_id") REFERENCES "movimientos_financieros"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "recordatorios_solicitud_id_key" ON "recordatorios"("solicitud_id");
CREATE INDEX "recordatorios_estado_id_fecha_id_idx" ON "recordatorios"("estado_id", "fecha", "id");
CREATE INDEX "recordatorios_cliente_id_fecha_idx" ON "recordatorios"("cliente_id", "fecha");
CREATE INDEX "recordatorios_movimiento_id_idx" ON "recordatorios"("movimiento_id");
