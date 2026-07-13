/**
 * Import de relatório de caixa para a DRE Gerencial.
 *  - Arquivo de PAGAMENTOS (consolidado): classifica cada linha em (linha, subconta)
 *    e agrega por unidade/mês. Substitui TODAS as despesas (o consolidado cobre tudo).
 *  - Arquivo de RECEBIDOS: exige a unidade (form field `unit`). Agrega receita,
 *    deduções e juros. Substitui as entradas de receita daquela unidade.
 */
import { prisma } from '@/lib/prisma'
import { parseDre, canonicalizeUnit } from '@/lib/dre-parser'
import { classifyExpense } from '@/lib/dre-classifier'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

type Bucket = { unit: string; kind: string; line: string; sub: string; year: number; month: number; amount: number }

export async function POST(req: Request) {
  const fd = await req.formData()
  const file = fd.get('file') as File | null
  const unitField = (fd.get('unit') as string | null)?.trim() || null
  if (!file) return NextResponse.json({ error: 'Arquivo não enviado' }, { status: 400 })

  const buf = await file.arrayBuffer()
  const parsed = parseDre(buf)

  const map = new Map<string, Bucket>()
  const add = (b: Omit<Bucket, 'amount'>, amount: number) => {
    const k = `${b.unit}|${b.kind}|${b.line}|${b.sub}|${b.year}|${b.month}`
    const cur = map.get(k)
    if (cur) cur.amount += amount
    else map.set(k, { ...b, amount })
  }

  if (parsed.kind === 'payment') {
    parsed.rows.forEach(r => {
      const [line, sub] = classifyExpense(r.code, r.name, r.doc, r.obs)
      add({ unit: r.unit, kind: 'DESPESA', line, sub, year: r.year, month: r.month }, r.amount)
    })
    const data = Array.from(map.values())
    const result = await prisma.$transaction(async tx => {
      const del = await tx.dreEntry.deleteMany({ where: { kind: 'DESPESA' } })
      const ins = await tx.dreEntry.createMany({ data })
      return { deleted: del.count, inserted: ins.count }
    }, { timeout: 120_000 })
    return NextResponse.json({ kind: 'payment', buckets: data.length, ...result, totalValor: parsed.total })
  }

  // Recebidos — precisa da unidade (canonizada contra encoding/acento)
  if (!unitField) {
    return NextResponse.json({ error: 'Para recebidos, informe a unidade (campo "unit")' }, { status: 400 })
  }
  const unit = canonicalizeUnit(unitField)
  parsed.rows.forEach(r => {
    add({ unit, kind: 'RECEITA', line: 'RECEITA', sub: r.isCard ? 'Recebimentos via Cartão' : 'Recebimentos Diretos (clientes)', year: r.year, month: r.month }, r.gross)
    if (r.discount) add({ unit, kind: 'DEDUCAO', line: 'DEDUCAO', sub: r.isCard ? 'Taxas de Cartão' : 'Descontos Comerciais', year: r.year, month: r.month }, r.discount)
    if (r.interest) add({ unit, kind: 'JUROS', line: 'JUROS', sub: 'Juros Recebidos de Clientes', year: r.year, month: r.month }, r.interest)
  })
  const data = Array.from(map.values())
  const result = await prisma.$transaction(async tx => {
    const del = await tx.dreEntry.deleteMany({ where: { unit, kind: { in: ['RECEITA', 'DEDUCAO', 'JUROS'] } } })
    const ins = await tx.dreEntry.createMany({ data })
    return { deleted: del.count, inserted: ins.count }
  }, { timeout: 120_000 })
  return NextResponse.json({ kind: 'receipt', unit, buckets: data.length, ...result, totalValor: parsed.total })
}
