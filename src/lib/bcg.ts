/**
 * Matriz BCG de produtos — CRESCIMENTO (histórico) × MARGEM realizada.
 *
 * Fica numa lib própria porque o quadrante não é exclusivo da Análise
 * Comercial: aparece também na Demanda por Cliente (inclusive no PDF do
 * vendedor) e na Reposição por Giro. Uma fonte só evita que duas telas
 * classifiquem o mesmo produto de formas diferentes.
 *
 * ── Crescimento: CAGR sobre janelas de 12 meses móveis ──────────────────
 * O eixo usa CAGR entre a PRIMEIRA e a ÚLTIMA janela de 12 meses fechados
 * disponíveis. Cada janela contém um ano completo, então a sazonalidade se
 * anula por construção — nenhum mês entra numa ponta sem entrar na outra.
 *
 *   CAGR = (janelaFinal / janelaInicial)^(12 / mesesDeDistância) − 1
 *
 * Com poucos meses de histórico as duas janelas se sobrepõem (hoje 20 meses
 * → 8 de distância, 4 de sobreposição), o que comprime a razão; o expoente
 * 12/8 recompõe a escala anual. À medida que a base cresce, a sobreposição
 * some e a medida fica mais limpa sozinha. Abaixo de 13 meses de histórico
 * não dá para formar duas janelas: aí cai no a/a de mesma janela.
 *
 * Nota: com exatamente dois anos comparáveis, CAGR anual e variação a/a são
 * a mesma coisa (expoente 1). O ganho aqui vem das janelas móveis, que usam
 * todos os meses em vez de dois pontos agregados — um pedido grande isolado
 * deixa de decidir o quadrante do produto.
 *
 *  · Margem: REALIZADA — preço médio praticado (venda ÷ qtd) contra o custo de
 *    reposição do ABC de Estoque. Difere da margem de tabela; a distância entre
 *    as duas é o desconto concedido.
 *  · Cortes: CAGR da própria carteira (análogo ao "crescimento de mercado" da
 *    BCG clássica) e margem média ponderada.
 */
import { prisma } from '@/lib/prisma'

export type Quadrante = 'ESTRELA' | 'VACA' | 'INTERROGACAO' | 'ABACAXI'

export interface BcgItem {
  code: string | null
  nome: string
  vendaCur: number
  vendaPrev: number
  qtdCur: number
  /** eixo do gráfico: CAGR anualizada entre as janelas de 12 meses */
  crescimento: number | null
  /** variação simples a/a de mesma janela, mantida para conferência */
  yoy: number | null
  /** janelas móveis que geraram a CAGR */
  ttmIni: number
  ttmFim: number
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
  /** janelas de 12 meses que sustentam a CAGR */
  cagr: {
    metodo: 'ttm12' | 'yoy'
    iniLabel: string; fimLabel: string
    mesesDistancia: number; mesesSobreposicao: number
    anos: number
  }
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
  cagr: { metodo: 'yoy', iniLabel: '', fimLabel: '', mesesDistancia: 0, mesesSobreposicao: 0, anos: 1 },
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

  // ── Eixo do tempo: todos os meses FECHADOS, em ordem ──
  const ymDe = (y: number, m: number) => y * 12 + (m - 1)
  const ymAtual = ymDe(hoje.getUTCFullYear(), hoje.getUTCMonth() + 1)
  const todosYm = Array.from(new Set(entries.map(e => ymDe(e.year, e.month))))
    .filter(v => v < ymAtual)
    .sort((a, b) => a - b)
  const rotuloYm = (v: number) => `${MESES[(v % 12) + 1]}/${String(Math.floor(v / 12)).slice(-2)}`

  // Duas janelas de 12 meses: a primeira e a última disponíveis. Cada uma cobre
  // um ano inteiro, então a sazonalidade se anula nas duas pontas.
  const usaTtm = todosYm.length >= 13
  const ttmFimIdx = usaTtm ? todosYm.slice(-12) : []
  const ttmIniIdx = usaTtm ? todosYm.slice(0, 12) : []
  const mesesDistancia = usaTtm ? todosYm[todosYm.length - 1] - todosYm[11] : 12
  const mesesSobreposicao = usaTtm ? Math.max(0, 12 - mesesDistancia) : 0
  const anos = mesesDistancia / 12
  const setFim = new Set(ttmFimIdx)
  const setIni = new Set(ttmIniIdx)

  const cagrDe = (fim: number, ini: number): number | null => {
    if (ini <= 0 || fim <= 0 || anos <= 0) return null
    return Math.pow(fim / ini, 1 / anos) - 1
  }

  interface Acc { code: string | null; nome: string; cur: number; prev: number; qtdCur: number; ttmIni: number; ttmFim: number }
  const map = new Map<string, Acc>()
  entries.forEach(e => {
    const k = e.produtoCode ?? e.produto
    if (!map.has(k)) map.set(k, { code: e.produtoCode, nome: e.produto, cur: 0, prev: 0, qtdCur: 0, ttmIni: 0, ttmFim: 0 })
    const a = map.get(k)!
    // janela comparável a/a (mesmos meses nos dois anos) — base da venda exibida
    if (janela.includes(e.month)) {
      if (e.year === curYear) { a.cur += e.valor; a.qtdCur += e.qtd }
      else if (e.year === prevYear) a.prev += e.valor
    }
    // janelas móveis de 12 meses — base da CAGR
    const v = ymDe(e.year, e.month)
    if (setFim.has(v)) a.ttmFim += e.valor
    if (setIni.has(v)) a.ttmIni += e.valor
  })

  const todos = Array.from(map.values())
  const vendaCur = todos.reduce((s, a) => s + a.cur, 0)
  const vendaPrev = todos.reduce((s, a) => s + a.prev, 0)
  const ttmFimTotal = todos.reduce((s, a) => s + a.ttmFim, 0)
  const ttmIniTotal = todos.reduce((s, a) => s + a.ttmIni, 0)
  // corte do eixo: CAGR da própria carteira (ou a/a, se ainda não há 13 meses)
  const crescimentoCarteira = usaTtm
    ? (cagrDe(ttmFimTotal, ttmIniTotal) ?? 0)
    : (vendaPrev > 0 ? (vendaCur - vendaPrev) / vendaPrev : 0)

  const base = todos.filter(a => a.cur > 0 || a.prev > 0).map(a => {
    const c = a.code ? custoDe.get(a.code) : undefined
    const precoMedio = a.qtdCur > 0 ? a.cur / a.qtdCur : 0
    const margem = c && precoMedio > 0 ? (precoMedio - c.custo) / precoMedio : null
    const yoy = a.prev > 0 ? (a.cur - a.prev) / a.prev : null
    // sem 13 meses de base, ou sem venda na janela inicial, a CAGR não existe:
    // cai no a/a (e quem não vendia antes é tratado como produto novo)
    const crescimento = usaTtm ? cagrDe(a.ttmFim, a.ttmIni) : yoy
    return {
      code: a.code, nome: a.nome,
      vendaCur: a.cur, vendaPrev: a.prev, qtdCur: a.qtdCur,
      crescimento, yoy, ttmIni: a.ttmIni, ttmFim: a.ttmFim,
      novo: usaTtm ? (a.ttmIni === 0 && a.ttmFim > 0) : (a.prev === 0 && a.cur > 0),
      perdido: usaTtm ? (a.ttmFim === 0 && a.ttmIni > 0) : (a.cur === 0 && a.prev > 0),
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
    cagr: {
      metodo: usaTtm ? 'ttm12' : 'yoy',
      iniLabel: usaTtm ? `${rotuloYm(ttmIniIdx[0])}–${rotuloYm(ttmIniIdx[11])}` : '',
      fimLabel: usaTtm ? `${rotuloYm(ttmFimIdx[0])}–${rotuloYm(ttmFimIdx[11])}` : '',
      mesesDistancia, mesesSobreposicao, anos,
    },
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
