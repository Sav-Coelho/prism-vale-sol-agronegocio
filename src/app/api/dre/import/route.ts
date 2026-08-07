/**
 * Import de relatório de caixa para a DRE Gerencial.
 *  - Arquivo de PAGAMENTOS (consolidado): classifica cada linha em (linha, subconta)
 *    e agrega por unidade/mês. Substitui TODAS as despesas (o consolidado cobre tudo).
 *  - Arquivo de RECEBIDOS: exige a unidade (form field `unit`). Agrega receita,
 *    deduções e juros. Substitui as entradas de receita daquela unidade.
 */
import { prisma } from '@/lib/prisma'
import { parseDre, canonicalizeUnit } from '@/lib/dre-parser'
import { parseExpenseReport } from '@/lib/dre-expense-parser'
import { buildDreFromCashflow, isCashflowAnaliticoFile } from '@/lib/dre-cashflow-source'
import { classifyExpense } from '@/lib/dre-classifier'
import * as XLSX from 'xlsx'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

type Bucket = { unit: string; kind: string; line: string; sub: string; supplier: string | null; supplierCode: string | null; year: number; month: number; amount: number }

// Detecta o "Relatório de Despesas" classificado (coluna CLASSIFICAÇÃO na 1ª aba)
function isClassifiedExpense(buf: ArrayBuffer): boolean {
  try {
    const wb = XLSX.read(buf, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const head = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, blankrows: false })[0] || []
    return head.some(h => String(h ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim() === 'CLASSIFICACAO')
  } catch { return false }
}

export async function POST(req: Request) {
  const fd = await req.formData()
  const file = fd.get('file') as File | null
  const unitField = (fd.get('unit') as string | null)?.trim() || null
  if (!file) return NextResponse.json({ error: 'Arquivo não enviado' }, { status: 400 })

  const buf = await file.arrayBuffer()

  const map = new Map<string, Bucket>()
  const add = (b: Omit<Bucket, 'amount'>, amount: number) => {
    const k = `${b.unit}|${b.kind}|${b.line}|${b.sub}|${b.supplier ?? ''}|${b.year}|${b.month}`
    const cur = map.get(k)
    if (cur) cur.amount += amount
    else map.set(k, { ...b, amount })
  }

  // ── CashFlow Analítico como FONTE ÚNICA da DRE (receita + despesa) ──
  // Substitui TUDO (receita e despesa) pelos meses presentes no arquivo.
  if (isCashflowAnaliticoFile(buf)) {
    const { entries, months, rows, totalE, totalS } = buildDreFromCashflow(buf)
    const data = entries.map(e => ({ ...e }))
    const result = await prisma.$transaction(async tx => {
      const del = await tx.dreEntry.deleteMany({})     // fonte única: base inteira é substituída
      let ins = 0
      const CHUNK = 3000
      for (let i = 0; i < data.length; i += CHUNK) {
        ins += (await tx.dreEntry.createMany({ data: data.slice(i, i + CHUNK) })).count
      }
      return { deleted: del.count, inserted: ins }
    }, { timeout: 240_000 })
    return NextResponse.json({
      kind: 'dre-from-cashflow', months, linhasBrutas: rows,
      totalEntradas: totalE, totalSaidas: totalS, buckets: data.length, ...result,
    })
  }

  // ── Relatório de Despesas classificado (plano de contas do contador) ──
  if (isClassifiedExpense(buf)) {
    const { entries, sheets } = parseExpenseReport(buf)
    // Despesas só até jun/2026 (alinhar com o período da receita; ignora jul+)
    const inPeriod = entries.filter(e => e.year < 2026 || (e.year === 2026 && e.month >= 1 && e.month <= 6))
    const dropped = entries.length - inPeriod.length
    inPeriod.forEach(e => add(
      { unit: e.unit, kind: 'EXP', line: e.line, sub: e.sub, supplier: e.supplier, supplierCode: e.supplierDoc, year: e.year, month: e.month },
      e.amount,
    ))
    const data = Array.from(map.values())
    const result = await prisma.$transaction(async tx => {
      // limpa despesas antigas (heurística) e as classificadas
      const del = await tx.dreEntry.deleteMany({ where: { kind: { in: ['EXP', 'DESPESA'] } } })
      const ins = await tx.dreEntry.createMany({ data })
      return { deleted: del.count, inserted: ins.count }
    }, { timeout: 240_000 })
    return NextResponse.json({ kind: 'expense-classified', sheets, buckets: data.length, lancamentosForaDoPeriodo: dropped, ...result })
  }

  const parsed = parseDre(buf)

  if (parsed.kind === 'payment') {
    parsed.rows.forEach(r => {
      const [line, sub] = classifyExpense(r.code, r.name, r.doc, r.obs)
      add({ unit: r.unit, kind: 'DESPESA', line, sub, supplier: r.name || null, supplierCode: r.code || null, year: r.year, month: r.month }, r.amount)
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
    add({ unit, kind: 'RECEITA', line: 'RECEITA', sub: r.isCard ? 'Recebimentos via Cartão' : 'Recebimentos Diretos (clientes)', supplier: null, supplierCode: null, year: r.year, month: r.month }, r.gross)
    if (r.discount) add({ unit, kind: 'DEDUCAO', line: 'DEDUCAO', sub: r.isCard ? 'Taxas de Cartão' : 'Descontos Comerciais', supplier: null, supplierCode: null, year: r.year, month: r.month }, r.discount)
    if (r.interest) add({ unit, kind: 'JUROS', line: 'JUROS', sub: 'Juros Recebidos de Clientes', supplier: null, supplierCode: null, year: r.year, month: r.month }, r.interest)
  })
  const data = Array.from(map.values())
  const result = await prisma.$transaction(async tx => {
    const del = await tx.dreEntry.deleteMany({ where: { unit, kind: { in: ['RECEITA', 'DEDUCAO', 'JUROS'] } } })
    const ins = await tx.dreEntry.createMany({ data })
    return { deleted: del.count, inserted: ins.count }
  }, { timeout: 120_000 })
  return NextResponse.json({ kind: 'receipt', unit, buckets: data.length, ...result, totalValor: parsed.total })
}
