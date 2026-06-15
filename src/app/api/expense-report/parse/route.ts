import { prisma } from '@/lib/prisma'
import { parseExpenseReport, normalize, type ParsedExpense } from '@/lib/expense-report-parser'
import { NextResponse } from 'next/server'

type MatchInfo = {
  unit:         { id: number; name: string } | null
  account:      { id: number; code: string; name: string; dreGroup: string } | null
  bankAccount:  { id: number; name: string; unitId: number } | null
  confidence:   number    // 0..100 — soma das partes que bateram (3 partes: unit, account, bank)
  needsNewUnit:        boolean
  needsNewAccount:     boolean
  needsNewBankAccount: boolean
}

export interface PreviewExpense extends ParsedExpense, MatchInfo {
  alreadyImported: boolean
}

export async function POST(req: Request) {
  const fd = await req.formData()
  const file = fd.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Arquivo não enviado' }, { status: 400 })

  const buf = await file.arrayBuffer()
  let summary
  try {
    summary = parseExpenseReport(buf)
  } catch (e) {
    return NextResponse.json({ error: 'Falha ao ler XLSX: ' + (e instanceof Error ? e.message : String(e)) }, { status: 400 })
  }

  // Carrega catálogos pra fazer matching
  const [units, accounts, bankAccounts, existingFitids] = await Promise.all([
    prisma.unit.findMany(),
    prisma.account.findMany(),
    prisma.bankAccount.findMany(),
    prisma.transaction.findMany({
      where: { fitid: { in: summary.expenses.map(e => e.fitid) } },
      select: { fitid: true },
    }),
  ])

  const importedSet = new Set(existingFitids.map(t => t.fitid))

  // Pré-normaliza pra match
  const unitsNorm = units.map(u => ({ ...u, norm: normalize(u.name) }))
  const accountsNorm = accounts.map(a => ({ ...a, norm: normalize(a.name) }))
  const bankAccountsNorm = bankAccounts.map(b => ({ ...b, norm: normalize(b.name) }))

  const matchUnit = (inferred: string | null) => {
    if (!inferred) return null
    const n = normalize(inferred)
    return unitsNorm.find(u => u.norm === n || u.norm.includes(n) || n.includes(u.norm)) ?? null
  }
  const matchAccount = (inferred: string | null) => {
    if (!inferred) return null
    const n = normalize(inferred)
    // Match exato após normalize
    const exact = accountsNorm.find(a => a.norm === n)
    if (exact) return exact
    // Fallback: account name contém OU é contida em — útil pra "Saúde Ocupacional Via Med" vs "Saúde Ocupacional (Via Med)"
    return accountsNorm.find(a => a.norm.includes(n) || n.includes(a.norm)) ?? null
  }
  const matchBank = (inferred: string | null) => {
    if (!inferred) return null
    const n = normalize(inferred)
    // Match pelo nome inteiro ou parcial
    return bankAccountsNorm.find(b => b.norm === n || b.norm.includes(n) || n.includes(b.norm)) ?? null
  }

  const preview: PreviewExpense[] = summary.expenses.map(e => {
    const unitMatch = matchUnit(e.inferredUnit)
    const accountMatch = matchAccount(e.inferredAccountName)
    const bankMatch = matchBank(e.inferredBankAccount)

    let confidence = 0
    if (unitMatch    || !e.inferredUnit)        confidence += 33
    if (accountMatch || !e.inferredAccountName) confidence += 34
    if (bankMatch    || !e.inferredBankAccount) confidence += 33

    return {
      ...e,
      unit:        unitMatch ? { id: unitMatch.id, name: unitMatch.name } : null,
      account:     accountMatch ? { id: accountMatch.id, code: accountMatch.code, name: accountMatch.name, dreGroup: accountMatch.dreGroup } : null,
      bankAccount: bankMatch ? { id: bankMatch.id, name: bankMatch.name, unitId: bankMatch.unitId } : null,
      confidence,
      needsNewUnit:        !!e.inferredUnit && !unitMatch,
      needsNewAccount:     !!e.inferredAccountName && !accountMatch,
      needsNewBankAccount: !!e.inferredBankAccount && !bankMatch,
      alreadyImported:     importedSet.has(e.fitid),
    }
  })

  // Resumo de entidades a criar
  const uniqUnitsToCreate = Array.from(new Set(
    preview.filter(p => p.needsNewUnit).map(p => p.inferredUnit!),
  ))
  const uniqAccountsToCreate = Array.from(new Set(
    preview.filter(p => p.needsNewAccount).map(p => `${p.inferredAccountName}|${p.inferredDreGroup}`),
  ))
  const uniqBanksToCreate = Array.from(new Set(
    preview.filter(p => p.needsNewBankAccount).map(p => p.inferredBankAccount!),
  ))

  return NextResponse.json({
    summary: {
      totalRows: summary.totalRows,
      totalLeaves: summary.totalLeaves,
      totalSheets: summary.totalSheets,
      totalValue: summary.totalValue,
      alreadyImported: preview.filter(p => p.alreadyImported).length,
      avgConfidence: preview.length > 0
        ? Math.round(preview.reduce((s, p) => s + p.confidence, 0) / preview.length)
        : 0,
      uniqUnitsToCreate,
      uniqAccountsToCreate: uniqAccountsToCreate.map(s => {
        const [name, dreGroup] = s.split('|')
        return { name, dreGroup }
      }),
      uniqBanksToCreate,
    },
    expenses: preview,
  })
}
