/**
 * Import da demanda por cliente → DemandEntry.
 * Substituição POR PERÍODO: apaga somente os (ano, mês) presentes no payload —
 * permite manter 2025 no banco e atualizar só 2026, e vice-versa.
 *  - multipart (file): arquivos pequenos (parse no servidor).
 *  - JSON { entries, resetMonths?, cobertura? }: arquivos grandes (>4.5MB) — o cliente parseia
 *    localmente e envia em lotes; resetMonths ("YYYY-MM"[]) e cobertura vêm só no 1º lote.
 * Grava também até que dia cada mês veio (DemandaCobertura): mês incompleto conta
 * como parcial na regra de mês fechado (lib/bcg).
 */
import { prisma } from '@/lib/prisma'
import { parseDemanda, isComercialDemanda, type CoberturaArquivo } from '@/lib/demanda-parser'
import { NextResponse } from 'next/server'

const DIA = /^\d{4}-\d{2}-\d{2}$/
async function gravarCobertura(cobertura: CoberturaArquivo) {
  for (const ym of Object.keys(cobertura)) {
    const [y, m] = ym.split('-').map(Number)
    const c = cobertura[ym]
    if (!y || !m || !c || !DIA.test(c.de) || !DIA.test(c.ate)) continue
    await prisma.demandaCobertura.upsert({
      where: { year_month: { year: y, month: m } },
      create: { year: y, month: m, deDia: c.de, ateDia: c.ate },
      update: { deDia: c.de, ateDia: c.ate },
    })
  }
}

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
    const { entries, resetMonths, cobertura } = await req.json()
    if (!Array.isArray(entries)) return NextResponse.json({ error: 'entries inválido' }, { status: 400 })
    let deleted = 0
    if (Array.isArray(resetMonths) && resetMonths.length) deleted = await deleteMonths(resetMonths)
    const inserted = await insertChunked(entries)
    if (cobertura && typeof cobertura === 'object') await gravarCobertura(cobertura as CoberturaArquivo)
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
  const { entries, clientes, produtos, leaves, total, months, cobertura } = parseDemanda(buf)
  const deleted = await deleteMonths(months)          // substitui SÓ os meses do arquivo
  const inserted = await insertChunked(entries)
  await gravarCobertura(cobertura)
  return NextResponse.json({ kind: 'demanda', deleted, inserted, clientes, produtos, leaves, total, months, cobertura })
}
