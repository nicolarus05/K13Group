'use client';
import { useParams } from 'next/navigation';
import { ReminderDetail } from '@/modules/recordatorios/reminders-ui';
export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <ReminderDetail id={id} />;
}
