/**
 * Análise de Demanda por Cliente.
 *  - Visão geral com FILTROS (pedidos da reunião de 2026-07-24):
 *      ?vendedor=NOME  ?years=2025,2026  ?months=1,2,3
 *    · 1 ano selecionado → visão simples do período; 2 anos → comparativo a/a
 *      nos meses selecionados.
 *  - Margem vendida real: cruza (valor vendido − qtd × custo de reposição do
 *    ABC de Estoque) — por cliente no ranking e por produto no detalhe.
 *  - ?cliente=CODE: detalhe (consulta filtrada no banco — rápido), com margem
 *    por produto e alerta ano-a-ano.
 */
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`

async function stockCostMap(): Promise<Map<string, number>> {
  const stock = await prisma.stockItem.findMany({ select: { code: true, unitCost: true } })
  const map = new Map<string, number>()
  stock.forEach(s => { if (s.unitCost > 0) map.set(s.code, s.unitCost) })
  return map
}
const margemOf = (valor: number, qtd: number, custo: number | undefined) =>
  custo != null && valor > 0 ? (valor - qtd * custo) / valor : null

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const cliente = q.get('cliente')?.trim() || null

  // ─── Detalhe de um cliente (consulta filtrada — rápida) ───
  if (cliente) {
    const [mine, costs] = await Promise.all([
      prisma.demandEntry.findMany({ where: { clienteCode: cliente } }),
      stockCostMap(),
    ])
    if (!mine.length) return NextResponse.json({ hasData: true, cliente, notFound: true, months: [] })
    const months = Array.from(new Set(mine.map(r => ym(r.year, r.month)))).sort()
    const empty = () => { const o: Record<string, number> = {}; months.forEach(m => o[m] = 0); return o }
    const years = Array.from(new Set(mine.map(r => r.year))).sort()
    const curYear = years[years.length - 1], prevYear = years.length > 1 ? years[years.length - 2] : null
    const nome = mine[0].cliente, vendedor = mine[0].vendedor

    const prodMap = new Map<string, { code: string | null; nome: string; total: number; qtd: number; byMonth: Record<string, number>; tCur: number; tPrev: number }>()
    const monthly = empty()
    mine.forEach(r => {
      const k = r.produtoCode ?? r.produto
      if (!prodMap.has(k)) prodMap.set(k, { code: r.produtoCode, nome: r.produto, total: 0, qtd: 0, byMonth: empty(), tCur: 0, tPrev: 0 })
      const p = prodMap.get(k)!
      p.total += r.valor; p.qtd += r.qtd; p.byMonth[ym(r.year, r.month)] += r.valor
      if (r.year === curYear) p.tCur += r.valor
      if (prevYear && r.year === prevYear) p.tPrev += r.valor
      monthly[ym(r.year, r.month)] += r.valor
    })
    // margem real por produto (custo do ABC de Estoque)
    const produtos = Array.from(prodMap.values()).map(p => ({
      ...p, margem: margemOf(p.total, p.qtd, p.code ? costs.get(p.code) : undefined),
    })).sort((a, b) => b.total - a.total)
    let valCC = 0, cusCC = 0
    produtos.forEach(p => { if (p.margem != null && p.code) { valCC += p.total; cusCC += p.qtd * (costs.get(p.code) ?? 0) } })
    const margemMedia = valCC > 0 ? (valCC - cusCC) / valCC : null

    const recentKeys = months.slice(Math.max(0, months.length - 2))
    const dropped = produtos.filter(p => p.total > 0 && recentKeys.every(m => p.byMonth[m] === 0))
      .map(p => ({ nome: p.nome, code: p.code, total: p.total, ultimoMes: months.filter(m => p.byMonth[m] > 0).pop() ?? null }))
      .sort((a, b) => b.total - a.total)
    const droppedYoY = prevYear ? produtos.filter(p => p.tPrev > 0 && p.tCur === 0)
      .map(p => ({ nome: p.nome, code: p.code, totalPrev: p.tPrev }))
      .sort((a, b) => b.totalPrev - a.totalPrev) : []

    return NextResponse.json({
      hasData: true, cliente, nome, vendedor, months, monthly, produtos, dropped, droppedYoY,
      curYear, prevYear, margemMedia,
      total: Object.values(monthly).reduce((s, v) => s + v, 0),
    })
  }

  // ─── Visão geral (com filtros) ───
  const [rows, costs] = await Promise.all([prisma.demandEntry.findMany(), stockCostMap()])
  if (!rows.length) return NextResponse.json({ hasData: false })

  const vendedores = Array.from(new Set(rows.map(r => r.vendedor).filter((v): v is string => !!v))).sort()
  const allYears = Array.from(new Set(rows.map(r => r.year))).sort()

  const fVend = q.get('vendedor')?.trim() || null
  const fYears = (q.get('years') ?? '').split(',').map(s => parseInt(s, 10)).filter(n => allYears.includes(n))
  const fMonths = (q.get('months') ?? '').split(',').map(s => parseInt(s, 10)).filter(n => n >= 1 && n <= 12)
  const selYears = fYears.length ? Array.from(new Set(fYears)).sort() : allYears
  const monthsFiltered = fMonths.length > 0

  const win = rows.filter(r =>
    selYears.includes(r.year) &&
    (!monthsFiltered || fMonths.includes(r.month)) &&
    (!fVend || r.vendedor === fVend))

  const months = Array.from(new Set(win.map(r => ym(r.year, r.month)))).sort()
  const empty = () => { const o: Record<string, number> = {}; months.forEach(m => o[m] = 0); return o }
  const hasYoY = selYears.length > 1
  const curYear = selYears[selYears.length - 1]
  const prevYear = hasYoY ? selYears[selYears.length - 2] : null

  // janela comparável: meses explícitos do filtro; senão Jan..(último mês CHEIO do ano corrente)
  let cmpMonths: number[]
  if (monthsFiltered) cmpMonths = fMonths
  else {
    const curMonthsNums = Array.from(new Set(win.filter(r => r.year === curYear).map(r => r.month)))
    const lastCur = curMonthsNums.length ? Math.max.apply(null, curMonthsNums) : 12
    const upTo = Math.max(1, lastCur - 1)
    cmpMonths = Array.from({ length: upTo }, (_, i) => i + 1)
  }

  interface Cli { code: string; nome: string; vendedor: string | null; total: number; qtd: number; byMonth: Record<string, number>; prods: Set<string>; cmpCur: number; cmpPrev: number; tCur: number; tPrev: number; valCC: number; cusCC: number }
  const cmap = new Map<string, Cli>()
  const monthlyTotal = empty()
  win.forEach(r => {
    if (!cmap.has(r.clienteCode)) cmap.set(r.clienteCode, { code: r.clienteCode, nome: r.cliente, vendedor: r.vendedor, total: 0, qtd: 0, byMonth: empty(), prods: new Set(), cmpCur: 0, cmpPrev: 0, tCur: 0, tPrev: 0, valCC: 0, cusCC: 0 })
    const c = cmap.get(r.clienteCode)!
    c.total += r.valor; c.qtd += r.qtd; c.byMonth[ym(r.year, r.month)] += r.valor; c.prods.add(r.produtoCode ?? r.produto)
    monthlyTotal[ym(r.year, r.month)] += r.valor
    if (r.year === curYear) { c.tCur += r.valor; if (cmpMonths.includes(r.month)) c.cmpCur += r.valor }
    if (prevYear && r.year === prevYear) { c.tPrev += r.valor; if (cmpMonths.includes(r.month)) c.cmpPrev += r.valor }
    // margem vendida real (itens com custo conhecido)
    const custo = r.produtoCode ? costs.get(r.produtoCode) : undefined
    if (custo != null && r.valor > 0) { c.valCC += r.valor; c.cusCC += r.qtd * custo }
  })

  const totalGeral = Array.from(cmap.values()).reduce((s, c) => s + c.total, 0)
  const sorted = Array.from(cmap.values()).sort((a, b) => b.total - a.total)
  let acc = 0
  const clientes = sorted.map(c => {
    acc += c.total
    const share = totalGeral ? c.total / totalGeral : 0
    const cum = totalGeral ? acc / totalGeral : 0
    const abc = cum <= 0.8 ? 'A' : cum <= 0.95 ? 'B' : 'C'
    const mesesAtivos = months.filter(m => c.byMonth[m] > 0)
    const recentKeys = months.slice(Math.max(0, months.length - 2))
    const baseKeys = months.slice(Math.max(0, months.length - 4), Math.max(0, months.length - 2))
    const recentSum = recentKeys.reduce((s, m) => s + c.byMonth[m], 0)
    const baseSum = baseKeys.reduce((s, m) => s + c.byMonth[m], 0)
    const first = mesesAtivos[0] ?? null
    let status = 'Estável'
    if (first && months.indexOf(first) >= months.length - 2) status = 'Novo'
    else if (recentSum === 0) status = 'Sumiu'
    else if (baseSum > 0 && recentSum < baseSum * 0.5) status = 'Em queda'
    else if (recentSum > baseSum * 1.5) status = 'Crescendo'
    const yoy = hasYoY && c.cmpPrev > 0 ? (c.cmpCur - c.cmpPrev) / c.cmpPrev : null
    const perdidoYoY = hasYoY && c.tPrev > 0 && c.tCur === 0
    const margem = c.valCC > 0 ? (c.valCC - c.cusCC) / c.valCC : null
    return { code: c.code, nome: c.nome, vendedor: c.vendedor, total: c.total, qtd: c.qtd, nProd: c.prods.size, abc, share, status, byMonth: c.byMonth, tCur: c.tCur, tPrev: c.tPrev, yoy, perdidoYoY, margem }
  })

  const dist = { A: 0, B: 0, C: 0 } as Record<string, number>
  clientes.forEach(c => dist[c.abc]++)
  const statusDist: Record<string, number> = {}
  clientes.forEach(c => statusDist[c.status] = (statusDist[c.status] ?? 0) + 1)

  const sumCmpCur = sorted.reduce((s, c) => s + c.cmpCur, 0)
  const sumCmpPrev = sorted.reduce((s, c) => s + c.cmpPrev, 0)
  const sumTCur = sorted.reduce((s, c) => s + c.tCur, 0)
  const sumTPrev = sorted.reduce((s, c) => s + c.tPrev, 0)
  const perdidosYoY = clientes.filter(c => c.perdidoYoY).length
  const cmpUpTo = cmpMonths.length ? Math.max.apply(null, cmpMonths) : 12

  return NextResponse.json({
    hasData: true, months,
    curYear, prevYear, cmpUpTo, hasYoY,
    filtros: { vendedores, anos: allYears, vendedor: fVend, years: selYears, months: fMonths },
    kpis: {
      totalGeral, nClientes: clientes.length,
      nProdutos: new Set(win.map(r => r.produtoCode ?? r.produto)).size,
      ticketMedio: clientes.length ? totalGeral / clientes.length : 0,
      totalCur: sumTCur, totalPrev: sumTPrev,
      yoyGeral: hasYoY && sumCmpPrev > 0 ? (sumCmpCur - sumCmpPrev) / sumCmpPrev : null,
      perdidosYoY,
    },
    monthlyTotal, clientes, distAbc: dist, statusDist,
  })
}
