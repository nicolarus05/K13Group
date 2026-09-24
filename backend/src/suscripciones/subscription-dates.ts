import { BadRequestException } from '@nestjs/common';

export const DATE_STATES = ['ACTIVA', 'PROXIMA_A_VENCER', 'VENCIDA'] as const;
export function businessDay(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  return ['year', 'month', 'day']
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join('-');
}
export function parseDay(value: string): Date {
  const date = new Date(value + 'T00:00:00.000Z');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(date.getTime()) ||
    date.getUTCFullYear() < 1000 ||
    date.getUTCFullYear() > 9998 ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new BadRequestException('Fecha inválida. Usa YYYY-MM-DD.');
  return date;
}
export function annualEnd(start: Date): Date {
  const year = start.getUTCFullYear() + 1;
  const month = start.getUTCMonth();
  const day = Math.min(start.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return new Date(Date.UTC(year, month, day));
}
export function datedState(end: Date, today: string, warningDays = 7) {
  const days = Math.round((end.getTime() - parseDay(today).getTime()) / 86400000);
  return days <= 0 ? 'VENCIDA' : days <= warningDays ? 'PROXIMA_A_VENCER' : 'ACTIVA';
}
