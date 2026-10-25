import { isDeepStrictEqual } from 'node:util';
import { Prisma } from '@prisma/client';

// Se aplica también al leer registros antiguos: nunca se devuelve el JSON en bruto.
const secret =
  /password|passwd|contrase|token|secret|cookie|authorization|identificadoroperativo|solicitudhash|fingerprint|^mac(?:address)?$|^devicekey$|^app$|^credenciales$|^datosoriginales$|^lectura$/i;
export function safeAuditData(value: unknown, depth = 0): Prisma.JsonValue {
  if (value === null || value === undefined) return null;
  if (depth > 12) return '[Contenido limitado]';
  if (Array.isArray(value)) return value.map((item) => safeAuditData(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        secret.test(key.replace(/[_\s-]/g, '')) ? '[Oculto]' : safeAuditData(item, depth + 1),
      ]),
    );
  }
  return value as Prisma.JsonValue;
}

export function auditChanges(before: Prisma.JsonValue, after: Prisma.JsonValue) {
  // Sin ambas instantáneas no se inventa un estado anterior para el histórico.
  if (
    !before ||
    !after ||
    Array.isArray(before) ||
    Array.isArray(after) ||
    typeof before !== 'object' ||
    typeof after !== 'object'
  )
    return null;
  // Algunos eventos guardaron solo los campos modificados. Una clave ausente
  // no prueba que se borrara; solo comparamos valores registrados en ambos lados.
  const updates =
    after.cambios && typeof after.cambios === 'object' && !Array.isArray(after.cambios)
      ? after.cambios
      : after;
  return Object.keys(before)
    .filter((campo) => Object.prototype.hasOwnProperty.call(updates, campo))
    .sort()
    .filter((campo) => !isDeepStrictEqual(before[campo], updates[campo]))
    .map((campo) => ({ campo, anterior: before[campo] ?? null, nuevo: updates[campo] ?? null }));
}

export async function writeAudit(
  tx: Prisma.TransactionClient,
  actor: string | null,
  tabla: string,
  id: string | null,
  accion: string,
  before: unknown,
  after: unknown,
) {
  const json = (v: unknown) =>
    v == null
      ? Prisma.JsonNull
      : (safeAuditData(JSON.parse(JSON.stringify(v))) as Prisma.InputJsonValue);
  await tx.actividad.create({
    data: {
      usuarioId: actor,
      tabla,
      registroId: id,
      accion,
      datosAnteriores: json(before),
      datosNuevos: json(after),
    },
  });
}
