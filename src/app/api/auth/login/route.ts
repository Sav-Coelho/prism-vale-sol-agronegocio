import { prisma } from '@/lib/prisma'
import { SESSION_COOKIE, SESSION_HOURS, asRole, homeFor, signSession } from '@/lib/auth'
import { checkPassword, ensureSeedUsers } from '@/lib/auth-node'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  // Só faz algo quando a tabela User está vazia. Lança se as senhas-semente
  // não estiverem no ambiente — devolvemos como erro de configuração, não 500.
  try {
    await ensureSeedUsers()
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Falha ao preparar o primeiro acesso' },
      { status: 503 },
    )
  }

  const body = await req.json().catch(() => ({}))
  const login = String(body.login || body.email || '').trim().toLowerCase()
  const senha = String(body.senha || '')

  if (!login || !senha) {
    return NextResponse.json({ error: 'Informe usuário e senha' }, { status: 400 })
  }

  const user = await prisma.user.findUnique({ where: { login } })
  // Mensagem única para usuário inexistente e senha errada — não revela qual falhou.
  const generico = { error: 'Usuário ou senha incorretos' }
  if (!user || !user.active) return NextResponse.json(generico, { status: 401 })
  if (!await checkPassword(senha, user.passwordHash)) return NextResponse.json(generico, { status: 401 })

  const sessionUser = { id: user.id, login: user.login, name: user.name, role: asRole(user.role) }
  const token = await signSession(sessionUser)

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })

  const res = NextResponse.json({ user: sessionUser, redirect: homeFor(sessionUser.role) })
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_HOURS * 60 * 60,
  })
  return res
}
