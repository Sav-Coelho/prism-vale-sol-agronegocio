/**
 * Matriz BCG de produtos: CRESCIMENTO (histórico) × MARGEM.
 *
 * O eixo do crescimento vem do histórico de vendas (`DemandEntry`, que tem
 * produto × mês × ano), comparando a mesma janela de meses entre os dois anos —
 * não a curva ABC, que é uma fotografia estática e não mostra movimento.
 *
 * A margem é a REALIZADA: preço médio efetivamente praticado (venda ÷ qtd)
 * contra o custo de reposição do ABC de Estoque. É diferente da margem de
 * tabela, e a distância entre as duas é o desconto concedido.
 *
 * Quadrantes (cortes: crescimento da carteira × margem média da carteira):
 *   ★ Estrela       cresce e tem margem      → proteger preço, não deixar faltar
 *   ✦ Vaca leiteira margem boa, sem crescer  → colher, financia o resto
 *   ? Interrogação  cresce sem margem        → reprecificar ou negociar compra
 *   ▽ Abacaxi       não cresce nem rende     → candidato a sair da linha
 *
 *   ?janela=6   → compara os últimos N meses cheios (padrão: ano corrente inteiro)
 */
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(req: NextRequest) {
  const [entries, stock] = await Promise.all([
    prisma.demandEntry.findMany({ select: { produtoCode: true, produto: true, year: true, month: true, qtd: true, valor: true } }),
    prisma.stockItem.findMany({ select: { code: true, qty: true, unitCost: true } }),
  ])
  if (!entries.length) return NextResponse.json({ hasData: false })

  const anos = Array.from(new Set(entries.map(e => e.year))).sort((a, b) => a - b)
  const curYear = anos[anos.length - 1]
  const prevYear = anos.length > 1 ? anos[anos.length - 2] : null
  if (prevYear == null) {
    return NextResponse.json({ hasData: false, motivo: 'É preciso ter dois anos de histórico para medir crescimento.' })
  }

  // Janela comparável: só meses CHEIOS do ano corrente. O mês em curso entraria
  // pela metade e faria todo produto parecer em queda.
  const hoje = new Date()
  const mesesCur = Array.from(new Set(entries.filter(e => e.year === curYear).map(e => e.month))).sort((a, b) => a - b)
  const ultimoCheio = mesesCur.filter(m => !(curYear === hoje.getUTCFullYear() && m === hoje.getUTCMonth() + 1))
  const nJanela = parseInt(req.nextUrl.searchParams.get('janela') ?? '', 10)
  const janela = !isNaN(nJanela) && nJanela > 0 ? ultimoCheio.slice(-nJanela) : ultimoCheio
  if (!janela.length) return NextResponse.json({ hasData: false, motivo: 'Sem mês fechado no ano corrente.' })

  const custoDe = new Map<string, { custo: number; estoque: number }>()
  stock.forEach(s => { if (s.unitCost > 0) custoDe.set(s.code, { custo: s.unitCost, estoque: s.qty }) })

  interface Acc { code: string | null; nome: string; cur: number; prev: number; qtdCur: number }
  const map = new Map<string, Acc>()
  entries.forEach(e => {
    if (!janela.includes(e.month)) return
    const k = e.produtoCode ?? e.produto
    if (!map.has(k)) map.set(k, { code: e.produtoCode, nome: e.produto, cur: 0, prev: 0, qtdCur: 0 })
    const a = map.get(k)!
    if (e.year === curYear) { a.cur += e.valor; a.qtdCur += e.qtd }
    else if (e.year === prevYear) a.prev += e.valor
  })

  const todos = Array.from(map.values())
  const vendaCur = todos.reduce((s, a) => s + a.cur, 0)
  const vendaPrev = todos.reduce((s, a) => s + a.prev, 0)
  // corte do eixo Y: o crescimento da própria carteira (análogo ao "crescimento
  // do mercado" da BCG clássica) — acima dele, o produto ganha espaço
  const crescimentoCarteira = vendaPrev > 0 ? (vendaCur - vendaPrev) / vendaPrev : 0

  const itens = todos
    .filter(a => a.cur > 0 || a.prev > 0)
    .map(a => {
      const c = a.code ? custoDe.get(a.code) : undefined
      const precoMedio = a.qtdCur > 0 ? a.cur / a.qtdCur : 0
      const margem = c && precoMedio > 0 ? (precoMedio - c.custo) / precoMedio : null
      const novo = a.prev === 0 && a.cur > 0
      const perdido = a.cur === 0 && a.prev > 0
      return {
        code: a.code, nome: a.nome,
        vendaCur: a.cur, vendaPrev: a.prev, qtdCur: a.qtdCur,
        crescimento: a.prev > 0 ? (a.cur - a.prev) / a.prev : null,
        novo, perdido,
        precoMedio, custo: c?.custo ?? null, estoque: c?.estoque ?? null,
        margem, lucro: margem != null ? a.cur * margem : null,
        capitalParado: c ? c.estoque * c.custo : null,
      }
    })

  // corte do eixo X: margem média ponderada da carteira (só itens com custo)
  const comMargem = itens.filter(i => i.margem != null && i.vendaCur > 0)
  const baseVenda = comMargem.reduce((s, i) => s + i.vendaCur, 0)
  const baseLucro = comMargem.reduce((s, i) => s + (i.lucro ?? 0), 0)
  const margemMedia = baseVenda > 0 ? baseLucro / baseVenda : 0

  const quadranteDe = (i: typeof itens[number]): string | null => {
    if (i.margem == null || i.vendaCur <= 0) return null
    // produto novo não tem base de comparação: entra como alto crescimento
    const cresce = i.novo || (i.crescimento != null && i.crescimento >= crescimentoCarteira)
    const rende = i.margem >= margemMedia
    return cresce ? (rende ? 'ESTRELA' : 'INTERROGACAO') : (rende ? 'VACA' : 'ABACAXI')
  }

  const comQuadrante = itens.map(i => ({ ...i, quadrante: quadranteDe(i) }))
  const resumo: Record<string, { itens: number; venda: number; lucro: number; margem: number; capitalParado: number }> = {}
  comQuadrante.forEach(i => {
    if (!i.quadrante) return
    const r = resumo[i.quadrante] ?? (resumo[i.quadrante] = { itens: 0, venda: 0, lucro: 0, margem: 0, capitalParado: 0 })
    r.itens++; r.venda += i.vendaCur; r.lucro += i.lucro ?? 0; r.capitalParado += i.capitalParado ?? 0
  })
  Object.values(resumo).forEach(r => { r.margem = r.venda > 0 ? r.lucro / r.venda : 0 })

  const MESES = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

  return NextResponse.json({
    hasData: true,
    janela: { meses: janela, label: `${MESES[janela[0]]}–${MESES[janela[janela.length - 1]]}`, curYear, prevYear },
    cortes: { crescimento: crescimentoCarteira, margem: margemMedia },
    totais: {
      vendaCur, vendaPrev, crescimentoCarteira,
      itens: itens.length,
      comMargem: comMargem.length,
      semCusto: itens.filter(i => i.margem == null && i.vendaCur > 0).length,
      novos: itens.filter(i => i.novo).length,
      perdidos: itens.filter(i => i.perdido).length,
    },
    resumo,
    itens: comQuadrante.sort((a, b) => b.vendaCur - a.vendaCur),
  })
}
