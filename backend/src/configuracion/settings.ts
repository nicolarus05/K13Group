import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const defaults = {
  'negocio.nombre': 'K13Group',
  'negocio.logo_asset_id': '',
  'interfaz.formato_fecha': 'dd/MM/yyyy',
  'interfaz.resultados_pagina': 25,
  'suscripciones.dias_proxima': 7,
  'sistema.intervalo_comprobacion_minutos': 1,
  'interfaz.refresco_indicadores_segundos': 60,
  'seguridad.access_minutos': 15,
  'seguridad.sesion_dias': 7,
  'copias.automaticas_activas': 0,
  'copias.intervalo_horas': 24,
  'copias.conservar': 7,
};
export type Settings = typeof defaults;
export type SettingKey = keyof Settings;
export const ranges: Partial<Record<SettingKey, [number, number]>> = {
  'suscripciones.dias_proxima': [1, 365],
  'sistema.intervalo_comprobacion_minutos': [1, 60],
  'interfaz.refresco_indicadores_segundos': [15, 300],
  'seguridad.access_minutos': [5, 60],
  'seguridad.sesion_dias': [1, 30],
  'copias.automaticas_activas': [0, 1],
  'copias.intervalo_horas': [1, 168],
  'copias.conservar': [1, 90],
};
export function validSetting(key: string, value: unknown, internal = false) {
  if (
    !Object.prototype.hasOwnProperty.call(defaults, key) ||
    (!internal && key === 'negocio.logo_asset_id')
  )
    throw new BadRequestException('Ajuste no permitido: ' + key);
  const range = ranges[key as SettingKey];
  if (range && (!Number.isInteger(value) || Number(value) < range[0] || Number(value) > range[1]))
    throw new BadRequestException(`${key}: debe estar entre ${range[0]} y ${range[1]}.`);
  if (key === 'interfaz.resultados_pagina' && ![10, 25, 50, 100].includes(value as number))
    throw new BadRequestException('Tamaño de página no permitido.');
  if (key === 'interfaz.formato_fecha' && !['dd/MM/yyyy', 'yyyy-MM-dd'].includes(value as string))
    throw new BadRequestException('Formato de fecha no permitido.');
  if (
    key === 'negocio.nombre' &&
    (typeof value !== 'string' || !value.trim() || value.trim().length > 150)
  )
    throw new BadRequestException('Nombre obligatorio, hasta 150 caracteres.');
  return typeof value === 'string' ? value.trim() : value;
}
export async function readSettings(tx: Prisma.TransactionClient): Promise<Settings> {
  const result = initialSettings();
  const rows = await tx.configuracion.findMany({ where: { clave: { in: Object.keys(defaults) } } });
  for (const row of rows) {
    const key = row.clave as SettingKey;
    const value = typeof defaults[key] === 'number' ? Number(row.valor) : row.valor;
    try {
      (result as Record<string, unknown>)[key] = validSetting(key, value, true);
    } catch {
      /* legacy inválido: valor predeterminado */
    }
  }
  return result;
}
export async function warningDays(tx: Prisma.TransactionClient) {
  return (await readSettings(tx))['suscripciones.dias_proxima'];
}
export async function settingsLock(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext('configuracion'))`;
}
export async function revision(tx: Prisma.TransactionClient, clave = 'configuracion.revision') {
  return Number((await tx.configuracion.findUnique({ where: { clave } }))?.valor ?? 0);
}
export async function bumpRevision(
  tx: Prisma.TransactionClient,
  value: number,
  clave = 'configuracion.revision',
) {
  await tx.configuracion.upsert({
    where: { clave },
    create: { clave, valor: String(value) },
    update: { valor: String(value) },
  });
}

export function initialSettings(): Settings {
  const value = { ...defaults };
  for (const [key, env, unit] of [
    ['seguridad.access_minutos', 'JWT_EXPIRES_IN', 60],
    ['seguridad.sesion_dias', 'JWT_REFRESH_EXPIRES_IN', 86400],
  ] as const) {
    const match = /^(\d+)([smhd])$/.exec(process.env[env] ?? '');
    if (match) {
      const n = (Number(match[1]) * ({ s: 1, m: 60, h: 3600, d: 86400 }[match[2]] ?? 0)) / unit;
      try {
        value[key] = validSetting(key, n) as number;
      } catch {}
    }
  }
  return value;
}
