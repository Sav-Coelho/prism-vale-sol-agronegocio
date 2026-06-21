// Rota administrativa temporária — apaga receivables/payables sem filial
// (registros legados do XLSX consolidado antigo). Remover após uso.
import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST() {
  const recDel = await prisma.receivable.deleteMany({ where: { filial: null } })
  const payDel = await prisma.payable.deleteMany({ where: { filial: null } })
  return NextResponse.json({
    receivablesDeleted: recDel.count,
    payablesDeleted: payDel.count,
  })
}
