'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, LogOut, Menu, UserCircle } from 'lucide-react';
import { useMe, useLogout } from '@/modules/auth/hooks/use-auth';
const labels: Record<string, string> = {
  dashboard: 'Dashboard',
  clientes: 'Clientes',
  suscripciones: 'Suscripciones',
  renovaciones: 'Renovaciones',
  finanzas: 'Finanzas',
  catalogos: 'Catálogos',
  importaciones: 'Importaciones',
};
export function Header({ onMenu }: { onMenu: () => void }) {
  const path = usePathname();
  const { data: user } = useMe();
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
          href="/dashboard#trabajo-pendiente"
          aria-label="Ver trabajo pendiente"
          title="Ver trabajo pendiente"
        >
          <Bell size={20} />
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
