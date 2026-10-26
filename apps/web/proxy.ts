import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authorizeAdminRequest, type AdminCapability } from '@/lib/admin-auth';
import { basicAdminAuthenticationAllowed } from '@/lib/admin-session';

/** An early gate; privileged handlers independently authenticate and authorize every action. */
export async function proxy(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  if (pathname === '/admin/login') {
    const response = NextResponse.next();
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
  const editions = pathname === '/api/newsletter/editions' || pathname.startsWith('/api/newsletter/editions/');
  const capability: AdminCapability | undefined = editions
    ? 'newsletter-reconcile'
    : pathname.startsWith('/admin') ? 'read' : undefined;
  const result = await authorizeAdminRequest(req, capability, { boundary: 'proxy', hideWhenUnconfigured: true });
  if (result.response) {
    if (result.response.status === 401 && !basicAdminAuthenticationAllowed() && req.method === 'GET' && pathname.startsWith('/admin')) {
      const response = NextResponse.redirect(new URL('/admin/login', req.url));
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    }
    return result.response;
  }
  const response = NextResponse.next();
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Vary', 'Authorization, Cookie');
  return response;
}

export const config = {
  matcher: ['/admin', '/admin/:path*', '/api/articles', '/api/articles/:path*', '/api/ai/generate-image', '/api/newsletter/editions', '/api/newsletter/editions/:path*'],
};
