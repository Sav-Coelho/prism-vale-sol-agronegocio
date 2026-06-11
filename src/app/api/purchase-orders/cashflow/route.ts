import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

// Aggregate purchase installments by month, returning a series for cash flow planning.
// Query params: months (lookahead window, default 12), unitId (optional)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const lookahead = Math.min(parseInt(searchParams.get('months') || '12'), 36)
  const unitId = searchParams.get('unitId')

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Build the next N month keys (YYYY-MM) starting from current month
  const keys: { key: string; label: string; year: number; month: number }[] = []
  for (let i = 0; i < lookahead; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() + i, 1)
    const m = d.getMonth() + 1
    const y = d.getFullYear()
    keys.push({
      key: `${y}-${String(m).padStart(2, '0')}`,
      label: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
      year: y,
      month: m,
    })
  }

  const where: Record<string, unknown> = {}
  if (unitId) where.order = { unitId: parseInt(unitId) }

  const installments = await prisma.purchaseInstallment.findMany({
    where,
    select: {
      amount: true,
      status: true,
      dueDate: true,
      month: true,
      year: true,
      order: {
        select: {
          id: true,
          buyer: { select: { id: true, name: true } },
          supplier: { select: { id: true, name: true } },
        },
      },
    },
  })

  // Group by month: pending and paid totals
  const byMonth: Record<string, { pending: number; paid: number; overdue: number; total: number }> = {}
  for (const k of keys) byMonth[k.key] = { pending: 0, paid: 0, overdue: 0, total: 0 }

  let overdueTotal = 0
  let pendingFutureTotal = 0

  for (const ins of installments) {
    const key = `${ins.year}-${String(ins.month).padStart(2, '0')}`
    const isOverdue = ins.status === 'PENDING' && new Date(ins.dueDate) < today
    if (isOverdue) overdueTotal += ins.amount
    if (ins.status === 'PENDING' && !isOverdue) pendingFutureTotal += ins.amount

    if (byMonth[key]) {
      if (ins.status === 'PAID') byMonth[key].paid += ins.amount
      else if (isOverdue) byMonth[key].overdue += ins.amount
      else byMonth[key].pending += ins.amount
      byMonth[key].total += ins.amount
    }
  }

  const series = keys.map(k => ({
    key: k.key,
    label: k.label,
    year: k.year,
    month: k.month,
    ...byMonth[k.key],
  }))

  return NextResponse.json({
    series,
    overdueTotal,
    pendingFutureTotal,
    totalInstallments: installments.length,
  })
}
