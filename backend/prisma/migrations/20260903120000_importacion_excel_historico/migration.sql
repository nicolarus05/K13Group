-- AlterTable
ALTER TABLE "clientes" ADD COLUMN "telefono_normalizado" VARCHAR(30);

-- AlterTable
ALTER TABLE "importaciones"
  ADD COLUMN "advertencias" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "checksum" VARCHAR(64),
  ADD COLUMN "estado" VARCHAR(40) NOT NULL DEFAULT 'EN_PROCESO',
  ADD COLUMN "fecha_fin" TIMESTAMP(3),
  ADD COLUMN "fecha_inicio" TIMESTAMP(3),
  ADD COLUMN "informe" JSONB,
  ADD COLUMN "version_mapeo" VARCHAR(20) NOT NULL DEFAULT '1.1';

-- AlterTable
ALTER TABLE "movimientos_financieros"
  ADD COLUMN "metodo_pago_nombre_snapshot" VARCHAR(100),
  ADD COLUMN "origen" VARCHAR(30) NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "producto_nombre_snapshot" VARCHAR(100),
  ADD COLUMN "referencia_nombre_snapshot" VARCHAR(100),
  ADD COLUMN "servidor_nombre_snapshot" VARCHAR(100),
  ADD COLUMN "tarifa_nombre_snapshot" VARCHAR(100);

-- AlterTable
ALTER TABLE "renovaciones"
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "estado_id" UUID,
  ADD COLUMN "fecha_operacion" DATE,
  ADD COLUMN "origen" VARCHAR(30) NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE "suscripciones"
  ADD COLUMN "identificador_operativo_cifrado" TEXT,
  ADD COLUMN "identificador_operativo_hash" VARCHAR(64),
  ADD COLUMN "tipo_dispositivo" VARCHAR(80);

-- CreateTable
CREATE TABLE "importacion_filas" (
  "id" UUID NOT NULL,
  "importacion_id" UUID NOT NULL,
  "hoja_origen" VARCHAR(20) NOT NULL,
  "fila_origen" INTEGER NOT NULL,
  "hash_fila" VARCHAR(64) NOT NULL,
  "datos_originales" JSONB NOT NULL,
  "datos_normalizados" JSONB,
  "estado" VARCHAR(30) NOT NULL DEFAULT 'PENDIENTE',
  "errores" JSONB,
  "advertencias" JSONB,
  "cliente_id" UUID,
  "suscripcion_id" UUID,
  "renovacion_id" UUID,
  "movimiento_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "importacion_filas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "importacion_filas_importacion_id_estado_idx" ON "importacion_filas"("importacion_id", "estado");
CREATE INDEX "importacion_filas_hash_fila_idx" ON "importacion_filas"("hash_fila");
CREATE UNIQUE INDEX "importacion_filas_importacion_id_hoja_origen_fila_origen_key" ON "importacion_filas"("importacion_id", "hoja_origen", "fila_origen");
CREATE INDEX "clientes_telefono_normalizado_idx" ON "clientes"("telefono_normalizado");
CREATE UNIQUE INDEX "importaciones_checksum_key" ON "importaciones"("checksum");
CREATE INDEX "movimientos_financieros_fecha_idx" ON "movimientos_financieros"("fecha");
CREATE INDEX "renovaciones_suscripcion_id_fecha_operacion_idx" ON "renovaciones"("suscripcion_id", "fecha_operacion");
CREATE INDEX "suscripciones_cliente_id_idx" ON "suscripciones"("cliente_id");
CREATE INDEX "suscripciones_identificador_operativo_hash_idx" ON "suscripciones"("identificador_operativo_hash");
CREATE UNIQUE INDEX "importacion_filas_renovacion_id_key" ON "importacion_filas"("renovacion_id");
CREATE UNIQUE INDEX "importacion_filas_movimiento_id_key" ON "importacion_filas"("movimiento_id");

-- AddForeignKey
ALTER TABLE "renovaciones" ADD CONSTRAINT "renovaciones_estado_id_fkey" FOREIGN KEY ("estado_id") REFERENCES "estados"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "importacion_filas" ADD CONSTRAINT "importacion_filas_importacion_id_fkey" FOREIGN KEY ("importacion_id") REFERENCES "importaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "importacion_filas" ADD CONSTRAINT "importacion_filas_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "importacion_filas" ADD CONSTRAINT "importacion_filas_suscripcion_id_fkey" FOREIGN KEY ("suscripcion_id") REFERENCES "suscripciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "importacion_filas" ADD CONSTRAINT "importacion_filas_renovacion_id_fkey" FOREIGN KEY ("renovacion_id") REFERENCES "renovaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "importacion_filas" ADD CONSTRAINT "importacion_filas_movimiento_id_fkey" FOREIGN KEY ("movimiento_id") REFERENCES "movimientos_financieros"("id") ON DELETE SET NULL ON UPDATE CASCADE;
