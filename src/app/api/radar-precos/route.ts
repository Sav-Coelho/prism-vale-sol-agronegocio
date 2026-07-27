/**
 * Radar de Precificação: por produto, compara
 *   · preço de TABELA (Lista de Preços)  ×  preço médio PRATICADO (MÉDIA/UN do ABC de Vendas)
 *   · margem de tabela  ×  margem real (ambas sobre o custo de reposição do estoque)
 * Responde: quanto de desconto está sendo dado e onde a precificação vaza.
 */
import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  const [sales, prices, stock] = await Promise.all([
    prisma.salesAbcItem.findMany(),
    prisma.productPrice.findMany({ select: { code: true, retailPrice: true } }),
    prisma.stockItem.findMany({ select: { code: true, unitCost: true } }),
  ])
  const priceMap = new Map(prices.map(p => [p.code, p.retailPrice]))
  const costMap = new Map(stock.filter(s => s.unitCost > 0).map(s => [s.code, s.unitCost]))

  const rows = sales
    .filter(s => s.qtySold > 0 && s.avgUnit > 0)
    .map(s => {
      const tabela = priceMap.get(s.code) ?? null
      const custo = costMap.get(s.code) ?? null
      const praticado = s.avgUnit
      const desconto = tabela && tabela > 0 ? (tabela - praticado) / tabela : null
      const mgTabela = tabela && custo ? (tabela - custo) / tabela : null
      const mgReal = custo ? (praticado - custo) / praticado : null
      return {
        code: s.code, nome: s.description, classe: s.abcClass,
        qtd: s.qtySold, faturamento: s.totalValue,
        tabela, praticado, custo, desconto, mgTabela, mgReal,
        gapMargem: mgTabela != null && mgReal != null ? mgReal - mgTabela : null,
      }
    })
    .sort((a, b) => b.faturamento - a.faturamento)

  // KPIs (ponderados por faturamento onde fizer sentido)
  const comTabela = rows.filter(r => r.desconto != null)
  const fatTot = comTabela.reduce((s, r) => s + r.faturamento, 0)
  const descontoMedio = fatTot > 0 ? comTabela.reduce((s, r) => s + (r.desconto ?? 0) * r.faturamento, 0) / fatTot : null
  const acimaTabela = comTabela.filter(r => (r.desconto ?? 0) < -0.005)
  const descontoForte = comTabela.filter(r => (r.desconto ?? 0) > 0.10)
  const comMargens = rows.filter(r => r.mgReal != null)
  const fatMg = comMargens.reduce((s, r) => s + r.faturamento, 0)
  const mgRealMedia = fatMg > 0 ? comMargens.reduce((s, r) => s + (r.mgReal ?? 0) * r.faturamento, 0) / fatMg : null
  const mgTabItems = rows.filter(r => r.mgTabela != null)
  const fatMgT = mgTabItems.reduce((s, r) => s + r.faturamento, 0)
  const mgTabelaMedia = fatMgT > 0 ? mgTabItems.reduce((s, r) => s + (r.mgTabela ?? 0) * r.faturamento, 0) / fatMgT : null
  const mgRealBaixa = comMargens.filter(r => (r.mgReal ?? 1) < 0.2)

  return NextResponse.json({
    hasData: rows.length > 0,
    kpis: {
      nItens: rows.length,
      nComTabela: comTabela.length,
      descontoMedio, mgTabelaMedia, mgRealMedia,
      nAcimaTabela: acimaTabela.length,
      nDescontoForte: descontoForte.length,
      nMgRealBaixa: mgRealBaixa.length,
      semTabela: rows.length - comTabela.length,
      semCusto: rows.filter(r => r.custo == null).length,
    },
    rows,
  })
}
