/**
 * Import do CashFlow Analítico (razão de caixa da contabilidade).
 * Wipe-and-replace da tabela CashflowEntry. Não toca em DreEntry.
 */
import { prisma } from '@/lib/prisma'
import { parseCashflowAnalitico, isCashflowAnalitico } from '@/lib/cashflow-analitico-parser'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

export async function POST(req: Request) {
  const fd = await req.formData()
  const file = fd.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Arquivo não enviado' }, { status: 400 })

  const buf = await file.arrayBuffer()
  if (!isCashflowAnalitico(buf)) {
    return NextResponse.json({ error: 'Formato não reconhecido. Esperado o CashFlow Analítico (colunas FILIAL, TIPO, CLASSIF_CONTABIL).' }, { status: 400 })
  }

  const { entries, filiais, months, rows, totalE, totalS } = parseCashflowAnalitico(buf)

  const del = await prisma.cashflowEntry.deleteMany({})
  // insere em lotes (agregado costuma ser alguns milhares de linhas)
  let inserted = 0
  const CHUNK = 2000
  for (let i = 0; i < entries.length; i += CHUNK) {
    const r = await prisma.cashflowEntry.createMany({ data: entries.slice(i, i + CHUNK) })
    inserted += r.count
  }

  return NextResponse.json({
    kind: 'cashflow-analitico',
    deleted: del.count,
    inserted,
    linhasBrutas: rows,
    filiais, months,
    totalEntradas: totalE,
    totalSaidas: totalS,
    saldo: totalE + totalS,
  })
}
