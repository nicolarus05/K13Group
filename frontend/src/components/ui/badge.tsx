import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

type BadgeVariant = 'success' | 'warning' | 'danger' | 'default' | 'primary';

const variants: Record<BadgeVariant, string> = {
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/15 text-danger',
  primary: 'bg-primary/15 text-primary',
  default: 'bg-hover text-text-secondary',
};

interface BadgeProps {
  variant?: BadgeVariant;
  className?: string;
  children: ReactNode;
}

export function Badge({ variant = 'default', className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded border border-current/25 px-2 py-0.5 text-xs font-medium',
        variants[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

// Mapeo rápido estado → variante para entidades del sistema
export function EstadoBadge({ estado }: { estado: string }) {
  const map: Record<string, BadgeVariant> = {
    ACTIVO: 'success',
    ACTIVA: 'success',
    COMPLETADA: 'success',
    CONFIRMADO: 'success',
    PENDIENTE: 'warning',
    PROXIMA_A_VENCER: 'warning',
    PRÓXIMA_A_VENCER: 'warning',
    POSPUESTO: 'warning',
    VENCIDA: 'danger',
    CANCELADA: 'danger',
    CANCELADO: 'danger',
    ANULADA: 'danger',
    ANULADO: 'danger',
    SUSPENDIDA: 'danger',
    INACTIVO: 'default',
    INACTIVA: 'default',
    BORRADOR: 'default',
  };

  const labels: Record<string, string> = {
    PROXIMA_A_VENCER: 'Próxima a vencer',
    PRÓXIMA_A_VENCER: 'Próxima a vencer',
  };

  return (
    <Badge variant={map[estado] ?? 'default'}>
      {labels[estado] ?? estado.charAt(0) + estado.slice(1).toLowerCase()}
    </Badge>
  );
}
