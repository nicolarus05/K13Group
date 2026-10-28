import Image from 'next/image';
import { LoginFormClient } from '@/modules/auth/components/login-form-client';

export default function LoginPage() {
  return (
    <main className="k13-login">
      <div className="k13-login-card k13-surface">
        <div className="k13-login-brand">
          <Image src="/LogoK13GROUP.jpg" alt="K13Group" width={140} height={140} priority />
          <h1>Accede a tu cuenta</h1>
          <p>Tu centro de gestión K13Group</p>
        </div>
        <LoginFormClient />
      </div>
    </main>
  );
}
