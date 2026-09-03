/**
 * Metade da autenticação que depende do node runtime (bcrypt) e do banco.
 * Nunca importar isto no middleware — quebraria o edge runtime.
 */
import bcrypt from 'bcryptjs'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { prisma } from './prisma'
import { SESSION_COOKIE, verifySession, type Role, type SessionUser } from './auth'

const ROUNDS = 10

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS)
}

export async function checkPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

/** Sessão do request atual, lida do cookie. */
export async function currentUser(): Promise<SessionUser | null> {
  return verifySession(cookies().get(SESSION_COOKIE)?.value)
}

export class AuthError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export type Guarda =
  | { ok: true; user: SessionUser }
  | { ok: false; res: NextResponse }

/**
 * Guarda de rota — segunda tranca, dentro do handler:
 *
 *     const g = await guard(['gerencial'])
 *     if (!g.ok) return g.res
 *
 * O middleware já bloqueia estas rotas, mas ele depende de uma regex de
 * exclusão no matcher: um ajuste ali abriria todas as APIs de uma vez e em
 * silêncio.
 */
export async function guard(roles?: Role[]): Promise<Guarda> {
  const u = await currentUser()
  if (!u) return { ok: false, res: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) }
  if (roles && roles.indexOf(u.role) < 0) {
    return { ok: false, res: NextResponse.json({ error: 'Sem permissão' }, { status: 403 }) }
  }
  return { ok: true, user: u }
}

/**
 * Cria as duas contas de equipe no primeiro acesso (só roda com a tabela vazia).
 *
 * As senhas vêm obrigatoriamente do ambiente: num repositório Git, um fallback
 * fixo seria credencial pública. Sem as variáveis, a semeadura falha em vez de
 * criar conta com senha conhecida.
 *
 * São contas COMPARTILHADAS (decisão do cliente: "pode ser um login só para
 * todos os vendedores"), por isso não há troca de senha obrigatória — o
 * primeiro a entrar trocaria a senha de todo mundo.
 */
export async function ensureSeedUsers(): Promise<void> {
  if (await prisma.user.count() > 0) return

  const senhaGerencial = process.env.SEED_GERENCIAL_PASSWORD
  const senhaComercial = process.env.SEED_COMERCIAL_PASSWORD
  if (!senhaGerencial || !senhaComercial) {
    throw new Error(
      'Base sem usuários: defina SEED_GERENCIAL_PASSWORD e SEED_COMERCIAL_PASSWORD ' +
      'para semear o primeiro acesso.'
    )
  }

  await prisma.user.createMany({
    data: [
      {
        login: 'gerencial',
        name: 'Equipe Gerencial',
        passwordHash: await hashPassword(senhaGerencial),
        role: 'gerencial',
      },
      {
        login: 'comercial',
        name: 'Equipe Comercial',
        passwordHash: await hashPassword(senhaComercial),
        role: 'comercial',
      },
    ],
    skipDuplicates: true,
  })
}
