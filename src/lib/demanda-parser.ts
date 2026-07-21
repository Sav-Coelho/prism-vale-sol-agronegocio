/**
 * Parser do relatório COMERCIAL (Vendedor › Cliente › Produto › Data).
 * Só as FOLHAS (linhas com DATA preenchida) são vendas reais — os demais níveis
 * são subtotais e seriam duplicação. Agrega por (cliente × produto × ano/mês).
 */
import * as XLSX from 'xlsx'

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()
const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim()
const codeOf = (s: unknown) => { const m = String(s ?? '').match(/\((\d+)\)\s*$/); return m ? m[1] : null }
// remove o "(código)" final para o rótulo legível
const label = (s: unknown) => clean(String(s ?? '').replace(/\s*\(\d+\)\s*$/, '')) || clean(s)

function parseDate(v: unknown): { y: number; mo: number } | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') { if (v > 40000 && v < 60000) { const d = new Date(Math.round((v - 25569) * 86400 * 1000)); return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1 } } return null }
  const m = String(v).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  return m ? { y: +m[3], mo: +m[2] } : null
}

export interface DemandAgg {
  vendedor: string | null
  clienteCode: string
  cliente: string
  produtoCode: string | null
  produto: string
  year: number
  month: number
  qtd: number
  valor: number
}

export function isComercialDemanda(buf: ArrayBuffer): boolean {
  try {
    const wb = XLSX.read(buf, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames.find(s => norm(s).includes('CONSOLIDADO')) || wb.SheetNames[0]]
    const head = (XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, blankrows: false })[0] || []).map(norm)
    return head.includes('VENDEDOR') && head.includes('CLIENTE') && head.includes('PRODUTO') && head.includes('DATA')
  } catch { return false }
}

export function parseDemanda(buffer: ArrayBuffer): { entries: DemandAgg[]; clientes: number; produtos: number; leaves: number; total: number; months: string[] } {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false })
  const ws = wb.Sheets[wb.SheetNames.find(s => norm(s).includes('CONSOLIDADO')) || wb.SheetNames[0]]
  const m = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, blankrows: false })
  const H = (m[0] || []).map(h => norm(h))
  const col = (n: string) => H.indexOf(n)
  const iVend = col('VENDEDOR'), iCli = col('CLIENTE'), iProd = col('PRODUTO'), iData = col('DATA'), iQtd = col('QUANTIDADE'), iVlr = col('VLR TOTAL')

  const map = new Map<string, DemandAgg>()
  const clientes = new Set<string>(), produtos = new Set<string>(), months = new Set<string>()
  let leaves = 0, total = 0

  for (let r = 1; r < m.length; r++) {
    const row = m[r]; if (!row) continue
    const d = parseDate(row[iData])
    if (!d) continue                                   // só folhas (vendas com data)
    const cliRaw = clean(row[iCli]); if (!cliRaw) continue
    const prodRaw = clean(row[iProd])
    const valor = Number(row[iVlr]) || 0
    const qtd = Number(row[iQtd]) || 0
    leaves++; total += valor
    const clienteCode = codeOf(row[iCli]) ?? cliRaw
    const produtoCode = codeOf(row[iProd])
    clientes.add(clienteCode); produtos.add(produtoCode ?? prodRaw)
    const ym = `${d.y}-${String(d.mo).padStart(2, '0')}`; months.add(ym)

    const key = `${clienteCode}¦${produtoCode ?? prodRaw}¦${d.y}¦${d.mo}`
    const cur = map.get(key)
    if (cur) { cur.qtd += qtd; cur.valor += valor }
    else map.set(key, {
      vendedor: label(row[iVend]) || null,
      clienteCode, cliente: label(row[iCli]),
      produtoCode, produto: label(row[iProd]),
      year: d.y, month: d.mo, qtd, valor,
    })
  }

  return { entries: Array.from(map.values()), clientes: clientes.size, produtos: produtos.size, leaves, total, months: Array.from(months).sort() }
}
