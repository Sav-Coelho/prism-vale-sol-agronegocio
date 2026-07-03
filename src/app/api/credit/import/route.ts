/**
 * Import INCREMENTAL de "RELATORIO DE TITULOS A RECEBER" pro modelo de crédito.
 *
 * Semântica cross-snapshot (a cada upload):
 *   • No XLSX + no DB (interseção) → mantém OVERDUE (o classifier promove
 *                                    pra DEFAULTED conforme o dueDate envelhece)
 *   • No DB, ausente no XLSX       → foi pago no ERP: marca PAID com paidDate = hoje
 *   • Só no XLSX                   → cria como OVERDUE (título novo em atraso)
 *   • PAID e voltou no XLSX        → reverte pra OVERDUE (reconcilia com o ERP)
 *
 * Chave estável de título: (clientId, externalId="titulo::parcela").
 * Chave estável de cliente: code = CÓDIGO do ERP.
 *
 * Implementado como sequência de operações em BATCH (sem transação longa,
 * pra caber no limite de 10s da função serverless do Vercel).
 */
import { prisma } from '@/lib/prisma'
import { parseCashFlow, type ParsedReceivable } from '@/lib/cash-flow-parser'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60  // Vercel Hobby permite até 60s por função

// Inclui dueDate e filial na chave: o mesmo número de título pode existir em
// filiais diferentes do mesmo cliente (colisão real observada nos relatórios).
// Caveat: se o ERP renegociar o VECTO de um título, a chave muda e o título
// antigo será marcado PAID — aceitável, pois renegociação quita o título original.
const extIdOf = (r: Pick<ParsedReceivable, 'titulo' | 'parcela' | 'dueDate' | 'filial'>) =>
  `${r.titulo}::${r.parcela ?? ''}::${r.dueDate}::${r.filial ?? ''}`

const clientKeyOf = (r: ParsedReceivable) =>
  r.customerCode || r.customerDoc || `NAME:${r.customerName.toUpperCase().trim()}`

export async function POST(req: Request) {
  const fd = await req.formData()
  const file = fd.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Arquivo não enviado' }, { status: 400 })

  const buf = await file.arrayBuffer()
  const parsed = parseCashFlow(buf)

  if (parsed.kind !== 'receivable') {
    return NextResponse.json({ error: 'Arquivo não é "RELATORIO DE TITULOS A RECEBER" (falta coluna VECTO)' }, { status: 400 })
  }
  if (!parsed.receivables || parsed.receivables.length === 0) {
    return NextResponse.json({ error: 'Nenhum título encontrado' }, { status: 400 })
  }

  const importDate = new Date()
  const clientCountBefore = await prisma.client.count()

  // ── Agrupa por cliente ─────────────────────────────────────
  type Bucket = { code: string | null; doc: string | null; name: string; phone: string | null; items: ParsedReceivable[] }
  const buckets = new Map<string, Bucket>()
  parsed.receivables.forEach(r => {
    const key = clientKeyOf(r)
    if (!buckets.has(key)) {
      buckets.set(key, { code: r.customerCode, doc: r.customerDoc, name: r.customerName, phone: r.phone, items: [] })
    }
    buckets.get(key)!.items.push(r)
  })

  // ── Passo 1: cria/atualiza Clients em batch ─────────────────
  // Estratégia: createMany para inserir só os novos (skipDuplicates via Client.code @unique),
  // depois busca todos e monta o map (clientKey → id).
  const clientsWithCode = Array.from(buckets.values()).filter(b => b.code)
  const clientsNoCode   = Array.from(buckets.values()).filter(b => !b.code)

  // 1a. cria clients com code (skipDuplicates ignora os que já existem)
  await prisma.client.createMany({
    data: clientsWithCode.map(b => ({
      code: b.code!,
      name: b.name,
      cpf: b.doc,
      phone: b.phone,
      active: true,
    })),
    skipDuplicates: true,
  })

  // 1b. clients sem code — vai um por um (raro)
  for (const b of clientsNoCode) {
    const existing = b.doc ? await prisma.client.findFirst({ where: { cpf: b.doc } }) : null
    if (!existing) {
      await prisma.client.create({ data: { name: b.name, cpf: b.doc, phone: b.phone } })
    }
  }

  // ── Passo 2: monta o map clientKey → clientId ─────────────
  const allClients = await prisma.client.findMany({
    select: { id: true, code: true, cpf: true, name: true },
  })
  const clientIdByCode = new Map<string, number>()
  const clientIdByDoc  = new Map<string, number>()
  const clientIdByName = new Map<string, number>()
  allClients.forEach(c => {
    if (c.code) clientIdByCode.set(c.code, c.id)
    if (c.cpf)  clientIdByDoc.set(c.cpf, c.id)
    clientIdByName.set(`NAME:${c.name.toUpperCase().trim()}`, c.id)
  })

  const resolveClientId = (bKey: string, b: Bucket): number | null => {
    if (b.code && clientIdByCode.has(b.code)) return clientIdByCode.get(b.code)!
    if (b.doc  && clientIdByDoc.has(b.doc))   return clientIdByDoc.get(b.doc)!
    if (clientIdByName.has(bKey))              return clientIdByName.get(bKey)!
    return null
  }

  // Set global de chaves (clientId, extId) do XLSX
  const xlsxKeysByClient = new Map<number, Set<string>>()  // clientId → set of extIds
  let missingClientCount = 0
  Array.from(buckets.entries()).forEach(([bKey, b]) => {
    const clientId = resolveClientId(bKey, b)
    if (!clientId) { missingClientCount += b.items.length; return }
    let set = xlsxKeysByClient.get(clientId)
    if (!set) { set = new Set(); xlsxKeysByClient.set(clientId, set) }
    b.items.forEach(r => set!.add(extIdOf(r)))
  })

  // ── Passo 3: carrega Sales atuais e detecta ordem cronológica ──
  const currentSales = await prisma.sale.findMany({
    where: { paymentStatus: { in: ['OVERDUE', 'PAID'] } },
    select: { id: true, clientId: true, externalId: true, paymentStatus: true, dueDate: true, amount: true },
  })

  const currentByClientExt = new Map<string, { id: number; status: string; amount: number }>()
  currentSales.forEach(s => {
    currentByClientExt.set(`${s.clientId}::${s.externalId ?? ''}`, { id: s.id, status: s.paymentStatus, amount: s.amount })
  })

  // Detecção de ordem cronológica: max(VECTO) do XLSX vs max(dueDate) do DB
  // Um relatório mais recente tem títulos com dueDates mais avançados.
  const maxDueXlsx = parsed.receivables.reduce((m, r) => {
    const t = new Date(r.dueDate).getTime()
    return t > m ? t : m
  }, 0)
  const maxDueDb = currentSales.reduce((m, s) => {
    const t = s.dueDate?.getTime() ?? 0
    return t > m ? t : m
  }, 0)
  const isOlderSnapshot = maxDueDb > 0 && maxDueXlsx < maxDueDb

  const idsToMarkPaid: number[] = []
  const idsToRevertToOverdue: number[] = []

  currentSales.forEach(s => {
    const inXlsx = xlsxKeysByClient.get(s.clientId)?.has(s.externalId ?? '')
    if (s.paymentStatus === 'OVERDUE' && !inXlsx) {
      // Só marca PAID se o novo snapshot é mais RECENTE que o estado atual.
      // Se for mais antigo, o título "ausente" pode simplesmente não existir ainda naquela foto.
      if (!isOlderSnapshot) idsToMarkPaid.push(s.id)
    } else if (s.paymentStatus === 'PAID' && inXlsx) {
      idsToRevertToOverdue.push(s.id)         // reabriu no ERP → volta pra OVERDUE
    }
  })

  // Sales novos (não existem no DB) + refresh de amount pra interseção
  type NewSaleData = {
    clientId: number; externalId: string; description: string;
    amount: number; date: Date; dueDate: Date; paymentStatus: string;
    month: number; year: number;
  }
  const newSales: NewSaleData[] = []
  const amountUpdates: Array<{ id: number; amount: number }> = []
  let keptCount = 0

  Array.from(buckets.entries()).forEach(([bKey, b]) => {
    const clientId = resolveClientId(bKey, b)
    if (!clientId) return
    b.items.forEach(r => {
      const extId = extIdOf(r)
      const existing = currentByClientExt.get(`${clientId}::${extId}`)
      if (existing) {
        keptCount += 1
        // Refresh do valor caso o ERP tenha corrigido o título entre snapshots
        if (Math.abs(existing.amount - r.amount) > 0.005) {
          amountUpdates.push({ id: existing.id, amount: r.amount })
        }
        return
      }
      const issueDate = r.issueDate ? new Date(r.issueDate) : new Date(r.dueDate)
      newSales.push({
        clientId,
        externalId: extId,
        description: `Título ${r.titulo}${r.parcela ? ' · ' + r.parcela : ''}`,
        amount: r.amount,
        date: issueDate,
        dueDate: new Date(r.dueDate),
        paymentStatus: 'OVERDUE',
        month: issueDate.getMonth() + 1,
        year: issueDate.getFullYear(),
      })
    })
  })

  // ── Passo 4: executa em batches ────────────────────────────
  let markedPaid = 0
  let reverted = 0
  if (idsToMarkPaid.length > 0) {
    const r = await prisma.sale.updateMany({
      where: { id: { in: idsToMarkPaid } },
      data: { paymentStatus: 'PAID', paidDate: importDate },
    })
    markedPaid = r.count
  }
  if (idsToRevertToOverdue.length > 0) {
    const r = await prisma.sale.updateMany({
      where: { id: { in: idsToRevertToOverdue } },
      data: { paymentStatus: 'OVERDUE', paidDate: null },
    })
    reverted = r.count
  }
  let created = 0
  if (newSales.length > 0) {
    const r = await prisma.sale.createMany({ data: newSales, skipDuplicates: true })
    created = r.count
  }
  // Correções pontuais de valor (raro — só quando o ERP altera o título)
  for (const u of amountUpdates) {
    await prisma.sale.update({ where: { id: u.id }, data: { amount: u.amount } })
  }

  const clientCountAfter = await prisma.client.count()

  return NextResponse.json({
    totalNoXlsx:        parsed.receivables.length,
    titulosPagos:       markedPaid,       // sumiram do XLSX → PAID (só se snapshot recente)
    titulosNovos:       created,          // não existiam no DB
    titulosMantidos:    keptCount,        // interseção que continua devendo (chaves únicas)
    titulosRevertidos:  reverted,         // PAID e voltaram → OVERDUE
    valoresCorrigidos:  amountUpdates.length,
    clientesCriados:    Math.max(0, clientCountAfter - clientCountBefore),
    clientesTotal:      clientCountAfter,
    missingClientCount,
    snapshotAntigo:     isOlderSnapshot,  // avisa a UI que este XLSX é anterior ao estado atual
    maxDueDateXlsx:     maxDueXlsx ? new Date(maxDueXlsx).toISOString().slice(0, 10) : null,
    maxDueDateDb:       maxDueDb  ? new Date(maxDueDb).toISOString().slice(0, 10) : null,
    importDate:         importDate.toISOString(),
  })
}
