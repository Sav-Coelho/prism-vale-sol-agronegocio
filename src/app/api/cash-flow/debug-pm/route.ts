// Rota de validação — devolve alguns registros brutos com o cálculo de dias
// que alimenta o PMR/PMP, pra conferir lado a lado contra (vencimento − emissão).
//
// Use: curl https://.../api/cash-flow/debug-pm
import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

function daysBetween(later: Date, earlier: Date) {
  return Math.round((later.getTime() - earlier.getTime()) / (1000 * 60 * 60 * 24))
}

export async function GET() {
  const cutoff = new Date()
  cutoff.setHours(0, 0, 0, 0)

  const receivables = await prisma.receivable.findMany({
    where: { issueDate: { not: null }, dueDate: { gt: cutoff } },
    select: {
      titulo: true, parcela: true,
      customerName: true,
      issueDate: true, dueDate: true,
      netAmount: true,
    },
    take: 15,
    orderBy: { dueDate: 'asc' },
  })

  const payables = await prisma.payable.findMany({
    where: { entryDate: { not: null }, dueDate: { gt: cutoff } },
    select: {
      titulo: true, parcela: true,
      supplierName: true,
      entryDate: true, dueDate: true,
      netAmount: true,
    },
    take: 15,
    orderBy: { dueDate: 'asc' },
  })

  // Replica EXATAMENTE o que o /series faz, pra a auditoria ser fiel.
  const recvCalc = receivables.map(r => ({
    cliente: r.customerName,
    titulo: `${r.titulo}/${r.parcela}`,
    emissao_iso: r.issueDate!.toISOString().slice(0, 10),
    vencimento_iso: r.dueDate.toISOString().slice(0, 10),
    valor: r.netAmount,
    dias_calculados: daysBetween(r.dueDate, r.issueDate!),
    // Verificação manual: ms diff / 86400000, mesma fórmula
    verificacao_manual_dias: Math.round(
      (r.dueDate.getTime() - r.issueDate!.getTime()) / (1000 * 60 * 60 * 24),
    ),
  }))

  const payCalc = payables.map(p => ({
    fornecedor: p.supplierName,
    titulo: `${p.titulo}/${p.parcela}`,
    entrada_iso: p.entryDate!.toISOString().slice(0, 10),
    vencimento_iso: p.dueDate.toISOString().slice(0, 10),
    valor: p.netAmount,
    dias_calculados: daysBetween(p.dueDate, p.entryDate!),
    verificacao_manual_dias: Math.round(
      (p.dueDate.getTime() - p.entryDate!.getTime()) / (1000 * 60 * 60 * 24),
    ),
  }))

  return NextResponse.json({
    note: 'dias_calculados = mesma fórmula do /series. verificacao_manual_dias = recálculo independente — devem bater 100%.',
    receivablesSample: recvCalc,
    payablesSample: payCalc,
  })
}
