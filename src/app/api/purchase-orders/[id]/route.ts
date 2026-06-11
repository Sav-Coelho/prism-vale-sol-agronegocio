import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const id = parseInt(params.id)
  const order = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { supplier: true, unit: true, buyer: true, items: true, installments: true },
  })
  if (!order) return NextResponse.json({ error: 'Pedido não encontrado' }, { status: 404 })
  return NextResponse.json(order)
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const id = parseInt(params.id)
  const body = await req.json()

  // Mark / unmark a single installment as paid
  if (body.action === 'pay-installment') {
    const { installmentId, paid } = body
    const installment = await prisma.purchaseInstallment.update({
      where: { id: parseInt(installmentId) },
      data: paid
        ? { status: 'PAID', paidDate: new Date() }
        : { status: 'PENDING', paidDate: null },
    })
    return NextResponse.json(installment)
  }

  // Receive action: update received quantities per item
  if (body.action === 'receive') {
    const { receivedItems } = body // [{ itemId, receivedQty }]
    await Promise.all(
      receivedItems.map((ri: { itemId: number; receivedQty: number }) =>
        prisma.purchaseItem.update({
          where: { id: ri.itemId },
          data: { receivedQty: parseFloat(String(ri.receivedQty)) },
        })
      )
    )
    // Check if fully received
    const order = await prisma.purchaseOrder.findUnique({ where: { id }, include: { items: true } })
    const allReceived = order?.items.every(i => i.receivedQty >= i.quantity)
    const anyReceived = order?.items.some(i => i.receivedQty > 0)
    const newStatus = allReceived ? 'RECEIVED' : anyReceived ? 'PARTIAL' : order?.status
    const updated = await prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: newStatus,
        receivedDate: allReceived ? new Date() : order?.receivedDate,
      },
      include: { supplier: true, unit: true, items: true },
    })
    return NextResponse.json(updated)
  }

  // Status change
  if (body.status) {
    const updated = await prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: body.status,
        receivedDate: body.status === 'RECEIVED' ? new Date() : undefined,
      },
      include: { supplier: true, unit: true, items: true },
    })
    return NextResponse.json(updated)
  }

  return NextResponse.json({ error: 'Ação inválida' }, { status: 400 })
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const id = parseInt(params.id)
  await prisma.purchaseItem.deleteMany({ where: { orderId: id } })
  // installments cascade via schema
  await prisma.purchaseOrder.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
