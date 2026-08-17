import dynamic from 'next/dynamic';

// Renderizado solo en cliente para evitar hydration mismatch causado por
// extensiones de navegador (gestores de contraseñas) que modifican el DOM
const LoginForm = dynamic(
  () => import('@/modules/auth/components/login-form').then((m) => ({ default: m.LoginForm })),
  { ssr: false },
);

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6 rounded-card bg-panel p-8 shadow-lg">
        <div>
          <h1 className="text-2xl font-semibold text-text-main">K13Group</h1>
          <p className="mt-1 text-sm text-text-secondary">Accede a tu cuenta</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
