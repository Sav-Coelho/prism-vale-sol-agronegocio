import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

const VALID_TYPES = ['CHECKING', 'CREDIT_CARD', 'SAVINGS']

export async function POST(req: Request) {
  const { name, unitId, initialBalance, type } = await req.json()
  if (!name?.trim() || !unitId) return NextResponse.json({ error: 'Nome e unidade obrigatórios' }, { status: 400 })
  const accountType = VALID_TYPES.includes(type) ? type : 'CHECKING'
  const account = await prisma.bankAccount.create({
    data: {
      name: name.trim(),
      unitId: parseInt(unitId),
      initialBalance: parseFloat(initialBalance) || 0,
      type: accountType,
    },
  })
  return NextResponse.json(account, { status: 201 })
}
