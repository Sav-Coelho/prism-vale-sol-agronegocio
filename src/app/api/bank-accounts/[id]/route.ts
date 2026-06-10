import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

const VALID_TYPES = ['CHECKING', 'CREDIT_CARD', 'SAVINGS']

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const id = parseInt(params.id)
  const { name, initialBalance, type } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Nome obrigatório' }, { status: 400 })
  const data: { name: string; initialBalance: number; type?: string } = {
    name: name.trim(),
    initialBalance: parseFloat(initialBalance) || 0,
  }
  if (type && VALID_TYPES.includes(type)) data.type = type
  const account = await prisma.bankAccount.update({ where: { id }, data })
  return NextResponse.json(account)
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const id = parseInt(params.id)
  const hasTx = await prisma.transaction.findFirst({ where: { bankAccountId: id } })
  if (hasTx) return NextResponse.json({ error: 'Conta possui lançamentos vinculados' }, { status: 409 })
  await prisma.balanceSnapshot.deleteMany({ where: { bankAccountId: id } })
  await prisma.bankAccount.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
