ALTER TABLE servidores ADD COLUMN observaciones TEXT;
ALTER TABLE metodos_pago ADD COLUMN orden INTEGER NOT NULL DEFAULT 0;
WITH ranked AS (SELECT id, row_number() OVER (ORDER BY nombre, id)::integer AS position FROM metodos_pago)
UPDATE metodos_pago SET orden = ranked.position FROM ranked WHERE metodos_pago.id = ranked.id;
INSERT INTO configuracion(id, clave, valor, descripcion)
VALUES (gen_random_uuid(), 'configuracion.revision', '0', 'Versión de edición'),
       (gen_random_uuid(), 'metodos_pago.revision', '0', 'Versión de orden')
ON CONFLICT (clave) DO NOTHING;
