import { createHash } from 'node:crypto';
import { normalizeName, normalizePhone } from '../common/helpers/normalization';

export interface IdentityData {
  nombre: string;
  telefono: string | null;
  email: string | null;
  observaciones: string | null;
}
export const identityHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function identityData(value: unknown): IdentityData {
  const data = (value ?? {}) as Record<string, unknown>;
  const text = (key: string) =>
    typeof data[key] === 'string' ? (data[key] as string).trim() || null : null;
  return {
    nombre: text('nombre') ?? '',
    telefono: text('telefono'),
    email: text('email'),
    observaciones: text('observaciones'),
  };
}
export function identityPhone(value: string | null): string | null {
  if (!value || value.length > 30 || !/^\+?[\d ()-]+$/.test(value)) return null;
  const phone = normalizePhone(value);
  return phone && phone.length <= 15 ? phone : null;
}
export function identityProblems(data: IdentityData): string[] {
  const errors: string[] = [];
  if (data.nombre.length < 2 || data.nombre.length > 150 || !normalizeName(data.nombre))
    errors.push('Nombre obligatorio de 2 a 150 caracteres.');
  if (data.telefono && !identityPhone(data.telefono))
    errors.push('Corrige el teléfono o déjalo vacío explícitamente.');
  if (data.email && (data.email.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)))
    errors.push('Corrige el email o déjalo vacío explícitamente.');
  if ((data.observaciones?.length ?? 0) > 10000)
    errors.push('Observaciones: máximo 10.000 caracteres.');
  return errors;
}
export function identityMatch(a: IdentityData, b: IdentityData): string | null {
  const pa = identityPhone(a.telefono),
    pb = identityPhone(b.telefono);
  const na = normalizeName(a.nombre),
    nb = normalizeName(b.nombre);
  const differentEmails = a.email && b.email && a.email.toLowerCase() !== b.email.toLowerCase();
  if (differentEmails && ((pa && pa === pb) || (na && na === nb)))
    return 'Conflicto: coincidencia de nombre o teléfono con emails distintos';
  if (pa && pa === pb)
    return na && na === nb
      ? 'Mismo teléfono y nombre compatible'
      : 'Conflicto: mismo teléfono y nombres distintos';
  if (na && na === nb)
    return pa && pb
      ? 'Conflicto: mismo nombre y teléfonos distintos'
      : 'Mismo nombre; falta teléfono para contrastar';
  // Sugerencia conservadora: un único cambio en nombres largos; nunca una vinculación.
  if (Math.min(na.length, nb.length) < 5 || Math.abs(na.length - nb.length) > 1) return null;
  let i = 0,
    j = 0,
    edits = 0;
  while (i < na.length && j < nb.length) {
    if (na[i] === nb[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return null;
    if (na.length >= nb.length) i++;
    if (nb.length >= na.length) j++;
  }
  return edits + (na.length - i) + (nb.length - j) <= 1
    ? 'Nombres parecidos; comprobar identidad'
    : null;
}
