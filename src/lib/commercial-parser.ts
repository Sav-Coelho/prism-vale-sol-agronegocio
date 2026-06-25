/**
 * Parsers dos 3 relatórios do ERP do cliente:
 *
 *   1. PREÇO DE VENDA — sheet única
 *      Headers: CÓDIGO | DESCRIÇÃO | PR.VAREJO
 *
 *   2. ABC DE ESTOQUE — N sheets (uma por filial + CONSOLIDADO). Usamos o CONSOLIDADO.
 *      Headers: CÓDIGO | DESCRIÇÃO | QTDE | CUSTO | VALOR TOTAL
 *
 *   3. RELATORIO ABC DE VENDAS — N sheets (idem). Usamos o CONSOLIDADO.
 *      Headers: CODIGO | PRODUTO | QUANTIDADE | VLR TOTAL | MÉDIA/UN | CLASSE
 */
import * as XLSX from 'xlsx'

export interface ParsedPrice {
  code: string
  description: string
  retailPrice: number
}

export interface ParsedStock {
  code: string
  description: string
  qty: number
  unitCost: number
  totalValue: number
}

export interface ParsedSalesAbc {
  code: string
  description: string
  qtySold: number
  totalValue: number
  avgUnit: number
  abcClass: string
}

function normalizeHeader(s: unknown): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()
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

function str(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

function pickConsolidatedSheet(wb: XLSX.WorkBook): XLSX.WorkSheet | null {
  const target = wb.SheetNames.find(n => n.toUpperCase().includes('CONSOLIDADO'))
  if (target) return wb.Sheets[target]
  return wb.Sheets[wb.SheetNames[0]] ?? null
}

function indexHeaders(headerRow: unknown[]): Record<string, number> {
  const idx: Record<string, number> = {}
  headerRow.forEach((h, i) => { idx[normalizeHeader(h)] = i })
  return idx
}

// ── PREÇO DE VENDA ──────────────────────────────────────────
export function parsePriceList(buffer: ArrayBuffer): ParsedPrice[] {
  const wb = XLSX.read(buffer, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, blankrows: false })
  if (matrix.length === 0) return []
  const idx = indexHeaders(matrix[0] as unknown[])
  const codeIdx = idx['CODIGO'] ?? idx['CODIGO']
  const descIdx = idx['DESCRICAO'] ?? idx['DESCRIÇÃO']
  const priceIdx = idx['PR.VAREJO'] ?? idx['PR VAREJO'] ?? idx['PRECO'] ?? idx['PREÇO']

  const items: ParsedPrice[] = []
  for (let r = 1; r < matrix.length; r++) {
    const row = matrix[r] as unknown[]
    const code = str(row[codeIdx])
    if (!code) continue
    const price = num(row[priceIdx])
    if (price <= 0) continue
    items.push({
      code,
      description: str(row[descIdx]),
      retailPrice: price,
    })
  }
  return items
}

// ── ABC DE ESTOQUE ──────────────────────────────────────────
export function parseStockAbc(buffer: ArrayBuffer): ParsedStock[] {
  const wb = XLSX.read(buffer, { type: 'array' })
  const sheet = pickConsolidatedSheet(wb)
  if (!sheet) return []
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, blankrows: false })
  if (matrix.length === 0) return []
  const idx = indexHeaders(matrix[0] as unknown[])
  const codeIdx = idx['CODIGO']
  const descIdx = idx['DESCRICAO'] ?? idx['DESCRIÇÃO']
  const qtyIdx  = idx['QTDE'] ?? idx['QUANTIDADE']
  const costIdx = idx['CUSTO']
  const totalIdx = idx['VALOR TOTAL'] ?? idx['VALOR']

  const items: ParsedStock[] = []
  for (let r = 1; r < matrix.length; r++) {
    const row = matrix[r] as unknown[]
    const code = str(row[codeIdx])
    if (!code) continue
    items.push({
      code,
      description: str(row[descIdx]),
      qty: num(row[qtyIdx]),
      unitCost: num(row[costIdx]),
      totalValue: num(row[totalIdx]),
    })
  }
  return items
}

// ── ABC DE VENDAS ───────────────────────────────────────────
export function parseSalesAbc(buffer: ArrayBuffer): ParsedSalesAbc[] {
  const wb = XLSX.read(buffer, { type: 'array' })
  const sheet = pickConsolidatedSheet(wb)
  if (!sheet) return []
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, blankrows: false })
  if (matrix.length === 0) return []
  const idx = indexHeaders(matrix[0] as unknown[])
  const codeIdx = idx['CODIGO']
  const descIdx = idx['PRODUTO'] ?? idx['DESCRICAO'] ?? idx['DESCRIÇÃO']
  const qtyIdx  = idx['QUANTIDADE'] ?? idx['QTDE']
  const totalIdx = idx['VLR TOTAL'] ?? idx['VALOR TOTAL']
  const avgIdx  = idx['MEDIA/UN'] ?? idx['MÉDIA/UN'] ?? idx['MEDIA UN']
  const classIdx = idx['CLASSE']

  const items: ParsedSalesAbc[] = []
  for (let r = 1; r < matrix.length; r++) {
    const row = matrix[r] as unknown[]
    const code = str(row[codeIdx])
    if (!code) continue
    const abc = str(row[classIdx]).toUpperCase()
    if (!['A', 'B', 'C'].includes(abc)) continue
    items.push({
      code,
      description: str(row[descIdx]),
      qtySold: num(row[qtyIdx]),
      totalValue: num(row[totalIdx]),
      avgUnit: num(row[avgIdx]),
      abcClass: abc,
    })
  }
  return items
}
