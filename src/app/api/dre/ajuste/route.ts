/**
 * Ajustes MANUAIS de conciliação da DRE.
 *
 * Existem para casos em que o fechamento do cliente e o razão de caixa não
 * batem e a causa ainda está em apuração: o valor correto vai aqui, com rótulo
 * visível na DRE, sem mexer na classificação do arquivo (que continua fiel à
 * fonte). Ficam numa tabela própria porque o import mensal substitui os meses
 * do arquivo e apagaria o ajuste junto.
 *
 *   GET                       → lista os ajustes
 *   POST   { ajustes: [...] } → cria (substitui os do mesmo ano/mês/linha)
 *   DELETE ?id=  |  ?year=&month=&line=  → remove
 */
import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  const ajustes = await prisma.dreAjuste.findMany({ orderBy: [{ year: 'asc' }, { month: 'asc' }] })
  return NextResponse.json({
    ajustes,
    total: ajustes.reduce((s, a) => s + a.amount, 0),
  })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const lista: unknown[] = Array.isArray(body.ajustes) ? body.ajustes : []
  if (!lista.length) return NextResponse.json({ error: 'Envie { ajustes: [...] }' }, { status: 400 })

  type In = { unit: string; kind?: string; line: string; sub: string; year: number; month: number; amount: number; motivo?: string }
  const data = lista.map(x => {
    const a = x as In
    if (!a.unit || !a.line || !a.sub || !a.year || !a.month || typeof a.amount !== 'number') {
      throw new Error('ajuste inválido: exige unit, line, sub, year, month, amount')
    }
    return {
      unit: a.unit, kind: a.kind || (a.line === 'RECEITA' ? 'RECEITA' : a.line === 'DEDUCAO' ? 'DEDUCAO' : 'EXP'),
      line: a.line, sub: a.sub, year: a.year, month: a.month, amount: a.amount, motivo: a.motivo ?? null,
    }
  })

  // substitui os ajustes das mesmas combinações ano/mês/linha (idempotente)
  const alvos = Array.from(new Set(data.map(d => `${d.year}|${d.month}|${d.line}`))).map(k => {
    const [year, month, line] = k.split('|')
    return { year: +year, month: +month, line }
  })
  const del = await prisma.dreAjuste.deleteMany({ where: { OR: alvos } })
  const ins = await prisma.dreAjuste.createMany({ data })

  return NextResponse.json({
    removidos: del.count, criados: ins.count,
    total: data.reduce((s, d) => s + d.amount, 0),
  })
}

export async function DELETE(req: Request) {
  const q = new URL(req.url).searchParams
  const id = parseInt(q.get('id') ?? '', 10)
  if (!isNaN(id)) {
    await prisma.dreAjuste.delete({ where: { id } })
    return NextResponse.json({ removidos: 1 })
  }
  const year = parseInt(q.get('year') ?? '', 10)
  const month = parseInt(q.get('month') ?? '', 10)
  const line = q.get('line') ?? undefined
  if (isNaN(year) || isNaN(month)) return NextResponse.json({ error: 'informe id, ou year+month' }, { status: 400 })
  const r = await prisma.dreAjuste.deleteMany({ where: { year, month, ...(line ? { line } : {}) } })
  return NextResponse.json({ removidos: r.count })
}
