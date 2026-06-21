/**
 * Parser dos XLSX padrão do ERP do cliente:
 *
 * — TÍTULOS A RECEBER (24 colunas):
 *   VECTO | EMISSÃO | CÓDIGO | RAZÃO SOCIAL | CNPJ/CPF | TÍTULO | PARCELA |
 *   PORTADOR | TIPO COBRANÇA | VENDEDOR | NOME VENDEDOR | NOME FAZENDA |
 *   FONE | VLR TÍTULO | DESCTO | JUROS | MULTA | VLR LÍQUIDO | DA | NSU |
 *   COMPLEMENTO | OBSERVAÇÃO | FILIAL | ANOTAÇÕES
 *
 * — PAGAMENTOS A EFETUAR (19 colunas):
 *   VENCTO | ENTRADA | CÓDIGO | RAZÃO SOCIAL | CNPJ | TÍTULO | PARCELA |
 *   VLR TÍTULO | DESCTO | JUROS | MULTA | VLR LÍQ. | DA | PORTADOR |
 *   Nº CHEQUE | TIPO DOCTO | FILIAL | OPERAÇÃO | OBS
 *
 * Detecta automaticamente pelo header (VECTO vs VENCTO) e gera fitid
 * determinístico que serve como chave de deduplicação no DB.
 */
import * as XLSX from 'xlsx'

export type Kind = 'receivable' | 'payable'

export interface ParsedReceivable {
  fitid: string
  dueDate: string
  issueDate: string | null
  customerCode: string | null
  customerName: string
  customerDoc: string | null
  titulo: string
  parcela: string | null
  portador: string | null
  tipoCobranca: string | null
  sellerCode: string | null
  sellerName: string | null
  farmName: string | null
  phone: string | null
  amount: number
  discount: number
  interest: number
  fine: number
  netAmount: number
  filial: string | null
  observation: string | null
}

export interface ParsedPayable {
  fitid: string
  dueDate: string
  entryDate: string | null
  supplierCode: string | null
  supplierName: string
  supplierDoc: string | null
  titulo: string
  parcela: string | null
  amount: number
  discount: number
  interest: number
  fine: number
  netAmount: number
  portador: string | null
  chequeNumber: string | null
  tipoDocto: string | null
  filial: string | null
  operacao: string | null
  observation: string | null
}

export interface ParseResult {
  kind: Kind
  total: number
  receivables?: ParsedReceivable[]
  payables?: ParsedPayable[]
  totalAmount: number
  errors: string[]
}

// ── Helpers ──────────────────────────────────────────────
function normalizeHeader(s: unknown): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()
}

function excelSerialToISO(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') {
    if (v < 1 || v > 200000) return null
    const ms = (v - 25569) * 86400 * 1000
    const d = new Date(ms)
    if (isNaN(d.getTime())) return null
    return d.toISOString().slice(0, 10)
  }
  if (typeof v === 'string') {
    const trimmed = v.trim()
    if (!trimmed) return null
    const ddmmyyyy = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
    if (ddmmyyyy) {
      const [, d, m, y] = ddmmyyyy
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10)
  }
  return null
}

function num(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const s = v.replace(/\./g, '').replace(',', '.').replace(/[^\d.\-]/g, '')
    const n = parseFloat(s)
    return isNaN(n) ? 0 : n
  }
  return 0
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s.length > 0 ? s : null
}

// Hash determinístico simples (não precisa ser criptográfico)
function hash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h).toString(36)
}

// ── Detecção do tipo ─────────────────────────────────────
function detectKind(headers: string[]): Kind | null {
  const set = new Set(headers.map(normalizeHeader))
  if (set.has('VECTO') && set.has('EMISSAO')) return 'receivable'
  if (set.has('VENCTO') && set.has('ENTRADA')) return 'payable'
  // Fallback: VECTO sozinho geralmente é receivable, VENCTO é payable
  if (set.has('VECTO')) return 'receivable'
  if (set.has('VENCTO')) return 'payable'
  return null
}

// ── Indexer de colunas (resistente a reordenação) ────────
function indexHeaders(headers: string[]): Record<string, number> {
  const idx: Record<string, number> = {}
  headers.forEach((h, i) => { idx[normalizeHeader(h)] = i })
  return idx
}

// ── Parser principal ─────────────────────────────────────
/**
 * Quando o XLSX vem com a coluna FILIAL vazia (relatório por filial),
 * a UI passa `filialOverride` pra preencher e o fitid já fica único por filial,
 * permitindo coexistência de várias filiais no mesmo banco.
 */
export function parseCashFlow(buffer: ArrayBuffer, filialOverride?: string): ParseResult {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false })
  const sheetName = wb.SheetNames[0]
  const sheet = wb.Sheets[sheetName]
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, blankrows: false })

  if (matrix.length === 0) {
    return { kind: 'receivable', total: 0, totalAmount: 0, errors: ['Planilha vazia'] }
  }

  const headerRow = (matrix[0] as unknown[]).map(c => String(c ?? ''))
  const kind = detectKind(headerRow)
  if (!kind) {
    return { kind: 'receivable', total: 0, totalAmount: 0, errors: ['Não foi possível identificar se o arquivo é de "a receber" (VECTO) ou "a pagar" (VENCTO)'] }
  }

  const idx = indexHeaders(headerRow)
  const errors: string[] = []
  let totalAmount = 0

  if (kind === 'receivable') {
    const items: ParsedReceivable[] = []
    for (let r = 1; r < matrix.length; r++) {
      const row = matrix[r] as unknown[]
      if (!row || row.length === 0) continue
      const dueDate = excelSerialToISO(row[idx['VECTO']])
      if (!dueDate) continue
      const customerName = str(row[idx['RAZAO SOCIAL']])
      if (!customerName) continue
      const titulo = str(row[idx['TITULO']]) || ''
      const parcela = str(row[idx['PARCELA']])
      const customerDoc = str(row[idx['CNPJ/CPF']])
      const amount = num(row[idx['VLR TITULO']])
      const filial = filialOverride ?? str(row[idx['FILIAL']])

      const seed = `R|${filial ?? ''}|${titulo}|${parcela}|${customerDoc}|${dueDate}|${amount.toFixed(2)}`
      const fitid = `r-${hash(seed)}`

      items.push({
        fitid,
        dueDate,
        issueDate:    excelSerialToISO(row[idx['EMISSAO']]),
        customerCode: str(row[idx['CODIGO']]),
        customerName,
        customerDoc,
        titulo,
        parcela,
        portador:     str(row[idx['PORTADOR']]),
        tipoCobranca: str(row[idx['TIPO COBRANCA']]),
        sellerCode:   str(row[idx['VENDEDOR']]),
        sellerName:   str(row[idx['NOME VENDEDOR']]),
        farmName:     str(row[idx['NOME FAZENDA']]),
        phone:        str(row[idx['FONE']]),
        amount,
        discount:     num(row[idx['DESCTO']]),
        interest:     num(row[idx['JUROS']]),
        fine:         num(row[idx['MULTA']]),
        netAmount:    num(row[idx['VLR LIQUIDO']]),
        filial,
        observation:  str(row[idx['OBSERVACAO']]) || str(row[idx['ANOTACOES']]),
      })
      totalAmount += amount
    }
    return { kind: 'receivable', total: items.length, totalAmount, receivables: items, errors }
  }

  // payable
  const items: ParsedPayable[] = []
  for (let r = 1; r < matrix.length; r++) {
    const row = matrix[r] as unknown[]
    if (!row || row.length === 0) continue
    const dueDate = excelSerialToISO(row[idx['VENCTO']])
    if (!dueDate) continue
    const supplierName = str(row[idx['RAZAO SOCIAL']])
    if (!supplierName) continue
    const titulo = str(row[idx['TITULO']]) || ''
    const parcela = str(row[idx['PARCELA']])
    const supplierDoc = str(row[idx['CNPJ']])
    const amount = num(row[idx['VLR TITULO']])
    const filial = filialOverride ?? str(row[idx['FILIAL']])

    const seed = `P|${filial ?? ''}|${titulo}|${parcela}|${supplierDoc}|${dueDate}|${amount.toFixed(2)}`
    const fitid = `p-${hash(seed)}`

    items.push({
      fitid,
      dueDate,
      entryDate:     excelSerialToISO(row[idx['ENTRADA']]),
      supplierCode:  str(row[idx['CODIGO']]),
      supplierName,
      supplierDoc,
      titulo,
      parcela,
      amount,
      discount:      num(row[idx['DESCTO']]),
      interest:      num(row[idx['JUROS']]),
      fine:          num(row[idx['MULTA']]),
      netAmount:     num(row[idx['VLR LIQ.']]) || num(row[idx['VLR LIQ']]) || amount,
      portador:      str(row[idx['PORTADOR']]),
      chequeNumber:  str(row[idx['Nº CHEQUE']]) || str(row[idx['N CHEQUE']]),
      tipoDocto:     str(row[idx['TIPO DOCTO']]),
      filial,
      operacao:      str(row[idx['OPERACAO']]),
      observation:   str(row[idx['OBS']]),
    })
    totalAmount += amount
  }
  return { kind: 'payable', total: items.length, totalAmount, payables: items, errors }
}
