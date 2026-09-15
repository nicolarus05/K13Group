ALTER TABLE "importacion_filas"
  ADD COLUMN "decision" VARCHAR(30),
  ADD COLUMN "revisada_por_id" UUID,
  ADD COLUMN "revisada_at" TIMESTAMP(3),
  ADD COLUMN "observacion_revision" TEXT,
  ADD COLUMN "mapeo" JSONB;

CREATE INDEX "importacion_filas_importacion_id_decision_idx"
  ON "importacion_filas"("importacion_id", "decision");

ALTER TABLE "importacion_filas"
  ADD CONSTRAINT "importacion_filas_revisada_por_id_fkey"
  FOREIGN KEY ("revisada_por_id") REFERENCES "usuarios"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "importacion_equivalencias" (
  "id" UUID NOT NULL,
  "tipo" VARCHAR(30) NOT NULL,
  "valor_origen" VARCHAR(255) NOT NULL,
  "valor_clave" VARCHAR(255) NOT NULL,
  "valor_canonico" VARCHAR(150) NOT NULL,
  "entidad_id" UUID,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "importacion_equivalencias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "importacion_equivalencias_tipo_valor_clave_key"
  ON "importacion_equivalencias"("tipo", "valor_clave");
CREATE INDEX "importacion_equivalencias_tipo_activo_idx"
  ON "importacion_equivalencias"("tipo", "activo");
