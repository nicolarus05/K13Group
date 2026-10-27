-- Evita recorrer todos los movimientos por cada operación al contar deudas.
CREATE INDEX "movimientos_financieros_renovacion_id_estado_id_idx"
ON "movimientos_financieros"("renovacion_id", "estado_id");
