/**
 * Orçamento — projeção econométrica da DRE.
 *
 * ── Desenho, e por que é assim ────────────────────────────────────────────
 * A DRE realizada tem POUCOS meses (de set/26 em diante o DreEntry guarda
 * título futuro vindo do CashFlow, não realizado). Modelar 12 meses a partir
 * disso por mínimos quadrados abre o intervalo para ±55% já no começo e
 * produz coeficientes sem sentido econômico. Então o modelo é híbrido:
 *
 *   · SAZONALIDADE e TENDÊNCIA vêm da série LONGA de vendas (DemandEntry,
 *     ~20 meses). É a única série com ciclo suficiente.
 *   · NÍVEL vem da DRE realizada, ancorado nos últimos `ancora` meses.
 *   · TENDÊNCIA é AMORTECIDA por `phi` (Gardner–McKenzie): com 8 pontos, uma
 *     reta livre extrapola absurdos a 12 meses.
 *   · INCERTEZA cresce com √h (passeio aleatório), não pela alavancagem do
 *     OLS, que explode fora da amostra.
 *
 * ── Mesma estrutura da DRE ─────────────────────────────────────────────────
 * Os subtotais seguem AS MESMAS fórmulas de /api/dre, para que o orçamento
 * de um mês fechado mostre exatamente o número da aba de DRE:
 *
 *   Receita Líquida = Receita − Deduções
 *   EBITDA          = Receita Líquida − CMV − ADM − Pessoal − Logística − Comercial − Impostos
 *   Lucro Líquido   = EBITDA − Financeiras(líq. de juros) − Sócios − Investimentos + Não operacional
 *
 * O não operacional SOMA: aqui ele é reembolso recebido (excedente), dinheiro
 * que entrou. Uma versão anterior deste arquivo o excluía e chamava de
 * "resultado" um subtotal que não existe na DRE (LL − não operacional) — o
 * cliente veria dois lucros diferentes para o mesmo mês.
 *
 * ── O que é previsão e o que é cenário ────────────────────────────────────
 * RECEITA é previsão: backtest de origem móvel com MAPE ~4% a um passo e o
 * realizado dentro do IC 95% nos três meses testados.
 * LUCRO é CENÁRIO: é a diferença pequena entre números grandes — o CMV sozinho
 * passa de 70% da receita líquida — então pequenos erros de premissa viram
 * erros grandes de lucro. Custo e despesa são PREMISSAS editáveis; o lucro é a
 * consequência aritmética delas.
 *
 * ── Comportamento das linhas ──────────────────────────────────────────────
 * Vem de PRIOR ECONÔMICO, não de teste estatístico. Com n=8 a classificação
 * automática dizia que CMV é custo fixo (a receita variou pouco no período) e
 * a regressão dava IMPOSTOS com inclinação NEGATIVA "significativa" (t=−3,62).
 * O dado estima o coeficiente; o prior decide se ele é % da receita ou valor
 * fixo. Ambos são sobreponíveis pela tela.
 */
import { prisma } from '@/lib/prisma'
import { chaveMes, classificarMeses } from '@/lib/dre-meses'

export type ModoLinha = 'RECEITA' | 'FIXO'
export type GrupoLinha = 'CMV' | 'OPERACIONAL' | 'ABAIXO'

/** Como cada linha da DRE se comporta. Editável na tela. */
export const PRIOR: Record<string, ModoLinha> = {
  CMV: 'RECEITA',        // custo da mercadoria acompanha o que se vende
  IMPOSTOS: 'RECEITA',   // tributo sobre venda
  COM: 'RECEITA',        // comissão é % da venda
  PESSOAL: 'FIXO',
  ADM: 'FIXO',
  LOG: 'FIXO',
  FIN: 'FIXO',
  INVEST: 'FIXO',
  NAOOP: 'FIXO',
  SOCIO: 'FIXO',
}
/** Posição de cada linha na DRE — idêntica à de /api/dre. */
export const GRUPO: Record<string, GrupoLinha> = {
  CMV: 'CMV',
  ADM: 'OPERACIONAL', PESSOAL: 'OPERACIONAL', LOG: 'OPERACIONAL', COM: 'OPERACIONAL', IMPOSTOS: 'OPERACIONAL',
  FIN: 'ABAIXO', SOCIO: 'ABAIXO', INVEST: 'ABAIXO', NAOOP: 'ABAIXO',
}
/** Sinal da linha no Lucro Líquido: custo tira, o não operacional (reembolso) soma. */
export const SINAL: Record<string, 1 | -1> = {
  CMV: -1, ADM: -1, PESSOAL: -1, LOG: -1, COM: -1, IMPOSTOS: -1,
  FIN: -1, SOCIO: -1, INVEST: -1, NAOOP: 1,
}

/**
 * Premissas de NEGÓCIO — definidas pelo cliente, não estimadas do histórico.
 * Entram no lugar do coeficiente medido quando a linha está no modo original.
 * O valor medido continua exposto em `valorAncora` e `valorPeriodo`, para a
 * distância entre a meta e o realizado ficar visível em vez de sumir.
 *
 * CMV 70%: meta informada pelo Sávio em 30/09/2026. Medido no período: 73,4%;
 * nos últimos 3 meses: 71,4%; em ago/26: 67,2%.
 */
export const PREMISSA_PADRAO: Record<string, number> = {
  CMV: 0.70,
}

export interface PremissaEntrada { modo?: ModoLinha; valor?: number }
export interface OrcamentoParams {
  /** meses recentes que definem o nível e os coeficientes (default 3) */
  ancora?: number
  /** amortecimento da tendência, 0–1. 1 = sem amortecer (default 0.85) */
  phi?: number
  /** meses a projetar a partir do próximo (default 7 = até mar/27) */
  horizonte?: number
  /** substitui a tendência estimada, ao mês (ex.: 0.01 = +1% a.m.) */
  crescimento?: number | null
  /** premissas editadas na tela, por linha */
  premissas?: Record<string, PremissaEntrada>
}

export interface Premissa {
  linha: string
  grupo: GrupoLinha
  sinal: 1 | -1
  modo: ModoLinha
  /** fração da receita líquida (modo RECEITA) ou R$/mês (modo FIXO) — o valor EM USO */
  valor: number
  origem: 'padrao' | 'medido' | 'editado'
  /** coeficiente medido na janela-âncora */
  valorAncora: number
  /** coeficiente medido em toda a base */
  valorPeriodo: number
  min: number
  max: number
  desvio: number
  editado: boolean
}
/** Os subtotais de um mês, com a mesma nomenclatura da DRE. */
export interface Subtotais {
  receita: number
  cmv: number
  /** ADM + Pessoal + Logística + Comercial + Impostos */
  despesasOperacionais: number
  ebitda: number
  /** Financeiras + Sócios + Investimentos − Não operacional */
  abaixoEbitda: number
  lucroLiquido: number
}
export interface MesOrcado extends Subtotais {
  mes: string
  ic: { lo: number; hi: number }
  amplitude: number
  fragil: boolean
  linhas: Record<string, number>
}
/**
 * Check-up: o mês já fechou, então dá para cobrar o que o orçamento previu.
 *
 * A previsão é RECONSTRUÍDA com origem travada antes do mês — se o modelo
 * reprevisse setembro depois de setembro fechar, ele treinaria com setembro e
 * acertaria por construção. Aqui ele só vê o que existia até agosto, que é
 * exatamente o número que a tela mostrava antes do fechamento.
 *
 * A diferença de Lucro Líquido é decomposta de forma EXATA (a soma dos efeitos
 * reproduz a diferença ao centavo), separando volume de taxa:
 *
 *   efeito receita           = (Rreal − Rprev) × (1 + Σ sinal·razão prevista das linhas variáveis)
 *   efeito de linha variável = sinal × (razão real − razão prevista) × Rreal
 *   efeito de linha fixa     = sinal × (valor real − valor previsto)
 *
 * O efeito receita é partido em duas parcelas — a das linhas até o EBITDA e a
 * das linhas abaixo dele — para que o subtotal de EBITDA feche sozinho mesmo
 * quando alguém muda uma linha de baixo para "% da receita" na tela.
 */
export interface CheckupLinha {
  linha: string
  grupo: GrupoLinha
  sinal: 1 | -1
  modo: ModoLinha
  premissa: number
  realizado: number
  previstoRS: number
  realizadoRS: number
  /** quanto esta linha tirou (−) ou devolveu (+) de lucro */
  impacto: number
}
export interface Checkup {
  mes: string
  nTreino: number
  receita: { previsto: number; realizado: number; lo: number; hi: number; dentroIC: boolean }
  /** efeito volume até o EBITDA e abaixo dele */
  efeitoReceita: { ateEbitda: number; abaixo: number }
  linhas: CheckupLinha[]
  ebitda: { previsto: number; realizado: number }
  lucroLiquido: { previsto: number; realizado: number; diferenca: number }
  /** soma dos efeitos menos a diferença — tem de ser ~0; é a prova da decomposição */
  residuo: number
  /** o mesmo para o subtotal de EBITDA */
  residuoEbitda: number
}

export interface BacktestPonto {
  mes: string
  nTreino: number
  previsto: number
  real: number
  /** (previsto − real) ÷ real: positivo = previu acima */
  erro: number
  lo: number
  hi: number
  dentroIC: boolean
  lucroPrevisto: number
  lucroReal: number
}
export interface OrcamentoResultado {
  hasData: boolean
  motivo?: string
  base: {
    mesesRealizados: string[]
    ultimoFechado: string
    serieLonga: { n: number; de: string; ate: string }
    /** meses do DreEntry deixados de fora por densidade — título futuro, não realizado */
    descartados: { mes: string; lancamentos: number }[]
    corteDensidade: number
  }
  /** realizado, com os mesmos subtotais da DRE */
  historico: ({ mes: string } & Subtotais)[]
  params: Required<Omit<OrcamentoParams, 'premissas' | 'crescimento'>> & { crescimento: number | null }
  tendencia: { mensalEstimada: number; mensalUsada: number; phi: number; fonte: string }
  sazonalidade: { mes: number; fator: number; obs: number; fragil: boolean }[]
  premissas: Premissa[]
  backtest: BacktestPonto[]
  checkups: Checkup[]
  metricas: { mapeReceita: number; coberturaIC: string; mapeLucro: number; nTestes: number; tCritico: number; grausLiberdade: number }
  meses: MesOrcado[]
  totais: Subtotais
}

const MES_LABEL = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const key = (y: number, m: number) => y * 100 + m
const rotulo = (k: number) => `${MES_LABEL[k % 100]}/${String(Math.floor(k / 100)).slice(2)}`
const proximo = (k: number) => { let y = Math.floor(k / 100); let m = (k % 100) + 1; if (m > 12) { m = 1; y++ } return key(y, m) }
const horizonteEntre = (a: number, b: number) =>
  (Math.floor(b / 100) * 12 + (b % 100)) - (Math.floor(a / 100) * 12 + (a % 100))

const media = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0)
const desvioPadrao = (a: number[]) => {
  if (a.length < 2) return 0
  const m = media(a)
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1))
}

// ── t de Student bilateral a 95% (quantil 0,975) ──────────────────────────
// Tabela completa de 1 a 30 graus de liberdade, com 6 casas, e interpolação
// em 1/gl acima disso. A tabela anterior tinha 3 casas e BURACOS (17, 19,
// 21–29) que caíam num fallback de 12,706 — quando a base chegasse a 19
// meses, o intervalo abriria umas 6 vezes sem motivo nenhum.
const T975 = [NaN,
  12.706205, 4.302653, 3.182446, 2.776445, 2.570582, 2.446912, 2.364624, 2.306004, 2.262157, 2.228139,
  2.200985, 2.178813, 2.160369, 2.144787, 2.131450, 2.119905, 2.109816, 2.100922, 2.093024, 2.085963,
  2.079614, 2.073873, 2.068658, 2.063899, 2.059539, 2.055529, 2.051831, 2.048407, 2.045230, 2.042272]
const T975_ALTO: Array<[number, number]> = [[30, 2.042272], [40, 2.021075], [60, 2.000298], [120, 1.979930], [Infinity, 1.959964]]
export function tcrit(gl: number): number {
  const g = Math.max(1, Math.floor(gl))
  if (g <= 30) return T975[g]
  for (let i = 0; i < T975_ALTO.length - 1; i++) {
    const [g0, t0] = T975_ALTO[i]
    const [g1, t1] = T975_ALTO[i + 1]
    if (g <= g1) {
      const x0 = 1 / g0, x1 = g1 === Infinity ? 0 : 1 / g1, x = 1 / g
      return t0 + ((t1 - t0) * (x - x0)) / (x1 - x0)
    }
  }
  return 1.959964
}

const SUB_ZERO: Subtotais = { receita: 0, cmv: 0, despesasOperacionais: 0, ebitda: 0, abaixoEbitda: 0, lucroLiquido: 0 }
const VAZIO: OrcamentoResultado = {
  hasData: false,
  base: { mesesRealizados: [], ultimoFechado: '', serieLonga: { n: 0, de: '', ate: '' }, descartados: [], corteDensidade: 0 },
  historico: [],
  params: { ancora: 3, phi: 0.85, horizonte: 7, crescimento: null },
  tendencia: { mensalEstimada: 0, mensalUsada: 0, phi: 0.85, fonte: '' },
  sazonalidade: [], premissas: [], backtest: [], checkups: [],
  metricas: { mapeReceita: 0, coberturaIC: '0/0', mapeLucro: 0, nTestes: 0, tCritico: 0, grausLiberdade: 0 },
  meses: [], totais: SUB_ZERO,
}

/** Subtotais de um mês a partir do valor de cada linha — fórmulas de /api/dre. */
function subtotais(receita: number, valor: (L: string) => number, linhas: string[]): Subtotais {
  const cmv = linhas.includes('CMV') ? valor('CMV') : 0
  const despesasOperacionais = linhas.filter(L => GRUPO[L] === 'OPERACIONAL').reduce((s, L) => s + valor(L), 0)
  const ebitda = receita - cmv - despesasOperacionais
  // abaixo do EBITDA com sinal da DRE: custo soma aqui, não operacional subtrai
  const abaixoEbitda = linhas.filter(L => GRUPO[L] === 'ABAIXO').reduce((s, L) => s - SINAL[L] * valor(L), 0)
  return { receita, cmv, despesasOperacionais, ebitda, abaixoEbitda, lucroLiquido: ebitda - abaixoEbitda }
}

export async function calcularOrcamento(opts: OrcamentoParams = {}): Promise<OrcamentoResultado> {
  const ancora = Math.max(1, Math.min(12, Math.round(opts.ancora ?? 3)))
  const phi = Math.max(0, Math.min(1, opts.phi ?? 0.85))
  const horizonte = Math.max(1, Math.min(12, Math.round(opts.horizonte ?? 7)))
  const params = { ancora, phi, horizonte, crescimento: opts.crescimento ?? null }

  const [dreRows, ajustes, demRows, densidade] = await Promise.all([
    prisma.dreEntry.groupBy({ by: ['year', 'month', 'line'], _sum: { amount: true } }),
    prisma.dreAjuste.groupBy({ by: ['year', 'month', 'line'], _sum: { amount: true } }),
    prisma.demandEntry.groupBy({ by: ['year', 'month'], _sum: { valor: true } }),
    prisma.dreEntry.groupBy({ by: ['year', 'month'], _count: { _all: true } }),
  ])
  if (!dreRows.length) return { ...VAZIO, params, motivo: 'Sem DRE importada.' }

  const dre = new Map<number, Record<string, number>>()
  const somar = (y: number, m: number, line: string, v: number) => {
    const k = key(y, m)
    if (!dre.has(k)) dre.set(k, {})
    const o = dre.get(k)!
    o[line] = (o[line] ?? 0) + v
  }
  dreRows.forEach(r => somar(r.year, r.month, r.line, r._sum.amount ?? 0))
  ajustes.forEach(r => somar(r.year, r.month, r.line, r._sum.amount ?? 0))
  /** valor da linha no mês como a DRE o usa: Financeiras líquidas de juros recebidos */
  const valorReal = (k: number, L: string) => {
    const o = dre.get(k)!
    return L === 'FIN' ? (o.FIN ?? 0) - (o.JUROS ?? 0) : (o[L] ?? 0)
  }

  // ── quais meses estão FECHADOS ──────────────────────────────────────────
  // Regra única de lib/dre-meses (a mesma da DRE e do Controle de Compras):
  // anterior ao corrente E com o razão inteiro. O import do CashFlow traz
  // TÍTULOS FUTUROS — a receber e a pagar —, então meses à frente aparecem no
  // DreEntry com receita E despesa; testar "tem despesa lançada" não separa.
  const hoje = new Date()
  const kAtual = key(hoje.getUTCFullYear(), hoje.getUTCMonth() + 1)
  const contaDe = new Map<string, number>()
  densidade.forEach(r => contaDe.set(chaveMes(r.year, r.month), r._count._all))
  const classif = classificarMeses(contaDe, hoje)
  const ym = (k: number) => chaveMes(Math.floor(k / 100), k % 100)
  const candidatos = Array.from(dre.keys()).filter(k => k < kAtual).sort((a, b) => a - b)
  const corteDensidade = classif.corte
  const meses = candidatos.filter(k => classif.status[ym(k)] === 'fechado')
  const descartados = candidatos
    .filter(k => classif.status[ym(k)] !== 'fechado')
    .map(k => ({ mes: rotulo(k), lancamentos: classif.contagem[ym(k)] ?? 0 }))
  if (meses.length < 4) {
    return { ...VAZIO, params, motivo: `São precisos ao menos 4 meses fechados de DRE; há ${meses.length}.` }
  }
  const recLiq = (k: number) => (dre.get(k)!.RECEITA ?? 0) - (dre.get(k)!.DEDUCAO ?? 0)

  // ── sazonalidade e tendência: série longa de vendas ──
  const ultimoFechado = meses[meses.length - 1]
  const dem = demRows
    .map(r => ({ k: key(r.year, r.month), m: r.month, v: r._sum.valor ?? 0 }))
    .filter(r => r.k <= ultimoFechado && r.v > 0)
    .sort((a, b) => a.k - b.k)

  const sazonal: Record<number, { s: number; n: number }> = {}
  let gLog = 0
  if (dem.length >= 6) {
    const yl = dem.map(r => Math.log(r.v))
    const ti = dem.map((_, i) => i)
    const mt = media(ti), my = media(yl)
    const den = ti.reduce((s, t) => s + (t - mt) ** 2, 0)
    gLog = den > 0 ? ti.reduce((s, t, i) => s + (t - mt) * (yl[i] - my), 0) / den : 0
    const a0 = my - gLog * mt
    const res = yl.map((v, i) => v - (a0 + gLog * i))
    for (let m = 1; m <= 12; m++) {
      const rs = dem.map((r, i) => (r.m === m ? res[i] : null)).filter((v): v is number => v != null)
      sazonal[m] = { s: rs.length ? media(rs) : 0, n: rs.length }
    }
    const centro = media(Object.values(sazonal).map(o => o.s))
    for (let m = 1; m <= 12; m++) sazonal[m].s -= centro
  } else {
    for (let m = 1; m <= 12; m++) sazonal[m] = { s: 0, n: 0 }
  }
  const fatorSaz = (k: number) => Math.exp(sazonal[k % 100]?.s ?? 0)
  const gEstimado = Math.exp(gLog) - 1
  const gUsado = params.crescimento ?? gEstimado

  // ── nível ancorado + tendência amortecida ──
  const ajustar = (treino: number[]) => {
    const dessaz = treino.map(k => recLiq(k) / fatorSaz(k))
    const nivel = media(dessaz.slice(-ancora))
    const ult = treino.length - 1
    // resíduo medido contra nível+tendência, não contra o nível achatado
    const rel = dessaz.map((v, i) => {
      let cr = 1
      for (let j = 1; j <= ult - i; j++) cr *= 1 + gUsado * Math.pow(phi, j)
      return Math.log((v * cr) / nivel)
    })
    return { nivel, sigma: Math.max(desvioPadrao(rel), 0.02), gl: Math.max(1, treino.length - 2), ultimo: treino[ult] }
  }
  const preverReceita = (mod: ReturnType<typeof ajustar>, kAlvo: number) => {
    const h = horizonteEntre(mod.ultimo, kAlvo)
    let cr = 1
    for (let i = 1; i <= h; i++) cr *= 1 + gUsado * Math.pow(phi, i)
    const p = mod.nivel * cr * fatorSaz(kAlvo)
    const se = mod.sigma * Math.sqrt(Math.max(h, 1))
    const t = tcrit(mod.gl)
    return { p, lo: p * Math.exp(-t * se), hi: p * Math.exp(t * se) }
  }

  // ── coeficientes por linha, sobre a janela-âncora ──
  const linhasPresentes = Object.keys(PRIOR).filter(L => meses.some(k => Math.abs(valorReal(k, L)) > 0))
  const coefDe = (janela: number[]) => {
    const somaRec = janela.reduce((s, k) => s + recLiq(k), 0)
    const out: Record<string, { modo: ModoLinha; valor: number }> = {}
    linhasPresentes.forEach(L => {
      const vals = janela.map(k => valorReal(k, L))
      out[L] = PRIOR[L] === 'RECEITA'
        ? { modo: 'RECEITA', valor: somaRec > 0 ? vals.reduce((s, v) => s + v, 0) / somaRec : 0 }
        : { modo: 'FIXO', valor: media(vals) }
    })
    return out
  }
  /** aplica as premissas de negócio por cima do que foi medido */
  const comPadrao = (medido: Record<string, { modo: ModoLinha; valor: number }>) => {
    const o = { ...medido }
    Object.entries(PREMISSA_PADRAO).forEach(([L, v]) => {
      if (o[L] && o[L].modo === 'RECEITA') o[L] = { modo: 'RECEITA', valor: v }
    })
    return o
  }
  const coefAncora = coefDe(meses.slice(-ancora))
  const coefPeriodo = coefDe(meses)

  // premissas finais: âncora, sobreposta pela meta de negócio e pelo que a tela editou
  const premissas: Premissa[] = linhasPresentes.map(L => {
    const base = coefAncora[L]
    const ed = opts.premissas?.[L]
    const modo = ed?.modo ?? base.modo
    const editado = ed?.valor != null && Number.isFinite(ed.valor)
    const medido = modo === base.modo ? base.valor : coefPeriodo[L].valor
    const padrao = modo === PRIOR[L] ? PREMISSA_PADRAO[L] : undefined
    const valor = editado ? (ed!.valor as number) : (padrao ?? medido)
    const origem: Premissa['origem'] = editado ? 'editado' : padrao != null ? 'padrao' : 'medido'
    const serie = meses.map(k => (PRIOR[L] === 'RECEITA' ? valorReal(k, L) / recLiq(k) : valorReal(k, L)))
    return {
      linha: L, grupo: GRUPO[L], sinal: SINAL[L], modo, valor, origem,
      valorAncora: base.valor, valorPeriodo: coefPeriodo[L].valor,
      min: Math.min(...serie), max: Math.max(...serie), desvio: desvioPadrao(serie), editado,
    }
  })
  const emUso = Object.fromEntries(premissas.map(p => [p.linha, p]))
  const aplicar = (L: string, receita: number) => {
    const p = emUso[L]
    if (!p) return 0
    return p.modo === 'RECEITA' ? p.valor * receita : p.valor
  }

  // ── check-up: todo mês fechado que dava para prever, com a diferença aberta ──
  const checkups: Checkup[] = []
  for (let idx = 4; idx < meses.length; idx++) {
    const treino = meses.slice(0, idx)
    const alvo = meses[idx]
    const mod = ajustar(treino)
    const f = preverReceita(mod, alvo)
    // mesmas premissas do orçamento, inclusive as de negócio: o check-up cobra
    // o que o orçamento dizia, e o orçamento diz CMV 70%
    const cf = comPadrao(coefDe(treino.slice(-ancora)))
    const rReal = recLiq(alvo)
    const prevDe = (L: string, R: number) => (cf[L] ? (cf[L].modo === 'RECEITA' ? cf[L].valor * R : cf[L].valor) : 0)

    // efeito volume, em duas parcelas: até o EBITDA e abaixo dele
    const pesoVar = (grupos: GrupoLinha[]) => linhasPresentes
      .filter(L => grupos.includes(GRUPO[L]) && cf[L]?.modo === 'RECEITA')
      .reduce((s, L) => s + SINAL[L] * cf[L].valor, 0)
    const efeitoReceita = {
      ateEbitda: (rReal - f.p) * (1 + pesoVar(['CMV', 'OPERACIONAL'])),
      abaixo: (rReal - f.p) * pesoVar(['ABAIXO']),
    }

    const linhas: CheckupLinha[] = linhasPresentes.map(L => {
      const modo = cf[L]?.modo ?? PRIOR[L]
      const premissa = cf[L]?.valor ?? 0
      const realizadoRS = valorReal(alvo, L)
      const realizado = modo === 'RECEITA' ? (rReal > 0 ? realizadoRS / rReal : 0) : realizadoRS
      const previstoRS = prevDe(L, f.p)
      // variável: diferença de razão sobre a receita REAL, para não contar duas
      // vezes o que o efeito receita já explicou
      const impacto = modo === 'RECEITA'
        ? SINAL[L] * (realizado - premissa) * rReal
        : SINAL[L] * (realizadoRS - premissa)
      return { linha: L, grupo: GRUPO[L], sinal: SINAL[L], modo, premissa, realizado, previstoRS, realizadoRS, impacto }
    })

    const sp = subtotais(f.p, L => prevDe(L, f.p), linhasPresentes)
    const sr = subtotais(rReal, L => valorReal(alvo, L), linhasPresentes)
    const diferenca = sr.lucroLiquido - sp.lucroLiquido
    const somaTudo = efeitoReceita.ateEbitda + efeitoReceita.abaixo + linhas.reduce((s, l) => s + l.impacto, 0)
    const somaEbitda = efeitoReceita.ateEbitda + linhas.filter(l => l.grupo !== 'ABAIXO').reduce((s, l) => s + l.impacto, 0)

    checkups.push({
      mes: rotulo(alvo), nTreino: treino.length,
      receita: { previsto: f.p, realizado: rReal, lo: f.lo, hi: f.hi, dentroIC: rReal >= f.lo && rReal <= f.hi },
      efeitoReceita, linhas,
      ebitda: { previsto: sp.ebitda, realizado: sr.ebitda },
      lucroLiquido: { previsto: sp.lucroLiquido, realizado: sr.lucroLiquido, diferenca },
      residuo: somaTudo - diferenca,
      residuoEbitda: somaEbitda - (sr.ebitda - sp.ebitda),
    })
  }
  checkups.reverse()   // mais recente primeiro

  // o backtest é a leitura resumida dos três check-ups mais recentes
  const backtest: BacktestPonto[] = checkups.slice(0, 3).map(c => ({
    mes: c.mes, nTreino: c.nTreino, previsto: c.receita.previsto, real: c.receita.realizado,
    erro: c.receita.realizado !== 0 ? (c.receita.previsto - c.receita.realizado) / c.receita.realizado : 0,
    lo: c.receita.lo, hi: c.receita.hi, dentroIC: c.receita.dentroIC,
    lucroPrevisto: c.lucroLiquido.previsto, lucroReal: c.lucroLiquido.realizado,
  })).reverse()
  const mapeReceita = backtest.length ? media(backtest.map(b => Math.abs(b.erro))) : 0
  const comLucro = backtest.filter(b => b.lucroReal !== 0)
  const mapeLucro = comLucro.length ? media(comLucro.map(b => Math.abs((b.lucroPrevisto - b.lucroReal) / b.lucroReal))) : 0

  // ── projeção ──
  const mod = ajustar(meses)
  const mesesOrcados: MesOrcado[] = []
  let k = ultimoFechado
  for (let i = 0; i < horizonte; i++) {
    k = proximo(k)
    const f = preverReceita(mod, k)
    const linhas: Record<string, number> = {}
    linhasPresentes.forEach(L => { linhas[L] = aplicar(L, f.p) })
    const amplitude = f.p > 0 ? (f.hi - f.lo) / f.p / 2 : 0
    mesesOrcados.push({
      mes: rotulo(k), ic: { lo: f.lo, hi: f.hi }, amplitude,
      fragil: amplitude > 0.4,
      linhas,
      ...subtotais(f.p, L => linhas[L], linhasPresentes),
    })
  }
  const somaCampo = (c: keyof Subtotais) => mesesOrcados.reduce((s, m) => s + m[c], 0)

  return {
    hasData: true,
    base: {
      mesesRealizados: meses.map(rotulo),
      ultimoFechado: rotulo(ultimoFechado),
      serieLonga: { n: dem.length, de: dem.length ? rotulo(dem[0].k) : '', ate: dem.length ? rotulo(dem[dem.length - 1].k) : '' },
      descartados, corteDensidade: Math.round(corteDensidade),
    },
    historico: meses.map(kk => ({ mes: rotulo(kk), ...subtotais(recLiq(kk), L => valorReal(kk, L), linhasPresentes) })),
    params,
    tendencia: {
      mensalEstimada: gEstimado, mensalUsada: gUsado, phi,
      fonte: dem.length >= 6 ? `série de vendas · ${dem.length} meses` : 'sem série longa suficiente',
    },
    sazonalidade: Array.from({ length: 12 }, (_, i) => {
      const m = i + 1
      return { mes: m, fator: Math.exp(sazonal[m]?.s ?? 0), obs: sazonal[m]?.n ?? 0, fragil: (sazonal[m]?.n ?? 0) < 2 }
    }),
    premissas,
    backtest,
    checkups,
    metricas: {
      mapeReceita, mapeLucro,
      coberturaIC: `${backtest.filter(b => b.dentroIC).length}/${backtest.length}`,
      nTestes: backtest.length,
      tCritico: tcrit(mod.gl), grausLiberdade: mod.gl,
    },
    meses: mesesOrcados,
    totais: {
      receita: somaCampo('receita'), cmv: somaCampo('cmv'),
      despesasOperacionais: somaCampo('despesasOperacionais'), ebitda: somaCampo('ebitda'),
      abaixoEbitda: somaCampo('abaixoEbitda'), lucroLiquido: somaCampo('lucroLiquido'),
    },
  }
}
