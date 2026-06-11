import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const id = parseInt(params.id)
  const { name, monthlyBudget, active } = await req.json()
  const data: { name?: string; monthlyBudget?: number; active?: boolean } = {}
  if (name?.trim()) data.name = name.trim()
  if (monthlyBudget !== undefined) data.monthlyBudget = parseFloat(monthlyBudget) || 0
  if (active !== undefined) data.active = !!active
  const buyer = await prisma.buyer.update({ where: { id }, data })
  return NextResponse.json(buyer)
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const id = parseInt(params.id)
  const hasPurchases = await prisma.purchaseOrder.findFirst({ where: { buyerId: id } })
  if (hasPurchases) {
    return NextResponse.json({ error: 'Comprador possui compras vinculadas' }, { status: 409 })
  }
  await prisma.buyer.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
