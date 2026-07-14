/**
 * Parser do "RELATÓRIO DE DESPESAS" classificado pelo plano de contas do contador.
 * Estrutura em árvore (indentação na coluna CLASSIFICAÇÃO):
 *   grupo (nível 0) → categoria DRE (nível 3) → conta (nível 6) → mês → lançamento
 * Cada aba é uma loja; o CONSOLIDADO é ignorado (usamos as 7 lojas).
 * A classificação do contador vira a LINHA da DRE — sem heurística.
 */
import * as XLSX from 'xlsx'

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()
const indent = (s: unknown) => { const t = String(s ?? ''); return t.length - t.trimStart().length }
const num = (v: unknown): number => {
  if (typeof v === 'number') return v
  if (typeof v === 'string') { const n = parseFloat(v.replace(/\./g, '').replace(',', '.').replace(/[^\d.\-]/g, '')); return isNaN(n) ? 0 : n }
  return 0
}
const serial = (v: unknown): Date | null => { const n = Number(v); return (!isNaN(n) && n > 40000 && n < 60000) ? new Date(Math.round((n - 25569) * 86400 * 1000)) : null }
const isMonth = (s: string) => /^\d{1,2}\s*\/\s*\d{4}$/.test(s.trim())

// aba → unidade canônica (confirmado com o cliente)
const SHEET_UNIT: Record<string, string> = {
  'VALE DO SOL AGRONEGOCIOS': 'VS - RIO BONITO',
  'MM 7 LAGOAS': 'MM - 7 LAGOAS',
  'VS APERIBE': 'VS - APERIBÉ',
  'VS 3 RIOS': 'VS - TRÊS RIOS',
  'VS QUATIS': 'VS - QUATIS',
  'MM APERIBE': 'MM - APERIBÉ',
  'MM RIO BONITO': 'MM - RIO BONITO',
}

export const DRE_EXP_LINES = ['CMV','ADM','PESSOAL','LOG','COM','IMPOSTOS','FIN','SOCIO','INVEST','DEDUCAO','NAOOP','DIFCAIXA','EXCLUIR'] as const
export type ExpLine = typeof DRE_EXP_LINES[number]

// mapeia o caminho de ancestrais (plano de contas) para a linha da DRE
function mapLine(pathNorm: string[]): ExpLine {
  const has = (kw: string) => pathNorm.some(x => x.includes(kw))
  if (has('FORNECEDOR MERCADORIAS')) return 'CMV'
  if (has('COMPRA DE VEICULOS')) return 'INVEST'
  if (has('LUCROS DISTRIBUIDOS')) return 'SOCIO'
  if (has('REEMBOLSO PARA CLIENTE')) return 'DEDUCAO'
  if (has('DEPOSITO C/C') || has('TRANSFERENCIA ENTRE LOJAS')) return 'EXCLUIR'
  if (has('ENTRADA POR EMPRESTIMOS') || has('RECUPERACAO DE DESPESAS')) return 'NAOOP'
  if (pathNorm[0]?.includes('DIFERENCA DO CAIXA')) return 'DIFCAIXA'
  if (has('PAGAMENTO EMPRESTIMOS')) return 'FIN'
  if (has('COM PESSOAL')) return 'PESSOAL'
  if (has('COMERCIAL')) return 'COM'
  if (has('LOGISTICA') || has('COM VEICULO')) return 'LOG'
  if (has('PARCELAMENTO DE IMPOSTOS') || has('PARCELAMENTOS DE IMPOSTOS') || has('TRIBUTOS E IMPOSTOS') || has('IRPJ')) return 'IMPOSTOS'
  if (has('BANCO')) return 'FIN'
  if (has('ADMINISTRATIV') || has('DESP ADM')) return 'ADM'
  if (has('DESPESAS MULTMUNDE') || has('OUTRAS DESPESAS')) return 'ADM'
  return 'ADM' // fallback conservador
}

// rótulo legível da subconta (nível conta): último ancestral que não é mês
function subLabel(path: string[]): string {
  for (let i = path.length - 1; i >= 0; i--) {
    const p = path[i].trim()
    if (!isMonth(p)) return p.replace(/\s*-?\s*LOJA\s*\d+.*$/i, '').replace(/\s+/g, ' ').trim() || p
  }
  return path[0] ?? '—'
}

export interface ExpenseEntry {
  unit: string
  line: ExpLine
  sub: string
  supplier: string | null   // histórico do lançamento
  supplierDoc: string | null
  year: number
  month: number
  amount: number            // magnitude p/ despesas/deduções; assinado p/ NAOOP e DIFCAIXA
}

export function parseExpenseReport(buffer: ArrayBuffer): { entries: ExpenseEntry[]; sheets: string[] } {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false })
  const entries: ExpenseEntry[] = []
  const usedSheets: string[] = []

  wb.SheetNames.forEach(sn => {
    if (norm(sn).includes('CONSOLIDADO')) return
    const unit = SHEET_UNIT[norm(sn)]
    if (!unit) return
    usedSheets.push(sn)
    const m = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sn], { header: 1, raw: true, blankrows: false })
    // colunas: CLASSIFICAÇÃO(0) DATA ENT(1) DATA PAG(2) DOCTO(3) HISTÓRICO(4) CNPJ/CPF(5) CONTA(6) VALOR(7)
    const rows: Array<{ ind: number; label: string; val: unknown; pag: unknown; ent: unknown; hist: string; doc: string }> = []
    for (let r = 1; r < m.length; r++) {
      const c = String(m[r][0] ?? '')
      if (!c.trim()) continue
      rows.push({ ind: indent(c), label: c.trim().replace(/\s+/g, ' '), val: m[r][7], pag: m[r][2], ent: m[r][1], hist: String(m[r][4] ?? '').trim(), doc: String(m[r][5] ?? '').trim() })
    }
    const stack: Array<{ ind: number; label: string }> = []
    for (let k = 0; k < rows.length; k++) {
      const row = rows[k], next = rows[k + 1]
      while (stack.length && stack[stack.length - 1].ind >= row.ind) stack.pop()
      const ancestors = stack.map(s => s.label)
      // nível 0 nunca é lançamento (são cabeçalhos/totais de seção)
      const isLeaf = row.ind > 0 && (!next || next.ind <= row.ind)
      if (isLeaf && typeof row.val === 'number' && row.val !== 0) {
        const path = [...ancestors, row.label]
        const pathN = path.map(norm)
        const line = mapLine(pathN)
        if (line !== 'EXCLUIR') {
          const d = serial(row.pag) ?? serial(row.ent)
          const signed = line === 'NAOOP' || line === 'DIFCAIXA' ? row.val : Math.abs(row.val)
          entries.push({
            unit, line, sub: subLabel(path),
            supplier: row.hist || subLabel(path), supplierDoc: row.doc || null,
            year: d ? d.getFullYear() : 2026, month: d ? d.getMonth() + 1 : 0,
            amount: signed,
          })
        }
      }
      stack.push({ ind: row.ind, label: row.label })
    }
  })
  return { entries, sheets: usedSheets }
}
