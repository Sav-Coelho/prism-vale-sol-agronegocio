/**
 * Orçamento — projeção da DRE. O modelo vive em `@/lib/orcamento`.
 *
 * O orçamento editado na tela (parâmetros, premissas por linha e ajustes mês a
 * mês) fica GRAVADO na tabela OrcamentoCenario, para o cliente voltar à mesma
 * versão e todos os usuários verem a mesma coisa.
 *
 *   GET            → orçamento calculado com o cenário salvo
 *   POST {cenario} → limpa, grava e devolve o orçamento recalculado
 *                    ({ cenario: {} } volta ao padrão do modelo;
 *                     { simular: true } calcula sem gravar)
 *
 * Unidades do cenário (as da lib): percentuais em FRAÇÃO (0,70 = 70%), valores
 * fixos em R$, meses 'AAAA-MM'.
 */
import { calcularOrcamento, sanitizarCenario, type CenarioOrcamento } from '@/lib/orcamento'
import { prisma } from '@/lib/prisma'
import { SESSION_COOKIE, verifySession } from '@/lib/auth'
import type { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const ID = 'padrao'

async function carregar(): Promise<{ cenario: CenarioOrcamento; salvoEm: string | null; aviso: string | null }> {
  try {
    const row = await prisma.orcamentoCenario.findUnique({ where: { id: ID } })
    return { cenario: row ? sanitizarCenario(row.dados) : {}, salvoEm: row ? row.updatedAt.toISOString() : null, aviso: null }
  } catch (e) {
    // tabela ainda não criada (db push não rodou no build): segue com o padrão
    return { cenario: {}, salvoEm: null, aviso: 'O orçamento salvo não pôde ser lido — exibindo o padrão do modelo.' }
  }
}

export async function GET() {
  const { cenario, salvoEm, aviso } = await carregar()
  const r = await calcularOrcamento(cenario)
  return NextResponse.json({ ...r, cenario, salvoEm, aviso })
}

export async function POST(req: NextRequest) {
  let body: { cenario?: unknown; simular?: boolean }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }
  const cenario = sanitizarCenario(body?.cenario)
  let salvoEm: string | null = null
  if (!body?.simular) {
    const user = await verifySession(req.cookies?.get(SESSION_COOKIE)?.value).catch(() => null)
    try {
      const dados = cenario as unknown as Prisma.InputJsonValue
      const row = await prisma.orcamentoCenario.upsert({
        where: { id: ID },
        create: { id: ID, dados, updatedBy: user?.login ?? null },
        update: { dados, updatedBy: user?.login ?? null },
      })
      salvoEm = row.updatedAt.toISOString()
    } catch (e) {
      return NextResponse.json({ error: 'Não foi possível salvar o orçamento. ' + (e instanceof Error ? e.message.slice(0, 160) : '') }, { status: 500 })
    }
  }
  const r = await calcularOrcamento(cenario)
  return NextResponse.json({ ...r, cenario, salvoEm, aviso: null })
}
