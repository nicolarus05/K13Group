'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { Sidebar } from './sidebar';
import { Header } from './header';
import { Footer } from './footer';
import './shell.css';
export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const drawer = useRef<HTMLDialogElement>(null);
  const path = usePathname();
  const cache = useQueryClient();
  // Cualquier escritura exitosa puede afectar al resumen; también sin listas montadas.
  useEffect(
    () =>
      cache.getMutationCache().subscribe((event) => {
        if (event.type === 'updated' && event.action.type === 'success') {
          void cache.invalidateQueries({ queryKey: ['dashboard'] });
        }
      }),
    [cache],
  );
  useEffect(() => {
    drawer.current?.close();
  }, [path]);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const close = () => {
      if (media.matches) drawer.current?.close();
    };
    media.addEventListener('change', close);
    return () => media.removeEventListener('change', close);
  }, []);
  const toggle = () => {
    if (window.matchMedia('(min-width: 1024px)').matches) setCollapsed((value) => !value);
    else drawer.current?.showModal();
  };
  return (
    <div className="k13-shell">
      <a className="k13-skip" href="#main-content">
        Saltar al contenido
      </a>
      <div className="k13-desktop-nav">
        <Sidebar collapsed={collapsed} onCollapse={() => setCollapsed((v) => !v)} />
      </div>
      <dialog
        ref={drawer}
        className="k13-drawer"
        aria-label="Menú de navegación"
        onClick={(e) => {
          if (e.target === drawer.current) drawer.current.close();
        }}
      >
        <button
          className="k13-icon-button k13-drawer-close"
          onClick={() => drawer.current?.close()}
          aria-label="Cerrar menú"
        >
          <X size={20} />
        </button>
        <Sidebar onNavigate={() => drawer.current?.close()} />
      </dialog>
      <div className="k13-content">
        <Header onMenu={toggle} />
        <main
          id="main-content"
          tabIndex={-1}
          className={'k13-main' + (path === '/dashboard' ? ' k13-main-dashboard' : '')}
        >
          {children}
        </main>
        <Footer />
      </div>
    </div>
  );
}
