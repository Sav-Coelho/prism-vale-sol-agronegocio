/**
 * Vínculo manual: o financeiro marca as linhas do caixa que pagaram esta fatura, quando o
 * Arken não as acha sozinho. Substitui os vínculos manuais anteriores da fatura. Linha já
 * usada por outra fatura não entra (a conciliação ignora) — nada é contado duas vezes.
 */
import { prisma } from '@/lib/prisma'
import { guard } from '@/lib/auth-node'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const g = await guard(['gerencial']); if (!g.ok) return g.res
  const id = Number(params.id)
  const b = await req.json().catch(() => null) as null | { chaves?: unknown }
  const chaves = Array.isArray(b?.chaves) ? Array.from(new Set((b!.chaves as unknown[]).map(String))) : null
  if (!chaves) return NextResponse.json({ error: 'Lista de linhas inválida.' }, { status: 400 })
  const f = await prisma.cartaoFatura.findUnique({ where: { id } })
  if (!f) return NextResponse.json({ error: 'Fatura não encontrada.' }, { status: 404 })
  const existem = await prisma.caixaLancamento.findMany({ where: { chave: { in: chaves } }, select: { chave: true } })
  if (existem.length !== chaves.length) return NextResponse.json({ error: 'Alguma linha marcada não está mais no caixa (o realizado foi reimportado). Recarregue a página.' }, { status: 409 })
  await prisma.$transaction([
    prisma.cartaoVinculo.deleteMany({ where: { faturaId: id, itemId: null } }),
    ...(chaves.length ? [prisma.cartaoVinculo.createMany({ data: chaves.map(chave => ({ faturaId: id, chave })) })] : []),
  ])
  return NextResponse.json({ ok: true, vinculos: chaves.length })
}
