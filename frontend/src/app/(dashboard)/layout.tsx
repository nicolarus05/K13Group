export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      {/* Sidebar se implementa en Sprint 2 */}
      <aside className="w-70 shrink-0 bg-panel" />
      <div className="flex flex-1 flex-col">
        {/* Header se implementa en Sprint 2 */}
        <header className="h-[70px] bg-panel" />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
