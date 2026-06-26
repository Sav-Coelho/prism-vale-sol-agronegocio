/**
 * Cruza as 3 bases (preço × estoque × vendas) e devolve em uma chamada:
 *
 *   1. marginRows[] — por SKU: preço, custo, margem bruta = (preço-custo)/preço
 *   2. abcRows[]    — por SKU classificado pelo ERP, com cumulativo da receita
 *   3. turnoverRows[] — por SKU: estoque, venda, giro, meses de cobertura
 */
import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  const [prices, stock, sales] = await Promise.all([
    prisma.productPrice.findMany(),
    prisma.stockItem.findMany(),
    prisma.salesAbcItem.findMany(),
  ])

  const priceMap = new Map(prices.map(p => [p.code, p]))
  const stockMap = new Map(stock.map(s => [s.code, s]))
  const salesMap = new Map(sales.map(v => [v.code, v]))

  // ── 1. MARGEM por produto ──────────────────────────────────────────
  // Une todos os códigos que apareçam em PRICE ou STOCK
  const codes = new Set<string>()
  prices.forEach(p => codes.add(p.code))
  stock.forEach(s => codes.add(s.code))
  const marginRows = Array.from(codes).map(code => {
    const p = priceMap.get(code)
    const s = stockMap.get(code)
    const v = salesMap.get(code)
    const price = p?.retailPrice ?? 0
    const cost = s?.unitCost ?? 0
    const description = p?.description || s?.description || v?.description || code

    const margin = price > 0 ? (price - cost) / price : 0

    return {
      code,
      description,
      retailPrice: price,
      unitCost: cost,
      marginPct: margin * 100,
      marginAbs: price - cost,
      qtySold: v?.qtySold ?? 0,
      qtyStock: s?.qty ?? 0,
      hasPrice: !!p,
      hasCost: !!s,
    }
  })
  // Exige preço E custo válidos (> 0). Item sem custo não tem margem que faça sentido.
  .filter(r => r.hasPrice && r.hasCost && r.retailPrice > 0 && r.unitCost > 0)
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
  const PERIOD_MONTHS = 6
  const turnoverCodes = new Set<string>()
  stock.forEach(s => turnoverCodes.add(s.code))
  sales.forEach(v => turnoverCodes.add(v.code))
  const turnoverRows = Array.from(turnoverCodes).map(code => {
    const s = stockMap.get(code)
    const v = salesMap.get(code)
    const qtyStock = s?.qty ?? 0
    const qtySold = v?.qtySold ?? 0
    const unitCost = s?.unitCost ?? 0
    const stockValue = s?.totalValue ?? 0
    const salesValue = v?.totalValue ?? 0

    const turnover = qtyStock > 0 ? qtySold / qtyStock : 0
    const monthsCoverage = qtySold > 0
      ? (qtyStock / qtySold) * PERIOD_MONTHS
      : (qtyStock > 0 ? Infinity : 0)

    let status: 'rupture' | 'low' | 'healthy' | 'excess'
    if (monthsCoverage < 1)      status = 'rupture'
    else if (monthsCoverage < 2) status = 'low'
    else if (monthsCoverage > 6) status = 'excess'
    else                          status = 'healthy'

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
  // Itens sem giro no período (qtySold = 0) saem da análise
  .filter(r => r.qtySold > 0)
  .sort((a, b) => b.stockValue - a.stockValue)

  // ── KPIs agregados ──────────────────────────────────────────────────
  const excellent = marginRows.filter(r => r.marginPct >= 30).length
  const detractors = marginRows.filter(r => r.marginPct < 20).length
  const ruptures = turnoverRows.filter(r => r.status === 'rupture').length
  const excess = turnoverRows.filter(r => r.status === 'excess').length

  return NextResponse.json({
    counts: {
      prices: prices.length,
      stock: stock.length,
      sales: sales.length,
      marginItems: marginRows.length,
      turnoverItems: turnoverRows.length,
    },
    summary: {
      excellent, detractors, ruptures, excess,
      totalSalesValue,
      totalStockValue: stock.reduce((s, x) => s + x.totalValue, 0),
    },
    marginRows,
    abcRows,
    turnoverRows,
  })
}
