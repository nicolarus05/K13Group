ALTER TABLE "importaciones" ADD COLUMN "version_identidades" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "importacion_identidades" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "importacion_id" UUID NOT NULL REFERENCES "importaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "estado" VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
  "datos" JSONB NOT NULL,
  "cliente_destino_id" UUID,
  "huella_cliente" VARCHAR(64),
  "historial" JSONB NOT NULL,
  "solicitud_id" UUID,
  "solicitud_hash" VARCHAR(64),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "importacion_identidades_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "importacion_identidades_solicitud_id_key" ON "importacion_identidades"("solicitud_id");
CREATE INDEX "importacion_identidades_importacion_id_idx" ON "importacion_identidades"("importacion_id");
ALTER TABLE "importacion_filas" ADD COLUMN "identidad_id" UUID REFERENCES "importacion_identidades"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "importacion_filas_identidad_id_idx" ON "importacion_filas"("identidad_id");
