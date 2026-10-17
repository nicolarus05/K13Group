DROP INDEX "importaciones_checksum_key";
CREATE UNIQUE INDEX "importaciones_checksum_version_mapeo_key" ON "importaciones"("checksum", "version_mapeo");
ALTER TABLE "importacion_filas" ADD COLUMN "lectura" JSONB,
  ADD COLUMN "correcciones" JSONB,
  ADD COLUMN "historial_lectura" JSONB,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "importacion_filas" ALTER COLUMN "hoja_origen" TYPE VARCHAR(31);
