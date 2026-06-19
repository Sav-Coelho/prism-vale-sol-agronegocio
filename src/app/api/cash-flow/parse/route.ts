import { prisma } from '@/lib/prisma'
import { parseCashFlow } from '@/lib/cash-flow-parser'
import { NextResponse } from 'next/server'

// Recebe um XLSX e devolve preview com cada linha marcada como
// "alreadyImported" se o fitid já existir no DB.
export async function POST(req: Request) {
  const fd = await req.formData()
  const file = fd.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Arquivo não enviado' }, { status: 400 })

  const buf = await file.arrayBuffer()
  let result
  try {
    result = parseCashFlow(buf)
  } catch (e) {
    return NextResponse.json({
      error: 'Falha ao ler XLSX: ' + (e instanceof Error ? e.message : String(e)),
    }, { status: 400 })
  }

  if (result.kind === 'receivable') {
    const items = result.receivables ?? []
    const fitids = items.map(i => i.fitid)
    const existing = fitids.length
      ? await prisma.receivable.findMany({ where: { fitid: { in: fitids } }, select: { fitid: true } })
      : []
    const existingSet = new Set(existing.map(e => e.fitid))
    const previewed = items.map(i => ({ ...i, alreadyImported: existingSet.has(i.fitid) }))
    const news = previewed.filter(i => !i.alreadyImported).length
    return NextResponse.json({
      kind: 'receivable',
      total: items.length,
      totalAmount: result.totalAmount,
      newCount: news,
      duplicateCount: items.length - news,
      items: previewed,
      errors: result.errors,
    })
  }

  // payable
  const items = result.payables ?? []
  const fitids = items.map(i => i.fitid)
  const existing = fitids.length
    ? await prisma.payable.findMany({ where: { fitid: { in: fitids } }, select: { fitid: true } })
    : []
  const existingSet = new Set(existing.map(e => e.fitid))
  const previewed = items.map(i => ({ ...i, alreadyImported: existingSet.has(i.fitid) }))
  const news = previewed.filter(i => !i.alreadyImported).length
  return NextResponse.json({
    kind: 'payable',
    total: items.length,
    totalAmount: result.totalAmount,
    newCount: news,
    duplicateCount: items.length - news,
    items: previewed,
    errors: result.errors,
  })
}
