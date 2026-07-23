/**
 * Análise de Demanda por Cliente.
 *  - Sem parâmetro: visão geral (KPIs, ranking de clientes com ABC + status de
 *    tendência, série mensal total).
 *  - ?cliente=CODE: detalhe do cliente (produtos com quebra mensal, tendência,
 *    e produtos que ele "deixou de comprar" no mês mais recente).
 */
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`

export async function GET(req: NextRequest) {
  const cliente = req.nextUrl.searchParams.get('cliente')?.trim() || null
  const rows = await prisma.demandEntry.findMany()
  if (!rows.length) return NextResponse.json({ hasData: false })

  const months = Array.from(new Set(rows.map(r => ym(r.year, r.month)))).sort()
  const empty = () => { const o: Record<string, number> = {}; months.forEach(m => o[m] = 0); return o }

  const years = Array.from(new Set(rows.map(r => r.year))).sort()
  const hasYoY = years.length > 1
  const curYear = years[years.length - 1], prevYear = hasYoY ? years[years.length - 2] : null
  // janela comparável entre anos: meses do ano corrente que já têm dados (ex.: 1..7)
  const curMonthsNums = Array.from(new Set(rows.filter(r => r.year === curYear).map(r => r.month)))
  const lastCurMonth = curMonthsNums.length ? Math.max.apply(null, curMonthsNums) : 12
  // último mês pode estar parcial — compara Jan..(último mês CHEIO); se só há 1 mês, usa ele mesmo
  const cmpUpTo = Math.max(1, lastCurMonth - 1)

  // ─── Detalhe de um cliente ───
  if (cliente) {
    const mine = rows.filter(r => r.clienteCode === cliente)
    if (!mine.length) return NextResponse.json({ hasData: true, cliente, notFound: true, months })
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
    const produtos = Array.from(prodMap.values()).sort((a, b) => b.total - a.total)
    // deixou de comprar: teve venda antes, mas 0 nos últimos 2 meses (neutraliza mês parcial)
    const recentKeys = months.slice(Math.max(0, months.length - 2))
    const dropped = produtos.filter(p => p.total > 0 && recentKeys.every(m => p.byMonth[m] === 0))
      .map(p => ({ nome: p.nome, code: p.code, total: p.total, ultimoMes: months.filter(m => p.byMonth[m] > 0).pop() ?? null }))
      .sort((a, b) => b.total - a.total)
    // comprava no ano anterior, ZERO no ano corrente (o pedido do Felipe)
    const droppedYoY = hasYoY ? produtos.filter(p => p.tPrev > 0 && p.tCur === 0)
      .map(p => ({ nome: p.nome, code: p.code, totalPrev: p.tPrev }))
      .sort((a, b) => b.totalPrev - a.totalPrev) : []
    return NextResponse.json({
      hasData: true, cliente, nome, vendedor, months, monthly, produtos, dropped, droppedYoY,
      curYear, prevYear,
      total: monthly ? Object.values(monthly).reduce((s, v) => s + v, 0) : 0,
    })
  }

  // ─── Visão geral ───
  interface Cli { code: string; nome: string; vendedor: string | null; total: number; qtd: number; byMonth: Record<string, number>; prods: Set<string>; cmpCur: number; cmpPrev: number; tCur: number; tPrev: number }
  const cmap = new Map<string, Cli>()
  const monthlyTotal = empty()
  rows.forEach(r => {
    if (!cmap.has(r.clienteCode)) cmap.set(r.clienteCode, { code: r.clienteCode, nome: r.cliente, vendedor: r.vendedor, total: 0, qtd: 0, byMonth: empty(), prods: new Set(), cmpCur: 0, cmpPrev: 0, tCur: 0, tPrev: 0 })
    const c = cmap.get(r.clienteCode)!
    c.total += r.valor; c.qtd += r.qtd; c.byMonth[ym(r.year, r.month)] += r.valor; c.prods.add(r.produtoCode ?? r.produto)
    monthlyTotal[ym(r.year, r.month)] += r.valor
    if (r.year === curYear) { c.tCur += r.valor; if (r.month <= cmpUpTo) c.cmpCur += r.valor }
    if (prevYear && r.year === prevYear) { c.tPrev += r.valor; if (r.month <= cmpUpTo) c.cmpPrev += r.valor }
  })

  const totalGeral = Array.from(cmap.values()).reduce((s, c) => s + c.total, 0)
  const sorted = Array.from(cmap.values()).sort((a, b) => b.total - a.total)
  // curva ABC (acumulado do faturamento)
  let acc = 0
  const clientes = sorted.map(c => {
    acc += c.total
    const share = totalGeral ? c.total / totalGeral : 0
    const cum = totalGeral ? acc / totalGeral : 0
    const abc = cum <= 0.8 ? 'A' : cum <= 0.95 ? 'B' : 'C'
    // status por JANELA de 2 meses (neutraliza um último mês parcial)
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
    // variação ano a ano na janela comparável Jan..cmpUpTo (null se não há ano anterior ou base zero)
    const yoy = hasYoY && c.cmpPrev > 0 ? (c.cmpCur - c.cmpPrev) / c.cmpPrev : null
    const perdidoYoY = hasYoY && c.tPrev > 0 && c.tCur === 0
    return { code: c.code, nome: c.nome, vendedor: c.vendedor, total: c.total, qtd: c.qtd, nProd: c.prods.size, abc, share, status, byMonth: c.byMonth, tCur: c.tCur, tPrev: c.tPrev, yoy, perdidoYoY }
  })

  const dist = { A: 0, B: 0, C: 0 } as Record<string, number>
  clientes.forEach(c => dist[c.abc]++)
  const statusDist: Record<string, number> = {}
  clientes.forEach(c => statusDist[c.status] = (statusDist[c.status] ?? 0) + 1)

  const sumCmpCur = clientes.reduce((s, c) => s + (cmap.get(c.code)?.cmpCur ?? 0), 0)
  const sumCmpPrev = clientes.reduce((s, c) => s + (cmap.get(c.code)?.cmpPrev ?? 0), 0)
  const sumTCur = clientes.reduce((s, c) => s + c.tCur, 0)
  const sumTPrev = clientes.reduce((s, c) => s + c.tPrev, 0)
  const perdidosYoY = clientes.filter(c => c.perdidoYoY).length

  return NextResponse.json({
    hasData: true, months,
    curYear, prevYear, cmpUpTo, hasYoY,
    kpis: {
      totalGeral, nClientes: clientes.length,
      nProdutos: new Set(rows.map(r => r.produtoCode ?? r.produto)).size,
      ticketMedio: clientes.length ? totalGeral / clientes.length : 0,
      totalCur: sumTCur, totalPrev: sumTPrev,
      yoyGeral: hasYoY && sumCmpPrev > 0 ? (sumCmpCur - sumCmpPrev) / sumCmpPrev : null,
      perdidosYoY,
    },
    monthlyTotal, clientes, distAbc: dist, statusDist,
  })
}
