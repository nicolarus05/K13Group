import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { type LucideIcon, InboxIcon } from 'lucide-react';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon = InboxIcon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 text-center', className)}>
      <Icon className="mb-4 h-10 w-10 text-hover" />
      <p className="text-sm font-medium text-text-main">{title}</p>
      {description && <p className="mt-1 text-xs text-text-secondary">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
