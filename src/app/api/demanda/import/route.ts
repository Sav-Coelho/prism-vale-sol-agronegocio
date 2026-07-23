/**
 * Import da demanda por cliente → DemandEntry.
 * Substituição POR PERÍODO: apaga somente os (ano, mês) presentes no payload —
 * permite manter 2025 no banco e atualizar só 2026, e vice-versa.
 *  - multipart (file): arquivos pequenos (parse no servidor).
 *  - JSON { entries, resetMonths? }: arquivos grandes (>4.5MB) — o cliente parseia
 *    localmente e envia em lotes; resetMonths ("YYYY-MM"[]) vem só no 1º lote.
 */
import { prisma } from '@/lib/prisma'
import { parseDemanda, isComercialDemanda } from '@/lib/demanda-parser'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

async function deleteMonths(months: string[]) {
  let deleted = 0
  for (const ym of months) {
    const [y, m] = ym.split('-').map(Number)
    if (!y || !m) continue
    deleted += (await prisma.demandEntry.deleteMany({ where: { year: y, month: m } })).count
  }
  return deleted
}

async function insertChunked(entries: unknown[]) {
  let inserted = 0
  const CHUNK = 5000
  for (let i = 0; i < entries.length; i += CHUNK) {
    inserted += (await prisma.demandEntry.createMany({ data: entries.slice(i, i + CHUNK) as never })).count
  }
  return inserted
}

export async function POST(req: Request) {
  const ct = req.headers.get('content-type') || ''

  // ── Modo lote (JSON) ──
  if (ct.includes('application/json')) {
    const { entries, resetMonths } = await req.json()
    if (!Array.isArray(entries)) return NextResponse.json({ error: 'entries inválido' }, { status: 400 })
    let deleted = 0
    if (Array.isArray(resetMonths) && resetMonths.length) deleted = await deleteMonths(resetMonths)
    const inserted = await insertChunked(entries)
    return NextResponse.json({ kind: 'demanda-batch', deleted, inserted })
  }

  // ── Modo arquivo (multipart) ──
  const fd = await req.formData()
  const file = fd.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Arquivo não enviado' }, { status: 400 })
  const buf = await file.arrayBuffer()
  if (!isComercialDemanda(buf)) {
    return NextResponse.json({ error: 'Formato não reconhecido (esperado COMERCIAL: VENDEDOR, CLIENTE, PRODUTO, DATA).' }, { status: 400 })
  }
  const { entries, clientes, produtos, leaves, total, months } = parseDemanda(buf)
  const deleted = await deleteMonths(months)          // substitui SÓ os meses do arquivo
  const inserted = await insertChunked(entries)
  return NextResponse.json({ kind: 'demanda', deleted, inserted, clientes, produtos, leaves, total, months })
}
