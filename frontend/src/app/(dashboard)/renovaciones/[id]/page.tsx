'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { catalogError } from '@/modules/catalogos/services/catalogos.service';
import { renewals } from '@/modules/renovaciones/renovaciones.service';
import { RenewalRecord } from '@/modules/renovaciones/renewal-history';
import { RenewalDialog, type RenewalAction } from '@/modules/renovaciones/renewal-dialog';
export default function Page() {
  const { id } = useParams<{ id: string }>();
  const [action, setAction] = useState<RenewalAction | null>(null);
  const query = useQuery({
    queryKey: ['renovaciones', id],
    queryFn: () => renewals.get(id),
    refetchInterval: action ? false : 60000,
  });
  return (
    <div className="space-y-4">
      <Link href="/renovaciones?historial=1" className="text-primary underline">
        Volver al historial
      </Link>
      <h1 className="text-xl font-semibold">Detalle de la operación</h1>
      {query.isPending && <p role="status">Cargando operación…</p>}
      {query.isError && (
        <div role="alert">
          {catalogError(query.error)}{' '}
          <Button onClick={() => void query.refetch()}>Reintentar</Button>
        </div>
      )}
      {query.data && <RenewalRecord row={query.data} onAction={setAction} />}
      {action && <RenewalDialog action={action} onClose={() => setAction(null)} />}
    </div>
  );
}
