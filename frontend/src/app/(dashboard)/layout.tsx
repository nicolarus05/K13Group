import { type ReactNode } from 'react';
import { PreferencesProvider } from '@/modules/configuracion/preferences';
import { AppShell } from '@/components/layout/app-shell';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <PreferencesProvider>
      <AppShell>{children}</AppShell>
    </PreferencesProvider>
  );
}
