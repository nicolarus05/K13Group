import { z } from 'zod';

export const clienteSchema = z.object({
  nombre: z.string().min(2, 'Mínimo 2 caracteres').max(150),
  telefono: z
    .string()
    .max(30)
    .optional()
    .transform((v) => v || undefined),
  email: z
    .string()
    .email('Email inválido')
    .max(150)
    .optional()
    .or(z.literal(''))
    .transform((v) => v || undefined),
  observaciones: z
    .string()
    .optional()
    .transform((v) => v || undefined),
});

export type ClienteFormData = z.infer<typeof clienteSchema>;
