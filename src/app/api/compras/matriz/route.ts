/**
 * Matriz de Fornecedores (Controle de Compras › Matriz de Fornecedores).
 *
 *   GET  → matriz calculada (lib/matriz-fornecedores)
 *   POST { chave, nome, tipo?, alternativas?, condicoes?, falhas? }
 *        → grava a avaliação de risco do fornecedor (só os campos enviados;
 *          null apaga a resposta) e devolve a matriz recalculada.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { SESSION_COOKIE, verifySession } from '@/lib/auth'
import { CAMPOS, PERGUNTAS, TIPOS, calcularMatriz } from '@/lib/matriz-fornecedores'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  return NextResponse.json(await calcularMatriz())
}

type Corpo = { chave?: unknown; nome?: unknown; tipo?: unknown } & Partial<Record<string, unknown>>

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Corpo
  const chave = typeof body.chave === 'string' ? body.chave.trim() : ''
  const nome = typeof body.nome === 'string' ? body.nome.trim() : ''
  if (!chave || !nome || chave.length > 200 || nome.length > 200) {
    return NextResponse.json({ error: 'Informe chave e nome do fornecedor.' }, { status: 400 })
  }

  const dados: { tipo?: string | null; alternativas?: number | null; condicoes?: number | null; falhas?: number | null } = {}
  if ('tipo' in body) {
    if (body.tipo !== null && !(TIPOS as readonly unknown[]).includes(body.tipo)) {
      return NextResponse.json({ error: 'Tipo inválido.' }, { status: 400 })
    }
    dados.tipo = body.tipo as string | null
  }
  for (let i = 0; i < CAMPOS.length; i++) {
    const campo = CAMPOS[i]
    if (!(campo in body)) continue
    const v = body[campo]
    if (v !== null && !PERGUNTAS[campo].opcoes.some(o => o.valor === v)) {
      return NextResponse.json({ error: `Resposta inválida em "${PERGUNTAS[campo].titulo}".` }, { status: 400 })
    }
    dados[campo] = v as number | null
  }

  const user = await verifySession(req.cookies?.get(SESSION_COOKIE)?.value).catch(() => null)
  try {
    await prisma.fornecedorRisco.upsert({
      where: { chave },
      create: { chave, nome, ...dados, updatedBy: user?.login ?? null },
      update: { nome, ...dados, updatedBy: user?.login ?? null },
    })
  } catch (e) {
    return NextResponse.json({ error: 'Não foi possível gravar a avaliação: ' + (e as Error).message }, { status: 500 })
  }
  return NextResponse.json(await calcularMatriz())
}
