/**
 * Autenticação do Arken — sessão em cookie httpOnly assinado (JWT HS256).
 *
 * Duas metades, separadas de propósito:
 *   • `signSession` / `verifySession` usam só `jose`, que roda no edge runtime
 *     — é o que o middleware consegue chamar.
 *   • bcrypt e Prisma ficam em `auth-node.ts`, restritos às API routes.
 *
 * Papéis (reunião de 28/08 — Felipe pediu acesso separado para os vendedores):
 *   gerencial — todos os módulos, leitura e escrita
 *   comercial — somente a Demanda por Cliente, SOMENTE LEITURA
 */
import { SignJWT, jwtVerify } from 'jose'

export const SESSION_COOKIE = 'arken_session'
export const SESSION_HOURS = 12

/**
 * A sessão renova sozinha enquanto a pessoa usa o sistema: passada metade da
 * janela, o middleware reemite o cookie. Quem está trabalhando não é deslogado
 * no meio de um lançamento; quem some por meio dia perde a sessão.
 */
export const SESSION_RENEW_AFTER_MS = (SESSION_HOURS / 2) * 60 * 60 * 1000

export type Role = 'gerencial' | 'comercial'

export interface SessionUser {
  id: number
  login: string
  name: string
  role: Role
  /** epoch em segundos — só vem de verifySession, para decidir a renovação */
  exp?: number
}

function secretKey(): Uint8Array {
  const s = process.env.AUTH_SECRET
  if (!s || s.length < 24) {
    throw new Error('AUTH_SECRET ausente ou muito curto (mínimo 24 caracteres)')
  }
  return new TextEncoder().encode(s)
}

export const asRole = (v: unknown): Role => (v === 'gerencial' ? 'gerencial' : 'comercial')

export async function signSession(user: SessionUser): Promise<string> {
  return new SignJWT({ login: user.login, name: user.name, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secretKey())
}

export async function verifySession(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secretKey())
    return {
      id: Number(payload.sub),
      login: String(payload.login || ''),
      name: String(payload.name || ''),
      role: asRole(payload.role),
      exp: typeof payload.exp === 'number' ? payload.exp : undefined,
    }
  } catch {
    return null
  }
}

// ─── Autorização ───
// Lista de PERMISSÃO (não de bloqueio): o comercial só alcança o que está aqui.
// Assim, um módulo novo nasce fechado para o vendedor — o inverso deixaria
// dados financeiros expostos por esquecimento.
const COMERCIAL_PERMITE = ['/demanda-cliente', '/api/demanda']

export function canAccess(role: Role, pathname: string, method = 'GET'): boolean {
  if (role === 'gerencial') return true
  const dentroDoModulo = COMERCIAL_PERMITE.some(p => pathname === p || pathname.startsWith(p + '/'))
  if (!dentroDoModulo) return false
  // Vendedor consulta, não altera: nada de import/POST/DELETE na base comercial.
  return method === 'GET' || method === 'HEAD'
}

/** Para onde mandar cada papel depois do login. */
export function homeFor(role: Role): string {
  return role === 'gerencial' ? '/dre' : '/demanda-cliente'
}

export const roleLabel = (role: Role): string =>
  role === 'gerencial' ? 'Gerencial' : 'Comercial'
