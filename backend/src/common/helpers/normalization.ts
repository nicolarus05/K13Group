/**
 * Normalizaciones deterministas usadas para buscar y deduplicar datos
 * importados. El valor original siempre debe conservarse por separado.
 */
export function normalizeComparable(value: unknown): string {
  return String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

export function normalizeName(value: unknown): string {
  return normalizeComparable(value).replace(/[^A-Z0-9 ]/g, '').trim();
}

/** Devuelve los dígitos del teléfono para comparar formatos equivalentes. */
export function normalizePhone(value: unknown): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;

  let digits = text.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);

  return digits.length >= 7 ? digits : null;
}

export function cleanOptionalText(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}
