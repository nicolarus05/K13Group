import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = new Set(['/login']);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasToken = request.cookies.has('access_token');

  if (PUBLIC_PATHS.has(pathname)) {
    // Ya autenticado → redirige al dashboard para no mostrar el login de nuevo
    if (hasToken) return NextResponse.redirect(new URL('/dashboard', request.url));
    return NextResponse.next();
  }

  // Ruta protegida sin token → login
  if (!hasToken) return NextResponse.redirect(new URL('/login', request.url));

  return NextResponse.next();
}

export const config = {
  // Excluye rutas internas de Next.js, assets y archivos estáticos
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
};
