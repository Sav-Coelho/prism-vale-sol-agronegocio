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

// ── Comparativo entre as duas janelas de 12 meses ────────────────────────────
// Duas fotos do portfólio na mesma régua. A base de 20 meses (Jan/25–Ago/26)
// comporta UM único par de janelas, então o eixo de crescimento é medido uma
// vez só e vale para as duas fotos; o que se move entre elas é a MARGEM, que é
// justamente o que a Vale Sol trabalhou no período.
// Os cortes ficam FIXOS nos valores de hoje nas duas fotos: com corte móvel,
// uma melhora geral do portfólio não apareceria (todo mundo sobe, a média sobe
// junto e ninguém "muda de quadrante").
export interface BcgFoto {
  venda: number
  qtd: number
  precoMedio: number
  margem: number | null
  quadrante: Quadrante | null
}
export interface BcgComparativoItem {
  code: string | null
  nome: string
  crescimento: number | null
  novo: boolean
  custo: number | null
  a: BcgFoto
  b: BcgFoto
}
export interface BcgComparativo {
  hasData: boolean
  motivo?: string
  janelaA: string
  janelaB: string
  cortes: { crescimento: number; margem: number }
  margemPond: { a: number | null; b: number | null }
  itens: BcgComparativoItem[]
  resumo: { a: Record<string, { itens: number; venda: number }>; b: Record<string, { itens: number; venda: number }> }
  /** "ABACAXI→VACA" → nº de produtos que fizeram esse caminho */
  migracao: Record<string, number>
  totais: { vendaA: number; vendaB: number; itens: number; semCusto: number; soA: number; soB: number; nosDois: number }
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
  const anosEntreJanelas = mesesDistancia / 12
  const setFim = new Set(ttmFimIdx)
  const setIni = new Set(ttmIniIdx)

  const cagrDe = (fim: number, ini: number): number | null => {
    if (ini <= 0 || fim <= 0 || anosEntreJanelas <= 0) return null
    return Math.pow(fim / ini, 1 / anosEntreJanelas) - 1
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
      mesesDistancia, mesesSobreposicao, anos: anosEntreJanelas,
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

const VAZIO_CMP: BcgComparativo = {
  hasData: false, janelaA: '', janelaB: '',
  cortes: { crescimento: 0, margem: 0 },
  margemPond: { a: null, b: null },
  itens: [], resumo: { a: {}, b: {} }, migracao: {},
  totais: { vendaA: 0, vendaB: 0, itens: 0, semCusto: 0, soA: 0, soB: 0, nosDois: 0 },
}

/** Portfólio na janela inicial × na janela final, para o comparativo visual. */
export async function compararJanelas(): Promise<BcgComparativo> {
  const [entries, stock] = await Promise.all([
    prisma.demandEntry.findMany({ select: { produtoCode: true, produto: true, year: true, month: true, qtd: true, valor: true } }),
    prisma.stockItem.findMany({ select: { code: true, unitCost: true } }),
  ])
  if (!entries.length) return { ...VAZIO_CMP, motivo: 'Sem base de Demanda por Cliente importada.' }

  const hoje = new Date()
  const ymDe = (y: number, m: number) => y * 12 + (m - 1)
  const ymAtual = ymDe(hoje.getUTCFullYear(), hoje.getUTCMonth() + 1)
  const todosYm = Array.from(new Set(entries.map(e => ymDe(e.year, e.month))))
    .filter(v => v < ymAtual).sort((a, b) => a - b)
  if (todosYm.length < 13) {
    return { ...VAZIO_CMP, motivo: `São precisos 13 meses fechados para formar duas janelas; a base tem ${todosYm.length}.` }
  }
  const rotuloYm = (v: number) => `${MESES[(v % 12) + 1]}/${String(Math.floor(v / 12)).slice(-2)}`
  const idxA = todosYm.slice(0, 12)
  const idxB = todosYm.slice(-12)
  const setA = new Set(idxA), setB = new Set(idxB)
  const anosEntre = (todosYm[todosYm.length - 1] - todosYm[11]) / 12

  const custoDe = new Map<string, number>()
  stock.forEach(s => { if (s.unitCost > 0) custoDe.set(s.code, s.unitCost) })

  interface Acc { code: string | null; nome: string; vA: number; qA: number; vB: number; qB: number }
  const map = new Map<string, Acc>()
  entries.forEach(e => {
    const k = e.produtoCode ?? e.produto
    if (!map.has(k)) map.set(k, { code: e.produtoCode, nome: e.produto, vA: 0, qA: 0, vB: 0, qB: 0 })
    const a = map.get(k)!
    const v = ymDe(e.year, e.month)
    if (setA.has(v)) { a.vA += e.valor; a.qA += e.qtd }
    if (setB.has(v)) { a.vB += e.valor; a.qB += e.qtd }
  })

  const todos = Array.from(map.values()).filter(a => a.vA > 0 || a.vB > 0)
  const totA = todos.reduce((s, a) => s + a.vA, 0)
  const totB = todos.reduce((s, a) => s + a.vB, 0)
  // mesmo corte de crescimento da matriz viva: a CAGR da própria carteira
  const crescimentoCarteira = totA > 0 && totB > 0 ? Math.pow(totB / totA, 1 / anosEntre) - 1 : 0

  const foto = (venda: number, qtd: number, custo: number | undefined): Omit<BcgFoto, 'quadrante'> => {
    const precoMedio = qtd > 0 ? venda / qtd : 0
    return { venda, qtd, precoMedio, margem: custo != null && precoMedio > 0 ? (precoMedio - custo) / precoMedio : null }
  }

  const parciais = todos.map(a => {
    const custo = a.code ? custoDe.get(a.code) : undefined
    const fa = foto(a.vA, a.qA, custo)
    const fb = foto(a.vB, a.qB, custo)
    return {
      code: a.code, nome: a.nome, custo: custo ?? null,
      crescimento: a.vA > 0 && a.vB > 0 ? Math.pow(a.vB / a.vA, 1 / anosEntre) - 1 : null,
      novo: a.vA === 0 && a.vB > 0,
      a: fa, b: fb,
    }
  })

  // corte de margem: média ponderada da janela ATUAL, aplicada às duas fotos
  const comMargemB = parciais.filter(p => p.b.margem != null && p.b.venda > 0)
  const baseVendaB = comMargemB.reduce((s, p) => s + p.b.venda, 0)
  const margemPondB = baseVendaB > 0
    ? comMargemB.reduce((s, p) => s + p.b.venda * (p.b.margem as number), 0) / baseVendaB : null
  const comMargemA = parciais.filter(p => p.a.margem != null && p.a.venda > 0)
  const baseVendaA = comMargemA.reduce((s, p) => s + p.a.venda, 0)
  const margemPondA = baseVendaA > 0
    ? comMargemA.reduce((s, p) => s + p.a.venda * (p.a.margem as number), 0) / baseVendaA : null
  const corteMargem = margemPondB ?? 0

  const quadrarA = (p: typeof parciais[number]): Quadrante | null => {
    if (p.a.margem == null || p.a.venda <= 0) return null
    // na foto antiga o produto ainda não podia ser "novo": ele já vendia
    const cresce = p.crescimento != null && p.crescimento >= crescimentoCarteira
    return cresce ? (p.a.margem >= corteMargem ? 'ESTRELA' : 'INTERROGACAO')
      : (p.a.margem >= corteMargem ? 'VACA' : 'ABACAXI')
  }
  const quadrarB = (p: typeof parciais[number]): Quadrante | null => {
    if (p.b.margem == null || p.b.venda <= 0) return null
    const cresce = p.novo || (p.crescimento != null && p.crescimento >= crescimentoCarteira)
    return cresce ? (p.b.margem >= corteMargem ? 'ESTRELA' : 'INTERROGACAO')
      : (p.b.margem >= corteMargem ? 'VACA' : 'ABACAXI')
  }

  const itens: BcgComparativoItem[] = parciais.map(p => ({
    code: p.code, nome: p.nome, crescimento: p.crescimento, novo: p.novo, custo: p.custo,
    a: { ...p.a, quadrante: quadrarA(p) },
    b: { ...p.b, quadrante: quadrarB(p) },
  }))

  const resumo = { a: {} as Record<string, { itens: number; venda: number }>, b: {} as Record<string, { itens: number; venda: number }> }
  const migracao: Record<string, number> = {}
  itens.forEach(i => {
    if (i.a.quadrante) { const r = resumo.a[i.a.quadrante] ?? (resumo.a[i.a.quadrante] = { itens: 0, venda: 0 }); r.itens++; r.venda += i.a.venda }
    if (i.b.quadrante) { const r = resumo.b[i.b.quadrante] ?? (resumo.b[i.b.quadrante] = { itens: 0, venda: 0 }); r.itens++; r.venda += i.b.venda }
    if (i.a.quadrante && i.b.quadrante) {
      const k = `${i.a.quadrante}→${i.b.quadrante}`
      migracao[k] = (migracao[k] ?? 0) + 1
    }
  })

  return {
    hasData: true,
    janelaA: `${rotuloYm(idxA[0])}–${rotuloYm(idxA[11])}`,
    janelaB: `${rotuloYm(idxB[0])}–${rotuloYm(idxB[11])}`,
    cortes: { crescimento: crescimentoCarteira, margem: corteMargem },
    margemPond: { a: margemPondA, b: margemPondB },
    itens: itens.sort((a, b) => b.b.venda - a.b.venda),
    resumo, migracao,
    totais: {
      vendaA: totA, vendaB: totB, itens: itens.length,
      semCusto: itens.filter(i => i.custo == null).length,
      soA: itens.filter(i => i.a.venda > 0 && i.b.venda === 0).length,
      soB: itens.filter(i => i.b.venda > 0 && i.a.venda === 0).length,
      nosDois: itens.filter(i => i.a.venda > 0 && i.b.venda > 0).length,
    },
  }
}
