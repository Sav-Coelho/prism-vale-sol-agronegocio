import { NextRequest, NextResponse } from 'next/server'
import {
  SESSION_COOKIE, SESSION_HOURS, SESSION_RENEW_AFTER_MS,
  canAccess, homeFor, signSession, verifySession,
} from '@/lib/auth'
import type { SessionUser } from '@/lib/auth'

// Rotas que não exigem sessão.
const PUBLICAS = ['/login', '/api/auth/login', '/api/auth/logout']

/**
 * Reemite o cookie quando já passou metade da janela da sessão.
 * Roda no edge, então usa só `jose`. Renovar em toda requisição funcionaria,
 * mas poria um Set-Cookie em cada resposta sem necessidade.
 */
async function renovarSessao(res: NextResponse, sessao: SessionUser) {
  if (!sessao.exp) return
  const restanteMs = sessao.exp * 1000 - Date.now()
  const janelaMs = SESSION_HOURS * 60 * 60 * 1000
  if (restanteMs > janelaMs - SESSION_RENEW_AFTER_MS) return

  const token = await signSession(sessao)
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_HOURS * 60 * 60,
  })
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (PUBLICAS.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next()
  }

  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value)

  if (!session) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  // A raiz leva cada papel ao seu módulo inicial.
  if (pathname === '/') {
    const url = req.nextUrl.clone()
    url.pathname = homeFor(session.role)
    return NextResponse.redirect(url)
  }

  if (!canAccess(session.role, pathname, req.method)) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
    }
    const url = req.nextUrl.clone()
    url.pathname = homeFor(session.role)
    url.search = ''
    return NextResponse.redirect(url)
  }

  const res = NextResponse.next()
  await renovarSessao(res, session)
  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.svg$).*)'],
}
