/**
 * Fonte ÚNICA da DRE a partir do CashFlow Analítico (razão de caixa da contabilidade).
 * Cobre os dois lados — receita (TIPO E) e despesa (TIPO S) — e reaplica as
 * depurações definidas com o cliente, que não existem na classificação bruta:
 *
 *   · Veículo FCA (financiamento)  → principal em Investimentos, juros em Financeiras
 *   · Multmunde (empresa do grupo) → memo intragrupo, fora do resultado
 *   · Transferências entre lojas   → excluídas
 *   · Reembolso a cliente          → líquido (saídas − entradas) nas Deduções
 *   · Orga Log                     → mercadoria (laboratório fatura pela logística)
 *   · Juros recebidos              → linha JUROS (abatida nas Financeiras pela /api/dre)
 */
import * as XLSX from 'xlsx'

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()
const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim()
const serial = (v: unknown): Date | null => { const n = Number(v); return (!isNaN(n) && n > 40000 && n < 60000) ? new Date(Math.round((n - 25569) * 86400 * 1000)) : null }

// Filial do arquivo → unidade canônica da DRE
const UNIT: Record<string, string> = {
  'MATRIZ RB': 'MM - RIO BONITO',
  'RIO BONITO': 'VS - RIO BONITO',
  '3 RIOS': 'VS - TRÊS RIOS',
  'QUATIS 2': 'VS - QUATIS',
  'APERIBE': 'VS - APERIBÉ',
  'SETE LAGOAS': 'MM - 7 LAGOAS',
}
const unitOf = (f: string) => UNIT[norm(f)] ?? clean(f) ?? 'CONSOLIDADO'

export interface CfDreEntry {
  unit: string; kind: string; line: string; sub: string
  supplier: string | null; supplierCode: string | null
  year: number; month: number; amount: number
}

/** Classifica um lançamento do CashFlow numa linha da DRE. */
function classify(path: string[], hist: string, tipo: 'E' | 'S'): { line: string; sub: string } | null {
  const has = (kw: string) => path.some(x => x.includes(kw))
  const W = norm(hist)
  const last = [...path].reverse().find(Boolean) ?? '—'

  if (tipo === 'E') {
    if (has('REEMBOLSO PARA CLIENTE')) return { line: 'REEMBIN', sub: 'Reembolso recebido de cliente' }
    if (has('DEPOSITO C/C') || has('TRANSFERENCIA ENTRE LOJAS')) return null
    if (has('ENTRADA POR EMPRESTIMOS') || has('RECUPERACAO')) return { line: 'NAOOP', sub: last }
    if (has('JUROS')) return { line: 'JUROS', sub: 'Juros Recebidos de Clientes' }
    // recebimento operacional
    const sub = has('CONTAS A RECEBER') ? 'Recebimentos de Clientes (títulos)'
      : has('VENDAS') ? 'Vendas à Vista / Balcão'
      : has('CHEQUE') ? 'Recebimento de Cheques' : last
    return { line: 'RECEITA', sub }
  }

  // ── SAÍDAS ──
  if (has('DEPOSITO C/C') || has('TRANSFERENCIA ENTRE LOJAS')) return null   // transferência: fora
  if (W.includes('MULTMUNDE') || W.includes('MULTIMUNDO')) return { line: 'INTRAGRUPO', sub: 'Transferências Multmunde' }
  if (W.includes('FCA FIAT') || W.includes('FIAT CHRYSLER')) {
    return W.includes('JUROS') ? { line: 'FIN', sub: 'Juros de financiamento (veículo)' }
                               : { line: 'INVEST', sub: 'Veículo financiado (principal)' }
  }
  if (has('FORNECEDOR MERCADORIAS')) return { line: 'CMV', sub: 'Compras de Mercadoria (fornecedores)' }
  if (has('COMPRA DE VEICULOS')) return { line: 'INVEST', sub: 'Compra de Veículos' }
  if (has('LUCROS DISTRIBUIDOS')) return { line: 'SOCIO', sub: last }
  if (has('REEMBOLSO PARA CLIENTE')) return { line: 'DEDUCAO', sub: 'Reembolso a Cliente' }
  if (has('PAGAMENTO EMPRESTIMOS')) return { line: 'FIN', sub: 'Pagamento de Empréstimos' }
  if (has('COM PESSOAL')) return { line: 'PESSOAL', sub: last }
  if (has('COMERCIAL')) return { line: 'COM', sub: last }
  if (has('LOGISTICA') || has('COM VEICULO')) return { line: 'LOG', sub: last }
  if (has('TRIBUTOS') || has('IRPJ') || has('DIFAL') || has('PARCELAMENTO DE IMPOSTOS')) return { line: 'IMPOSTOS', sub: last }
  if (has('BANCO') || has('TARIFA')) return { line: 'FIN', sub: last }
  if (has('DIFERENCA DO CAIXA') || has('DIFERENCA DE CAIXA')) return { line: 'DIFCAIXA', sub: last }
  if (has('ADMINISTRATIV') || has('DESP ADM')) return { line: 'ADM', sub: last }
  return { line: 'ADM', sub: last }
}

export function isCashflowAnaliticoFile(buf: ArrayBuffer): boolean {
  try {
    const wb = XLSX.read(buf, { type: 'array' })
    const head = (XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, blankrows: false })[0] || []).map(norm)
    return head.includes('FILIAL') && head.includes('TIPO') && head.some(h => h.startsWith('CLASSIF_CONTABIL'))
  } catch { return false }
}

export function buildDreFromCashflow(buffer: ArrayBuffer, maxMonth?: { year: number; month: number }): {
  entries: CfDreEntry[]; months: string[]; rows: number; totalE: number; totalS: number
} {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const m = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, blankrows: false })
  const H = (m[0] || []).map(h => norm(h))
  const col = (n: string) => H.indexOf(n)
  const iFil = col('FILIAL'), iData = col('DATA'), iHist = col('HISTORICO'), iTipo = col('TIPO'), iVal = col('VALOR')
  const iCs = [1, 2, 3, 4, 5, 6].map(k => col('CLASSIF_CONTABIL(' + k + ')')).filter(i => i >= 0)

  const map = new Map<string, CfDreEntry>()
  const months = new Set<string>()
  let rows = 0, totalE = 0, totalS = 0

  const add = (e: Omit<CfDreEntry, 'amount'>, amount: number) => {
    const k = `${e.unit}|${e.line}|${e.sub}|${e.supplier ?? ''}|${e.year}|${e.month}`
    const cur = map.get(k)
    if (cur) cur.amount += amount
    else map.set(k, { ...e, amount })
  }

  for (let r = 1; r < m.length; r++) {
    const row = m[r]; if (!row || row[iFil] == null) continue
    const val = Number(row[iVal]) || 0; if (val === 0) continue
    const d = serial(row[iData]); if (!d) continue
    const year = d.getUTCFullYear(), month = d.getUTCMonth() + 1
    if (maxMonth && (year > maxMonth.year || (year === maxMonth.year && month > maxMonth.month))) continue

    const tipo = clean(row[iTipo]) === 'S' ? 'S' : 'E'
    const path = iCs.map(i => norm(row[i])).filter(Boolean)
    const hist = clean(row[iHist])
    const c = classify(path, hist, tipo)
    if (!c) continue

    rows++
    if (tipo === 'E') totalE += Math.abs(val); else totalS += Math.abs(val)
    months.add(`${year}-${String(month).padStart(2, '0')}`)

    // REEMBIN entra como valor NEGATIVO em DEDUCAO (líquido = saídas − entradas)
    const line = c.line === 'REEMBIN' ? 'DEDUCAO' : c.line
    const amount = c.line === 'REEMBIN' ? -Math.abs(val) : Math.abs(val)
    const kind = line === 'RECEITA' ? 'RECEITA' : line === 'DEDUCAO' ? 'DEDUCAO' : line === 'JUROS' ? 'JUROS' : 'EXP'

    add({
      unit: unitOf(String(row[iFil])), kind, line, sub: c.sub,
      supplier: hist || null, supplierCode: null, year, month,
    }, amount)
  }

  return { entries: Array.from(map.values()), months: Array.from(months).sort(), rows, totalE, totalS }
}
