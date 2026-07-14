/**
 * Parser do "CashFlow Analítico" da contabilidade (razão de caixa plano).
 * Colunas: FILIAL, DATA, DATA_ORIGEM, HISTORICO, DOCUMENTO, TIPO (E/S),
 *          CLASSIF_CONTABIL(1..6), BANCO, CONTA_CORRENTE, VALOR.
 * Agrega por (filial, tipo, classificação 6 níveis, ano, mês). amount assinado.
 * Visão à parte da DRE — não classifica em linhas da DRE.
 */
import * as XLSX from 'xlsx'

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()
const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim()
const serial = (v: unknown): Date | null => { const n = Number(v); return (!isNaN(n) && n > 40000 && n < 60000) ? new Date(Math.round((n - 25569) * 86400 * 1000)) : null }

export interface CashflowAgg {
  filial: string
  tipo: string          // E | S
  c1: string; c2: string | null; c3: string | null; c4: string | null; c5: string | null; c6: string | null
  year: number
  month: number
  amount: number        // assinado (E +, S −)
  n: number
}

// Detecta o formato: cabeçalho com FILIAL + TIPO + CLASSIF_CONTABIL(1)
export function isCashflowAnalitico(buf: ArrayBuffer): boolean {
  try {
    const wb = XLSX.read(buf, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const head = (XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, blankrows: false })[0] || []).map(norm)
    return head.includes('FILIAL') && head.includes('TIPO') && head.some(h => h.startsWith('CLASSIF_CONTABIL'))
  } catch { return false }
}

export function parseCashflowAnalitico(buffer: ArrayBuffer): {
  entries: CashflowAgg[]
  filiais: string[]
  months: string[]
  rows: number
  totalE: number
  totalS: number
} {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const m = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, blankrows: false })
  const H = (m[0] || []).map(h => norm(h))
  const col = (name: string) => H.indexOf(name)
  const iFil = col('FILIAL'), iData = col('DATA'), iOrig = col('DATA_ORIGEM'), iTipo = col('TIPO'), iVal = col('VALOR')
  const iC = [1, 2, 3, 4, 5, 6].map(k => H.indexOf('CLASSIF_CONTABIL(' + k + ')'))

  const map = new Map<string, CashflowAgg>()
  const filiais = new Set<string>()
  const months = new Set<string>()
  let totalE = 0, totalS = 0, rows = 0

  for (let r = 1; r < m.length; r++) {
    const row = m[r]
    if (!row || row[iFil] == null || String(row[iFil]).trim() === '') continue
    const val = Number(row[iVal]) || 0
    if (val === 0) continue
    const filial = clean(row[iFil])
    const tipo = clean(row[iTipo]) === 'S' ? 'S' : 'E'
    const c = iC.map(idx => idx >= 0 ? clean(row[idx]) : '')
    const c1 = c[0] || '—'
    const d = serial(row[iData]) ?? (iOrig >= 0 ? serial(row[iOrig]) : null)
    const year = d ? d.getFullYear() : 2026
    const month = d ? d.getMonth() + 1 : 0
    rows++
    if (tipo === 'E') totalE += val; else totalS += val
    filiais.add(filial)
    months.add(`${year}-${String(month).padStart(2, '0')}`)

    const key = `${filial}|${tipo}|${c.join('¦')}|${year}|${month}`
    const cur = map.get(key)
    if (cur) { cur.amount += val; cur.n++ }
    else map.set(key, {
      filial, tipo, c1,
      c2: c[1] || null, c3: c[2] || null, c4: c[3] || null, c5: c[4] || null, c6: c[5] || null,
      year, month, amount: val, n: 1,
    })
  }

  return {
    entries: Array.from(map.values()),
    filiais: Array.from(filiais).sort(),
    months: Array.from(months).sort(),
    rows, totalE, totalS,
  }
}
