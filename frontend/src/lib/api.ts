import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

type RetriableRequest = InternalAxiosRequestConfig & {
  sessionRetried?: boolean;
  sessionGeneration?: number;
};
let refreshing: Promise<void> | null = null;
let generation = 0;
let endingSession: Promise<void> | null = null;
let sessionExpired = false;

api.interceptors.request.use((config: RetriableRequest) => {
  config.sessionGeneration = generation;
  return config;
});

async function endExpiredSession() {
  if (!endingSession) {
    endingSession = (async () => {
      // Borra también cookies HttpOnly y revoca la sesión restante.
      await api.post('/auth/logout');
      if (typeof window !== 'undefined') window.location.replace('/login');
    })().finally(() => {
      endingSession = null;
    });
  }
  return endingSession;
}

api.interceptors.response.use(
  (response) => {
    if (/\/auth\/login(?:$|[?])/.test(response.config.url ?? '')) {
      sessionExpired = false;
      generation += 1;
    }
    return response;
  },
  async (error: AxiosError) => {
    const config = error.config as RetriableRequest | undefined;
    if (
      error.response?.status !== 401 ||
      !config ||
      /\/auth\/(login|logout|refresh)(?:$|[?])/.test(config.url ?? '')
    )
      throw error;
    // La navegación al login puede tardar. Los 401 que llegan en ese intervalo
    // pertenecen a la sesión ya revocada y no deben iniciar otro refresh.
    if (sessionExpired) throw error;
    if (config.sessionRetried) {
      sessionExpired = true;
      await endExpiredSession();
      throw error;
    }
    config.sessionRetried = true;
    // Un 401 tardío de otra petición no debe iniciar un segundo refresh.
    if (config.sessionGeneration === generation) {
      if (!refreshing) {
        refreshing = api
          .post('/auth/refresh')
          .then(() => {
            generation += 1;
          })
          .catch(async (refreshError: unknown) => {
            if (axios.isAxiosError(refreshError) && refreshError.response?.status === 401) {
              sessionExpired = true;
              await endExpiredSession();
            }
            throw refreshError;
          })
          .finally(() => {
            refreshing = null;
          });
      }
      await refreshing;
    }
    return api.request(config);
  },
);

// Respuesta estándar de la API
export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  errors?: string[];
}

// Respuesta paginada
export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
