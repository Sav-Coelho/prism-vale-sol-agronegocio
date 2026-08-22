/**
 * Reposição por Giro (método do Fabrício: "comprar picotado de acordo com o giro").
 * giro diário = qtd vendida ÷ dias do período de vendas; cobertura = estoque ÷ giro.
 * Sugestão de compra = o que falta para atingir a cobertura-alvo (?dias=30),
 * priorizando rupturas de curva A. Custo pela base de custo de reposição.
 *   ?dias=30      → cobertura-alvo em dias
 *   ?base=221     → dias do período do ABC de Vendas (override manual).
 * Sem ?base, o período é AUTOMÁTICO: os exports do ABC são sempre YTD
 * (01/01 → data da extração), então usamos 01/01 do ano da importação até a
 * data em que o ABC foi importado no Arken — se atualiza sozinho a cada import.
 */
import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(req: Request) {
  const url = new URL(req.url)
  const alvoDias = Math.max(5, Math.min(180, parseInt(url.searchParams.get('dias') ?? '30', 10) || 30))

  const [sales, stock] = await Promise.all([
    prisma.salesAbcItem.findMany(),
    prisma.stockItem.findMany({ select: { code: true, qty: true, unitCost: true } }),
  ])
  const stockMap = new Map(stock.map(s => [s.code, s]))

  // dias do período de vendas: manual (?base=) ou automático pelo último import
  const baseParam = parseInt(url.searchParams.get('base') ?? '', 10)
  let baseAuto: string | null = null
  let baseDias: number
  if (!isNaN(baseParam) && baseParam > 0) {
    baseDias = Math.max(30, Math.min(400, baseParam))
  } else {
    const lastImport = sales.reduce<Date | null>((m, s) => (m === null || s.updatedAt > m ? s.updatedAt : m), null) ?? new Date()
    const jan1 = Date.UTC(lastImport.getUTCFullYear(), 0, 1)
    baseDias = Math.max(30, Math.min(400, Math.round((lastImport.getTime() - jan1) / 86400000)))
    baseAuto = lastImport.toISOString().slice(0, 10)
  }

  const rows = sales
    .filter(s => s.qtySold > 0)
    .map(s => {
      const st = stockMap.get(s.code)
      const estoque = st?.qty ?? 0
      const custo = st && st.unitCost > 0 ? st.unitCost : null
      const giroDia = s.qtySold / baseDias
      const cobertura = giroDia > 0 ? estoque / giroDia : null
      let status: string
      if (estoque <= 0) status = 'RUPTURA'
      else if ((cobertura ?? 0) < alvoDias * 0.25) status = 'CRÍTICO'
      else if ((cobertura ?? 0) < alvoDias) status = 'REPOR'
      else if ((cobertura ?? 0) <= alvoDias * 3) status = 'OK'
      else status = 'EXCESSO'
      const sugQtd = ['RUPTURA', 'CRÍTICO', 'REPOR'].includes(status)
        ? Math.max(0, Math.ceil(giroDia * alvoDias - Math.max(0, estoque)))
        : 0
      const sugCusto = sugQtd > 0 && custo != null ? sugQtd * custo : null
      return {
        code: s.code, nome: s.description, classe: s.abcClass,
        qtdVendida: s.qtySold, faturamento: s.totalValue,
        giroDia, estoque, cobertura, status, sugQtd, sugCusto, custo,
        semCadastroEstoque: !st,
      }
    })
    .sort((a, b) => {
      const cw = (c: string) => c === 'A' ? 0 : c === 'B' ? 1 : 2
      if (cw(a.classe) !== cw(b.classe)) return cw(a.classe) - cw(b.classe)
      const sw = (s: string) => s === 'RUPTURA' ? 0 : s === 'CRÍTICO' ? 1 : s === 'REPOR' ? 2 : s === 'OK' ? 3 : 4
      if (sw(a.status) !== sw(b.status)) return sw(a.status) - sw(b.status)
      return b.faturamento - a.faturamento
    })

  const precisa = rows.filter(r => r.sugQtd > 0)
  const custoTotal = precisa.reduce((s, r) => s + (r.sugCusto ?? 0), 0)
  const custoA = precisa.filter(r => r.classe === 'A').reduce((s, r) => s + (r.sugCusto ?? 0), 0)
  const statusDist: Record<string, number> = {}
  rows.forEach(r => statusDist[r.status] = (statusDist[r.status] ?? 0) + 1)
  const rupturasA = rows.filter(r => r.classe === 'A' && r.status === 'RUPTURA').length

  return NextResponse.json({
    hasData: rows.length > 0,
    params: { alvoDias, baseDias, baseAuto },
    kpis: {
      itens: rows.length, precisaRepor: precisa.length, rupturasA,
      custoReporTudo: custoTotal, custoReporA: custoA,
      semCusto: precisa.filter(r => r.sugCusto == null).length,
    },
    statusDist, rows,
  })
}
