'use client';

import { LogOut, User } from 'lucide-react';
import { useMe, useLogout } from '@/modules/auth/hooks/use-auth';

export function Header() {
  const { data: user } = useMe();
  const { mutate: logout, isPending } = useLogout();

  return (
    <header className="flex h-[70px] shrink-0 items-center justify-between border-b border-hover bg-panel px-6">
      {/* Saludo contextual */}
      <p className="text-sm text-text-secondary">
        Bienvenido,{' '}
        <span className="font-medium text-text-main">{user?.nombre ?? '…'}</span>
      </p>

      {/* Menú de usuario */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <User className="h-4 w-4" />
          <span>{user?.username}</span>
        </div>

        <div className="h-4 w-px bg-hover" />

        <button
          onClick={() => logout()}
          disabled={isPending}
          className="flex items-center gap-1.5 rounded-button px-2 py-1.5 text-sm text-text-secondary transition-colors hover:bg-hover hover:text-text-main disabled:opacity-50"
          title="Cerrar sesión"
        >
          <LogOut className="h-4 w-4" />
          <span>Salir</span>
        </button>
      </div>
    </header>
  );
}
