'use client';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  CreditCard,
  RefreshCw,
  DollarSign,
  BookOpen,
  Upload,
  ChevronsLeft,
  ChevronsRight,
  BarChart2,
  Settings,
  Bell,
  CalendarDays,
} from 'lucide-react';
const logo = '/LogoK13GROUP.jpg';
const items = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Clientes', href: '/clientes', icon: Users },
  { label: 'Suscripciones', href: '/suscripciones', icon: CreditCard },
  { label: 'Renovaciones', href: '/renovaciones', icon: RefreshCw },
  { label: 'Catálogos', href: '/catalogos', icon: BookOpen },
  { label: 'Finanzas', href: '/finanzas', icon: DollarSign },
  { label: 'Estadísticas', href: '/estadisticas', icon: BarChart2 },
  { label: 'Recordatorios', href: '/recordatorios', icon: Bell },
  { label: 'Calendario', href: '/calendario', icon: CalendarDays },
  { label: 'Importar Excel', href: '/importaciones', icon: Upload },
];
export function Sidebar({
  collapsed = false,
  onCollapse,
  onNavigate,
}: {
  collapsed?: boolean;
  onCollapse?: () => void;
  onNavigate?: () => void;
}) {
  const path = usePathname();
  return (
    <aside
      className={'k13-sidebar' + (collapsed ? ' is-collapsed' : '')}
      aria-label="Barra lateral"
    >
      <Link
        href="/dashboard"
        className="k13-brand"
        aria-label="K13Group · Inicio"
        onClick={onNavigate}
      >
        <Image src={logo} alt="K13Group" width={158} height={158} priority sizes="158px" />
      </Link>
      <nav aria-label="Navegación principal">
        {items.map(({ label, href, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            title={collapsed ? label : undefined}
            aria-label={label}
            aria-current={path === href || path.startsWith(href + '/') ? 'page' : undefined}
            className="k13-nav-link"
          >
            <Icon size={19} />
            <span>{label}</span>
          </Link>
        ))}
        {!collapsed && (
          <div className="k13-nav-future">
            <small>PRÓXIMAMENTE</small>
            <span>
              <Settings size={18} />
              Configuración
            </span>
          </div>
        )}
      </nav>
      {onCollapse && (
        <button
          type="button"
          className="k13-icon-button k13-collapse"
          onClick={onCollapse}
          aria-label={collapsed ? 'Expandir barra lateral' : 'Contraer barra lateral'}
        >
          {collapsed ? <ChevronsRight size={20} /> : <ChevronsLeft size={20} />}
        </button>
      )}
    </aside>
  );
}
