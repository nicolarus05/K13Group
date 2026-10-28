'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginFormData } from '../schemas/login.schema';
import { useLogin } from '../hooks/use-auth';

export function LoginForm() {
  const { mutate: login, isPending, error } = useLogin();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({ resolver: zodResolver(loginSchema) });

  const apiError = (error as { response?: { data?: { message?: string } } })
    ?.response?.data?.message;

  return (
    <form onSubmit={handleSubmit((data) => login(data))} noValidate className="space-y-4">
      <div className="space-y-1">
        <label htmlFor="username" className="block text-sm font-medium text-text-secondary">
          Usuario
        </label>
        <input
          id="username"
          type="text"
          autoComplete="username"
          disabled={isPending}
          className="w-full rounded-input border border-hover bg-background px-3 py-2 text-sm text-text-main outline-none transition-colors focus:border-primary disabled:opacity-50"
          {...register('username')}
        />
        {errors.username && (
          <p className="text-xs text-danger">{errors.username.message}</p>
        )}
      </div>

      <div className="space-y-1">
        <label htmlFor="password" className="block text-sm font-medium text-text-secondary">
          Contraseña
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          disabled={isPending}
          className="w-full rounded-input border border-hover bg-background px-3 py-2 text-sm text-text-main outline-none transition-colors focus:border-primary disabled:opacity-50"
          {...register('password')}
        />
        {errors.password && (
          <p className="text-xs text-danger">{errors.password.message}</p>
        )}
      </div>

      {apiError && <p className="text-sm text-danger">{apiError}</p>}

      <button
        type="submit"
        disabled={isPending}
        className="k13-action min-h-11 w-full rounded-button py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? 'Entrando…' : 'Iniciar sesión'}
      </button>
    </form>
  );
}
