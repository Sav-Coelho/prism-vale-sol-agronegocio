import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

// Cada expense pode trazer IDs já decididos pela UI (accountId/unitId/bankAccountId)
// E também a "intenção" textual (inferredUnit/Account/Bank) — usada como
// fallback para resolver depois que as entidades novas forem criadas.
interface IncomingExpense {
  fitid: string
  date: string
  amount: number
  description: string
  memo?: string | null
  accountId: number | null
  unitId: number | null
  bankAccountId: number | null
  // intenção (string) — vinculação pós-criação
  inferredUnit?: string | null
  inferredAccountName?: string | null
  inferredBankAccount?: string | null
}

interface NewUnit { name: string }
interface NewAccount {
  code?: string
  name: string
  type?: string
  dreGroup: string
}
interface NewBankAccount { name: string; unitName?: string | null; type?: string }

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
  const unitIdByName: Record<string, number> = {}
  // Pré-carregar existing units para o fallback
  const existingUnits = await prisma.unit.findMany()
  for (const u of existingUnits) unitIdByName[u.name] = u.id

  for (const u of (body.newUnits || [])) {
    if (unitIdByName[u.name]) continue
    try {
      const created = await prisma.unit.create({ data: { name: u.name } })
      unitIdByName[u.name] = created.id
    } catch {
      const existing = await prisma.unit.findUnique({ where: { name: u.name } })
      if (existing) unitIdByName[u.name] = existing.id
    }
  }

  // ── 2. Criar Accounts faltantes
  const accountIdByName: Record<string, number> = {}
  const existingAccounts = await prisma.account.findMany()
  for (const a of existingAccounts) accountIdByName[a.name] = a.id

  for (const a of (body.newAccounts || [])) {
    if (accountIdByName[a.name]) continue
    const type = a.type || DRE_TYPE_MAP[a.dreGroup] || 'DESPESA'
    const code = a.code || await nextAccountCode(a.dreGroup)
    try {
      const created = await prisma.account.create({
        data: { code, name: a.name, type, dreGroup: a.dreGroup },
      })
      accountIdByName[a.name] = created.id
    } catch {
      const existing = await prisma.account.findFirst({ where: { name: a.name } })
      if (existing) accountIdByName[a.name] = existing.id
    }
  }

  // ── 3. Criar BankAccounts faltantes
  const bankIdByName: Record<string, number> = {}
  const existingBanks = await prisma.bankAccount.findMany()
  for (const b of existingBanks) bankIdByName[b.name] = b.id

  for (const b of (body.newBankAccounts || [])) {
    if (bankIdByName[b.name]) continue
    let unitId: number | null = null
    if (b.unitName && unitIdByName[b.unitName]) unitId = unitIdByName[b.unitName]
    if (!unitId) {
      const anyUnit = existingUnits[0] ?? Object.values(unitIdByName)[0]
      unitId = typeof anyUnit === 'number' ? anyUnit : anyUnit?.id ?? null
    }
    if (!unitId) continue
    try {
      const created = await prisma.bankAccount.create({
        data: { name: b.name, unitId, type: b.type || 'CHECKING' },
      })
      bankIdByName[b.name] = created.id
    } catch {
      const existing = await prisma.bankAccount.findFirst({ where: { name: b.name } })
      if (existing) bankIdByName[b.name] = existing.id
    }
  }

  // ── 4. Resolver cada expense — preferir IDs explícitos, fallback pra inferred
  const expensesToInsert = body.expenses.map(e => {
    const d = new Date(e.date)
    const unitId = e.unitId ?? (e.inferredUnit ? unitIdByName[e.inferredUnit] ?? null : null)
    const accountId = e.accountId ?? (e.inferredAccountName ? accountIdByName[e.inferredAccountName] ?? null : null)
    const bankAccountId = e.bankAccountId ?? (e.inferredBankAccount ? bankIdByName[e.inferredBankAccount] ?? null : null)
    return {
      date: d,
      description: e.description,
      amount: e.amount,
      memo: e.memo ?? null,
      fitid: e.fitid,
      accountId,
      unitId,
      bankAccountId,
      month: d.getMonth() + 1,
      year: d.getFullYear(),
    }
  })

  // ── 5. Inserir transações (skipDuplicates pelo fitid unique)
  const result = await prisma.transaction.createMany({
    data: expensesToInsert,
    skipDuplicates: true,
  })

  // ── 6. Contadores de resolução
  const linkedUnit    = expensesToInsert.filter(e => e.unitId !== null).length
  const linkedAccount = expensesToInsert.filter(e => e.accountId !== null).length
  const linkedBank    = expensesToInsert.filter(e => e.bankAccountId !== null).length

  return NextResponse.json({
    imported: result.count,
    skipped: body.expenses.length - result.count,
    createdUnits:        Object.keys(unitIdByName).length - existingUnits.length,
    createdAccounts:     Object.keys(accountIdByName).length - existingAccounts.length,
    createdBankAccounts: Object.keys(bankIdByName).length - existingBanks.length,
    linkedUnit,
    linkedAccount,
    linkedBank,
  })
}
