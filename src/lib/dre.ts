export type DRELineType = 'section' | 'group' | 'account' | 'subtotal' | 'breakeven' | 'transfer'

export interface DRELine {
  type: DRELineType
  label: string
  sublabel?: string
  value: number
  indent: number
  highlight: boolean
}

export interface DREData {
  month: number
  year: number
  lines: DRELine[]
  receitaBruta: number
  receitaLiquida: number
  margemBruta: number
  margemContribuicao: number
  resultadoBruto: number
  resultadoOperacional: number
  ebitda: number
  lucroAposInvestimentos: number
  lucroAntesImpostos: number
  resultadoLiquido: number
  margemBrutaPct: number
  margemContribuicaoPct: number
  margemEbitdaPct: number
  margemOperacionalPct: number
  margemLiquidaPct: number
}

export type DreSection =
  | 'RECEITA_OP'
  | 'DEDUCAO'
  | 'CUSTO_VAR'
  | 'DESPESA_FIXA'
  | 'INVESTIMENTO'
  | 'RECEITA_NOP'
  | 'DESPESA_NOP'
  | 'IMPOSTO_LUCRO'
  | 'NEUTRO'

export interface DreGroupConfig {
  name: string
  section: DreSection
  sortOrder: number
}

interface AccEntry { name: string; code: string; value: number }

// Sections grouped per "block" of the DRE — used to decide where each
// configured group appears. Each block also has a label override per group.
const SECTION_DEFS: { section: DreSection; sign: 1 | -1 }[] = [
  { section: 'RECEITA_OP',    sign: +1 },
  { section: 'DEDUCAO',       sign: -1 },
  { section: 'CUSTO_VAR',     sign: -1 },
  { section: 'DESPESA_FIXA',  sign: -1 },
  { section: 'INVESTIMENTO',  sign: -1 },
  { section: 'RECEITA_NOP',   sign: +1 },
  { section: 'DESPESA_NOP',   sign: -1 },
  { section: 'IMPOSTO_LUCRO', sign: -1 },
]

// Default fallback config — used if caller didn't pass dreGroups (legacy)
const DEFAULT_GROUPS: DreGroupConfig[] = [
  { name: 'Receita Operacional',       section: 'RECEITA_OP',    sortOrder:  1 },
  { name: 'Deduções sobre a Venda',    section: 'DEDUCAO',       sortOrder:  2 },
  { name: 'Custo do Produto/Serviço',  section: 'CUSTO_VAR',     sortOrder:  3 },
  { name: 'Despesa Variável',          section: 'CUSTO_VAR',     sortOrder:  4 },
  { name: 'Despesas Administrativas',  section: 'DESPESA_FIXA',  sortOrder:  5 },
  { name: 'Despesas Financeiras',      section: 'DESPESA_FIXA',  sortOrder:  6 },
  { name: 'Despesas com Pessoal',      section: 'DESPESA_FIXA',  sortOrder:  7 },
  { name: 'Despesas com Marketing',    section: 'DESPESA_FIXA',  sortOrder:  8 },
  { name: 'Investimentos',             section: 'INVESTIMENTO',  sortOrder:  9 },
  { name: 'Receita Não Operacional',   section: 'RECEITA_NOP',   sortOrder: 10 },
  { name: 'Despesas Não Operacionais', section: 'DESPESA_NOP',   sortOrder: 11 },
  { name: 'Impostos',                  section: 'IMPOSTO_LUCRO', sortOrder: 12 },
]

export function calcDRE(
  transactions: Array<{ amount: number; account: { type: string; dreGroup: string; name: string; code: string } | null }>,
  month: number,
  year: number,
  dreGroups: DreGroupConfig[] = DEFAULT_GROUPS,
): DREData {
  // Aggregate by group name (absolute values) and per-account inside each group
  const byGroup: Record<string, number> = {}
  const byAccount: Record<string, AccEntry[]> = {}
  let transferSaida = 0
  let transferEntrada = 0

  // Index group → section
  const sectionOf: Record<string, DreSection> = {}
  for (const g of dreGroups) sectionOf[g.name] = g.section

  for (const tx of transactions) {
    if (!tx.account) continue
    const { dreGroup, name, code } = tx.account
    const section = sectionOf[dreGroup]

    if (section === 'NEUTRO' || dreGroup === 'Transferência entre Contas') {
      if (tx.amount < 0) transferSaida += Math.abs(tx.amount)
      else transferEntrada += tx.amount
      continue
    }
    if (!section) continue  // unknown group — ignore in totals

    const val = Math.abs(tx.amount)
    byGroup[dreGroup] = (byGroup[dreGroup] || 0) + val
    if (!byAccount[dreGroup]) byAccount[dreGroup] = []
    const ex = byAccount[dreGroup].find(a => a.name === name)
    if (ex) { ex.value += val } else { byAccount[dreGroup].push({ name, code, value: val }) }
  }

  // Total per section
  const sectionTotal = (s: DreSection) =>
    dreGroups
      .filter(g => g.section === s)
      .reduce((sum, g) => sum + (byGroup[g.name] || 0), 0)

  const receitaOp    = sectionTotal('RECEITA_OP')
  const deducoes     = sectionTotal('DEDUCAO')
  const receitaLiq   = receitaOp - deducoes

  const custoProd    = dreGroups
    .filter(g => g.section === 'CUSTO_VAR' && /custo do produto|cmv/i.test(g.name))
    .reduce((sum, g) => sum + (byGroup[g.name] || 0), 0)
  const custosVar    = sectionTotal('CUSTO_VAR')
  const margemBruta  = receitaLiq - custoProd
  const margem       = receitaLiq - custosVar

  const custosFixos  = sectionTotal('DESPESA_FIXA')
  const lucroOp      = margem - custosFixos

  const invest       = sectionTotal('INVESTIMENTO')
  const lucroAposInv = lucroOp - invest

  const recNaoOp     = sectionTotal('RECEITA_NOP')
  const despNaoOp    = sectionTotal('DESPESA_NOP')
  const lucroAntesIR = lucroAposInv + recNaoOp - despNaoOp

  const impostos     = sectionTotal('IMPOSTO_LUCRO')
  const lucroLiq     = lucroAntesIR - impostos

  // Breakeven points
  const mcPct = receitaOp > 0 ? margem / receitaOp : 0
  const peo   = mcPct > 0 ? custosFixos / mcPct : 0
  const pei   = mcPct > 0 ? (custosFixos + invest) / mcPct : 0
  const pef   = mcPct > 0 ? (custosFixos + invest + Math.max(0, despNaoOp - recNaoOp)) / mcPct : 0

  const depreciacao = dreGroups
    .filter(g => /deprecia|amortiza/i.test(g.name))
    .reduce((sum, g) => sum + (byGroup[g.name] || 0), 0)
  const ebitda = lucroOp + depreciacao
  const pct = (n: number) => receitaLiq > 0 ? (n / receitaLiq) * 100 : 0

  // Generate lines — order matters. We iterate the section groups in
  // sortOrder, but section *order* is fixed (RECEITA_OP first, then DEDUCAO, etc).
  const accts = (groupName: string, sign: 1 | -1, indent: number): DRELine[] =>
    (byAccount[groupName] || [])
      .filter(a => a.value > 0)
      .sort((a, b) => a.code.localeCompare(b.code))
      .map(a => ({
        type: 'account' as const,
        label: a.name,
        value: sign * a.value,
        indent,
        highlight: false,
      }))

  const groupsInSection = (s: DreSection) =>
    dreGroups.filter(g => g.section === s).sort((a, b) => a.sortOrder - b.sortOrder)

  const lines: DRELine[] = []

  // ── Receitas
  for (const g of groupsInSection('RECEITA_OP')) {
    lines.push({ type: 'group', label: g.name, value: byGroup[g.name] || 0, indent: 0, highlight: false })
    lines.push(...accts(g.name, +1, 1))
  }
  for (const g of groupsInSection('DEDUCAO')) {
    lines.push({ type: 'group', label: g.name, sublabel: '(-) impostos, taxas e tarifas', value: -(byGroup[g.name] || 0), indent: 0, highlight: false })
    lines.push(...accts(g.name, -1, 1))
  }
  lines.push({ type: 'subtotal', label: '(=) Receita Líquida de Vendas', value: receitaLiq, indent: 0, highlight: true })

  // ── Custos Variáveis
  lines.push({ type: 'section', label: '(-) Custos Variáveis', value: -custosVar, indent: 0, highlight: false })
  for (const g of groupsInSection('CUSTO_VAR')) {
    lines.push({ type: 'group', label: g.name, value: -(byGroup[g.name] || 0), indent: 1, highlight: false })
    lines.push(...accts(g.name, -1, 2))
  }
  lines.push({ type: 'subtotal', label: '(=) Margem de Contribuição', value: margem, indent: 0, highlight: true })
  if (peo > 0) lines.push({ type: 'breakeven', label: '(=) Ponto de Equilíbrio Operacional', sublabel: 'receita mínima para cobrir custos fixos', value: peo, indent: 0, highlight: false })

  // ── Custos Fixos
  lines.push({ type: 'section', label: '(-) Custos Fixos', value: -custosFixos, indent: 0, highlight: false })
  for (const g of groupsInSection('DESPESA_FIXA')) {
    lines.push({ type: 'group', label: g.name, value: -(byGroup[g.name] || 0), indent: 1, highlight: false })
    lines.push(...accts(g.name, -1, 2))
  }
  lines.push({ type: 'subtotal', label: '(=) Lucro Operacional', sublabel: 'EBIT', value: lucroOp, indent: 0, highlight: true })
  if (pei > 0) lines.push({ type: 'breakeven', label: '(=) Ponto de Equilíbrio de Investimentos', value: pei, indent: 0, highlight: false })

  // ── Investimentos
  lines.push({ type: 'section', label: '(-) Investimentos', value: -invest, indent: 0, highlight: false })
  for (const g of groupsInSection('INVESTIMENTO')) {
    lines.push({ type: 'group', label: g.name, value: -(byGroup[g.name] || 0), indent: 1, highlight: false })
    lines.push(...accts(g.name, -1, 2))
  }
  lines.push({ type: 'subtotal', label: '(=) Lucro após os Investimentos', value: lucroAposInv, indent: 0, highlight: true })
  if (pef > 0) lines.push({ type: 'breakeven', label: '(=) Ponto de Equilíbrio Financeiro', value: pef, indent: 0, highlight: false })

  // ── Não operacionais
  lines.push({ type: 'section', label: '(+/-) Outras Receitas e Despesas Não Operacionais', value: recNaoOp - despNaoOp, indent: 0, highlight: false })
  for (const g of groupsInSection('RECEITA_NOP')) {
    lines.push({ type: 'group', label: g.name, value: byGroup[g.name] || 0, indent: 1, highlight: false })
    lines.push(...accts(g.name, +1, 2))
  }
  for (const g of groupsInSection('DESPESA_NOP')) {
    lines.push({ type: 'group', label: g.name, value: -(byGroup[g.name] || 0), indent: 1, highlight: false })
    lines.push(...accts(g.name, -1, 2))
  }
  lines.push({ type: 'subtotal', label: '(=) Lucro antes dos Impostos', value: lucroAntesIR, indent: 0, highlight: true })

  // ── Impostos
  for (const g of groupsInSection('IMPOSTO_LUCRO')) {
    lines.push({ type: 'group', label: g.name, value: -(byGroup[g.name] || 0), indent: 0, highlight: false })
    lines.push(...accts(g.name, -1, 1))
  }
  lines.push({ type: 'subtotal', label: '(=) Lucro Líquido', value: lucroLiq, indent: 0, highlight: true })

  if (transferSaida > 0 || transferEntrada > 0) {
    lines.push({ type: 'transfer', label: 'Transferências entre Contas', sublabel: 'informativo — não contabiliza no resultado', value: 0, indent: 0, highlight: false })
    if (transferSaida > 0)   lines.push({ type: 'transfer', label: 'Saídas de Transferência',   value: -transferSaida,   indent: 1, highlight: false })
    if (transferEntrada > 0) lines.push({ type: 'transfer', label: 'Entradas de Transferência', value:  transferEntrada, indent: 1, highlight: false })
  }

  // suppress unused warning for SECTION_DEFS / sign helper (kept for clarity)
  void SECTION_DEFS

  return {
    month, year, lines,
    receitaBruta: receitaOp,
    receitaLiquida: receitaLiq,
    margemBruta,
    margemContribuicao: margem,
    resultadoBruto: margem,
    resultadoOperacional: lucroOp,
    ebitda,
    lucroAposInvestimentos: lucroAposInv,
    lucroAntesImpostos: lucroAntesIR,
    resultadoLiquido: lucroLiq,
    margemBrutaPct:        pct(margemBruta),
    margemContribuicaoPct: pct(margem),
    margemEbitdaPct:       pct(ebitda),
    margemOperacionalPct:  pct(lucroOp),
    margemLiquidaPct:      pct(lucroLiq),
  }
}

export const MONTH_NAMES = [
  '', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
]
