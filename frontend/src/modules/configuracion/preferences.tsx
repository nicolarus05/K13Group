'use client';
import {
  createContext,
  useCallback,
  useState,
  type Dispatch,
  type SetStateAction,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useMe } from '@/modules/auth/hooks/use-auth';

export const defaults = {
  'negocio.nombre': 'K13Group',
  'negocio.logo_asset_id': '',
  'interfaz.formato_fecha': 'dd/MM/yyyy',
  'interfaz.resultados_pagina': 25,
  'suscripciones.dias_proxima': 7,
  'sistema.intervalo_comprobacion_minutos': 1,
  'interfaz.refresco_indicadores_segundos': 60,
  'seguridad.access_minutos': 15,
  'seguridad.sesion_dias': 7,
  'copias.automaticas_activas': 0,
  'copias.intervalo_horas': 24,
  'copias.conservar': 7,
};
export type Settings = typeof defaults;
export type SettingsResponse = {
  valores: Settings;
  version: number;
  actualizadoAt?: string | null;
};
export const settingsKey = ['configuracion', 'ajustes'];
export const fetchSettings = () =>
  api.get<{ data: SettingsResponse }>('/configuracion').then((r) => r.data.data);
const Preferences = createContext(defaults);
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const user = useMe();
  const cache = useQueryClient();
  const last = useRef<number | undefined>(undefined);
  const query = useQuery({
    queryKey: settingsKey,
    queryFn: fetchSettings,
    enabled: !!user.data,
    refetchInterval: 30000,
  });
  useEffect(() => {
    const version = query.data?.version;
    if (version !== undefined && last.current !== undefined && last.current !== version)
      void cache.invalidateQueries({
        predicate: (q) => q.queryKey[0] !== 'configuracion' && q.queryKey[0] !== 'auth',
      });
    last.current = version;
  }, [query.data?.version, cache]);
  return (
    <Preferences.Provider value={{ ...defaults, ...query.data?.valores }}>
      {children}
    </Preferences.Provider>
  );
}
export const usePreferences = () => useContext(Preferences);
export const useRefreshInterval = () =>
  usePreferences()['interfaz.refresco_indicadores_segundos'] * 1000;
export const usePageSize = () => usePreferences()['interfaz.resultados_pagina'];
export function formatDate(value: string, format = 'dd/MM/yyyy') {
  const date = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '—';
  return format === 'yyyy-MM-dd' ? date : date.split('-').reverse().join('/');
}
export function useDateLabel() {
  const prefs = usePreferences();
  return (value: string) => formatDate(value, prefs['interfaz.formato_fecha']);
}

// Mantener filtros y borradores; volver a la primera página al cambiar el tamaño
// global solo cuando la pantalla no tiene un tamaño explícito.
export function useListQuery<T extends { page?: number; limit?: number }>(initial: T) {
  const size = usePageSize();
  const [state, setState] = useState(initial);
  const [previous, setPrevious] = useState(size);
  if (previous !== size) {
    setPrevious(size);
    if (state.limit === undefined) setState({ ...state, page: 1 });
  }
  return [{ limit: size, ...state }, setState] as const;
}
export function useConfiguredPage() {
  const [query, setQuery] = useListQuery<{ page: number; limit?: number }>({ page: 1 });
  const setPage: Dispatch<SetStateAction<number>> = useCallback(
    (value) =>
      setQuery((old) => ({ ...old, page: typeof value === 'function' ? value(old.page) : value })),
    [setQuery],
  );
  return [query.page, setPage, query.limit] as const;
}
