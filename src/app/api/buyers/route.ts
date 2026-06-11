import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export async function GET() {
  const buyers = await prisma.buyer.findMany({
    orderBy: { name: 'asc' },
    include: {
      purchases: {
        select: { id: true, totalAmount: true, month: true, year: true, status: true },
      },
    },
  })
  return NextResponse.json(buyers)
}

export async function POST(req: Request) {
  const { name, monthlyBudget } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Nome obrigatório' }, { status: 400 })
  try {
    const buyer = await prisma.buyer.create({
      data: {
        name: name.trim(),
        monthlyBudget: parseFloat(monthlyBudget) || 0,
      },
    })
    return NextResponse.json(buyer, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Comprador já existe' }, { status: 409 })
  }
}
