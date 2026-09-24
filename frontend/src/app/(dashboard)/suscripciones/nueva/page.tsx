'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { SubscriptionForm } from '@/modules/suscripciones/subscription-form';
function NewSubscription() {
  const params = useSearchParams();
  return <SubscriptionForm initialClientId={params.get('clienteId') ?? undefined} />;
}
export default function Page() {
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Nueva suscripción</h1>
      <Suspense fallback={<p>Cargando…</p>}>
        <NewSubscription />
      </Suspense>
    </div>
  );
}
