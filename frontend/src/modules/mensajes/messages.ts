import { api } from '@/lib/api';
export const messageTypes = [
  ['CLIENTE_CREADO', 'Cliente Creado'],
  ['SUSCRIPCION_RENOVADA', 'Suscripción Renovada'],
  ['DEMO_CREADA', 'Demo Creada'],
  ['SUSCRIPCION_POR_VENCER', 'Suscripción por vencer'],
  ['SUSCRIPCION_VENCIDA', 'Suscripción Vencida'],
] as const;
export const variableLabels = {
  nombre_cliente: 'Nombre del cliente',
  usuario: 'Usuario',
  contrasena: 'Contraseña',
  conexiones: 'Conexiones',
  vencimiento: 'Vencimiento',
  aplicacion: 'Aplicación',
  importe_pagado: 'Importe pagado',
  importe_pendiente: 'Importe pendiente',
  estado_pago: 'Estado del pago',
};
export type Variable = keyof typeof variableLabels;
export type Template = {
  tipo: string;
  nombre: string;
  texto: string;
  textoInicial: string;
  version: number;
};
export type TemplateList = { variables: Variable[]; plantillas: Template[] };
export type Period = {
  id: string;
  inicio: string;
  vencimiento: string;
  tipo: string;
  aplicacion: string;
  pagado: string | null;
  pendiente: string | null;
  estadoPago: string;
};
export type MessageSubscription = {
  id: string;
  version: number;
  aplicacion: string;
  servidor: string;
  inicio: string;
  vencimiento: string;
  estado: string;
  periodos: Period[];
};
export type MessageContext = {
  cliente: { id: string; nombre: string };
  suscripciones: MessageSubscription[];
};
export const messages = {
  templates: (signal?: AbortSignal) =>
    api.get<TemplateList>('/mensajes/plantillas', { signal }).then((r) => r.data),
  context: (id: string, signal?: AbortSignal) =>
    api.get<MessageContext>('/mensajes/clientes/' + id, { signal }).then((r) => r.data),
  save: (template: Template, texto: string) =>
    api
      .put<Template>('/mensajes/plantillas/' + template.tipo, { texto, version: template.version })
      .then((r) => r.data),
};
export function templateProblems(text: string) {
  const errors: string[] = [];
  if (!text.trim()) errors.push('Escribe el texto de la plantilla.');
  if (text.length > 10000) errors.push('Máximo 10.000 caracteres.');
  const rest = text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_match, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(variableLabels, key))
      errors.push('Variable no admitida: ' + key);
    return '';
  });
  if (rest.includes('{{') || rest.includes('}}'))
    errors.push('Revisa las variables: utiliza {{nombre_variable}}.');
  return [...new Set(errors)];
}
export function renderMessage(text: string, values: Partial<Record<Variable, string>>) {
  const missing = new Set<Variable>();
  const result = text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_match, key: Variable) => {
    const value = values[key];
    if (typeof value !== 'string' || !value.trim()) {
      missing.add(key);
      return `⟦Completar: ${key}⟧`;
    }
    return value;
  });
  return { text: result, missing: [...missing] };
}
export const formatMoney = (value: string | null | undefined) =>
  value == null
    ? ''
    : Number(value).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
export function formatDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(value)) return '';
  const [date, time] = value.split('T');
  const [year, month, day] = date.split('-');
  const parsed = new Date(date + 'T00:00:00Z');
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date ||
    (time && (+time.slice(0, 2) > 23 || +time.slice(3) > 59))
  )
    return '';
  return `${day}/${month}/${year}${time ? ' ' + time + ' (Madrid)' : ''}`;
}
export const sampleValues: Record<Variable, string> = {
  nombre_cliente: 'Cliente de ejemplo',
  usuario: 'usuario_ejemplo',
  contrasena: 'clave_de_ejemplo',
  conexiones: '2',
  vencimiento: '30/10/2027',
  aplicacion: 'Aplicación de ejemplo',
  importe_pagado: '140,00 €',
  importe_pendiente: '0,00 €',
  estado_pago: 'Pagado',
};
