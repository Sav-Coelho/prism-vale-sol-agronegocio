/**
 * Import de "RELATORIO DE TITULOS A RECEBER" (XLSX) para alimentar
 * o modelo Bayesiano de risco de cliente.
 *
 * Estratégia: WIPE-AND-REPLACE. A cada upload:
 *   1. Apaga TODAS as Sales
 *   2. Apaga TODOS os Clients
 *   3. Re-cria Clients agrupados por CÓDIGO do ERP
 *   4. Cria uma Sale por título (OVERDUE — todos os do relatório estão vencidos)
 *
 * O classifier em lib/credit.ts converte automaticamente
 *   OVERDUE + (hoje − dueDate) ≥ 90 dias → DEFAULTED.
 */
import { prisma } from '@/lib/prisma'
import { parseCashFlow, type ParsedReceivable } from '@/lib/cash-flow-parser'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(req: Request) {
  const fd = await req.formData()
  const file = fd.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Arquivo não enviado' }, { status: 400 })

  const buf = await file.arrayBuffer()
  const parsed = parseCashFlow(buf)

  if (parsed.kind !== 'receivable') {
    return NextResponse.json({ error: 'O arquivo não é um "RELATORIO DE TITULOS A RECEBER" (falta coluna VECTO)' }, { status: 400 })
  }
  if (!parsed.receivables || parsed.receivables.length === 0) {
    return NextResponse.json({ error: 'Nenhum título válido encontrado no arquivo' }, { status: 400 })
  }

  // Agrupa títulos por CÓDIGO do ERP (fallback: customerDoc, depois customerName)
  type Bucket = {
    code: string | null
    doc: string | null
    name: string
    phone: string | null
    items: ParsedReceivable[]
  }
  const buckets = new Map<string, Bucket>()
  const skipped: string[] = []

  for (const r of parsed.receivables) {
    // Chave: customerCode se existir, senão customerDoc, senão nome normalizado
    const key = r.customerCode || r.customerDoc || `NAME:${r.customerName.toUpperCase().trim()}`
    if (!buckets.has(key)) {
      buckets.set(key, {
        code: r.customerCode,
        doc: r.customerDoc,
        name: r.customerName,
        phone: r.phone,
        items: [],
      })
    }
    buckets.get(key)!.items.push(r)
  }

  // Executa wipe-and-replace atomicamente
  const result = await prisma.$transaction(async tx => {
    const deletedSales = await tx.sale.deleteMany({})
    const deletedClients = await tx.client.deleteMany({})

    let createdClients = 0
    let createdSales = 0

    for (const b of Array.from(buckets.values())) {
      const client = await tx.client.create({
        data: {
          code: b.code,
          name: b.name,
          cpf: b.doc,
          phone: b.phone,
          active: true,
        },
      })
      createdClients += 1

      const salesData = b.items.map(r => {
        const issueDate = r.issueDate ? new Date(r.issueDate) : new Date(r.dueDate)
        return {
          clientId: client.id,
          description: `Título ${r.titulo}${r.parcela ? ' · ' + r.parcela : ''}`,
          amount: r.amount,   // valor original (não usar netAmount pra não inflar receita com juros/multa)
          date: issueDate,
          dueDate: new Date(r.dueDate),
          paidDate: null,
          paymentStatus: 'OVERDUE',
          unitId: null,
          month: issueDate.getMonth() + 1,
          year: issueDate.getFullYear(),
        }
      })

      if (salesData.length > 0) {
        const ins = await tx.sale.createMany({ data: salesData })
        createdSales += ins.count
      }
    }

    return {
      deletedSales: deletedSales.count,
      deletedClients: deletedClients.count,
      createdClients,
      createdSales,
    }
  }, { timeout: 120_000 })

  return NextResponse.json({
    ...result,
    totalTitulos: parsed.receivables.length,
    skipped: skipped.length,
    parsedErrors: parsed.errors,
  })
}
