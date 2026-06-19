import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const id = parseInt(params.id)
  const { name } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Nome obrigatório' }, { status: 400 })
  try {
    const unit = await prisma.unit.update({
      where: { id },
      data: { name: name.trim().toUpperCase() },
    })
    return NextResponse.json(unit)
  } catch {
    return NextResponse.json({ error: 'Nome já existe ou unidade não encontrada' }, { status: 409 })
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const id = parseInt(params.id)
  const hasSales = await prisma.sale.findFirst({ where: { unitId: id } })
  if (hasSales) return NextResponse.json({ error: 'Unidade possui vendas vinculadas' }, { status: 409 })
  const hasClients = await prisma.client.findFirst({ where: { unitId: id } })
  if (hasClients) return NextResponse.json({ error: 'Unidade possui clientes vinculados' }, { status: 409 })
  await prisma.unit.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
