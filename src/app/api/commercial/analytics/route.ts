/**
 * Cruza as 3 bases (preço × estoque × vendas) e devolve em uma chamada:
 *
 *   1. marginRows[] — por SKU: preço, custo, MC bruta, MC com custo fixo (30% da receita rateado por unidade)
 *   2. abcRows[]    — por SKU classificado pelo ERP, com cumulativo da receita
 *   3. turnoverRows[] — por SKU: estoque, venda, giro, meses de cobertura
 */
import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const FIXED_COST_PCT = 0.30  // custo fixo operacional = 30% da receita

export async function GET() {
  const [prices, stock, sales] = await Promise.all([
    prisma.productPrice.findMany(),
    prisma.stockItem.findMany(),
    prisma.salesAbcItem.findMany(),
  ])

  const priceMap = new Map(prices.map(p => [p.code, p]))
  const stockMap = new Map(stock.map(s => [s.code, s]))
  const salesMap = new Map(sales.map(v => [v.code, v]))

  // ── Cálculo do custo fixo unitário (rateio por unidade vendida) ─────
  const totalRevenue = sales.reduce((acc, s) => {
    const p = priceMap.get(s.code)?.retailPrice ?? s.avgUnit
    return acc + p * s.qtySold
  }, 0)
  const totalUnits = sales.reduce((acc, s) => acc + s.qtySold, 0)
  const fixedCostTotal = totalRevenue * FIXED_COST_PCT
  const fixedCostPerUnit = totalUnits > 0 ? fixedCostTotal / totalUnits : 0

  // ── 1. MARGEM por produto ──────────────────────────────────────────
  // Une todos os códigos que apareçam em PRICE ou STOCK
  const codes = new Set<string>([...priceMap.keys(), ...stockMap.keys()])
  const marginRows = Array.from(codes).map(code => {
    const p = priceMap.get(code)
    const s = stockMap.get(code)
    const v = salesMap.get(code)
    const price = p?.retailPrice ?? 0
    const cost = s?.unitCost ?? 0
    const description = p?.description || s?.description || v?.description || code

    const grossMargin = price > 0 ? (price - cost) / price : 0  // % bruta
    // Com custo fixo: ajusta unitário (não dá pra ratear pra quem não vendeu)
    const contributionMargin = price > 0
      ? (price - cost - fixedCostPerUnit) / price
      : 0

    return {
      code,
      description,
      retailPrice: price,
      unitCost: cost,
      grossMarginPct: grossMargin * 100,
      grossMarginAbs: price - cost,
      contributionMarginPct: contributionMargin * 100,
      contributionMarginAbs: price - cost - fixedCostPerUnit,
      qtySold: v?.qtySold ?? 0,
      qtyStock: s?.qty ?? 0,
      hasPrice: !!p,
      hasCost: !!s,
    }
  })
  .filter(r => r.hasPrice && r.hasCost) // só os com dados completos
  .sort((a, b) => b.retailPrice - a.retailPrice)

  // ── 2. ABC ──────────────────────────────────────────────────────────
  const abcSorted = [...sales].sort((a, b) => b.totalValue - a.totalValue)
  const totalSalesValue = abcSorted.reduce((s, x) => s + x.totalValue, 0)
  let cum = 0
  const abcRows = abcSorted.map((s, i) => {
    cum += s.totalValue
    return {
      rank: i + 1,
      code: s.code,
      description: s.description,
      qtySold: s.qtySold,
      totalValue: s.totalValue,
      avgUnit: s.avgUnit,
      abcClass: s.abcClass,
      cumulativePct: totalSalesValue > 0 ? (cum / totalSalesValue) * 100 : 0,
      sharePct: totalSalesValue > 0 ? (s.totalValue / totalSalesValue) * 100 : 0,
    }
  })

  // ── 3. GIRO de estoque ──────────────────────────────────────────────
  // Considera o período do ABC vendas (~6 meses, jan-jun 2026)
  const PERIOD_MONTHS = 6
  const turnoverCodes = new Set<string>([...stockMap.keys(), ...salesMap.keys()])
  const turnoverRows = Array.from(turnoverCodes).map(code => {
    const s = stockMap.get(code)
    const v = salesMap.get(code)
    const qtyStock = s?.qty ?? 0
    const qtySold = v?.qtySold ?? 0
    const unitCost = s?.unitCost ?? 0
    const stockValue = s?.totalValue ?? 0
    const salesValue = v?.totalValue ?? 0

    // Giro = vendas / estoque médio (assumindo estoque atual como aproximação)
    const turnover = qtyStock > 0 ? qtySold / qtyStock : 0
    // Meses de cobertura: quanto tempo o estoque atual dura no ritmo de venda
    const monthsCoverage = qtySold > 0
      ? (qtyStock / qtySold) * PERIOD_MONTHS
      : (qtyStock > 0 ? Infinity : 0)

    // Classificação
    let status: 'rupture' | 'low' | 'healthy' | 'excess' | 'dead'
    if (qtySold === 0 && qtyStock > 0)       status = 'dead'        // sem venda no período
    else if (qtySold === 0 && qtyStock === 0) status = 'dead'        // sem dados
    else if (monthsCoverage < 1)             status = 'rupture'     // <1 mês
    else if (monthsCoverage < 2)             status = 'low'         // 1-2 meses
    else if (monthsCoverage > 6)             status = 'excess'      // >6 meses
    else                                      status = 'healthy'    // 2-6 meses

    return {
      code,
      description: s?.description || v?.description || code,
      qtyStock, qtySold,
      unitCost, stockValue, salesValue,
      turnover,
      monthsCoverage: Number.isFinite(monthsCoverage) ? monthsCoverage : null,
      status,
      abcClass: v?.abcClass ?? null,
    }
  })
  .filter(r => r.qtyStock > 0 || r.qtySold > 0)
  .sort((a, b) => b.stockValue - a.stockValue)

  // ── KPIs agregados ──────────────────────────────────────────────────
  const excellent = marginRows.filter(r => r.contributionMarginPct >= 30).length
  const detractors = marginRows.filter(r => r.contributionMarginPct < 20).length
  const ruptures = turnoverRows.filter(r => r.status === 'rupture').length
  const excess = turnoverRows.filter(r => r.status === 'excess').length
  const dead = turnoverRows.filter(r => r.status === 'dead').length

  return NextResponse.json({
    counts: {
      prices: prices.length,
      stock: stock.length,
      sales: sales.length,
      marginItems: marginRows.length,
      turnoverItems: turnoverRows.length,
    },
    fixedCost: {
      pct: FIXED_COST_PCT,
      totalRevenue,
      totalUnits,
      fixedCostTotal,
      fixedCostPerUnit,
    },
    summary: {
      excellent, detractors, ruptures, excess, dead,
      totalSalesValue,
      totalStockValue: stock.reduce((s, x) => s + x.totalValue, 0),
    },
    marginRows,
    abcRows,
    turnoverRows,
  })
}
