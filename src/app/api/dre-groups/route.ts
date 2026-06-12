import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

const VALID_TYPES    = ['RECEITA', 'DEDUCAO', 'CUSTO', 'DESPESA', 'IMPOSTO', 'NEUTRO'] as const
const VALID_SECTIONS = [
  'RECEITA_OP', 'DEDUCAO', 'CUSTO_VAR', 'DESPESA_FIXA',
  'INVESTIMENTO', 'RECEITA_NOP', 'DESPESA_NOP', 'IMPOSTO_LUCRO', 'NEUTRO',
] as const

// Section → derived type (UI usually doesn't need to set type explicitly)
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

export async function GET() {
  const groups = await prisma.dreGroup.findMany({ orderBy: { sortOrder: 'asc' } })
  return NextResponse.json(groups)
}

export async function POST(req: Request) {
  const { name, section, sortOrder } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Nome obrigatório' }, { status: 400 })
  if (!VALID_SECTIONS.includes(section)) {
    return NextResponse.json({ error: 'Seção inválida' }, { status: 400 })
  }
  try {
    const lastOrder = await prisma.dreGroup.findFirst({ orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } })
    const next = sortOrder ?? ((lastOrder?.sortOrder ?? 0) + 1)
    const group = await prisma.dreGroup.create({
      data: {
        name: name.trim(),
        type: TYPE_BY_SECTION[section],
        section,
        sortOrder: next,
        protected: false,
      },
    })
    return NextResponse.json(group, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Já existe categoria com esse nome' }, { status: 409 })
  }
}
