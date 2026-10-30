import { BadRequestException } from '@nestjs/common';

export const variablesMensaje = [
  'nombre_cliente',
  'usuario',
  'contrasena',
  'conexiones',
  'vencimiento',
  'aplicacion',
  'importe_pagado',
  'importe_pendiente',
  'estado_pago',
] as const;
const acceso = `👤 Usuario: {{usuario}}
🔑 Contraseña: {{contrasena}}
📺 Conexiones: {{conexiones}}
📅 Vencimiento: {{vencimiento}}
🖥 Aplicación: {{aplicacion}}`;
export const plantillasIniciales = [
  {
    tipo: 'CLIENTE_CREADO',
    nombre: 'Cliente Creado',
    texto: `Hola {{nombre_cliente}}! 👋

Tu nueva cuenta ya está activada.
No compartas tus datos de acceso y recuerda no superar el número máximo de conexiones contratado.

${acceso}
💶 Importe pagado: {{importe_pagado}}`,
  },
  {
    tipo: 'SUSCRIPCION_RENOVADA',
    nombre: 'Suscripción Renovada',
    texto: `Hola {{nombre_cliente}}! 👋

Tu suscripción ha sido renovada. ¡Gracias por seguir con nosotros!

📅 Nuevo vencimiento: {{vencimiento}}
🖥 Aplicación: {{aplicacion}}
💶 Importe pagado: {{importe_pagado}}
💳 Estado del pago: {{estado_pago}}`,
  },
  {
    tipo: 'DEMO_CREADA',
    nombre: 'Demo Creada',
    texto: `Hola {{nombre_cliente}}! 👋

Tu demo ya está preparada. Estos son tus datos de acceso:

${acceso}

Cuando la pruebes, cuéntanos qué te parece.`,
  },
  {
    tipo: 'SUSCRIPCION_POR_VENCER',
    nombre: 'Suscripción por vencer',
    texto: `Hola {{nombre_cliente}}! 👋

Te recordamos que tu suscripción está próxima a vencer.

📅 Vencimiento: {{vencimiento}}
🖥 Aplicación: {{aplicacion}}

Contacta con nosotros si quieres renovarla.`,
  },
  {
    tipo: 'SUSCRIPCION_VENCIDA',
    nombre: 'Suscripción Vencida',
    texto: `Hola {{nombre_cliente}}! 👋

Tu suscripción ha vencido.

📅 Vencimiento: {{vencimiento}}
🖥 Aplicación: {{aplicacion}}

Si quieres volver a disfrutar del servicio, contacta con nosotros para renovarla.`,
  },
] as const;
export function plantillaInicial(tipo: string) {
  const template = plantillasIniciales.find((p) => p.tipo === tipo);
  if (!template) throw new BadRequestException('Plantilla no válida.');
  return template;
}
export function validarTextoPlantilla(texto: string) {
  if (typeof texto !== 'string' || !texto.trim() || texto.length > 10000)
    throw new BadRequestException('El texto debe contener entre 1 y 10.000 caracteres.');
  const remainder = texto.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_match, variable: string) => {
    if (!(variablesMensaje as readonly string[]).includes(variable))
      throw new BadRequestException('Variable no admitida: ' + variable);
    return '';
  });
  if (remainder.includes('{{') || remainder.includes('}}'))
    throw new BadRequestException('Revisa las variables: utiliza {{nombre_variable}}.');
  return texto;
}
