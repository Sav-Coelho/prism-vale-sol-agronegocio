/**
 * Parser dos relatórios de caixa (regime de caixa) para a DRE:
 *  - PAGAMENTOS EFETUADOS (14 col, "VLR PAGO"): despesas, com FILIAL por linha.
 *  - TÍTULOS RECEBIDOS (20 col, "VLR BAIXA"): receita por unidade (unidade vem de fora).
 * A data de referência é a BAIXA (quando o dinheiro entrou/saiu).
 */
import * as XLSX from 'xlsx'

const norm = (s: unknown) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()
const num = (v: unknown): number => {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/\./g, '').replace(',', '.').replace(/[^\d.\-]/g, ''))
    return isNaN(n) ? 0 : n
  }
  return 0
}
const serialToDate = (v: unknown): Date | null => {
  const n = Number(v)
  if (isNaN(n) || n < 40000 || n > 60000) return null
  return new Date(Math.round((n - 25569) * 86400 * 1000))
}

// FILIAL do consolidado de pagamentos → unidade canônica (vazio = VS Rio Bonito)
const PAY_FILIAL_UNIT: Record<string, string> = {
  'VS 3 RIOS': 'VS - TRÊS RIOS', 'VS QUATIS': 'VS - QUATIS',
  'VS APERIBE': 'VS - APERIBÉ', 'VS APERIBÉ': 'VS - APERIBÉ',
  '': 'VS - RIO BONITO', 'MM RIO BON': 'MM - RIO BONITO',
  'MM APERIBE': 'MM - APERIBÉ', 'MM APERIBÉ': 'MM - APERIBÉ',
  'MM 7 LAGOA': 'MM - 7 LAGOAS',
}

export const CARD_DOC = '01.425.787/0001-04'

export interface PaymentRow {
  unit: string
  code: string
  name: string
  doc: string
  obs: string
  amount: number
  year: number
  month: number
}
export interface ReceiptRow {
  isCard: boolean
  gross: number       // VLR BAIXA
  discount: number    // DESCTO
  interest: number    // JUROS
  year: number
  month: number
}
export type DreParse =
  | { kind: 'payment'; rows: PaymentRow[]; total: number }
  | { kind: 'receipt'; rows: ReceiptRow[]; total: number }

function matrix(buffer: ArrayBuffer): unknown[][] {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false })
  const ws = wb.Sheets[wb.SheetNames[0]]
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, blankrows: false })
}

export function parseDre(buffer: ArrayBuffer): DreParse {
  const m = matrix(buffer)
  if (m.length === 0) return { kind: 'receipt', rows: [], total: 0 }
  const H = (m[0] as unknown[]).map(norm)
  const idx: Record<string, number> = {}
  H.forEach((h, i) => { idx[h] = i })

  const isPayment = idx['VLR PAGO'] !== undefined

  if (isPayment) {
    const iFil = idx['FILIAL'], iCod = idx['CODIGO'], iRz = idx['RAZAO SOCIAL'],
      iDoc = idx['CNPJ'] ?? idx['CNPJ/CPF'], iVal = idx['VLR PAGO'], iObs = idx['OBS'], iBaixa = idx['BAIXA']
    const rows: PaymentRow[] = []
    let total = 0
    for (let r = 1; r < m.length; r++) {
      const row = m[r] as unknown[]
      if (!row || row.length === 0) continue
      const amount = num(row[iVal]); if (amount === 0) continue
      const filRaw = norm(row[iFil])
      const unit = PAY_FILIAL_UNIT[filRaw] ?? 'VS - RIO BONITO'
      const d = serialToDate(row[iBaixa]) ?? new Date()
      total += amount
      rows.push({
        unit,
        code: String(row[iCod] ?? '').trim(),
        name: String(row[iRz] ?? '').trim(),
        doc: String(row[iDoc] ?? '').trim(),
        obs: String(row[iObs] ?? '').trim(),
        amount,
        year: d.getFullYear(),
        month: d.getMonth() + 1,
      })
    }
    return { kind: 'payment', rows, total }
  }

  // Recebimentos
  const iBaixaVal = idx['VLR BAIXA'], iDesc = idx['DESCTO'], iJur = idx['JUROS'],
    iDoc = idx['CNPJ/CPF'] ?? idx['CNPJ'], iBaixa = idx['BAIXA']
  const rows: ReceiptRow[] = []
  let total = 0
  for (let r = 1; r < m.length; r++) {
    const row = m[r] as unknown[]
    if (!row || row.length === 0) continue
    const gross = num(row[iBaixaVal]); if (gross === 0) continue
    const d = serialToDate(row[iBaixa]) ?? new Date()
    total += gross
    rows.push({
      isCard: String(row[iDoc] ?? '').trim() === CARD_DOC,
      gross,
      discount: num(row[iDesc]),
      interest: num(row[iJur]),
      year: d.getFullYear(),
      month: d.getMonth() + 1,
    })
  }
  return { kind: 'receipt', rows, total }
}
