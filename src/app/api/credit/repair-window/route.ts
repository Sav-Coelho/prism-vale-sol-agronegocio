/**
 * Reparo one-shot do estrago causado pela mudança de filtro do relatório do ERP
 * (jul/2026: janela de VECTO passou de 2025-01-02+ para 2026-01-02+).
 *
 * Quando a janela estreitou, os títulos vencidos em 2025 sumiram do arquivo e o
 * import os marcou "resolvidos" (DEFAULTED + paidDate) — mas eles seguem em
 * aberto no ERP (caso Santa Amélia / Joaquim Cunha apontado pela cobrança).
 *
 * Uso: POST multipart com o ÚLTIMO arquivo de janela ampla (o snapshot (3)/(5),
 * VECTO 2025-01-02 → 2026-06-29) + ?cutoff=2026-01-02 (início da janela atual).
 * Para cada título do arquivo com VECTO < cutoff que esteja DEFAULTED+paidDate
 * no DB, zera o paidDate (volta ao saldo em aberto; score não muda — o calote
 * continua contando). Títulos PAID não são tocados; títulos >= cutoff idem
 * (esses continuam cobertos pelos snapshots semanais normais).
 *
 * Idempotente: rodar duas vezes não muda nada na segunda.
 */
import { prisma } from '@/lib/prisma'
import { parseCashFlow, type ParsedReceivable } from '@/lib/cash-flow-parser'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

const extIdOf = (r: Pick<ParsedReceivable, 'titulo' | 'parcela' | 'dueDate' | 'filial'>) =>
  `${r.titulo}::${r.parcela ?? ''}::${r.dueDate}::${r.filial ?? ''}`

export async function POST(req: Request) {
  const url = new URL(req.url)
  const cutoffStr = url.searchParams.get('cutoff') ?? '2026-01-02'
  const cutoff = new Date(cutoffStr + 'T00:00:00Z').getTime()
  if (isNaN(cutoff)) return NextResponse.json({ error: 'cutoff inválido' }, { status: 400 })

  const fd = await req.formData()
  const file = fd.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Arquivo não enviado' }, { status: 400 })

  const parsed = parseCashFlow(await file.arrayBuffer())
  if (parsed.kind !== 'receivable' || !parsed.receivables?.length) {
    return NextResponse.json({ error: 'Arquivo não é "RELATORIO DE TITULOS A RECEBER"' }, { status: 400 })
  }

  // títulos do arquivo com vencimento ANTES da janela atual
  const oldOnes = parsed.receivables.filter(r => new Date(r.dueDate).getTime() < cutoff)
  if (oldOnes.length === 0) {
    return NextResponse.json({ reabertos: 0, valorReaberto: 0, detalhe: [], aviso: 'nenhum título anterior ao cutoff no arquivo' })
  }

  // resolve clientId como no import (code → cpf → nome)
  const allClients = await prisma.client.findMany({ select: { id: true, code: true, cpf: true, name: true } })
  const byCode = new Map<string, number>(), byDoc = new Map<string, number>(), byName = new Map<string, number>()
  allClients.forEach(c => {
    if (c.code) byCode.set(c.code, c.id)
    if (c.cpf) byDoc.set(c.cpf, c.id)
    byName.set(c.name.toUpperCase().trim(), c.id)
  })
  const clientIdOf = (r: ParsedReceivable): number | null => {
    if (r.customerCode && byCode.has(r.customerCode)) return byCode.get(r.customerCode)!
    if (r.customerDoc && byDoc.has(r.customerDoc)) return byDoc.get(r.customerDoc)!
    return byName.get(r.customerName.toUpperCase().trim()) ?? null
  }

  const wanted = new Set(oldOnes.map(r => `${clientIdOf(r)}::${extIdOf(r)}`))

  // candidatos no DB: calote "resolvido" (paidDate preenchido) vencido antes do cutoff
  const candidates = await prisma.sale.findMany({
    where: { paymentStatus: 'DEFAULTED', paidDate: { not: null }, dueDate: { lt: new Date(cutoff) } },
    select: { id: true, clientId: true, externalId: true, amount: true },
  })
  const toReopen = candidates.filter(s => wanted.has(`${s.clientId}::${s.externalId ?? ''}`))

  if (toReopen.length > 0) {
    await prisma.sale.updateMany({
      where: { id: { in: toReopen.map(s => s.id) } },
      data: { paidDate: null },
    })
  }

  // resumo por cliente para o log
  const nameOf = new Map(allClients.map(c => [c.id, c.name]))
  const porCliente = new Map<number, { nome: string; n: number; valor: number }>()
  toReopen.forEach(s => {
    if (!porCliente.has(s.clientId)) porCliente.set(s.clientId, { nome: nameOf.get(s.clientId) ?? '?', n: 0, valor: 0 })
    const c = porCliente.get(s.clientId)!
    c.n++; c.valor += s.amount
  })

  return NextResponse.json({
    cutoff: cutoffStr,
    titulosAntigosNoArquivo: oldOnes.length,
    candidatosNoDb: candidates.length,
    reabertos: toReopen.length,
    valorReaberto: toReopen.reduce((s, r) => s + r.amount, 0),
    detalhe: Array.from(porCliente.values()).sort((a, b) => b.valor - a.valor),
  })
}
