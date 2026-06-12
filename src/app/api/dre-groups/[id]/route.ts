import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

const VALID_SECTIONS = [
  'RECEITA_OP', 'DEDUCAO', 'CUSTO_VAR', 'DESPESA_FIXA',
  'INVESTIMENTO', 'RECEITA_NOP', 'DESPESA_NOP', 'IMPOSTO_LUCRO', 'NEUTRO',
] as const

const TYPE_BY_SECTION: Record<string, string> = {
  RECEITA_OP:    'RECEITA',
  DEDUCAO:       'DEDUCAO',
  CUSTO_VAR:     'CUSTO',
  DESPESA_FIXA:  'DESPESA',
  INVESTIMENTO:  'DESPESA',
  RECEITA_NOP:   'RECEITA',
  DESPESA_NOP:   'DESPESA',
  IMPOSTO_LUCRO: 'IMPOSTO',
  NEUTRO:        'NEUTRO',
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const id = parseInt(params.id)
  const { name, section, sortOrder } = await req.json()

  const current = await prisma.dreGroup.findUnique({ where: { id } })
  if (!current) return NextResponse.json({ error: 'Categoria não encontrada' }, { status: 404 })

  const data: { name?: string; section?: string; type?: string; sortOrder?: number } = {}

  if (name && name.trim() !== current.name) {
    if (current.protected) {
      return NextResponse.json({ error: 'Categoria protegida não pode ser renomeada' }, { status: 409 })
    }
    data.name = name.trim()
  }

  if (section && section !== current.section) {
    if (!VALID_SECTIONS.includes(section)) {
      return NextResponse.json({ error: 'Seção inválida' }, { status: 400 })
    }
    if (current.protected) {
      return NextResponse.json({ error: 'Categoria protegida não pode mudar de seção' }, { status: 409 })
    }
    data.section = section
    data.type = TYPE_BY_SECTION[section]
  }

  if (sortOrder !== undefined && sortOrder !== current.sortOrder) {
    data.sortOrder = parseInt(sortOrder)
  }

  // Apply rename in cascade to Account.dreGroup + propagate new type
  if (data.name) {
    await prisma.$transaction([
      prisma.account.updateMany({
        where: { dreGroup: current.name },
        data: { dreGroup: data.name, ...(data.type ? { type: data.type } : {}) },
      }),
      prisma.dreGroup.update({ where: { id }, data }),
    ])
  } else if (data.type) {
    await prisma.$transaction([
      prisma.account.updateMany({ where: { dreGroup: current.name }, data: { type: data.type } }),
      prisma.dreGroup.update({ where: { id }, data }),
    ])
  } else if (Object.keys(data).length > 0) {
    await prisma.dreGroup.update({ where: { id }, data })
  }

  const updated = await prisma.dreGroup.findUnique({ where: { id } })
  return NextResponse.json(updated)
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const id = parseInt(params.id)
  const current = await prisma.dreGroup.findUnique({ where: { id } })
  if (!current) return NextResponse.json({ error: 'Categoria não encontrada' }, { status: 404 })

  if (current.protected) {
    return NextResponse.json({ error: 'Categoria protegida não pode ser excluída' }, { status: 409 })
  }

  const inUse = await prisma.account.findFirst({ where: { dreGroup: current.name } })
  if (inUse) {
    return NextResponse.json(
      { error: `Categoria possui contas vinculadas. Mova-as antes de excluir.` },
      { status: 409 },
    )
  }

  await prisma.dreGroup.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
