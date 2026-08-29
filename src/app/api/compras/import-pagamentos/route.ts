/**
 * Import do RELATORIO DE PAGAMENTOS A EFETUAR → PurchaseCommit.
 * Reusa o parser de payables (VENCTO/ENTRADA/VLR LÍQ./OPERAÇÃO). Guarda VLR LÍQUIDO.
 * Substitui SÓ a janela coberta pelo arquivo (dueDate >= 1º vencimento) —
 * boletos vencidos antes ficam como histórico pago do mês (mesma regra do
 * import do CashFlow Analítico, que também alimenta esta base).
 * Não toca em Payable (fluxo de caixa) nem em PurchaseOrder (pedidos manuais).
 */
import { prisma } from '@/lib/prisma'
import { parseCashFlow } from '@/lib/cash-flow-parser'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

export async function POST(req: Request) {
  const fd = await req.formData()
  const file = fd.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Arquivo não enviado' }, { status: 400 })

  const parsed = parseCashFlow(await file.arrayBuffer())
  if (parsed.kind !== 'payable' || !parsed.payables?.length) {
    return NextResponse.json({ error: 'Arquivo não é "RELATORIO DE PAGAMENTOS A EFETUAR" (esperado VENCTO/ENTRADA).' }, { status: 400 })
  }

  const data = parsed.payables.map(p => ({
    fornecedor: p.supplierName,
    titulo: p.titulo || null,
    parcela: p.parcela || null,
    dueDate: new Date(p.dueDate),
    valor: p.netAmount || p.amount,
    operacao: p.operacao || null,
    tipoDocto: p.tipoDocto || null,
    filial: p.filial || null,
  }))

  const minDue = data.reduce((m, d) => d.dueDate < m ? d.dueDate : m, data[0].dueDate)
  const del = await prisma.purchaseCommit.deleteMany({ where: { dueDate: { gte: minDue } } })
  const ins = await prisma.purchaseCommit.createMany({ data })

  const total = data.reduce((s, d) => s + d.valor, 0)
  return NextResponse.json({ kind: 'pagamentos-a-efetuar', deleted: del.count, inserted: ins.count, total })
}
