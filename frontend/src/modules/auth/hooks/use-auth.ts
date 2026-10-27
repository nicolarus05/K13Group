'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/toast';
import { authService } from '../services/auth.service';
import type { LoginFormData } from '../schemas/login.schema';

export const AUTH_QUERY_KEY = ['auth', 'me'] as const;

export function useMe() {
  return useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: () => authService.me().then((r) => r.data.data),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

export function useLogin() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (credentials: LoginFormData) =>
      authService.login(credentials).then((r) => r.data.data),
    onSuccess: (user) => {
      // El login también es accesible con otra sesión todavía en caché.
      queryClient.clear();
      queryClient.setQueryData(AUTH_QUERY_KEY, user);
      router.push('/dashboard');
      router.refresh();
    },
  });
}

export function useLogout() {
  const toast = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => authService.logout(),
    onError: () => toast.error('No se pudo cerrar la sesión. Inténtalo de nuevo.'),
    onSuccess: () => {
      queryClient.clear();
      router.push('/login');
      router.refresh();
    },
  });
}
