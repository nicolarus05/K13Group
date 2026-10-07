BEGIN;
-- Misma normalización que normalizePhone: dígitos, sin prefijo 00, mínimo 7.
-- Si hay duplicados históricos, abortar toda la migración sin fusionar clientes.
WITH digits AS (
  SELECT id, regexp_replace(coalesce(telefono, ''), '[^0-9]', '', 'g') AS value FROM clientes
), normalized AS (
  SELECT id, CASE WHEN left(value, 2) = '00' THEN substring(value FROM 3) ELSE value END AS value FROM digits
)
UPDATE clientes c SET telefono_normalizado = CASE WHEN length(n.value) >= 7 THEN n.value ELSE NULL END
FROM normalized n WHERE c.id = n.id;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM clientes WHERE deleted_at IS NULL AND telefono_normalizado IS NOT NULL
             GROUP BY telefono_normalizado HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Hay teléfonos duplicados entre clientes no eliminados. Revisarlos antes de aplicar esta migración.';
  END IF;
END $$;

CREATE UNIQUE INDEX clientes_telefono_activo_key ON clientes (telefono_normalizado)
WHERE deleted_at IS NULL AND telefono_normalizado IS NOT NULL;
COMMIT;
