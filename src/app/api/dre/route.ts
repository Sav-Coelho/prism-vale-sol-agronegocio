/**
 * Monta a DRE Gerencial (caixa) estruturada: consolidado + por unidade.
 * Hierarquia de 3 níveis: linha → subconta → fornecedor.
 * Movimentações intragrupo (Multmunde) ficam FORA do CMV e dos subtotais,
 * exibidas como memo abaixo do Lucro Líquido.
 */
import { prisma } from '@/lib/prisma'
import { LINE_LABEL } from '@/lib/dre-classifier'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const CONS = 'CONSOLIDADO'

interface SupplierRow { name: string; code: string | null; amount: number }
interface SubRow { sub: string; amount: number; suppliers: SupplierRow[] }

export async function GET() {
  const entries = await prisma.dreEntry.findMany()

  // scope -> line -> sub -> { amount, suppliers: Map<name, {code, amount}> }
  const scopes = new Map<string, Map<string, Map<string, { amount: number; sup: Map<string, { code: string | null; amount: number }> }>>>()
  const unitsSet = new Set<string>()
  const monthsSet = new Set<string>()

  const bump = (scope: string, line: string, sub: string, supplier: string | null, code: string | null, amount: number) => {
    if (!scopes.has(scope)) scopes.set(scope, new Map())
    const ls = scopes.get(scope)!
    if (!ls.has(line)) ls.set(line, new Map())
    const ss = ls.get(line)!
    if (!ss.has(sub)) ss.set(sub, { amount: 0, sup: new Map() })
    const rec = ss.get(sub)!
    rec.amount += amount
    if (supplier) {
      const s = rec.sup.get(supplier)
      if (s) s.amount += amount
      else rec.sup.set(supplier, { code, amount })
    }
  }

  entries.forEach(e => {
    unitsSet.add(e.unit)
    monthsSet.add(`${e.year}-${String(e.month).padStart(2, '0')}`)
    bump(e.unit, e.line, e.sub, e.supplier, e.supplierCode, e.amount)
    bump(CONS, e.line, e.sub, e.supplier, e.supplierCode, e.amount)
  })

  const subsOf = (scope: string, line: string): SubRow[] => {
    const ss = scopes.get(scope)?.get(line)
    if (!ss) return []
    return Array.from(ss.entries()).map(([sub, rec]) => ({
      sub,
      amount: rec.amount,
      suppliers: Array.from(rec.sup.entries())
        .map(([name, v]) => ({ name, code: v.code, amount: v.amount }))
        .sort((a, b) => b.amount - a.amount),
    })).sort((a, b) => b.amount - a.amount)
  }
  const totOf = (scope: string, line: string) => subsOf(scope, line).reduce((s, x) => s + x.amount, 0)

  function buildScope(scope: string) {
    const receita = totOf(scope, 'RECEITA')
    const deducao = totOf(scope, 'DEDUCAO')
    const recLiq = receita - deducao
    const cmv = totOf(scope, 'CMV')
    const mc = recLiq - cmv
    const adm = totOf(scope, 'ADM'), pes = totOf(scope, 'PESSOAL'), log = totOf(scope, 'LOG'), com = totOf(scope, 'COM')
    const lucroOp = mc - adm - pes - log - com
    const imp = totOf(scope, 'IMPOSTOS')
    const ebitda = lucroOp - imp
    const juros = totOf(scope, 'JUROS')
    const finBruto = totOf(scope, 'FIN')
    const fin = finBruto - juros
    const pro = totOf(scope, 'PROLABORE'), soc = totOf(scope, 'SOCIO')
    const ll = ebitda - fin - pro - soc
    const intragrupo = totOf(scope, 'INTRAGRUPO')

    const finSubs = subsOf(scope, 'FIN').slice()
    if (juros) finSubs.push({ sub: '(−) Juros Recebidos de Clientes', amount: -juros, suppliers: [] })

    const rows = [
      { type: 'group', key: 'RECEITA', label: 'Receita Operacional Bruta', sign: 1, amount: receita, subs: subsOf(scope, 'RECEITA') },
      { type: 'group', key: 'DEDUCAO', label: 'Deduções sobre Venda', sign: -1, amount: deducao, subs: subsOf(scope, 'DEDUCAO') },
      { type: 'subtotal', key: 'RECLIQ', label: 'Receita Líquida', amount: recLiq },
      { type: 'group', key: 'CMV', label: LINE_LABEL.CMV, sign: -1, amount: cmv, subs: subsOf(scope, 'CMV') },
      { type: 'subtotal', key: 'MC', label: 'Margem de Contribuição', amount: mc },
      { type: 'group', key: 'ADM', label: LINE_LABEL.ADM, sign: -1, amount: adm, subs: subsOf(scope, 'ADM') },
      { type: 'group', key: 'PESSOAL', label: LINE_LABEL.PESSOAL, sign: -1, amount: pes, subs: subsOf(scope, 'PESSOAL') },
      { type: 'group', key: 'LOG', label: LINE_LABEL.LOG, sign: -1, amount: log, subs: subsOf(scope, 'LOG') },
      { type: 'group', key: 'COM', label: LINE_LABEL.COM, sign: -1, amount: com, subs: subsOf(scope, 'COM') },
      { type: 'subtotal', key: 'LUCROOP', label: 'Lucro Operacional', amount: lucroOp },
      { type: 'group', key: 'IMPOSTOS', label: LINE_LABEL.IMPOSTOS, sign: -1, amount: imp, subs: subsOf(scope, 'IMPOSTOS') },
      { type: 'subtotal', key: 'EBITDA', label: 'EBITDA', amount: ebitda },
      { type: 'group', key: 'FIN', label: LINE_LABEL.FIN, sign: -1, amount: fin, subs: finSubs },
      { type: 'group', key: 'PROLABORE', label: LINE_LABEL.PROLABORE, sign: -1, amount: pro, subs: subsOf(scope, 'PROLABORE') },
      { type: 'group', key: 'SOCIO', label: LINE_LABEL.SOCIO, sign: -1, amount: soc, subs: subsOf(scope, 'SOCIO') },
      { type: 'subtotal', key: 'LL', label: 'Lucro Líquido Gerencial', amount: ll },
    ]
    if (intragrupo) {
      rows.push({ type: 'memo', key: 'INTRAGRUPO', label: LINE_LABEL.INTRAGRUPO, sign: -1, amount: intragrupo, subs: subsOf(scope, 'INTRAGRUPO') } as never)
    }
    return { recLiq, rows }
  }

  const units = Array.from(unitsSet).sort()
  const scopeList = [CONS, ...units]
  const dre: Record<string, ReturnType<typeof buildScope>> = {}
  scopeList.forEach(s => { dre[s] = buildScope(s) })

  return NextResponse.json({
    hasData: entries.length > 0,
    units,
    months: Array.from(monthsSet).sort(),
    dre,
  })
}
