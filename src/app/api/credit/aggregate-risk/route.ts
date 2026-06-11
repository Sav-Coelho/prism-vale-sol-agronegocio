import { prisma } from '@/lib/prisma'
import { aggregateMonthlyRisk, type SaleForCredit } from '@/lib/credit'
import { NextRequest, NextResponse } from 'next/server'

// GET /api/credit/aggregate-risk?months=12
// Returns time series of exposure-weighted portfolio default risk.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const months = Math.min(Math.max(parseInt(searchParams.get('months') || '12'), 1), 36)

  const clients = await prisma.client.findMany({
    include: { sales: true },
  })

  const data = clients.map(c => ({
    clientId: c.id,
    clientName: c.name,
    sales: c.sales as SaleForCredit[],
  }))

  const series = aggregateMonthlyRisk(data, months)
  return NextResponse.json({ series })
}
