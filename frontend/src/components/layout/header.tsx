'use client';
import { useRefreshInterval } from '@/modules/configuracion/preferences';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, LogOut, Menu, UserCircle } from 'lucide-react';
import { useMe, useLogout } from '@/modules/auth/hooks/use-auth';
import { useQuery } from '@tanstack/react-query';
import { reminders } from '@/modules/recordatorios/recordatorios.service';
const labels: Record<string, string> = {
  configuracion: 'Configuración',
  auditoria: 'Auditoría',
  dashboard: 'Dashboard',
  clientes: 'Clientes',
  suscripciones: 'Suscripciones',
  renovaciones: 'Renovaciones',
  finanzas: 'Contabilidad',
  estadisticas: 'Estadísticas',
  catalogos: 'Catálogos',
  importaciones: 'Importaciones',
  exportaciones: 'Exportaciones',
  recordatorios: 'Recordatorios',
  calendario: 'Calendario',
};
export function Header({ onMenu }: { onMenu: () => void }) {
  const refreshInterval = useRefreshInterval();

  const path = usePathname();
  const { data: user } = useMe();
  const notices = useQuery({
    queryKey: ['recordatorios', 'resumen'],
    queryFn: reminders.summary,
    enabled: Boolean(user),
    staleTime: 0,
    refetchInterval: refreshInterval,
  });
  const { mutate: logout, isPending } = useLogout();
  return (
    <header className="k13-header">
      <div className="k13-header-title">
        <button className="k13-icon-button" onClick={onMenu} aria-label="Abrir o contraer menú">
          <Menu size={21} />
        </button>
        <span>{labels[path.split('/')[1]] ?? 'K13Group'}</span>
      </div>
      <div className="k13-header-actions">
        <Link
          className="k13-icon-button"
          href="/recordatorios"
          aria-label="Ver trabajo pendiente"
          title="Ver trabajo pendiente"
        >
          <Bell size={20} />
          {!notices.isError && typeof notices.data?.atencion === 'number' && (
            <span
              className="k13-notice-count"
              aria-label={`${notices.data.atencion} avisos requieren atención`}
            >
              {notices.data.atencion > 99 ? '99+' : notices.data.atencion}
            </span>
          )}
        </Link>
        <span className="k13-user">
          <UserCircle size={28} />
          <span>
            {user?.username ?? '…'}
            <small>{user?.nombre ?? 'Sesión iniciada'}</small>
          </span>
        </span>
        <button
          className="k13-icon-button"
          onClick={() => logout()}
          disabled={isPending}
          aria-label="Cerrar sesión"
          title="Cerrar sesión"
        >
          <LogOut size={18} />
        </button>
      </div>
    </header>
  );
}
