import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

interface InstallmentInput {
  dueDate: string
  amount: number | string
}

interface ItemInput {
  description: string
  quantity: number | string
  unitPrice: number | string
  notes?: string
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const month = searchParams.get('month')
  const year = searchParams.get('year')
  const buyerId = searchParams.get('buyerId')

  const where: Record<string, unknown> = {}
  if (month) where.month = parseInt(month)
  if (year) where.year = parseInt(year)
  if (buyerId) where.buyerId = parseInt(buyerId)

  const orders = await prisma.purchaseOrder.findMany({
    where,
    include: {
      supplier: true,
      unit: true,
      buyer: true,
      items: true,
      installments: { orderBy: { dueDate: 'asc' } },
    },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(orders)
}

export async function POST(req: Request) {
  const body = await req.json()
  const {
    supplierId, unitId, buyerId,
    expectedDate, notes, description, invoiceNumber,
    totalAmount: explicitTotal,
    items, installments,
  } = body

  if (!supplierId) return NextResponse.json({ error: 'Fornecedor obrigatório' }, { status: 400 })

  // Total: explicit total or computed from items
  let totalAmount = parseFloat(String(explicitTotal)) || 0
  if (!totalAmount && items?.length) {
    totalAmount = (items as ItemInput[]).reduce(
      (s, i) => s + parseFloat(String(i.quantity)) * parseFloat(String(i.unitPrice)),
      0,
    )
  }
  if (totalAmount <= 0) return NextResponse.json({ error: 'Valor total inválido' }, { status: 400 })

  const d = expectedDate ? new Date(expectedDate) : new Date()
  const order = await prisma.purchaseOrder.create({
    data: {
      supplierId: parseInt(supplierId),
      unitId: unitId ? parseInt(unitId) : null,
      buyerId: buyerId ? parseInt(buyerId) : null,
      expectedDate: expectedDate ? new Date(expectedDate) : null,
      totalAmount,
      description: description?.trim() || null,
      invoiceNumber: invoiceNumber?.trim() || null,
      notes: notes?.trim() || null,
      month: d.getMonth() + 1,
      year: d.getFullYear(),
      ...(items?.length ? {
        items: {
          create: (items as ItemInput[]).map(i => ({
            description: i.description.trim(),
            quantity: parseFloat(String(i.quantity)),
            unitPrice: parseFloat(String(i.unitPrice)),
            notes: i.notes?.trim() || null,
          })),
        },
      } : {}),
      ...(installments?.length ? {
        installments: {
          create: (installments as InstallmentInput[]).map(p => {
            const due = new Date(p.dueDate)
            return {
              dueDate: due,
              amount: parseFloat(String(p.amount)),
              month: due.getMonth() + 1,
              year: due.getFullYear(),
            }
          }),
        },
      } : {}),
    },
    include: { supplier: true, unit: true, buyer: true, items: true, installments: true },
  })
  return NextResponse.json(order, { status: 201 })
}
