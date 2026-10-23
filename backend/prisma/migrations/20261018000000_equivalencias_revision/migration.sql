ALTER TABLE importaciones ADD COLUMN version_equivalencias INTEGER NOT NULL DEFAULT 0;
CREATE TABLE importacion_equivalencias_revision (
  id UUID PRIMARY KEY,
  importacion_id UUID NOT NULL REFERENCES importaciones(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('PRODUCTO','TARIFA','SERVIDOR','REFERENCIA','PAGO')),
  alcance VARCHAR(10) NOT NULL CHECK (alcance IN ('VALOR','FILA')),
  clave VARCHAR(64) NOT NULL,
  fila_id UUID,
  accion VARCHAR(20) NOT NULL CHECK (accion IN ('ASIGNAR','PENDIENTE','HEREDAR')),
  entidad_id UUID,
  historico BOOLEAN NOT NULL DEFAULT false,
  huella_destino VARCHAR(64),
  origen JSONB NOT NULL,
  dependencias JSONB NOT NULL,
  autor UUID NOT NULL,
  motivo VARCHAR(1000) NOT NULL,
  solicitud_id UUID NOT NULL UNIQUE,
  solicitud_hash VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(importacion_id, version),
  CHECK ((alcance = 'FILA') = (fila_id IS NOT NULL)),
  CHECK ((accion = 'ASIGNAR') = (entidad_id IS NOT NULL)),
  CHECK (NOT historico OR (tipo = 'SERVIDOR' AND accion = 'ASIGNAR'))
);
CREATE INDEX importacion_equivalencias_revision_origen_idx ON importacion_equivalencias_revision(importacion_id, tipo, clave);
