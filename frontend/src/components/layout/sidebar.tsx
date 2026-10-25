'use client';
import Image from 'next/image';
import { usePreferences } from '@/modules/configuracion/preferences';
import { api } from '@/lib/api';
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
  ShieldCheck,
} from 'lucide-react';
const logo = '/LogoK13GROUP.jpg';
const items = [
  { label: 'Auditoría', href: '/auditoria', icon: ShieldCheck },
  { label: 'Configuración', href: '/configuracion', icon: Settings },
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Clientes', href: '/clientes', icon: Users },
  { label: 'Suscripciones', href: '/suscripciones', icon: CreditCard },
  { label: 'Renovaciones', href: '/renovaciones', icon: RefreshCw },
  { label: 'Catálogos', href: '/catalogos', icon: BookOpen },
  { label: 'Finanzas', href: '/finanzas', icon: DollarSign },
  { label: 'Estadísticas', href: '/estadisticas', icon: BarChart2 },
  { label: 'Recordatorios', href: '/recordatorios', icon: Bell },
  { label: 'Calendario', href: '/calendario', icon: CalendarDays },
  { label: 'Exportaciones', href: '/exportaciones', icon: BookOpen },
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
  const prefs = usePreferences();
  const customLogo = prefs['negocio.logo_asset_id'];
  const brand = prefs['negocio.nombre'];
  return (
    <aside
      className={'k13-sidebar' + (collapsed ? ' is-collapsed' : '')}
      aria-label="Barra lateral"
    >
      <Link
        href="/dashboard"
        className="k13-brand"
        aria-label={`${brand} · Inicio`}
        onClick={onNavigate}
      >
        {customLogo ? (
          <Image
            unoptimized
            src={`${api.defaults.baseURL}/configuracion/logo/${customLogo}`}
            alt={brand}
            width={158}
            height={158}
          />
        ) : (
          <Image src={logo} alt={brand} width={158} height={158} priority sizes="158px" />
        )}
        {!collapsed && <span>{brand}</span>}
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
