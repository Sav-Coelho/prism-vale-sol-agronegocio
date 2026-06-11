import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

const VALID_STATUS = ['PENDING', 'PAID', 'OVERDUE', 'DEFAULTED']

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const id = parseInt(params.id)
  const body = await req.json()
  const data: Record<string, unknown> = {}

  if (body.description?.trim()) data.description = body.description.trim()
  if (body.amount !== undefined) data.amount = parseFloat(body.amount)
  if (body.dueDate  !== undefined) data.dueDate  = body.dueDate  ? new Date(body.dueDate)  : null
  if (body.paidDate !== undefined) data.paidDate = body.paidDate ? new Date(body.paidDate) : null
  if (body.paymentStatus && VALID_STATUS.includes(body.paymentStatus)) {
    data.paymentStatus = body.paymentStatus
    // Auto-stamp paidDate when marking PAID without one
    if (body.paymentStatus === 'PAID' && !body.paidDate && data.paidDate === undefined) {
      data.paidDate = new Date()
    }
  }

  const sale = await prisma.sale.update({ where: { id }, data, include: { client: true } })
  return NextResponse.json(sale)
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const id = parseInt(params.id)
  await prisma.sale.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
