ALTER TABLE importacion_identidades ADD COLUMN materializada BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE importacion_lotes (
 id UUID PRIMARY KEY,
 importacion_id UUID NOT NULL,
 autor UUID NOT NULL,
 solicitud_id UUID NOT NULL UNIQUE,
 solicitud_hash VARCHAR(64) NOT NULL,
 huella VARCHAR(64) NOT NULL,
 seleccion JSONB NOT NULL,
 propuesta JSONB NOT NULL,
 resultado JSONB,
 estado VARCHAR(20) NOT NULL DEFAULT 'PREPARADO' CHECK (estado IN ('PREPARADO','APLICADO','FALLIDO')),
 motivo VARCHAR(1000) NOT NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 aplicado_at TIMESTAMP(3),
 CONSTRAINT importacion_lotes_importacion_id_fkey FOREIGN KEY(importacion_id) REFERENCES importaciones(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX importacion_lotes_importacion_id_created_at_idx ON importacion_lotes(importacion_id,created_at);
INSERT INTO estados(id,tipo,valor,etiqueta,orden,activo)
VALUES(gen_random_uuid(),'suscripcion','HISTORICA','Histórica',7,true)
ON CONFLICT(tipo,valor) DO NOTHING;
