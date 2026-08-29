/**
 * Alimenta o /fluxo-de-caixa a partir do CashFlow Analítico (projetado).
 * Mapeia TIPO E (entrada) → Receivable e TIPO S (saída) → Payable, preservando a
 * FILIAL do arquivo (fallback 'CONSOLIDADO' se vier vazia).
 * Wipe TOTAL de Receivable/Payable e substitui por esta projeção (decisão do usuário).
 * A stale-rule (dueDate <= hoje não entra em análise) é aplicada pela /series na leitura.
 *
 * LIGAÇÃO COM O CONTROLE DE COMPRAS (pedido do Sávio, 2026-08-28): as saídas com
 * classificação FORNECEDOR MERCADORIAS também substituem a base de boletos
 * (PurchaseCommit) — o comprometido do /controle-compras se atualiza junto com o
 * cash flow semanal, sem depender do "Pagamentos a Efetuar" à parte.
 * Exclusões (coerência com a DRE/limite de 70%): MULTMUNDE (intragrupo, fora do
 * CMV) e FCA (veículo/financiamento).
 */
import { prisma } from '@/lib/prisma'
import * as XLSX from 'xlsx'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

const FILIAL = 'CONSOLIDADO'
const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()
const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim()
const serial = (v: unknown): Date | null => { const n = Number(v); return (!isNaN(n) && n > 40000 && n < 60000) ? new Date(Math.round((n - 25569) * 86400 * 1000)) : null }
// separa "168855/2" → { titulo:'168855', parcela:'2' }
function splitDoc(doc: string): { titulo: string; parcela: string | null } {
  const m = doc.match(/^(.*)\/(\d+)\s*$/)
  return m ? { titulo: m[1].trim(), parcela: m[2] } : { titulo: doc || '—', parcela: null }
}

export async function POST(req: Request) {
  const fd = await req.formData()
  const file = fd.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Arquivo não enviado' }, { status: 400 })

  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const m = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, blankrows: false })
  const H = (m[0] || []).map(h => norm(h))
  const col = (name: string) => H.indexOf(name)
  const iData = col('DATA'), iOrig = col('DATA_ORIGEM'), iHist = col('HISTORICO'), iDoc = col('DOCUMENTO'), iTipo = col('TIPO'), iVal = col('VALOR')
  const iFil = col('FILIAL')
  const iCs = [1, 2, 3, 4, 5, 6].map(k => col('CLASSIF_CONTABIL(' + k + ')')).filter(i => i >= 0)
  const iC1 = iCs.length ? iCs[0] : -1
  // Classificação exibida = nível MAIS ESPECÍFICO preenchido (o nível 1 costuma ser
  // genérico: "OUTRAS CONTAS › FORNECEDOR MERCADORIAS" → mostra "FORNECEDOR MERCADORIAS").
  const classifOf = (row: unknown[]): string | null => {
    for (let k = iCs.length - 1; k >= 0; k--) {
      const v = clean(row[iCs[k]])
      if (v) return v
    }
    return null
  }
  if (iData < 0 || iTipo < 0 || iVal < 0) {
    return NextResponse.json({ error: 'Formato não reconhecido (esperado CashFlow Analítico: DATA, TIPO, VALOR).' }, { status: 400 })
  }

  const receivables: Record<string, unknown>[] = []
  const payables: Record<string, unknown>[] = []
  const boletos: { fornecedor: string; titulo: string | null; parcela: string | null; dueDate: Date; valor: number; operacao: string | null; tipoDocto: string; filial: string }[] = []
  let skippedNoDate = 0
  let intragrupoExcluido = 0

  for (let r = 1; r < m.length; r++) {
    const row = m[r]; if (!row) continue
    const val = Number(row[iVal]) || 0
    if (val === 0) continue
    const due = serial(row[iData])
    if (!due) { skippedNoDate++; continue }        // sem data de vencimento não posiciona no fluxo
    const orig = iOrig >= 0 ? serial(row[iOrig]) : null
    const hist = clean(row[iHist]) || (iC1 >= 0 ? clean(row[iC1]) : '') || '(sem histórico)'
    const { titulo, parcela } = splitDoc(clean(row[iDoc]))
    const classif = classifOf(row)
    const filial = (iFil >= 0 ? clean(row[iFil]) : '') || FILIAL
    const tipo = clean(row[iTipo]) === 'S' ? 'S' : 'E'
    const amt = Math.abs(val)

    if (tipo === 'E') {
      receivables.push({
        fitid: `cfa|E|${r}`, dueDate: due, issueDate: orig,
        customerName: hist, customerDoc: null, titulo, parcela,
        amount: amt, netAmount: amt, filial, observation: classif, status: 'PENDING',
      })
    } else {
      payables.push({
        fitid: `cfa|S|${r}`, dueDate: due, entryDate: orig,
        supplierName: hist, supplierDoc: null, titulo, parcela,
        amount: amt, netAmount: amt, filial, operacao: classif, observation: classif, status: 'PENDING',
      })
      // ── boletos de compras p/ o Controle de Compras ──
      const niveis = iCs.map(i => norm(row[i])).filter(Boolean)
      if (niveis.some(x => x.includes('FORNECEDOR MERCADORIAS'))) {
        const h = norm(hist)
        if (h.includes('MULTMUNDE') || h.includes('FCA FIAT')) { intragrupoExcluido += amt; continue }
        boletos.push({
          fornecedor: hist, titulo: titulo || null, parcela, dueDate: due, valor: amt,
          operacao: classif, tipoDocto: 'CashFlow Analítico', filial,
        })
      }
    }
  }

  const result = await prisma.$transaction(async tx => {
    const delR = await tx.receivable.deleteMany({})
    const delP = await tx.payable.deleteMany({})
    let insR = 0, insP = 0
    const CHUNK = 1000
    for (let i = 0; i < receivables.length; i += CHUNK) insR += (await tx.receivable.createMany({ data: receivables.slice(i, i + CHUNK) as never, skipDuplicates: true })).count
    for (let i = 0; i < payables.length; i += CHUNK) insP += (await tx.payable.createMany({ data: payables.slice(i, i + CHUNK) as never, skipDuplicates: true })).count
    // Boletos do compras: substitui SÓ a janela coberta pela fotografia
    // (dueDate >= 1º vencimento do arquivo). Boletos vencidos ANTES dela ficam —
    // são o histórico já pago do mês corrente; apagá-los derrubaria o
    // comprometido/CMV de agosto a cada import semanal.
    let delB = 0, insB = 0
    if (boletos.length > 0) {
      const minDueBoletos = boletos.reduce((m, b) => b.dueDate < m ? b.dueDate : m, boletos[0].dueDate)
      delB = (await tx.purchaseCommit.deleteMany({ where: { dueDate: { gte: minDueBoletos } } })).count
      for (let i = 0; i < boletos.length; i += CHUNK) insB += (await tx.purchaseCommit.createMany({ data: boletos.slice(i, i + CHUNK) })).count
    }
    return { deletedReceivables: delR.count, deletedPayables: delP.count, insertedReceivables: insR, insertedPayables: insP, deletedBoletos: delB, insertedBoletos: insB }
  }, { timeout: 120_000 })

  return NextResponse.json({
    kind: 'cashflow-analitico→fluxo', filial: FILIAL, skippedNoDate, ...result,
    boletosTotal: boletos.reduce((s, b) => s + b.valor, 0),
    intragrupoExcluido,
  })
}
