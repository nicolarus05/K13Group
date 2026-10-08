'use client';
import { usePreferences } from '@/modules/configuracion/preferences';
export function Footer() {
  const brand = usePreferences()['negocio.nombre'];
  return (
    <footer className="border-hover bg-panel text-text-secondary border-t px-6 py-2 text-xs">
      {brand} v0.1.0
    </footer>
  );
}
