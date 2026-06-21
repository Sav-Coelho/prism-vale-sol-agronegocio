import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Devolve em UMA chamada tudo que os 6 gráficos precisam, calculado no servidor:
//
//   1. monthlyFlow:   { month, year, label, receber, pagar, gap } — 12 meses (passado+futuro)
//   2. cumulativeBalance: { date, label, balance }
//   3. topReceivables: top 10 clientes em aberto (somatório netAmount PENDING)
//   4. topPayables:    top 10 fornecedores em aberto
//   5a. pmpScatter:   pontos { dueDate, daysToPay, amount } pra dispersão dos prazos a pagar
//   5b. pmrScatter:   idem pra receber
//   6. pmpPmrSeries:  { month, year, label, pmp, pmr, gap } — PMP/PMR ponderados pelo valor

const MONTH_LABELS = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
                      'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

function ymKey(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
function ymLabel(d: Date) {
  return `${MONTH_LABELS[d.getUTCMonth() + 1]}/${String(d.getUTCFullYear()).slice(-2)}`
}
function daysBetween(later: Date, earlier: Date) {
  return Math.round((later.getTime() - earlier.getTime()) / (1000 * 60 * 60 * 24))
}

export async function GET(req: NextRequest) {
  // Filtra apenas títulos futuros (dueDate > hoje) — vencidos não entram em análise
  const cutoff = new Date()
  cutoff.setHours(0, 0, 0, 0)

  const { searchParams } = new URL(req.url)
  const unit = searchParams.get('unit')?.trim()
  const unitFilter = unit ? { filial: unit } : {}

  // Lista de filiais distintas — pra alimentar o dropdown do dashboard
  const [recFiliais, payFiliais, receivables, payables] = await Promise.all([
    prisma.receivable.findMany({
      where: { filial: { not: null } },
      distinct: ['filial'],
      select: { filial: true },
    }),
    prisma.payable.findMany({
      where: { filial: { not: null } },
      distinct: ['filial'],
      select: { filial: true },
    }),
    prisma.receivable.findMany({
      where: { dueDate: { gt: cutoff }, ...unitFilter },
      select: {
        dueDate: true, issueDate: true, amount: true, netAmount: true,
        customerName: true, status: true,
      },
    }),
    prisma.payable.findMany({
      where: { dueDate: { gt: cutoff }, ...unitFilter },
      select: {
        dueDate: true, entryDate: true, amount: true, netAmount: true,
        supplierName: true, status: true,
      },
    }),
  ])
  const filiaisSet = new Set<string>()
  ;[...recFiliais, ...payFiliais].forEach(r => { if (r.filial) filiaisSet.add(r.filial) })
  const filiais = Array.from(filiaisSet).sort()

  // ── 1. Monthly flow (próximos 12 meses) ─────────────────
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const startWindow = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 6, 1))
  const monthBuckets: { key: string; label: string; year: number; month: number }[] = []
  for (let i = 0; i < 18; i++) {
    const d = new Date(Date.UTC(startWindow.getUTCFullYear(), startWindow.getUTCMonth() + i, 1))
    monthBuckets.push({ key: ymKey(d), label: ymLabel(d), year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 })
  }
  const recvByMonth: Record<string, number> = {}
  const payByMonth:  Record<string, number> = {}
  for (const r of receivables) recvByMonth[ymKey(r.dueDate)] = (recvByMonth[ymKey(r.dueDate)] || 0) + r.netAmount
  for (const p of payables)    payByMonth[ymKey(p.dueDate)]  = (payByMonth[ymKey(p.dueDate)]  || 0) + p.netAmount

  const monthlyFlow = monthBuckets.map(b => {
    const receber = recvByMonth[b.key] || 0
    const pagar   = payByMonth[b.key]  || 0
    return { ...b, receber, pagar, gap: receber - pagar }
  })

  // ── 2. Saldo acumulado diário ──────────────────────────
  // Lista todos eventos (data, valor) e acumula em ordem cronológica
  const events: { date: Date; delta: number }[] = []
  for (const r of receivables) events.push({ date: r.dueDate, delta: +r.netAmount })
  for (const p of payables)    events.push({ date: p.dueDate, delta: -p.netAmount })
  events.sort((a, b) => a.date.getTime() - b.date.getTime())
  const cumulativeBalance: { date: string; label: string; balance: number }[] = []
  let cum = 0
  // Agrupar por dia
  const byDay: Record<string, number> = {}
  for (const ev of events) {
    const k = ev.date.toISOString().slice(0, 10)
    byDay[k] = (byDay[k] || 0) + ev.delta
  }
  Object.keys(byDay).sort().forEach(k => {
    cum += byDay[k]
    const d = new Date(k)
    cumulativeBalance.push({
      date: k,
      label: `${String(d.getUTCDate()).padStart(2, '0')}/${MONTH_LABELS[d.getUTCMonth() + 1]}`,
      balance: cum,
    })
  })

  // ── 3. & 4. Top 10 ─────────────────────────────────────
  const recvByCustomer: Record<string, number> = {}
  for (const r of receivables) {
    if (r.status === 'RECEIVED') continue
    recvByCustomer[r.customerName] = (recvByCustomer[r.customerName] || 0) + r.netAmount
  }
  const topReceivables = Object.entries(recvByCustomer)
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)

  const payBySupplier: Record<string, number> = {}
  for (const p of payables) {
    if (p.status === 'PAID') continue
    payBySupplier[p.supplierName] = (payBySupplier[p.supplierName] || 0) + p.netAmount
  }
  const topPayables = Object.entries(payBySupplier)
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)

  // ── 5. Dispersão dos prazos — AGREGADO por cliente/fornecedor ─────
  // Cada ponto é uma entidade única (cliente ou fornecedor):
  //   x = prazo médio ponderado pelo valor (PMR ou PMP daquela entidade)
  //   y = exposição total (soma do netAmount dos títulos)
  //   count = quantos títulos
  //
  // Permite enxergar quem são os "fornecedores generosos" (X alto = longo prazo) e
  // os clientes mais demorados pra pagar. Y separa por exposição.
  const recvByCustomer2: Record<string, { sumDaysXAmount: number; sumAmount: number; count: number }> = {}
  for (const r of receivables) {
    if (!r.issueDate || !r.customerName) continue
    const days = daysBetween(r.dueDate, r.issueDate)
    if (days < 0 || days > 365) continue
    const key = r.customerName
    const e = recvByCustomer2[key] || (recvByCustomer2[key] = { sumDaysXAmount: 0, sumAmount: 0, count: 0 })
    e.sumDaysXAmount += days * r.netAmount
    e.sumAmount      += r.netAmount
    e.count          += 1
  }
  const pmrScatter = Object.entries(recvByCustomer2)
    .filter(([, v]) => v.sumAmount > 0)
    .map(([name, v]) => ({
      name,
      days:   Math.round(v.sumDaysXAmount / v.sumAmount),
      amount: v.sumAmount,
      count:  v.count,
    }))

  const payBySupplier2: Record<string, { sumDaysXAmount: number; sumAmount: number; count: number }> = {}
  for (const p of payables) {
    if (!p.entryDate || !p.supplierName) continue
    const days = daysBetween(p.dueDate, p.entryDate)
    if (days < 0 || days > 365) continue
    const key = p.supplierName
    const e = payBySupplier2[key] || (payBySupplier2[key] = { sumDaysXAmount: 0, sumAmount: 0, count: 0 })
    e.sumDaysXAmount += days * p.netAmount
    e.sumAmount      += p.netAmount
    e.count          += 1
  }
  const pmpScatter = Object.entries(payBySupplier2)
    .filter(([, v]) => v.sumAmount > 0)
    .map(([name, v]) => ({
      name,
      days:   Math.round(v.sumDaysXAmount / v.sumAmount),
      amount: v.sumAmount,
      count:  v.count,
    }))

  // ── 6. Série temporal PMP/PMR (ponderada pelo valor) ───
  // Agrupa pelo mês de EMISSÃO/ENTRADA (não vencimento) — mede negociação
  // do mês, não o impacto futuro no caixa.
  const recvWeighted: Record<string, { sumDaysXAmount: number; sumAmount: number }> = {}
  const payWeighted:  Record<string, { sumDaysXAmount: number; sumAmount: number }> = {}
  for (const r of receivables) {
    if (!r.issueDate) continue
    const days = daysBetween(r.dueDate, r.issueDate)
    if (days < 0 || days > 365) continue
    const k = ymKey(r.issueDate)   // bucket pelo mês de emissão
    const e = recvWeighted[k] || (recvWeighted[k] = { sumDaysXAmount: 0, sumAmount: 0 })
    e.sumDaysXAmount += days * r.netAmount
    e.sumAmount      += r.netAmount
  }
  for (const p of payables) {
    if (!p.entryDate) continue
    const days = daysBetween(p.dueDate, p.entryDate)
    if (days < 0 || days > 365) continue
    const k = ymKey(p.entryDate)   // bucket pelo mês de entrada da nota
    const e = payWeighted[k] || (payWeighted[k] = { sumDaysXAmount: 0, sumAmount: 0 })
    e.sumDaysXAmount += days * p.netAmount
    e.sumAmount      += p.netAmount
  }
  const pmpPmrSeries = monthBuckets.map(b => {
    const pmr = recvWeighted[b.key]?.sumAmount ? recvWeighted[b.key].sumDaysXAmount / recvWeighted[b.key].sumAmount : 0
    const pmp = payWeighted[b.key]?.sumAmount  ? payWeighted[b.key].sumDaysXAmount  / payWeighted[b.key].sumAmount  : 0
    return { ...b, pmp: Math.round(pmp), pmr: Math.round(pmr), gap: Math.round(pmp - pmr) }
  })

  // ── Resumo geral ───────────────────────────────────────
  const totalReceber = receivables.reduce((s, r) => s + r.netAmount, 0)
  const totalPagar   = payables.reduce((s, p) => s + p.netAmount, 0)
  const totalReceberPending = receivables.filter(r => r.status === 'PENDING').reduce((s, r) => s + r.netAmount, 0)
  const totalPagarPending   = payables.filter(p => p.status === 'PENDING').reduce((s, p) => s + p.netAmount, 0)

  return NextResponse.json({
    filiais,
    selectedUnit: unit ?? null,
    summary: {
      countReceivables: receivables.length,
      countPayables: payables.length,
      totalReceber, totalPagar,
      totalReceberPending, totalPagarPending,
      netPosition: totalReceberPending - totalPagarPending,
    },
    monthlyFlow,
    cumulativeBalance,
    topReceivables,
    topPayables,
    pmrScatter,
    pmpScatter,
    pmpPmrSeries,
  })
}
