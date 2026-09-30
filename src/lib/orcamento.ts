/**
 * Orçamento — projeção econométrica da DRE.
 *
 * ── Desenho, e por que é assim ────────────────────────────────────────────
 * A DRE realizada tem POUCOS meses (de set/26 em diante o DreEntry guarda
 * recebível futuro vindo do CashFlow, não realizado). Modelar 12 meses a
 * partir disso por mínimos quadrados abre o intervalo para ±55% já no começo
 * e produz coeficientes sem sentido econômico. Então o modelo é híbrido:
 *
 *   · SAZONALIDADE e TENDÊNCIA vêm da série LONGA de vendas (DemandEntry,
 *     ~20 meses). É a única série com ciclo suficiente.
 *   · NÍVEL vem da DRE realizada, ancorado nos últimos `ancora` meses.
 *   · TENDÊNCIA é AMORTECIDA por `phi` (Gardner–McKenzie): com 8 pontos, uma
 *     reta livre extrapola absurdos a 12 meses.
 *   · INCERTEZA cresce com √h (passeio aleatório), não pela alavancagem do
 *     OLS, que explode fora da amostra.
 *
 * ── O que é previsão e o que é cenário ────────────────────────────────────
 * RECEITA é previsão: o backtest de origem móvel dá MAPE ~4% a um passo, com
 * o real dentro do IC95 nos três meses testados.
 * RESULTADO é CENÁRIO, não previsão. O resultado operacional é uma diferença
 * pequena entre números grandes (CMV come ~73% da receita líquida), então um
 * erro de 1 ponto no CMV vale mais que o resultado do mês inteiro — o MAPE do
 * resultado passa de 600%. As linhas de custo e despesa são PREMISSAS
 * editáveis; o resultado é a consequência aritmética delas.
 *
 * ── Comportamento das linhas ──────────────────────────────────────────────
 * Vem de PRIOR ECONÔMICO, não de teste estatístico. Com n=8 a classificação
 * automática dizia que CMV é custo fixo (a receita variou pouco no período) e
 * a regressão dava IMPOSTOS com inclinação NEGATIVA "significativa" (t=−3,62).
 * O dado estima o coeficiente; o prior decide se ele é % da receita ou valor
 * fixo. Ambos são sobreponíveis pela tela.
 */
import { prisma } from '@/lib/prisma'

export type ModoLinha = 'RECEITA' | 'FIXO'

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
/** Fora do resultado operacional (não operacional e movimento entre empresas). */
const FORA_DO_OPERACIONAL = new Set(['NAOOP', 'INTRAGRUPO'])

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
  modo: ModoLinha
  /** % da receita líquida (modo RECEITA) ou R$/mês (modo FIXO) */
  valor: number
  /** mesmo coeficiente medido em toda a base, para comparar com a âncora */
  valorPeriodo: number
  min: number
  max: number
  desvio: number
  editado: boolean
}
export interface MesOrcado {
  mes: string
  receita: { p: number; lo: number; hi: number }
  amplitude: number
  fragil: boolean
  linhas: Record<string, number>
  cmv: number
  despesas: number
  resultado: number
}
/**
 * Check-up: o mês já fechou, então dá para cobrar o que o orçamento previu.
 *
 * A previsão é RECONSTRUÍDA com origem travada antes do mês — se o modelo
 * reprevisse setembro depois de setembro fechar, ele treinaria com setembro e
 * acertaria por construção. Aqui ele só vê o que existia até agosto, que é
 * exatamente o número que a tela mostrava antes do fechamento.
 *
 * A diferença de resultado é decomposta de forma EXATA (a soma dos efeitos
 * reproduz a diferença até o centavo):
 *
 *   efeito receita  = (Rreal − Rprev) × (1 − premissas variáveis)
 *   efeito de linha variável = −(razão real − razão prevista) × Rreal
 *   efeito de linha fixa     = −(valor real − valor previsto)
 */
export interface CheckupLinha {
  linha: string
  modo: ModoLinha
  /** premissa e realizado na unidade do modo: fração da receita, ou R$ */
  premissa: number
  realizado: number
  previstoRS: number
  realizadoRS: number
  /** quanto esta linha tirou (−) ou devolveu (+) de resultado */
  impacto: number
}
export interface Checkup {
  mes: string
  nTreino: number
  receita: { previsto: number; realizado: number; erro: number; lo: number; hi: number; dentroIC: boolean }
  efeitoReceita: number
  linhas: CheckupLinha[]
  resultado: { previsto: number; realizado: number; diferenca: number }
  /** soma dos efeitos menos a diferença — tem de ser ~0; é a prova da decomposição */
  residuo: number
}

export interface BacktestPonto {
  mes: string
  nTreino: number
  previsto: number
  real: number
  erro: number
  lo: number
  hi: number
  dentroIC: boolean
  resultadoPrevisto: number
  resultadoReal: number
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
  /** realizado, para o gráfico emendar história e projeção */
  historico: { mes: string; receita: number; cmv: number; despesas: number; resultado: number }[]
  params: Required<Omit<OrcamentoParams, 'premissas' | 'crescimento'>> & { crescimento: number | null }
  tendencia: { mensalEstimada: number; mensalUsada: number; phi: number; fonte: string }
  sazonalidade: { mes: number; fator: number; obs: number; fragil: boolean }[]
  premissas: Premissa[]
  backtest: BacktestPonto[]
  /** meses já fechados que o orçamento havia previsto, com a diferença decomposta */
  checkups: Checkup[]
  metricas: { mapeReceita: number; coberturaIC: string; mapeResultado: number; nTestes: number }
  meses: MesOrcado[]
  totais: { receita: number; cmv: number; despesas: number; resultado: number }
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
// t bilateral a 95% — tabela curta evita dependência externa
const TCRIT: Record<number, number> = { 1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145, 15: 2.131, 16: 2.120, 18: 2.101, 20: 2.086, 25: 2.060, 30: 2.042 }
const tcrit = (gl: number) => TCRIT[gl] ?? (gl > 30 ? 1.96 : 12.706)

const VAZIO: OrcamentoResultado = {
  hasData: false,
  base: { mesesRealizados: [], ultimoFechado: '', serieLonga: { n: 0, de: '', ate: '' }, descartados: [], corteDensidade: 0 },
  historico: [],
  params: { ancora: 3, phi: 0.85, horizonte: 7, crescimento: null },
  tendencia: { mensalEstimada: 0, mensalUsada: 0, phi: 0.85, fonte: '' },
  sazonalidade: [], premissas: [], backtest: [], checkups: [],
  metricas: { mapeReceita: 0, coberturaIC: '0/0', mapeResultado: 0, nTestes: 0 },
  meses: [], totais: { receita: 0, cmv: 0, despesas: 0, resultado: 0 },
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

  // ── quais meses estão FECHADOS ──────────────────────────────────────────
  // Duas armadilhas aqui, e as duas já morderam:
  //  1. o mês corrente entra pela metade;
  //  2. o import do CashFlow traz TÍTULOS FUTUROS — a receber e a pagar — então
  //     meses à frente aparecem no DreEntry com receita E despesa. Testar
  //     "tem despesa lançada" não os separa.
  // O que separa é a DENSIDADE: um mês realizado tem o razão inteiro (~1.500
  // lançamentos aqui), um mês futuro tem só os títulos já emitidos (~400).
  const hoje = new Date()
  const kAtual = key(hoje.getUTCFullYear(), hoje.getUTCMonth() + 1)
  const contaDe = new Map<number, number>()
  densidade.forEach(r => contaDe.set(key(r.year, r.month), r._count._all))
  const candidatos = Array.from(dre.keys()).filter(k => k < kAtual).sort((a, b) => a - b)
  const contagens = candidatos.map(k => contaDe.get(k) ?? 0).sort((a, b) => a - b)
  const mediana = contagens.length ? contagens[Math.floor(contagens.length / 2)] : 0
  const corteDensidade = mediana * 0.6
  const meses = candidatos.filter(k => (contaDe.get(k) ?? 0) >= corteDensidade)
  const descartados = candidatos
    .filter(k => (contaDe.get(k) ?? 0) < corteDensidade)
    .map(k => ({ mes: rotulo(k), lancamentos: contaDe.get(k) ?? 0 }))
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
  const linhasPresentes = Object.keys(PRIOR).filter(L => meses.some(k => Math.abs(dre.get(k)![L] ?? 0) > 0))
  const coefDe = (janela: number[]) => {
    const somaRec = janela.reduce((s, k) => s + recLiq(k), 0)
    const out: Record<string, { modo: ModoLinha; valor: number }> = {}
    linhasPresentes.forEach(L => {
      const vals = janela.map(k => dre.get(k)![L] ?? 0)
      out[L] = PRIOR[L] === 'RECEITA'
        ? { modo: 'RECEITA', valor: somaRec > 0 ? vals.reduce((s, v) => s + v, 0) / somaRec : 0 }
        : { modo: 'FIXO', valor: media(vals) }
    })
    return out
  }
  const janelaAncora = meses.slice(-ancora)
  const coefAncora = coefDe(janelaAncora)
  const coefPeriodo = coefDe(meses)

  // premissas finais: âncora, sobreposta pelo que a tela editou
  const premissas: Premissa[] = linhasPresentes.map(L => {
    const base = coefAncora[L]
    const ed = opts.premissas?.[L]
    const modo = ed?.modo ?? base.modo
    const editado = ed?.valor != null && Number.isFinite(ed.valor)
    const valor = editado ? (ed!.valor as number) : (modo === base.modo ? base.valor : coefPeriodo[L].valor)
    const serie = meses.map(k => (PRIOR[L] === 'RECEITA' ? (dre.get(k)![L] ?? 0) / recLiq(k) : (dre.get(k)![L] ?? 0)))
    return {
      linha: L, modo, valor, valorPeriodo: coefPeriodo[L].valor,
      min: Math.min(...serie), max: Math.max(...serie), desvio: desvioPadrao(serie), editado,
    }
  })
  const aplicar = (L: string, receita: number) => {
    const p = premissas.find(x => x.linha === L)
    if (!p) return 0
    return p.modo === 'RECEITA' ? p.valor * receita : p.valor
  }

  // ── check-up: todo mês fechado que dava para prever, com a diferença aberta ──
  // Origem TRAVADA antes do alvo. Reprever o mês depois que ele fecha faria o
  // modelo treinar com o próprio mês e acertar por construção.
  const operacionais = linhasPresentes.filter(L => !FORA_DO_OPERACIONAL.has(L))
  const checkups: Checkup[] = []
  for (let idx = 4; idx < meses.length; idx++) {
    const treino = meses.slice(0, idx)
    const alvo = meses[idx]
    const mod = ajustar(treino)
    const f = preverReceita(mod, alvo)
    const cf = coefDe(treino.slice(-ancora))
    const rReal = recLiq(alvo)

    // parcela da receita que sobra depois das linhas variáveis previstas
    const somaVarPrev = operacionais
      .filter(L => cf[L]?.modo === 'RECEITA')
      .reduce((s, L) => s + cf[L].valor, 0)
    const efeitoReceita = (rReal - f.p) * (1 - somaVarPrev)

    const linhas: CheckupLinha[] = operacionais.map(L => {
      const modo = cf[L]?.modo ?? PRIOR[L]
      const premissa = cf[L]?.valor ?? 0
      const realizadoRS = dre.get(alvo)![L] ?? 0
      const realizado = modo === 'RECEITA' ? (rReal > 0 ? realizadoRS / rReal : 0) : realizadoRS
      const previstoRS = modo === 'RECEITA' ? premissa * f.p : premissa
      // variável: mede a diferença de razão sobre a receita REAL, para não
      // contar duas vezes o que o efeito receita já explicou
      const impacto = modo === 'RECEITA'
        ? -(realizado - premissa) * rReal
        : -(realizadoRS - premissa)
      return { linha: L, modo, premissa, realizado, previstoRS, realizadoRS, impacto }
    })

    const resultadoPrevisto = f.p - operacionais.reduce((s, L) => s + (cf[L] ? (cf[L].modo === 'RECEITA' ? cf[L].valor * f.p : cf[L].valor) : 0), 0)
    const resultadoReal = rReal - operacionais.reduce((s, L) => s + (dre.get(alvo)![L] ?? 0), 0)
    const diferenca = resultadoReal - resultadoPrevisto
    const somaEfeitos = efeitoReceita + linhas.reduce((s, l) => s + l.impacto, 0)

    checkups.push({
      mes: rotulo(alvo), nTreino: treino.length,
      receita: {
        previsto: f.p, realizado: rReal,
        erro: rReal !== 0 ? (f.p - rReal) / rReal : 0,
        lo: f.lo, hi: f.hi, dentroIC: rReal >= f.lo && rReal <= f.hi,
      },
      efeitoReceita, linhas,
      resultado: { previsto: resultadoPrevisto, realizado: resultadoReal, diferenca },
      residuo: somaEfeitos - diferenca,
    })
  }
  checkups.reverse()   // mais recente primeiro

  // o backtest é a leitura resumida dos mesmos pontos
  const backtest: BacktestPonto[] = checkups.slice(0, 3).map(c => ({
    mes: c.mes, nTreino: c.nTreino, previsto: c.receita.previsto, real: c.receita.realizado,
    erro: c.receita.erro, lo: c.receita.lo, hi: c.receita.hi, dentroIC: c.receita.dentroIC,
    resultadoPrevisto: c.resultado.previsto, resultadoReal: c.resultado.realizado,
  })).reverse()
  const mapeReceita = backtest.length ? media(backtest.map(b => Math.abs(b.erro))) : 0
  const mapeResultado = backtest.length
    ? media(backtest.filter(b => b.resultadoReal !== 0).map(b => Math.abs((b.resultadoPrevisto - b.resultadoReal) / b.resultadoReal)))
    : 0

  // ── projeção ──
  const mod = ajustar(meses)
  const mesesOrcados: MesOrcado[] = []
  let k = ultimoFechado
  for (let i = 0; i < horizonte; i++) {
    k = proximo(k)
    const f = preverReceita(mod, k)
    const linhas: Record<string, number> = {}
    linhasPresentes.forEach(L => { linhas[L] = aplicar(L, f.p) })
    const cmv = linhas.CMV ?? 0
    const despesas = linhasPresentes
      .filter(L => L !== 'CMV' && !FORA_DO_OPERACIONAL.has(L))
      .reduce((s, L) => s + linhas[L], 0)
    const amplitude = f.p > 0 ? (f.hi - f.lo) / f.p / 2 : 0
    mesesOrcados.push({
      mes: rotulo(k), receita: f, amplitude,
      fragil: amplitude > 0.4,
      linhas, cmv, despesas, resultado: f.p - cmv - despesas,
    })
  }

  return {
    hasData: true,
    base: {
      mesesRealizados: meses.map(rotulo),
      ultimoFechado: rotulo(ultimoFechado),
      serieLonga: { n: dem.length, de: dem.length ? rotulo(dem[0].k) : '', ate: dem.length ? rotulo(dem[dem.length - 1].k) : '' },
      descartados, corteDensidade: Math.round(corteDensidade),
    },
    historico: meses.map(k => {
      const o = dre.get(k)!
      const cmv = o.CMV ?? 0
      const despesas = linhasPresentes
        .filter(L => L !== 'CMV' && !FORA_DO_OPERACIONAL.has(L))
        .reduce((s, L) => s + (o[L] ?? 0), 0)
      return { mes: rotulo(k), receita: recLiq(k), cmv, despesas, resultado: recLiq(k) - cmv - despesas }
    }),
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
      mapeReceita, mapeResultado,
      coberturaIC: `${backtest.filter(b => b.dentroIC).length}/${backtest.length}`,
      nTestes: backtest.length,
    },
    meses: mesesOrcados,
    totais: {
      receita: mesesOrcados.reduce((s, m) => s + m.receita.p, 0),
      cmv: mesesOrcados.reduce((s, m) => s + m.cmv, 0),
      despesas: mesesOrcados.reduce((s, m) => s + m.despesas, 0),
      resultado: mesesOrcados.reduce((s, m) => s + m.resultado, 0),
    },
  }
}
