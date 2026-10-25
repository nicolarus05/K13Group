CREATE INDEX "actividad_created_at_id_idx" ON "actividad"("created_at", "id");
CREATE INDEX "actividad_tabla_registro_id_created_at_id_idx" ON "actividad"("tabla", "registro_id", "created_at", "id");
CREATE INDEX "actividad_usuario_id_created_at_id_idx" ON "actividad"("usuario_id", "created_at", "id");
