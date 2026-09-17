/**
 * Matriz BCG de produtos — CRESCIMENTO (histórico) × MARGEM realizada.
 *
 * Fica numa lib própria porque o quadrante não é exclusivo da Análise
 * Comercial: aparece também na Demanda por Cliente (inclusive no PDF do
 * vendedor) e na Reposição por Giro. Uma fonte só evita que duas telas
 * classifiquem o mesmo produto de formas diferentes.
 *
 *  · Crescimento: mesma janela de meses FECHADOS nos dois anos (`DemandEntry`).
 *    O mês em curso entraria pela metade e faria todo produto parecer em queda.
 *  · Margem: REALIZADA — preço médio praticado (venda ÷ qtd) contra o custo de
 *    reposição do ABC de Estoque. Difere da margem de tabela; a distância entre
 *    as duas é o desconto concedido.
 *  · Cortes: crescimento da própria carteira (análogo ao "crescimento de
 *    mercado" da BCG clássica) e margem média ponderada.
 */
import { prisma } from '@/lib/prisma'

export type Quadrante = 'ESTRELA' | 'VACA' | 'INTERROGACAO' | 'ABACAXI'

export interface BcgItem {
  code: string | null
  nome: string
  vendaCur: number
  vendaPrev: number
  qtdCur: number
  crescimento: number | null
  novo: boolean
  perdido: boolean
  precoMedio: number
  custo: number | null
  estoque: number | null
  margem: number | null
  lucro: number | null
  capitalParado: number | null
  quadrante: Quadrante | null
}

export interface BcgResultado {
  hasData: boolean
  motivo?: string
  janela: { meses: number[]; label: string; curYear: number; prevYear: number }
  cortes: { crescimento: number; margem: number }
  totais: {
    vendaCur: number; vendaPrev: number; crescimentoCarteira: number
    itens: number; comMargem: number; semCusto: number; novos: number; perdidos: number
  }
  resumo: Record<string, { itens: number; venda: number; lucro: number; margem: number; capitalParado: number }>
  itens: BcgItem[]
  /** code → quadrante, para as outras telas etiquetarem sem recalcular */
  porCodigo: Record<string, { quadrante: Quadrante; crescimento: number | null; margem: number; novo: boolean }>
}

export const QUADRANTE_LABEL: Record<Quadrante, string> = {
  ESTRELA: 'Estrela',
  VACA: 'Vaca leiteira',
  INTERROGACAO: 'Interrogação',
  ABACAXI: 'Abacaxi',
}
export const QUADRANTE_ICONE: Record<Quadrante, string> = {
  ESTRELA: '⭐', VACA: '🐄', INTERROGACAO: '❓', ABACAXI: '🍍',
}

const MESES = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const VAZIO: BcgResultado = {
  hasData: false,
  janela: { meses: [], label: '', curYear: 0, prevYear: 0 },
  cortes: { crescimento: 0, margem: 0 },
  totais: { vendaCur: 0, vendaPrev: 0, crescimentoCarteira: 0, itens: 0, comMargem: 0, semCusto: 0, novos: 0, perdidos: 0 },
  resumo: {}, itens: [], porCodigo: {},
}

export async function calcularBcg(opts?: { janelaMeses?: number }): Promise<BcgResultado> {
  const [entries, stock] = await Promise.all([
    prisma.demandEntry.findMany({ select: { produtoCode: true, produto: true, year: true, month: true, qtd: true, valor: true } }),
    prisma.stockItem.findMany({ select: { code: true, qty: true, unitCost: true } }),
  ])
  if (!entries.length) return { ...VAZIO, motivo: 'Sem base de Demanda por Cliente importada.' }

  const anos = Array.from(new Set(entries.map(e => e.year))).sort((a, b) => a - b)
  const curYear = anos[anos.length - 1]
  const prevYear = anos.length > 1 ? anos[anos.length - 2] : null
  if (prevYear == null) return { ...VAZIO, motivo: 'É preciso ter dois anos de histórico para medir crescimento.' }

  const hoje = new Date()
  const mesesCur = Array.from(new Set(entries.filter(e => e.year === curYear).map(e => e.month))).sort((a, b) => a - b)
  const cheios = mesesCur.filter(m => !(curYear === hoje.getUTCFullYear() && m === hoje.getUTCMonth() + 1))
  const janela = opts?.janelaMeses && opts.janelaMeses > 0 ? cheios.slice(-opts.janelaMeses) : cheios
  if (!janela.length) return { ...VAZIO, motivo: 'Sem mês fechado no ano corrente.' }

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
  const crescimentoCarteira = vendaPrev > 0 ? (vendaCur - vendaPrev) / vendaPrev : 0

  const base = todos.filter(a => a.cur > 0 || a.prev > 0).map(a => {
    const c = a.code ? custoDe.get(a.code) : undefined
    const precoMedio = a.qtdCur > 0 ? a.cur / a.qtdCur : 0
    const margem = c && precoMedio > 0 ? (precoMedio - c.custo) / precoMedio : null
    return {
      code: a.code, nome: a.nome,
      vendaCur: a.cur, vendaPrev: a.prev, qtdCur: a.qtdCur,
      crescimento: a.prev > 0 ? (a.cur - a.prev) / a.prev : null,
      novo: a.prev === 0 && a.cur > 0,
      perdido: a.cur === 0 && a.prev > 0,
      precoMedio, custo: c?.custo ?? null, estoque: c?.estoque ?? null,
      margem, lucro: margem != null ? a.cur * margem : null,
      capitalParado: c ? c.estoque * c.custo : null,
    }
  })

  const comMargem = base.filter(i => i.margem != null && i.vendaCur > 0)
  const baseVenda = comMargem.reduce((s, i) => s + i.vendaCur, 0)
  const baseLucro = comMargem.reduce((s, i) => s + (i.lucro ?? 0), 0)
  const margemMedia = baseVenda > 0 ? baseLucro / baseVenda : 0

  const itens: BcgItem[] = base.map(i => {
    let quadrante: Quadrante | null = null
    if (i.margem != null && i.vendaCur > 0) {
      const cresce = i.novo || (i.crescimento != null && i.crescimento >= crescimentoCarteira)
      const rende = i.margem >= margemMedia
      quadrante = cresce ? (rende ? 'ESTRELA' : 'INTERROGACAO') : (rende ? 'VACA' : 'ABACAXI')
    }
    return { ...i, quadrante }
  })

  const resumo: BcgResultado['resumo'] = {}
  const porCodigo: BcgResultado['porCodigo'] = {}
  itens.forEach(i => {
    if (!i.quadrante) return
    const r = resumo[i.quadrante] ?? (resumo[i.quadrante] = { itens: 0, venda: 0, lucro: 0, margem: 0, capitalParado: 0 })
    r.itens++; r.venda += i.vendaCur; r.lucro += i.lucro ?? 0; r.capitalParado += i.capitalParado ?? 0
    if (i.code) porCodigo[i.code] = { quadrante: i.quadrante, crescimento: i.crescimento, margem: i.margem as number, novo: i.novo }
  })
  Object.values(resumo).forEach(r => { r.margem = r.venda > 0 ? r.lucro / r.venda : 0 })

  return {
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
    itens: itens.sort((a, b) => b.vendaCur - a.vendaCur),
    porCodigo,
  }
}
