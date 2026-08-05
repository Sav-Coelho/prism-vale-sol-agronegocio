/**
 * Fluxo de caixa POR DIA (pedido do cliente): para cada dia com movimento,
 * o total a receber, a pagar, o saldo do dia, o acumulado e as CONTAS
 * COMPONENTES (título a título: quem, parcela, classificação, valor).
 * Considera vencimentos de hoje em diante.
 */
import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  // Inclui TUDO que está na base — inclusive vencimentos já passados (decisão do
  // usuário: o fluxo mostra o extrato completo, não só o futuro).
  const [receivables, payables] = await Promise.all([
    prisma.receivable.findMany({
      select: { dueDate: true, customerName: true, titulo: true, parcela: true, netAmount: true, observation: true },
      orderBy: { dueDate: 'asc' },
    }),
    prisma.payable.findMany({
      select: { dueDate: true, supplierName: true, titulo: true, parcela: true, netAmount: true, operacao: true },
      orderBy: { dueDate: 'asc' },
    }),
  ])

  interface Item { nome: string; titulo: string | null; parcela: string | null; classif: string | null; valor: number }
  interface Day { date: string; receber: number; pagar: number; recebimentos: Item[]; pagamentos: Item[] }
  const days = new Map<string, Day>()
  const dayOf = (d: Date) => d.toISOString().slice(0, 10)
  const ensure = (k: string) => {
    if (!days.has(k)) days.set(k, { date: k, receber: 0, pagar: 0, recebimentos: [], pagamentos: [] })
    return days.get(k)!
  }

  receivables.forEach(r => {
    const d = ensure(dayOf(r.dueDate))
    d.receber += r.netAmount
    d.recebimentos.push({ nome: r.customerName, titulo: r.titulo || null, parcela: r.parcela, classif: r.observation, valor: r.netAmount })
  })
  payables.forEach(p => {
    const d = ensure(dayOf(p.dueDate))
    d.pagar += p.netAmount
    d.pagamentos.push({ nome: p.supplierName, titulo: p.titulo || null, parcela: p.parcela, classif: p.operacao, valor: p.netAmount })
  })

  // ordena por dia; itens maiores primeiro; acumulado corrente
  let acumulado = 0
  const out = Array.from(days.values()).sort((a, b) => a.date.localeCompare(b.date)).map(d => {
    d.recebimentos.sort((a, b) => b.valor - a.valor)
    d.pagamentos.sort((a, b) => b.valor - a.valor)
    const saldoDia = d.receber - d.pagar
    acumulado += saldoDia
    return { ...d, saldoDia, acumulado, nReceber: d.recebimentos.length, nPagar: d.pagamentos.length }
  })

  const totReceber = out.reduce((s, d) => s + d.receber, 0)
  const totPagar = out.reduce((s, d) => s + d.pagar, 0)

  return NextResponse.json({
    hasData: out.length > 0,
    hoje: dayOf(today),
    resumo: { totReceber, totPagar, saldo: totReceber - totPagar, nDias: out.length },
    dias: out,
  })
}
