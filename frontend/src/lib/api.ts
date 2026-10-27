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
  sessionEpoch?: number;
};
let refreshing: Promise<void> | null = null;
let generation = 0;
let sessionEpoch = 0;
let endingSession: Promise<void> | null = null;
let sessionExpired = false;

api.interceptors.request.use(async (config: RetriableRequest) => {
  if (/\/auth\/login(?:$|[?])/.test(config.url ?? '')) {
    // Un login sustituye la sesión: primero terminar las respuestas anteriores
    // que pueden escribir cookies HttpOnly, sin permitir que cierren la nueva.
    sessionEpoch += 1;
    await refreshing?.catch(() => undefined);
    await endingSession?.catch(() => undefined);
  }
  config.sessionGeneration = generation;
  config.sessionEpoch = sessionEpoch;
  return config;
});

async function endExpiredSession() {
  if (!endingSession) {
    const epoch = sessionEpoch;
    endingSession = (async () => {
      // Borra también cookies HttpOnly y revoca la sesión restante.
      await api.post('/auth/logout', undefined, { timeout: 15000 });
      if (epoch === sessionEpoch && typeof window !== 'undefined')
        window.location.replace('/login');
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
    // Una petición de otra sesión no debe renovarse ni reintentarse con la nueva.
    if (config.sessionEpoch !== sessionEpoch) throw error;
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
        const epoch = sessionEpoch;
        refreshing = api
          .post('/auth/refresh', undefined, { timeout: 15000 })
          .then(() => {
            generation += 1;
          })
          .catch(async (refreshError: unknown) => {
            if (
              epoch === sessionEpoch &&
              axios.isAxiosError(refreshError) &&
              refreshError.response?.status === 401
            ) {
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
    if (config.sessionEpoch !== sessionEpoch) throw error;
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
