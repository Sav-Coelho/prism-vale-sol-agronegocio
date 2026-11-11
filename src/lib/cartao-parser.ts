/**
 * Leitura das faturas de cartão em PDF — parte PURA (sem pdf.js nem OCR), usada no
 * navegador depois da extração e nos testes da auditoria.
 *
 *  · Itaú Empresas: o PDF tem texto. Chega aqui como linhas de células (pdf.js, itens
 *    agrupados pela altura e ordenados da esquerda para a direita).
 *  · Safra Empresas: o PDF não tem texto utilizável (fontes Type3 com o Unicode trocado
 *    de propósito — só o espaço é legível). Chega aqui o texto do OCR, página após página.
 *
 * Toda fatura passa pela conferência: a soma dos itens tem de bater com o total da fatura
 * (menos a sobra da fatura anterior, quando houver) antes de poder ser salva.
 */

export interface ItemFatura {
  data: string                 // dd/mm, como na fatura
  dataCompra: string | null    // AAAA-MM-DD (ano deduzido do vencimento)
  descricao: string            // como na fatura
  parcela: string | null       // "06/12"
  portador: string | null      // titular do cartão adicional, quando a fatura separa
  valor: number                // + compra/tarifa · − estorno/crédito
  aviso?: string               // correção automática que o financeiro deve conferir
}

export interface FaturaLida {
  banco: string                // ITAU | SAFRA | OUTRO
  nome: string | null          // ex.: ITAU EMPRESAS VISA
  final: string | null         // 4 últimos dígitos
  titular: string | null
  vencimento: string | null    // AAAA-MM-DD
  total: number | null         // total a pagar
  saldoAnterior: number        // sobra da fatura anterior dentro do total (normalmente 0)
  itens: ItemFatura[]
  leitura: 'TEXTO' | 'OCR'
  avisos: string[]
}

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()

/** "R$1.234,56" · "-R$0,18" · "R$ -3,00" · "1.234,56" → número; null se não for valor */
export function valorBR(s: string): number | null {
  const t = String(s ?? '').replace(/\s+/g, '')
  const m = t.match(/^(-)?R?\$?(-)?(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})$/)
  if (!m) return null
  const v = Number(m[3].replace(/\./g, '') + '.' + m[4])
  return m[1] || m[2] ? -v : v
}

/** dd/mm/aaaa → AAAA-MM-DD */
const dataIso = (s: string | null | undefined): string | null => {
  const m = String(s ?? '').match(/(\d{2})\/(\d{2})\/(\d{4})/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

/** Parcela no fim da descrição ("…MERCA06/10", "…PARC06/12", "IPHONES ARARUAMA 02/12"). O OCR troca 0 por O. */
export function parcelaDe(descricao: string): string | null {
  const m = descricao.replace(/\s+$/, '').match(/([0-9O]{1,2})S?\/([0-9O]{2})$/)
  if (!m) return null
  const a = m[1].replace(/O/g, '0').padStart(2, '0'), b = m[2].replace(/O/g, '0')
  const na = Number(a), nb = Number(b)
  return na >= 1 && nb >= 1 && na <= nb && nb <= 48 ? `${a}/${b}` : null
}

/** Ano da compra: o da fatura, ou o anterior quando o mês da compra é depois do mês do vencimento. */
export function dataDaCompra(ddmm: string, vencimento: string | null): string | null {
  const m = ddmm.match(/^(\d{2})\/(\d{2})$/)
  if (!m || !vencimento) return null
  const vy = Number(vencimento.slice(0, 4)), vm = Number(vencimento.slice(5, 7))
  const y = Number(m[2]) > vm ? vy - 1 : vy
  return `${y}-${m[2]}-${m[1]}`
}

/** Chave do estabelecimento para a memória da classificação: sem parcela, sem "PARC" e sem espaços extras. */
export function chaveEstabelecimento(descricao: string): string {
  return norm(descricao)
    .replace(/\s*([0-9O]{1,2})S?\/([0-9O]{2})$/, '')
    .replace(/PARC$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function conferir(f: Pick<FaturaLida, 'itens' | 'total' | 'saldoAnterior'>): { soma: number; esperado: number | null; diferenca: number | null; ok: boolean } {
  const soma = Math.round(f.itens.reduce((s, i) => s + i.valor, 0) * 100) / 100
  if (f.total == null) return { soma, esperado: null, diferenca: null, ok: false }
  const esperado = Math.round((f.total - (f.saldoAnterior || 0)) * 100) / 100
  const diferenca = Math.round((soma - esperado) * 100) / 100
  return { soma, esperado, diferenca, ok: Math.abs(diferenca) <= 0.01 && f.itens.length > 0 }
}

export function detectarBanco(texto: string): 'ITAU' | 'SAFRA' | null {
  const t = norm(texto)
  if (/\bSAFRA\b/.test(t)) return 'SAFRA'
  if (/\bITAU\b/.test(t) && /XXXX\.XXXX/.test(t)) return 'ITAU'
  return null
}

// ─────────────────────────────── Itaú Empresas (texto) ───────────────────────────────
export function lerItau(linhas: string[][]): FaturaLida {
  const avisos: string[] = []
  const celulas = linhas.map(l => l.map(c => c.trim()).filter(Boolean)).filter(l => l.length)
  const texto = celulas.map(l => l.join(' | ')).join('\n')
  const cab = texto.match(/(ITAU[ A-Z]+?)\s+-\s+[\dX]{4}\.XXXX\.XXXX\.(\d{4})/i)
  const vencimento = dataIso(texto.match(/vencimento:[\s\S]{0,160}?(\d{2}\/\d{2}\/\d{4})/i)?.[1])
  let total: number | null = null, saldoAnterior = 0, viuSaldo = false
  for (const l of celulas) {
    const rot = norm(l[0])
    if (total == null && rot === 'TOTAL DA FATURA' && l.length >= 2) total = valorBR(l[l.length - 1])
    if (!viuSaldo && rot === 'SALDO DA FATURA ANTERIOR' && l.length >= 2) { saldoAnterior = valorBR(l[l.length - 1]) ?? 0; viuSaldo = true }
  }
  const itens: ItemFatura[] = []
  let secao: 'NAC' | 'INT' | 'ENC' | null = null
  let portador: string | null = null
  for (const l of celulas) {
    const um = norm(l.join(' '))
    const tit = l.length === 1 ? l[0].match(/^(.+?)\s+-\s+FINAL\s+(\d{4})$/i) : null
    if (tit) { portador = tit[1].trim(); continue }
    if (/^LANCAMENTOS NACIONAIS$/.test(um)) { secao = 'NAC'; continue }
    if (/^LANCAMENTOS INTERNACIONAIS$/.test(um)) { secao = 'INT'; continue }
    if (/^PRODUTOS, SERVICOS E ENCARGOS$/.test(um)) { secao = 'ENC'; continue }
    if (/^TOTAL DE (LANCAMENTOS|PRODUTOS)/.test(um) || /^ENCARGOS DESTA FATURA/.test(um)) { secao = null; continue }
    if (!secao || l.length < 3 || !/^\d{2}\/\d{2}$/.test(l[0])) continue
    const valor = valorBR(l[l.length - 1])
    if (valor == null) continue
    const descricao = l.slice(1, -1).join(' ').replace(/\s+/g, ' ').trim()
    if (/^PAGAMENTO/i.test(descricao)) continue
    itens.push({ data: l[0], dataCompra: dataDaCompra(l[0], vencimento), descricao, parcela: parcelaDe(descricao), portador, valor })
  }
  if (!cab) avisos.push('Não achei o número do cartão no cabeçalho.')
  if (!vencimento) avisos.push('Não achei o vencimento.')
  if (total == null) avisos.push('Não achei o total da fatura.')
  return { banco: 'ITAU', nome: cab ? cab[1].trim().toUpperCase() : null, final: cab ? cab[2] : null, titular: itens.find(i => i.portador)?.portador ?? null, vencimento, total, saldoAnterior, itens, leitura: 'TEXTO', avisos }
}

// ─────────────────────────────── Safra Empresas (OCR) ───────────────────────────────
// Linha de lançamento: "28/09 MERCADOLIVRE*MPARC02/10 391,98". O OCR às vezes come a
// vírgula ("312,45" → "31245") ou o sinal; a vírgula é recolocada antes dos 2 últimos
// dígitos (a coluna R$ sempre tem centavos) e a linha fica marcada para conferência.
const LINHA_OCR = /^(\d{2}\/\d{2})\s+[—–\-_]*\s*(.+?)\s+(-?\s?R?\$?\s?\d[\d.]*,\d{2}|-?\d{3,})\s*$/

export function lerSafraOcr(texto: string): FaturaLida {
  const avisos: string[] = []
  const linhas = texto.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const final = texto.match(/final\s+(\d{4})/i)?.[1] ?? texto.match(/\d{6}[*+\s]{2,}(\d{4})\b/)?.[1] ?? null
  const nome = texto.match(/(SAFRA EMPRESAS [A-Z]+)/i)?.[1]?.toUpperCase() ?? null
  const titular = texto.match(/^([A-ZÀ-Ú][A-ZÀ-Ú ]{3,}?)\s+\d{6}[*+]/m)?.[1]?.trim() ?? null
  const vencimento = dataIso(texto.match(/Vencimento[\s\S]{0,80}?(\d{2}\/\d{2}\/\d{4})/i)?.[1])
  const pega = (re: RegExp) => { const m = texto.match(re); return m ? valorBR(m[1]) : null }
  const total = pega(/Total desta fatura\s+(-?[\d.]+,\d{2})/i)
    ?? pega(/Total Geral dos Lan[cç]amentos\s+(-?[\d.]+,\d{2})/i)
    ?? pega(/Pagamento Total[\s\S]{0,60}?R\$\s*([\d.]+,\d{2})/i)
  const itens: ItemFatura[] = []
  for (const l of linhas) {
    const m = l.match(LINHA_OCR)
    if (!m) continue
    // o OCR lê "PARC06/12" como "PARCO6/12" ou "PARCOS6/12"
    const descricao = m[2].replace(/\s+/g, ' ').trim().replace(/PARC[O0]S?(\d)/g, 'PARC0$1')
    if (/^PAGAMENTO\b/i.test(descricao) || /^TOTAL\b/i.test(descricao)) continue
    let bruto = m[3].replace(/\s+/g, ''), aviso: string | undefined
    if (!bruto.includes(',')) {
      const neg = bruto.startsWith('-'); const dig = bruto.replace(/\D/g, '')
      bruto = `${neg ? '-' : ''}${dig.slice(0, -2)},${dig.slice(-2)}`
      aviso = `O OCR leu "${m[3]}"; usei ${bruto}. Confira na fatura.`
    }
    const valor = valorBR(bruto)
    if (valor == null) continue
    itens.push({ data: m[1], dataCompra: dataDaCompra(m[1], vencimento), descricao, parcela: parcelaDe(descricao), portador: titular, valor, ...(aviso ? { aviso } : {}) })
  }
  if (!final) avisos.push('Não achei o final do cartão.')
  if (!vencimento) avisos.push('Não achei o vencimento.')
  if (total == null) avisos.push('Não achei o total da fatura.')
  return { banco: 'SAFRA', nome, final, titular, vencimento, total, saldoAnterior: 0, itens, leitura: 'OCR', avisos }
}
