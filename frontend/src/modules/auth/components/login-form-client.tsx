'use client';

import dynamic from 'next/dynamic';

// Renderizado solo en cliente para evitar hydration mismatch de gestores de contraseñas
export const LoginFormClient = dynamic(
  () => import('./login-form').then((m) => ({ default: m.LoginForm })),
  { ssr: false },
);
