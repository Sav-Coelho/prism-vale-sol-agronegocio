import { prisma } from '@/lib/prisma'
import { scoreClient, classifySale, type SaleForCredit } from '@/lib/credit'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/credit
// Returns one row per client with the bayesian score and aging buckets.
export async function GET() {
  const clients = await prisma.client.findMany({
    include: { sales: true },
    orderBy: { name: 'asc' },
  })

  const now = new Date()

  const rows = clients.map(c => {
    const sales = c.sales as SaleForCredit[]
    const score = scoreClient(sales, now)

    // Aging buckets on open balance
    let bucket0_30 = 0, bucket31_60 = 0, bucket61_90 = 0, bucket90plus = 0, openBalance = 0
    for (const s of sales) {
      const cls = classifySale(s, now)
      const isOpen = cls === 'PENDING' || (s.paymentStatus === 'OVERDUE' && !s.paidDate)
      if (!isOpen) continue
      openBalance += s.amount
      const ref = s.dueDate ? new Date(s.dueDate) : new Date(s.date)
      const daysLate = Math.max(0, (now.getTime() - ref.getTime()) / (1000 * 60 * 60 * 24))
      if      (daysLate <= 30)  bucket0_30   += s.amount
      else if (daysLate <= 60)  bucket31_60  += s.amount
      else if (daysLate <= 90)  bucket61_90  += s.amount
      else                       bucket90plus += s.amount
    }

    return {
      id: c.id,
      name: c.name,
      cpf: c.cpf,
      active: c.active,
      ...score,
      salesCount: sales.length,
      openBalance,
      aging: { bucket0_30, bucket31_60, bucket61_90, bucket90plus },
    }
  })

  return NextResponse.json(rows)
}
