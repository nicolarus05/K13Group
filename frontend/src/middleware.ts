import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = new Set(['/login']);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Las cookies solo permiten llegar a la interfaz; la API valida la sesión.
  // Dejar accesible el login evita bucles con cookies caducadas o revocadas.
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
  const hasSession = request.cookies.has('access_token') || request.cookies.has('refresh_token');
  if (!hasSession) return NextResponse.redirect(new URL('/login', request.url));

  return NextResponse.next();
}

export const config = {
  // Excluye rutas internas de Next.js, assets y archivos estáticos
  matcher: ['/((?!_next/static|_next/image|favicon.ico|LogoK13GROUP.jpg|api/).*)'],
};
