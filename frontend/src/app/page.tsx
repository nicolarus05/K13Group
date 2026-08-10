import { redirect } from 'next/navigation';

// La raíz redirige al dashboard; si no hay sesión, el middleware lo lleva al login
export default function HomePage() {
  redirect('/dashboard');
}
