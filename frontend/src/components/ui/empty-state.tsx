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
      <Icon className="text-text-secondary/60 mb-4 h-10 w-10" />
      <p className="text-text-main text-sm font-medium">{title}</p>
      {description && <p className="text-text-secondary mt-1 text-xs">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
