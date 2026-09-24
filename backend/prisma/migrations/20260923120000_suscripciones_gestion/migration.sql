ALTER TABLE "suscripciones" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "solicitud_id" UUID,
  ADD COLUMN "solicitud_hash" VARCHAR(64);
CREATE UNIQUE INDEX "suscripciones_solicitud_id_key" ON "suscripciones"("solicitud_id");
ALTER TABLE "actividad" ALTER COLUMN "usuario_id" DROP NOT NULL;
