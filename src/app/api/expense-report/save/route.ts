import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

// O frontend manda as expenses já decididas, cada uma com o accountId/unitId/
// bankAccountId que o usuário confirmou (ou null se ainda não classificou).
// Esta rota cria as entidades faltantes que vierem em `newEntities` e em
// seguida insere as transações em createMany com skipDuplicates pelo fitid.

interface IncomingExpense {
  fitid: string
  date: string
  amount: number
  description: string
  memo?: string | null
  accountId: number | null
  unitId: number | null
  bankAccountId: number | null
}

interface NewUnit { name: string }
interface NewAccount {
  code?: string
  name: string
  type: string
  dreGroup: string
}
interface NewBankAccount { name: string; unitName: string | null; type?: string }

const DRE_TYPE_MAP: Record<string, string> = {
  'Receita Operacional':       'RECEITA',
  'Receita Não Operacional':   'RECEITA',
  'Deduções sobre a Venda':    'DEDUCAO',
  'Custo do Produto/Serviço':  'CUSTO',
  'Despesa Variável':          'CUSTO',
  'Despesas Administrativas':  'DESPESA',
  'Despesas Financeiras':      'DESPESA',
  'Despesas com Pessoal':      'DESPESA',
  'Despesas com Marketing':    'DESPESA',
  'Investimentos':             'DESPESA',
  'Despesas Não Operacionais': 'DESPESA',
  'Impostos':                  'IMPOSTO',
  'Transferência entre Contas':'NEUTRO',
}

async function nextAccountCode(dreGroup: string): Promise<string> {
  // Use the same prefix scheme as the rest of the chart
  const PREFIX: Record<string, string> = {
    'Receita Operacional':       '3.1',
    'Deduções sobre a Venda':    '3.2',
    'Custo do Produto/Serviço':  '4.1',
    'Despesa Variável':          '4.2',
    'Despesas Administrativas':  '5.1',
    'Despesas Financeiras':      '5.2',
    'Despesas com Pessoal':      '5.3',
    'Despesas com Marketing':    '5.4',
    'Investimentos':             '6.1',
    'Receita Não Operacional':   '7.1',
    'Despesas Não Operacionais': '7.2',
    'Impostos':                  '8.1',
    'Transferência entre Contas':'9.9',
  }
  const prefix = PREFIX[dreGroup] || '5.1'
  const existing = await prisma.account.findMany({
    where: { code: { startsWith: prefix + '.' } },
    select: { code: true },
  })
  const nums = existing.map(a => parseInt(a.code.split('.').pop() || '0') || 0)
  const next = nums.length ? Math.max(...nums) + 1 : 1
  return `${prefix}.${String(next).padStart(2, '0')}`
}

export async function POST(req: Request) {
  const body = await req.json() as {
    expenses: IncomingExpense[]
    newUnits?: NewUnit[]
    newAccounts?: NewAccount[]
    newBankAccounts?: NewBankAccount[]
  }

  // ── 1. Criar Units faltantes
  const createdUnits: Record<string, number> = {}
  for (const u of (body.newUnits || [])) {
    try {
      const created = await prisma.unit.create({ data: { name: u.name } })
      createdUnits[u.name] = created.id
    } catch {
      const existing = await prisma.unit.findUnique({ where: { name: u.name } })
      if (existing) createdUnits[u.name] = existing.id
    }
  }

  // ── 2. Criar Accounts faltantes
  const createdAccounts: Record<string, number> = {}
  for (const a of (body.newAccounts || [])) {
    const type = a.type || DRE_TYPE_MAP[a.dreGroup] || 'DESPESA'
    const code = a.code || await nextAccountCode(a.dreGroup)
    try {
      const created = await prisma.account.create({
        data: { code, name: a.name, type, dreGroup: a.dreGroup },
      })
      createdAccounts[a.name] = created.id
    } catch {
      const existing = await prisma.account.findFirst({ where: { name: a.name } })
      if (existing) createdAccounts[a.name] = existing.id
    }
  }

  // ── 3. Criar BankAccounts faltantes (precisa de uma Unit)
  const createdBankAccounts: Record<string, number> = {}
  for (const b of (body.newBankAccounts || [])) {
    let unitId: number | null = null
    if (b.unitName) {
      unitId = createdUnits[b.unitName] ?? null
      if (!unitId) {
        const u = await prisma.unit.findUnique({ where: { name: b.unitName } })
        unitId = u?.id ?? null
      }
    }
    if (!unitId) {
      // Sem unit referenciada, pega a primeira disponível
      const anyUnit = await prisma.unit.findFirst()
      unitId = anyUnit?.id ?? null
    }
    if (!unitId) continue   // sistema vazio sem nenhuma unit; pula
    try {
      const created = await prisma.bankAccount.create({
        data: { name: b.name, unitId, type: b.type || 'CHECKING' },
      })
      createdBankAccounts[b.name] = created.id
    } catch {
      const existing = await prisma.bankAccount.findFirst({ where: { name: b.name } })
      if (existing) createdBankAccounts[b.name] = existing.id
    }
  }

  // ── 4. Salvar transações (skipDuplicates pelo fitid unique)
  const result = await prisma.transaction.createMany({
    data: body.expenses.map(e => {
      const d = new Date(e.date)
      return {
        date: d,
        description: e.description,
        amount: e.amount,
        memo: e.memo ?? null,
        fitid: e.fitid,
        accountId: e.accountId,
        unitId: e.unitId,
        bankAccountId: e.bankAccountId,
        month: d.getMonth() + 1,
        year: d.getFullYear(),
      }
    }),
    skipDuplicates: true,
  })

  return NextResponse.json({
    imported: result.count,
    skipped: body.expenses.length - result.count,
    createdUnits: Object.keys(createdUnits).length,
    createdAccounts: Object.keys(createdAccounts).length,
    createdBankAccounts: Object.keys(createdBankAccounts).length,
  })
}
