/**
 * DRE Gerencial (caixa) estruturada, com quebra MENSAL por linha/subconta.
 * Consolidado + por unidade. Hierarquia: linha → subconta → fornecedor.
 * Cada linha e subtotal traz `total` (todos os meses) e `byMonth` (mapa mês→valor),
 * pra montar colunas comparativas e análise vertical por período no frontend.
 * Intragrupo (Multmunde) fica fora do resultado, como memo.
 */
import { prisma } from '@/lib/prisma'
import { LINE_LABEL } from '@/lib/dre-classifier'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const CONS = 'CONSOLIDADO'

export async function GET() {
  const entries = await prisma.dreEntry.findMany()

  const months = Array.from(new Set(entries.map(e => `${e.year}-${String(e.month).padStart(2, '0')}`))).sort()
  const units = Array.from(new Set(entries.map(e => e.unit))).sort()

  // scope -> line -> sub -> { byMonth, suppliers }
  type SubAgg = { byMonth: Map<string, number>; sup: Map<string, { code: string | null; amount: number }> }
  const scopes = new Map<string, Map<string, Map<string, SubAgg>>>()

  const bump = (scope: string, line: string, sub: string, m: string, supplier: string | null, code: string | null, amount: number) => {
    if (!scopes.has(scope)) scopes.set(scope, new Map())
    const ls = scopes.get(scope)!
    if (!ls.has(line)) ls.set(line, new Map())
    const ss = ls.get(line)!
    if (!ss.has(sub)) ss.set(sub, { byMonth: new Map(), sup: new Map() })
    const rec = ss.get(sub)!
    rec.byMonth.set(m, (rec.byMonth.get(m) ?? 0) + amount)
    if (supplier) {
      const s = rec.sup.get(supplier)
      if (s) s.amount += amount
      else rec.sup.set(supplier, { code, amount })
    }
  }

  entries.forEach(e => {
    const m = `${e.year}-${String(e.month).padStart(2, '0')}`
    bump(e.unit, e.line, e.sub, m, e.supplier, e.supplierCode, e.amount)
    bump(CONS, e.line, e.sub, m, e.supplier, e.supplierCode, e.amount)
  })

  const emptyMonths = () => { const o: Record<string, number> = {}; months.forEach(m => o[m] = 0); return o }

  // subcontas de uma linha, com byMonth + total + fornecedores
  const subsOf = (scope: string, line: string) => {
    const ss = scopes.get(scope)?.get(line)
    if (!ss) return []
    return Array.from(ss.entries()).map(([sub, rec]) => {
      const byMonth = emptyMonths()
      let total = 0
      rec.byMonth.forEach((v, m) => { byMonth[m] = v; total += v })
      return {
        sub, total, byMonth,
        suppliers: Array.from(rec.sup.entries())
          .map(([name, v]) => ({ name, code: v.code, amount: v.amount }))
          .sort((a, b) => b.amount - a.amount),
      }
    }).sort((a, b) => b.total - a.total)
  }
  // agregado da linha por mês
  const lineByMonth = (scope: string, line: string) => {
    const o = emptyMonths()
    const ss = scopes.get(scope)?.get(line)
    ss?.forEach(rec => rec.byMonth.forEach((v, m) => { o[m] = (o[m] ?? 0) + v }))
    return o
  }
  const totalOf = (bm: Record<string, number>) => Object.values(bm).reduce((s, v) => s + v, 0)
  // combinação de linhas por mês (soma sinais)
  const combine = (parts: Array<[Record<string, number>, number]>) => {
    const o = emptyMonths()
    parts.forEach(([bm, sign]) => months.forEach(m => { o[m] += (bm[m] ?? 0) * sign }))
    return o
  }

  function buildScope(scope: string) {
    const REC = lineByMonth(scope, 'RECEITA')
    const DED = lineByMonth(scope, 'DEDUCAO')
    const CMV = lineByMonth(scope, 'CMV')
    const ADM = lineByMonth(scope, 'ADM')
    const PES = lineByMonth(scope, 'PESSOAL')
    const LOG = lineByMonth(scope, 'LOG')
    const COM = lineByMonth(scope, 'COM')
    const IMP = lineByMonth(scope, 'IMPOSTOS')
    const JUR = lineByMonth(scope, 'JUROS')
    const FINb = lineByMonth(scope, 'FIN')
    const SOC = lineByMonth(scope, 'SOCIO')
    const INV = lineByMonth(scope, 'INVEST')
    const NAOOP = lineByMonth(scope, 'NAOOP')
    const DIF = lineByMonth(scope, 'DIFCAIXA')
    const INTRA = lineByMonth(scope, 'INTRAGRUPO')

    const RECLIQ = combine([[REC, 1], [DED, -1]])
    const MC = combine([[RECLIQ, 1], [CMV, -1]])
    const LUCROOP = combine([[MC, 1], [ADM, -1], [PES, -1], [LOG, -1], [COM, -1]])
    const EBITDA = combine([[LUCROOP, 1], [IMP, -1]])
    const FIN = combine([[FINb, 1], [JUR, -1]])          // financeiras líquidas de juros recebidos
    const LL = combine([[EBITDA, 1], [FIN, -1], [SOC, -1], [INV, -1], [NAOOP, 1]])

    const finSubs = subsOf(scope, 'FIN').slice()
    const jurTotal = totalOf(JUR)
    if (jurTotal) {
      const bm = emptyMonths(); months.forEach(m => bm[m] = -(JUR[m] ?? 0))
      finSubs.push({ sub: '(−) Juros Recebidos de Clientes', total: -jurTotal, byMonth: bm, suppliers: [] })
    }

    const grp = (key: string, label: string, sign: 1 | -1, bm: Record<string, number>, line: string) =>
      ({ type: 'group', key, label, sign, total: totalOf(bm), byMonth: bm, subs: subsOf(scope, line) })
    const sub = (key: string, label: string, bm: Record<string, number>) =>
      ({ type: 'subtotal', key, label, total: totalOf(bm), byMonth: bm })

    const rows: Array<Record<string, unknown>> = [
      grp('RECEITA', 'Receita Operacional Bruta', 1, REC, 'RECEITA'),
      grp('DEDUCAO', 'Deduções sobre Venda', -1, DED, 'DEDUCAO'),
      sub('RECLIQ', 'Receita Líquida', RECLIQ),
      grp('CMV', LINE_LABEL.CMV, -1, CMV, 'CMV'),
      sub('MC', 'Margem de Contribuição', MC),
      grp('ADM', LINE_LABEL.ADM, -1, ADM, 'ADM'),
      grp('PESSOAL', LINE_LABEL.PESSOAL, -1, PES, 'PESSOAL'),
      grp('LOG', LINE_LABEL.LOG, -1, LOG, 'LOG'),
      grp('COM', LINE_LABEL.COM, -1, COM, 'COM'),
      sub('LUCROOP', 'Lucro Operacional', LUCROOP),
      grp('IMPOSTOS', LINE_LABEL.IMPOSTOS, -1, IMP, 'IMPOSTOS'),
      sub('EBITDA', 'EBITDA', EBITDA),
      { type: 'group', key: 'FIN', label: LINE_LABEL.FIN, sign: -1 as const, total: totalOf(FIN), byMonth: FIN, subs: finSubs },
      grp('SOCIO', 'Retirada de Sócio', -1, SOC, 'SOCIO'),
      grp('INVEST', 'Investimentos (CAPEX)', -1, INV, 'INVEST'),
      grp('NAOOP', 'Resultado Não-Operacional', 1, NAOOP, 'NAOOP'),
      sub('LL', 'Lucro Líquido Gerencial', LL),
    ]
    if (totalOf(DIF)) {
      rows.push({ type: 'memo', key: 'DIFCAIXA', label: 'Diferença de Caixa (ajuste)', sign: 1, total: totalOf(DIF), byMonth: DIF, subs: subsOf(scope, 'DIFCAIXA') })
    }
    if (totalOf(INTRA)) {
      rows.push({ type: 'memo', key: 'INTRAGRUPO', label: 'Movimentações Intragrupo (Multmunde)', sign: 1, total: totalOf(INTRA), byMonth: INTRA, subs: subsOf(scope, 'INTRAGRUPO') })
    }
    return { rows }
  }

  const dre: Record<string, ReturnType<typeof buildScope>> = {}
  ;[CONS, ...units].forEach(s => { dre[s] = buildScope(s) })

  return NextResponse.json({ hasData: entries.length > 0, units, months, dre })
}
