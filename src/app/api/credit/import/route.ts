/**
 * Import INCREMENTAL de "RELATORIO DE TITULOS A RECEBER" pro modelo de crédito.
 *
 * Semântica cross-snapshot (a cada upload):
 *   • No XLSX + no DB  → mantém OVERDUE (o classifier promove pra DEFAULTED
 *                        conforme o dueDate envelhece contra a data de hoje)
 *   • No DB, ausente   → foi pago no ERP: marca PAID com paidDate = hoje
 *                        (melhora o score)
 *   • Só no XLSX       → novo título em atraso: cria OVERDUE (piora o score)
 *   • PAID e voltou    → reverte pra OVERDUE (reconcilia com o ERP)
 *
 * Chave estável de título: (clientId, externalId="titulo::parcela").
 */
import { prisma } from '@/lib/prisma'
import { parseCashFlow, type ParsedReceivable } from '@/lib/cash-flow-parser'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Chave estável por título no ERP
const extIdOf = (r: Pick<ParsedReceivable, 'titulo' | 'parcela'>) =>
  `${r.titulo}::${r.parcela ?? ''}`

// Chave de agrupamento por cliente
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

  // Agrupa por cliente
  type Bucket = {
    code: string | null
    doc: string | null
    name: string
    phone: string | null
    items: ParsedReceivable[]
  }
  const buckets = new Map<string, Bucket>()
  parsed.receivables.forEach(r => {
    const key = clientKeyOf(r)
    if (!buckets.has(key)) {
      buckets.set(key, { code: r.customerCode, doc: r.customerDoc, name: r.customerName, phone: r.phone, items: [] })
    }
    buckets.get(key)!.items.push(r)
  })

  // Set de chaves globais do XLSX (customerCode/customerDoc/nome + extId)
  const xlsxKeyGlobal = new Set<string>()
  Array.from(buckets.entries()).forEach(([clientKey, b]) => {
    b.items.forEach(r => xlsxKeyGlobal.add(`${clientKey}||${extIdOf(r)}`))
  })

  const result = await prisma.$transaction(async tx => {
    // Passo 1 · Detecta títulos OVERDUE atuais que sumiram → PAID
    const currentOverdue = await tx.sale.findMany({
      where: { paymentStatus: 'OVERDUE' },
      select: {
        id: true, externalId: true,
        client: { select: { code: true, cpf: true, name: true } },
      },
    })

    const idsToMarkPaid: number[] = []
    currentOverdue.forEach(s => {
      const c = s.client
      const clientKey = c.code || c.cpf || `NAME:${c.name.toUpperCase().trim()}`
      const globalKey = `${clientKey}||${s.externalId ?? ''}`
      if (!xlsxKeyGlobal.has(globalKey)) idsToMarkPaid.push(s.id)
    })

    const markedPaid = idsToMarkPaid.length > 0
      ? (await tx.sale.updateMany({
          where: { id: { in: idsToMarkPaid } },
          data: { paymentStatus: 'PAID', paidDate: importDate },
        })).count
      : 0

    // Passo 2 · Upsert Clients + Sales por bucket
    let createdClients = 0, updatedClients = 0, createdSales = 0, updatedSales = 0, revertedFromPaid = 0

    for (const b of Array.from(buckets.values())) {
      let clientId: number

      // Upsert Client (chave: code, fallback cpf, fallback create sem chave)
      if (b.code) {
        const before = await tx.client.findUnique({ where: { code: b.code } })
        const c = await tx.client.upsert({
          where: { code: b.code },
          create: { code: b.code, name: b.name, cpf: b.doc, phone: b.phone },
          update: { name: b.name, cpf: b.doc, phone: b.phone },
        })
        clientId = c.id
        if (before) updatedClients += 1
        else createdClients += 1
      } else {
        const existing = b.doc
          ? await tx.client.findFirst({ where: { cpf: b.doc } })
          : null
        if (existing) {
          const c = await tx.client.update({
            where: { id: existing.id },
            data: { name: b.name, phone: b.phone },
          })
          clientId = c.id; updatedClients += 1
        } else {
          const c = await tx.client.create({
            data: { name: b.name, cpf: b.doc, phone: b.phone },
          })
          clientId = c.id; createdClients += 1
        }
      }

      // Upsert Sales
      for (const r of b.items) {
        const extId = extIdOf(r)
        const issueDate = r.issueDate ? new Date(r.issueDate) : new Date(r.dueDate)
        const existing = await tx.sale.findUnique({
          where: { clientId_externalId: { clientId, externalId: extId } },
        })

        if (existing) {
          const wasPaid = existing.paymentStatus === 'PAID'
          await tx.sale.update({
            where: { id: existing.id },
            data: {
              amount: r.amount,
              dueDate: new Date(r.dueDate),
              date: issueDate,
              paymentStatus: 'OVERDUE',
              paidDate: null,
              month: issueDate.getMonth() + 1,
              year: issueDate.getFullYear(),
            },
          })
          if (wasPaid) revertedFromPaid += 1
          else updatedSales += 1
        } else {
          await tx.sale.create({
            data: {
              clientId,
              externalId: extId,
              description: `Título ${r.titulo}${r.parcela ? ' · ' + r.parcela : ''}`,
              amount: r.amount,
              date: issueDate,
              dueDate: new Date(r.dueDate),
              paidDate: null,
              paymentStatus: 'OVERDUE',
              month: issueDate.getMonth() + 1,
              year: issueDate.getFullYear(),
            },
          })
          createdSales += 1
        }
      }
    }

    return {
      totalNoXlsx: parsed.receivables!.length,
      titulosPagos: markedPaid,             // sumiram do XLSX → PAID
      titulosNovos: createdSales,           // não existiam no DB
      titulosMantidos: updatedSales,        // interseção
      titulosRevertidos: revertedFromPaid,  // PAID e voltaram
      clientesCriados: createdClients,
      clientesAtualizados: updatedClients,
    }
  }, { timeout: 240_000 })

  return NextResponse.json({ ...result, importDate: importDate.toISOString() })
}
