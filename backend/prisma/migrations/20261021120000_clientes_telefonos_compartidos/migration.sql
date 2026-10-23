-- Regla confirmada para el histórico: distintos clientes pueden compartir contacto.
-- Se conserva el índice no único y la normalización para buscar coincidencias.
-- No se fusionan fichas ni se cambia ningún teléfono existente.
DROP INDEX "clientes_telefono_activo_key";
