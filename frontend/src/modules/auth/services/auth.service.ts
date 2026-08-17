import { api } from '@/lib/api';
import type { LoginFormData } from '../schemas/login.schema';
import type { User } from '../types/auth.types';

export const authService = {
  login: (credentials: LoginFormData) =>
    api.post<{ success: boolean; data: User }>('/auth/login', credentials),

  logout: () => api.post('/auth/logout'),

  refresh: () => api.post('/auth/refresh'),

  me: () => api.get<{ success: boolean; data: User }>('/auth/me'),
};
