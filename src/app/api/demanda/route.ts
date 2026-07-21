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
  const lastM = months[months.length - 1]
  const empty = () => { const o: Record<string, number> = {}; months.forEach(m => o[m] = 0); return o }

  // ─── Detalhe de um cliente ───
  if (cliente) {
    const mine = rows.filter(r => r.clienteCode === cliente)
    if (!mine.length) return NextResponse.json({ hasData: true, cliente, notFound: true, months })
    const nome = mine[0].cliente, vendedor = mine[0].vendedor
    const prodMap = new Map<string, { code: string | null; nome: string; total: number; qtd: number; byMonth: Record<string, number> }>()
    const monthly = empty()
    mine.forEach(r => {
      const k = r.produtoCode ?? r.produto
      if (!prodMap.has(k)) prodMap.set(k, { code: r.produtoCode, nome: r.produto, total: 0, qtd: 0, byMonth: empty() })
      const p = prodMap.get(k)!
      p.total += r.valor; p.qtd += r.qtd; p.byMonth[ym(r.year, r.month)] += r.valor
      monthly[ym(r.year, r.month)] += r.valor
    })
    const produtos = Array.from(prodMap.values()).sort((a, b) => b.total - a.total)
    // deixou de comprar: teve venda antes, mas 0 no último mês
    const dropped = produtos.filter(p => p.byMonth[lastM] === 0 && p.total > 0)
      .map(p => ({ nome: p.nome, code: p.code, total: p.total, ultimoMes: months.filter(m => p.byMonth[m] > 0).pop() ?? null }))
      .sort((a, b) => b.total - a.total)
    return NextResponse.json({ hasData: true, cliente, nome, vendedor, months, monthly, produtos, dropped, total: monthly ? Object.values(monthly).reduce((s, v) => s + v, 0) : 0 })
  }

  // ─── Visão geral ───
  interface Cli { code: string; nome: string; vendedor: string | null; total: number; qtd: number; byMonth: Record<string, number>; prods: Set<string> }
  const cmap = new Map<string, Cli>()
  const monthlyTotal = empty()
  rows.forEach(r => {
    if (!cmap.has(r.clienteCode)) cmap.set(r.clienteCode, { code: r.clienteCode, nome: r.cliente, vendedor: r.vendedor, total: 0, qtd: 0, byMonth: empty(), prods: new Set() })
    const c = cmap.get(r.clienteCode)!
    c.total += r.valor; c.qtd += r.qtd; c.byMonth[ym(r.year, r.month)] += r.valor; c.prods.add(r.produtoCode ?? r.produto)
    monthlyTotal[ym(r.year, r.month)] += r.valor
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
    const mesesAtivos = months.filter(m => c.byMonth[m] > 0)
    const avg = mesesAtivos.length ? c.total / mesesAtivos.length : 0
    const last = c.byMonth[lastM]
    const first = mesesAtivos[0] ?? null
    let status = 'Estável'
    if (first === lastM) status = 'Novo'
    else if (last === 0) status = 'Sumiu'
    else if (last < avg * 0.5) status = 'Em queda'
    else if (last > avg * 1.5) status = 'Crescendo'
    return { code: c.code, nome: c.nome, vendedor: c.vendedor, total: c.total, qtd: c.qtd, nProd: c.prods.size, abc, share, status, byMonth: c.byMonth }
  })

  const dist = { A: 0, B: 0, C: 0 } as Record<string, number>
  clientes.forEach(c => dist[c.abc]++)
  const statusDist: Record<string, number> = {}
  clientes.forEach(c => statusDist[c.status] = (statusDist[c.status] ?? 0) + 1)

  return NextResponse.json({
    hasData: true, months,
    kpis: { totalGeral, nClientes: clientes.length, nProdutos: new Set(rows.map(r => r.produtoCode ?? r.produto)).size, ticketMedio: clientes.length ? totalGeral / clientes.length : 0 },
    monthlyTotal, clientes, distAbc: dist, statusDist,
  })
}
