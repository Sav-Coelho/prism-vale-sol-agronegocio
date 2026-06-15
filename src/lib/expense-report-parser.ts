/**
 * Parser do relatório de despesas (XLSX) gerado pelo ERP do cliente.
 *
 * O arquivo tem N sheets (uma por loja/empresa + "CONSOLIDADO") com 8 colunas:
 *   A: CLASSIFICAÇÃO   — hierárquica (grupos + folha)
 *   B: DATA ENT        — data de entrada/emissão
 *   C: DATA PAG        — data de pagamento (pode estar vazia)
 *   D: DOCTO           — "A PAGAR", "FORNEC.", vazio
 *   E: HISTÓRICO       — descrição livre da transação
 *   F: CNPJ/CPF        — quando há fornecedor cadastrado
 *   G: CONTA           — conta bancária (apenas em transações bancárias)
 *   H: VALOR           — valor com sinal (negativo = saída)
 *
 * Cada bloco tem ~5 níveis hierárquicos com totais propagados pra cima.
 * As linhas-folha são identificadas pela CLASSIFICAÇÃO ser uma descrição
 * livre (não termina com "- LOJA N" e não é um header de grupo conhecido).
 */
import * as XLSX from 'xlsx'

export interface ParsedExpense {
  rowIdx: number
  sheet: string
  date: string                  // ISO of DATA PAG or DATA ENT
  paidDate: string | null
  amount: number                // signed (negativo = despesa)
  description: string
  cnpj: string | null
  docType: string | null

  // Inferred classification from the XLSX hierarchy
  inferredUnit: string | null         // "LOJA 7"
  inferredDreGroup: string | null     // "Despesas Administrativas"
  inferredAccountName: string | null  // "Aluguel de Imóveis"
  inferredBankAccount: string | null  // "ITAU 3 RIOS 99568-7"

  fitid: string                 // dedup key, deterministic
}

export interface ExpenseReportSummary {
  totalRows: number
  totalLeaves: number
  totalSheets: number
  totalValue: number
  expenses: ParsedExpense[]
}

const SHEETS_TO_SKIP = new Set(['CONSOLIDADO', 'CONSOLIDADO ', 'Consolidado'])

// Headers de grupo conhecidos — quando aparecem na classificação, indicam
// que a linha é um agrupador (não uma folha)
const GROUP_HEADERS = new Set([
  'DESPESAS', 'BANCOS', 'BANCO', 'TAXAS',
  'BRADESCO', 'ITAU', 'SAFRA', 'SICREDI', 'SICOOB', 'CAIXA', 'SANTANDER',
  'BB', 'INTER', 'BANCO DO BRASIL',
  // Categorias contábeis que aparecem sem sufixo "- LOJA N"
  'FORNECEDOR MERCADORIAS', 'OUTRAS CONTAS', 'CARTAO DE CREDITO',
  'CARTÃO DE CRÉDITO', 'PARCELAMENTO ICMS FEEF FOT',
])

// Mapeia o nome do "agrupador" da planilha pro dreGroup do Prism.
// Faz match por palavra-chave porque os nomes vêm sempre com " - LOJA N" no fim
// (e às vezes também com "MULTMUNDE"/"VALE DO SOL" prefixado).
const DRE_GROUP_KEYWORDS: { match: RegExp; dreGroup: string }[] = [
  { match: /DESP[\.\s]*ADM|DESPESAS\s+ADMINISTRATIV/i, dreGroup: 'Despesas Administrativas' },
  { match: /TAXAS|JUROS BANC|TARIFAS|CARTAO\s+DE\s+CREDITO|CARTÃO\s+DE\s+CRÉDITO/i, dreGroup: 'Despesas Financeiras' },
  { match: /DESPESAS\s+COM\s+PESSOAL/i,                dreGroup: 'Despesas com Pessoal' },
  { match: /FOLHA\s+DE\s+PG/i,                         dreGroup: 'Despesas com Pessoal' },
  { match: /DESPESAS?\s+COMERCIAL|MARKETING/i,         dreGroup: 'Despesas com Marketing' },
  { match: /DESPESAS\s+COM\s+VE[ÍI]CULO/i,             dreGroup: 'Despesa Variável' },
  { match: /TRIBUTOS\s+E\s+IMPOSTOS|PARCELAMENTOS?\s+DE\s+IMPOSTOS|PARCELAMENTO\s+ICMS/i, dreGroup: 'Deduções sobre a Venda' },
  { match: /FORNECEDOR\s+MERCADORIAS/i,                dreGroup: 'Custo do Produto/Serviço' },
  { match: /IMOBILIZADO/i,                             dreGroup: 'Investimentos' },
  { match: /EMPR[ÉE]STIMOS?|FINANCIAMENT|LUCROS?\s+DIST/i, dreGroup: 'Despesas Não Operacionais' },
  { match: /TRANSFER[ÊE]NCIA|DEPOSITO\s+C\/C|SUPRIMENTO/i, dreGroup: 'Transferência entre Contas' },
]

// Bancos conhecidos — quando aparecem como agrupador, geralmente o subgrupo
// "TAXAS" abaixo deles indica despesa financeira de tarifa bancária
const BANK_NAMES = new Set([
  'BRADESCO', 'ITAU', 'ITAÚ', 'SAFRA', 'SICREDI', 'CAIXA',
  'SANTANDER', 'BB', 'INTER', 'BANCO DO BRASIL',
])

/** Remove acentos e normaliza pra comparação */
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/** Remove "- LOJA N" do final */
function stripLojaSuffix(s: string): string {
  return s.replace(/\s*-\s*LOJA\s+\d+\s*$/i, '').trim()
}

/** Detecta "LOJA N" no texto e devolve "LOJA N" canonicalizado */
function extractLoja(s: string): string | null {
  const m = s.match(/LOJA\s+(\d+)/i)
  return m ? `LOJA ${m[1]}` : null
}

/** É uma linha-grupo (não-folha)? */
function isGroupRow(classification: string): boolean {
  const trimmed = classification.trim()
  if (!trimmed) return false
  // Termina com " - LOJA N" → é grupo
  if (/\s-\s*LOJA\s+\d+\s*$/i.test(trimmed)) return true
  // É um header bancário conhecido
  if (GROUP_HEADERS.has(trimmed.toUpperCase())) return true
  // Headers que começam com palavras conhecidas
  if (/^(DESPESAS|BANCOS?|TAXAS|TRIBUTOS|PARCELAMENTOS?|OUTRAS\s+CONTAS|TRANSFER[ÊE]NCIA)\b/i.test(trimmed)) return true
  return false
}

// Aliases para consolidar variações de nome do ERP
const ACCOUNT_ALIASES: { match: RegExp; replace: string }[] = [
  { match: /^FOLHA\s+(DE\s+)?PG(TO)?$/i,                  replace: 'Folha de Pagamento' },
  { match: /^SERV\s+TERC\s+PESSOA\s+JURIDICA$/i,          replace: 'Serv. Terc. Pessoa Jurídica' },
  { match: /^SERV\s+TERC\s+PESSOA\s+FISICA$/i,            replace: 'Serv. Terc. Pessoa Física' },
  { match: /^HONORARIO\s+CONTABIL$/i,                     replace: 'Honorário Contábil' },
  { match: /^HONORARIO\s+JURIDICO$/i,                     replace: 'Honorário Jurídico' },
  { match: /^DARF\s+PREVIDENCIARIO$/i,                    replace: 'DARF Previdenciário' },
  { match: /^FORNECEDOR\s+MERCADORIAS$/i,                 replace: 'Fornecedor Mercadorias' },
  { match: /^CARTAO\s+DE\s+CREDITO$/i,                    replace: 'Cartão de Crédito (Encargos)' },
  { match: /^CARTAO\s+DESPESAS\s+PRE\s+PAGO$/i,           replace: 'Cartão Despesas Pré-pago' },
  { match: /^ICMS$/i,                                     replace: 'ICMS sobre Vendas' },
  { match: /^ICMS\s*-\s*SUBSTITUICAO\s+TRIBUTARIA$/i,     replace: 'ICMS sobre Vendas (ST)' },
  { match: /^DIFAL$/i,                                    replace: 'DIFAL' },
  { match: /^DIFAL\s*-?\s*MG$/i,                          replace: 'DIFAL MG' },
  { match: /^PARCELAMENTO\s+ICMS\s+FEEF\s+FOT$/i,         replace: 'Parcelamento ICMS FEEF/FOT' },
  { match: /^PEDAGIO$/i,                                  replace: 'Pedágio' },
  { match: /^TARIFAS?\s+BRADESCO$/i,                      replace: 'Tarifas Bradesco' },
  { match: /^TARIFAS?\s+ITAU$/i,                          replace: 'Tarifas Itaú' },
  { match: /^TARIFAS?\s+SAFRA$/i,                         replace: 'Tarifas Safra' },
  { match: /^TARIFAS?\s+SICREDI$/i,                       replace: 'Tarifas Sicredi' },
  { match: /^TARIFAS?\s+SICOOB$/i,                        replace: 'Tarifas Sicoob' },
  { match: /^DEPOSITO\s+C\/C$/i,                          replace: 'Depósito C/C' },
]

/** Cleaning do nome da conta plano */
function cleanAccountName(raw: string): string {
  const cleaned = stripLojaSuffix(raw).trim()
  // Aliases primeiro (case-insensitive, antes do title case)
  const upper = cleaned.toUpperCase()
  for (const { match, replace } of ACCOUNT_ALIASES) {
    if (match.test(upper)) return replace
  }
  // Title case manual respeitando preposições/conjunções comuns em PT
  const lowers = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'a', 'o'])
  return cleaned
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => {
      if (i > 0 && lowers.has(w)) return w
      return w.charAt(0).toUpperCase() + w.slice(1)
    })
    .join(' ')
    // restaurar acentuação de palavras comuns
    .replace(/\bHonorario\b/g, 'Honorário')
    .replace(/\bCustodia\b/g, 'Custódia')
    .replace(/\bImoveis\b/g, 'Imóveis')
    .replace(/\bVeiculos?\b/g, 'Veículos')
    .replace(/\bVeiculo\b/g, 'Veículo')
    .replace(/\bAgua\b/g, 'Água')
    .replace(/\bEletrica\b/g, 'Elétrica')
    .replace(/\bManutencao\b/g, 'Manutenção')
    .replace(/\bConservacao\b/g, 'Conservação')
    .replace(/\bEstadias?\b/g, 'Estadias')
    .replace(/\bMaquinas\b/g, 'Máquinas')
    .replace(/\bEquipamentos\b/g, 'Equipamentos')
    .replace(/\bPropaganda\b/g, 'Propaganda')
    .replace(/\bMercadorias\b/g, 'Mercadorias')
    .replace(/\bDeposito\b/g, 'Depósito')
    .replace(/\bTributos?\b/g, 'Tributos')
    .replace(/\bImpostos?\b/g, 'Impostos')
    .replace(/\bJuridico\b/g, 'Jurídico')
    .replace(/\bSaude\b/g, 'Saúde')
    .replace(/\bSeguranca\b/g, 'Segurança')
    .replace(/\bOcupacional\b/g, 'Ocupacional')
}

/** Resolve o dreGroup com base no caminho hierárquico */
function resolveDreGroup(path: string[]): string | null {
  // Se algum dos níveis tem TAXAS sob um nome de banco, é Despesas Financeiras
  for (let i = path.length - 1; i >= 0; i--) {
    const node = path[i].toUpperCase()
    if (node.startsWith('TAXAS')) {
      // Tem banco no nível anterior?
      for (let j = i - 1; j >= 0; j--) {
        const stripped = stripLojaSuffix(path[j]).toUpperCase().trim()
        if (BANK_NAMES.has(stripped) || /^BANCOS?\b/.test(stripped)) {
          return 'Despesas Financeiras'
        }
      }
    }
  }
  // Caminhar do mais específico (último) ao mais genérico
  for (let i = path.length - 1; i >= 0; i--) {
    for (const { match, dreGroup } of DRE_GROUP_KEYWORDS) {
      if (match.test(path[i])) return dreGroup
    }
  }
  return null
}

/** Resolve o nome da conta plano com base no caminho */
function resolveAccountName(path: string[], dreGroup: string | null): string | null {
  // Se for despesa financeira de banco, monta um nome do banco
  if (dreGroup === 'Despesas Financeiras') {
    for (const node of path) {
      const stripped = stripLojaSuffix(node).toUpperCase().trim()
      if (BANK_NAMES.has(stripped)) return `Tarifas ${cleanAccountName(node)}`
    }
    return 'Tarifas Bancárias'
  }

  // Procura o último nó que termine com " - LOJA N" e NÃO seja um header conhecido
  // (esse é o "nome da conta plano específica")
  for (let i = path.length - 1; i >= 0; i--) {
    const node = path[i].trim()
    const stripped = stripLojaSuffix(node).toUpperCase()
    if (GROUP_HEADERS.has(stripped)) continue
    if (/^DESPESAS?\b|^BANCOS?\b|^TAXAS\b/i.test(stripped)) continue
    if (/\s-\s*LOJA\s+\d+\s*$/i.test(node)) {
      // Filtra também os DESP ADM / DESPESAS COM PESSOAL / etc
      const isAggregator =
        /^DESP[\.\s]+ADM|^DESPESAS\s+(ADMINISTRATIV|COM\s+PESSOAL|COMERCIAL|COM\s+VE[ÍI]CULO|N[ÃA]O\s+OPERACIONAIS?)/i.test(stripped) ||
        /^TRIBUTOS\s+E\s+IMPOSTOS/i.test(stripped) ||
        /^PARCELAMENTOS?\s+DE\s+IMPOSTOS/i.test(stripped) ||
        /^OUTRAS\s+CONTAS/i.test(stripped)
      if (isAggregator) continue
      return cleanAccountName(node)
    }
  }
  return null
}

function extractBankAccount(contaCell: string | null): string | null {
  if (!contaCell) return null
  const trimmed = contaCell.trim()
  return trimmed || null
}

// Excel armazena datas como serial numérico desde 1899-12-30
function excelSerialToISO(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') {
    if (v < 1 || v > 200000) return null
    const ms = (v - 25569) * 86400 * 1000  // 25569 = days between 1900-01-01 and 1970-01-01
    const d = new Date(ms)
    if (isNaN(d.getTime())) return null
    return d.toISOString().slice(0, 10)
  }
  if (typeof v === 'string') {
    // Já está como dd/mm/yyyy ou yyyy-mm-dd
    const ddmmyyyy = v.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
    if (ddmmyyyy) {
      const [, d, m, y] = ddmmyyyy
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
    }
    const isoMatch = v.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (isoMatch) return v.slice(0, 10)
    const date = new Date(v)
    if (!isNaN(date.getTime())) return date.toISOString().slice(0, 10)
  }
  return null
}

function parseAmount(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const cleaned = v.replace(/\./g, '').replace(',', '.').replace(/[^\d.\-]/g, '')
    const n = parseFloat(cleaned)
    return isNaN(n) ? 0 : n
  }
  return 0
}

// Hash simples e determinístico — não precisa ser criptográfico
function hash(str: string): string {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h).toString(36)
}

interface RawRow {
  classification: string
  dateEnt: string | null
  datePag: string | null
  docto: string
  historico: string
  cnpj: string
  conta: string
  valor: number
}

function readRows(sheet: XLSX.WorkSheet): RawRow[] {
  // sheet_to_json com header:1 dá uma matriz de arrays
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, blankrows: true })
  if (matrix.length === 0) return []

  const rows: RawRow[] = []
  // Pular linha do header
  for (let i = 1; i < matrix.length; i++) {
    const r = matrix[i] || []
    const c = (idx: number) => String(r[idx] ?? '').trim()
    rows.push({
      classification: c(0),
      dateEnt:  excelSerialToISO(r[1]),
      datePag:  excelSerialToISO(r[2]),
      docto:    c(3),
      historico: c(4),
      cnpj:      c(5),
      conta:     c(6),
      valor:     parseAmount(r[7]),
    })
  }
  return rows
}

/**
 * Classifica o "tipo" de uma linha-grupo pra atualizar o contexto correto.
 * Cada tipo SOBRESCREVE seu valor anterior (não acumula como stack).
 */
type GroupKind = 'companyLoja' | 'dreGroupHeader' | 'bankCategory' | 'bankName' | 'taxas' | 'accountName' | 'unknown'

function classifyGroupKind(cls: string): GroupKind {
  const upper = cls.toUpperCase().trim()
  const stripped = stripLojaSuffix(upper).trim()

  // Nível 1: "DESPESAS XXX - LOJA N" (empresa + loja)
  if (/^DESPESAS\s+(MULTMUNDE|VALE\s+DO\s+SOL)\b.*-\s*LOJA\s+\d+\s*$/i.test(cls)) {
    return 'companyLoja'
  }
  // "DESPESAS" sozinho (raiz da árvore)
  if (upper === 'DESPESAS') return 'unknown'

  // Nível 2: dreGroup headers (DESP ADM, BANCOS, DESPESAS COM PESSOAL, etc)
  if (/^DESP[\.\s]+ADM/i.test(cls) ||
      /^DESPESAS\s+(ADMINISTRATIV|COM\s+PESSOAL|COMERCIAL|COM\s+VE[ÍI]CULO|N[ÃA]O\s+OPERACIONAIS?)/i.test(cls) ||
      /^TRIBUTOS\s+E\s+IMPOSTOS/i.test(cls) ||
      /^PARCELAMENTOS?\s+DE\s+IMPOSTOS/i.test(cls) ||
      /^OUTRAS\s+CONTAS/i.test(cls) ||
      /^FORNECEDOR\s+MERCADORIAS/i.test(cls) ||
      /^CARTAO\s+DE\s+CREDITO/i.test(cls) ||
      /^CART[ÃA]O\s+DE\s+CR[ÉE]DITO/i.test(cls)) {
    return 'dreGroupHeader'
  }
  // "BANCOS" / "BANCO" (categoria bancária)
  if (/^BANCOS?\b/i.test(stripped)) return 'bankCategory'

  // Banco específico
  if (BANK_NAMES.has(stripped)) return 'bankName'

  // TAXAS dentro de banco
  if (stripped === 'TAXAS') return 'taxas'

  // Senão: conta do plano (termina com "- LOJA N")
  if (/\s-\s*LOJA\s+\d+\s*$/i.test(cls)) return 'accountName'

  return 'unknown'
}

interface ParseContext {
  companyLoja:     string | null  // "DESPESAS VALE DO SOL RIO BONITO - LOJA 6"
  dreGroupHeader:  string | null  // "DESP ADM VL RB - LOJA 6" / "BANCOS" / etc
  bankCategory:    string | null  // "BANCOS" / "BANCO"
  bankName:        string | null  // "SAFRA - LOJA 6"
  insideTaxas:     boolean
  accountName:     string | null  // "ALUGUEL DE IMOVEIS - LOJA 7"
}

function emptyContext(): ParseContext {
  return {
    companyLoja: null,
    dreGroupHeader: null,
    bankCategory: null,
    bankName: null,
    insideTaxas: false,
    accountName: null,
  }
}

function updateContext(ctx: ParseContext, cls: string, kind: GroupKind): void {
  switch (kind) {
    case 'companyLoja':
      // Nível 1: reseta tudo abaixo
      ctx.companyLoja = cls
      ctx.dreGroupHeader = null
      ctx.bankCategory = null
      ctx.bankName = null
      ctx.insideTaxas = false
      ctx.accountName = null
      break
    case 'dreGroupHeader':
      ctx.dreGroupHeader = cls
      ctx.bankCategory = null
      ctx.bankName = null
      ctx.insideTaxas = false
      ctx.accountName = null
      break
    case 'bankCategory':
      ctx.bankCategory = cls
      ctx.bankName = null
      ctx.insideTaxas = false
      ctx.accountName = null
      break
    case 'bankName':
      ctx.bankName = cls
      ctx.insideTaxas = false
      ctx.accountName = null
      break
    case 'taxas':
      ctx.insideTaxas = true
      ctx.accountName = null
      break
    case 'accountName':
      ctx.accountName = cls
      break
  }
}

function contextToPath(ctx: ParseContext): string[] {
  const path: string[] = []
  if (ctx.companyLoja)    path.push(ctx.companyLoja)
  if (ctx.dreGroupHeader) path.push(ctx.dreGroupHeader)
  if (ctx.bankCategory)   path.push(ctx.bankCategory)
  if (ctx.bankName)       path.push(ctx.bankName)
  if (ctx.insideTaxas)    path.push('TAXAS')
  if (ctx.accountName)    path.push(ctx.accountName)
  return path
}

function parseSheet(sheetName: string, rows: RawRow[]): ParsedExpense[] {
  const expenses: ParsedExpense[] = []
  const ctx: ParseContext = emptyContext()

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const cls = row.classification

    if (!cls && !row.valor && !row.historico) {
      // Linha em branco: limpa apenas o nível mais específico (accountName / taxas)
      ctx.accountName = null
      ctx.insideTaxas = false
      continue
    }

    if (!cls) continue

    const isGroup = isGroupRow(cls)
    if (isGroup) {
      const kind = classifyGroupKind(cls)
      updateContext(ctx, cls, kind)
      continue
    }

    // É folha
    const dateIso = row.datePag || row.dateEnt
    if (!dateIso) continue

    const path = contextToPath(ctx)

    // Unit: extraída do contexto da companyLoja (preferido) ou dreGroupHeader
    const inferredUnit       = extractLoja(ctx.companyLoja ?? '') || extractLoja(ctx.dreGroupHeader ?? '') || extractLoja(ctx.accountName ?? '')
    const inferredDreGroup   = resolveDreGroup(path)
    const inferredAccountName = resolveAccountName(path, inferredDreGroup)
    const inferredBankAccount = extractBankAccount(row.conta)

    const description = row.historico || cls

    const fitidSeed = `${sheetName}|${dateIso}|${row.valor.toFixed(2)}|${description}|${row.cnpj}|${row.conta}`
    const fitid = `xlsx-${hash(fitidSeed)}`

    expenses.push({
      rowIdx: i + 2,
      sheet: sheetName,
      date: dateIso,
      paidDate: row.datePag,
      amount: row.valor,
      description,
      cnpj: row.cnpj || null,
      docType: row.docto || null,
      inferredUnit,
      inferredDreGroup,
      inferredAccountName,
      inferredBankAccount,
      fitid,
    })
  }

  return expenses
}

export function parseExpenseReport(buffer: ArrayBuffer): ExpenseReportSummary {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false })

  const allExpenses: ParsedExpense[] = []
  let totalRows = 0
  let sheetsParsed = 0

  for (const sheetName of wb.SheetNames) {
    if (SHEETS_TO_SKIP.has(sheetName.trim().toUpperCase())) continue
    const sheet = wb.Sheets[sheetName]
    if (!sheet) continue
    const rows = readRows(sheet)
    totalRows += rows.length
    const expenses = parseSheet(sheetName, rows)
    allExpenses.push(...expenses)
    sheetsParsed++
  }

  // Dedup por fitid (caso o mesmo lançamento apareça em mais de um sheet)
  const seenFitid = new Set<string>()
  const unique = allExpenses.filter(e => {
    if (seenFitid.has(e.fitid)) return false
    seenFitid.add(e.fitid)
    return true
  })

  const totalValue = unique.reduce((s, e) => s + e.amount, 0)

  return {
    totalRows,
    totalLeaves: unique.length,
    totalSheets: sheetsParsed,
    totalValue,
    expenses: unique,
  }
}
