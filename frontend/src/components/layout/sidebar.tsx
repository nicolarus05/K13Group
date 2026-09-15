'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Users,
  CreditCard,
  RefreshCw,
  Package,
  DollarSign,
  BarChart2,
  Settings,
  Upload,
  BookOpen,
  type LucideIcon,
} from 'lucide-react';

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

const navItems: NavItem[] = [
  { label: 'Dashboard',      href: '/dashboard',       icon: LayoutDashboard },
  { label: 'Clientes',       href: '/clientes',        icon: Users },
  { label: 'Suscripciones',  href: '/suscripciones',   icon: CreditCard },
  { label: 'Renovaciones',   href: '/renovaciones',    icon: RefreshCw },
  { label: 'Productos',      href: '/productos',       icon: Package },
  { label: 'Catálogos',      href: '/catalogos',       icon: BookOpen },
  { label: 'Finanzas',       href: '/finanzas',        icon: DollarSign },
  { label: 'Estadísticas',   href: '/estadisticas',    icon: BarChart2 },
  { label: 'Configuración',  href: '/configuracion',   icon: Settings },
  { label: 'Importar Excel', href: '/importaciones',    icon: Upload },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col border-r border-hover bg-panel">
      {/* Logo */}
      <div className="flex h-[70px] items-center border-b border-hover px-6">
        <span className="text-lg font-semibold text-text-main">K13Group</span>
      </div>

      {/* Navegación */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-0.5">
          {navItems.map(({ label, href, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + '/');
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={cn(
                    'flex items-center gap-3 rounded-button px-3 py-2.5 text-sm font-medium transition-colors',
                    active
                      ? 'bg-primary/15 text-primary'
                      : 'text-text-secondary hover:bg-hover hover:text-text-main',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
