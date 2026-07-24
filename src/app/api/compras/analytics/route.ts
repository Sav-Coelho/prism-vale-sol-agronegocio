/**
 * Analytics do Controle de Compras:
 *  - Dashboard: limite total, comprado no mês, saldo, CMV% atual vs meta.
 *  - Resumo por comprador (limite × comprado no mês × saldo × status).
 *  - Projeção de pagamentos por MÊS × CATEGORIA: boletos do ERP (comprometido
 *    real, PurchaseCommit) + parcelas dos pedidos manuais (PurchaseOrder).
 *  - LIMITE POR MÊS = meta% × RECEITA LÍQUIDA do MÊS ANTERIOR (regra do cliente:
 *    limite de julho = %CMV ideal × Rec. Líq. de junho). Se o mês anterior ainda
 *    não tem receita na DRE, usa o último mês disponível (fallback sinalizado).
 */
import { prisma } from '@/lib/prisma'
import { installments, ymKey, ymLabel, monthRange } from '@/lib/compras'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const BOLETOS_CAT = 'Boletos a pagar (ERP)'
const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()
const prevYm = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 2, 1))
  return ymKey(d)
}

export async function GET() {
  const [pedidos, commits, compradores, settings, recRows] = await Promise.all([
    prisma.purchaseOrder.findMany(),
    prisma.purchaseCommit.findMany(),
    prisma.comprador.findMany({ orderBy: { nome: 'asc' } }),
    prisma.purchaseSetting.findMany(),
    prisma.dreEntry.findMany({ where: { line: { in: ['RECEITA', 'DEDUCAO'] } }, select: { line: true, year: true, month: true, amount: true } }),
  ])

  const metaCmvPct = settings.find(s => s.key === 'metaCmvPct')?.value ?? 0.70

  // ── Receita LÍQUIDA por mês (Bruta − Deduções) da DRE ──
  const recliq = new Map<string, number>()
  recRows.forEach(r => {
    const k = `${r.year}-${String(r.month).padStart(2, '0')}`
    recliq.set(k, (recliq.get(k) ?? 0) + (r.line === 'RECEITA' ? r.amount : -r.amount))
  })
  const latestRecYm = Array.from(recliq.keys()).sort().pop() ?? null

  // limite de um mês = meta% × Rec.Líq. do mês ANTERIOR (fallback: último mês com receita)
  const limitInfo = (ym: string): { limite: number; baseYm: string | null; exato: boolean } => {
    const p = prevYm(ym)
    if (recliq.has(p)) return { limite: (recliq.get(p) ?? 0) * metaCmvPct, baseYm: p, exato: true }
    if (latestRecYm) return { limite: (recliq.get(latestRecYm) ?? 0) * metaCmvPct, baseYm: latestRecYm, exato: false }
    return { limite: 0, baseYm: null, exato: false }
  }

  // mês de referência = mês corrente (servidor, UTC)
  const now = new Date()
  const curStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const refYm = ymKey(curStart)
  const refLimit = limitInfo(refYm)

  // ── Resumo por comprador (comprado NO MÊS pela data do pedido) ──
  const compradoNoMes = new Map<string, number>()
  pedidos.forEach(p => {
    if (ymKey(p.dataPedido) === refYm) compradoNoMes.set(p.comprador, (compradoNoMes.get(p.comprador) ?? 0) + p.valor)
  })
  const resumoCompradores = compradores.map(c => {
    const comprado = compradoNoMes.get(c.nome) ?? 0
    const saldo = c.limite - comprado
    const util = c.limite > 0 ? comprado / c.limite : 0
    const status = c.limite <= 0 ? '—' : saldo < 0 ? '🔴 Estourado' : util > 0.9 ? '⚠️ Quase no limite' : '✅ OK'
    return { nome: c.nome, setor: c.setor, ativo: c.ativo, limite: c.limite, comprado, saldo, util, status }
  })
  const limiteTotal = compradores.filter(c => c.ativo).reduce((s, c) => s + c.limite, 0)
  const compradoTotalMes = Array.from(compradoNoMes.values()).reduce((s, v) => s + v, 0)
  const cmvAtualPct = refLimit.baseYm && (recliq.get(refLimit.baseYm) ?? 0) > 0 ? compradoTotalMes / (recliq.get(refLimit.baseYm) ?? 1) : 0

  // ── Projeção: boletos do ERP + parcelas dos pedidos manuais, por mês × categoria ──
  const catOf = (p: typeof pedidos[number]) => p.categoria || 'Pedidos lançados'
  const bucket = new Map<string, Map<string, number>>()
  const bump = (k: string, cat: string, v: number) => {
    if (!bucket.has(k)) bucket.set(k, new Map())
    const cm = bucket.get(k)!
    cm.set(cat, (cm.get(cat) ?? 0) + v)
  }
  let maxDue = curStart
  // boletos (exclui imobilizado — veículo/equipamento não consome limite de compras)
  let boletosTotal = 0, boletosImobilizado = 0
  commits.forEach(c => {
    if (norm(c.operacao).includes('IMOBILIZADO')) { boletosImobilizado += c.valor; return }
    if (c.dueDate < curStart) return
    if (c.dueDate > maxDue) maxDue = c.dueDate
    bump(ymKey(c.dueDate), BOLETOS_CAT, c.valor)
    boletosTotal += c.valor
  })
  // pedidos manuais (parcelas)
  pedidos.forEach(p => {
    installments(p).forEach(({ due, amount }) => {
      if (due < curStart) return
      if (due > maxDue) maxDue = due
      bump(ymKey(due), catOf(p), amount)
    })
  })

  const monthsSpan = (maxDue.getUTCFullYear() - curStart.getUTCFullYear()) * 12 + (maxDue.getUTCMonth() - curStart.getUTCMonth()) + 1
  const horizon = Math.min(24, Math.max(6, monthsSpan))
  const months = monthRange(curStart, horizon)

  const categorias = Array.from(new Set([
    ...(boletosTotal > 0 ? [BOLETOS_CAT] : []),
    ...pedidos.map(catOf),
  ])).sort()

  const projecao = months.map(k => {
    const cm = bucket.get(k) ?? new Map<string, number>()
    const row: Record<string, number | string> = { ym: k, mes: ymLabel(k) }
    let total = 0
    categorias.forEach(cat => { const v = cm.get(cat) ?? 0; row[cat] = v; total += v })
    const li = limitInfo(k)
    row.total = total
    row.limite = li.limite
    row.folga = li.limite - total
    return row
  })

  const porCategoria = categorias.map(cat => ({
    categoria: cat,
    total: months.reduce((s, k) => s + (bucket.get(k)?.get(cat) ?? 0), 0),
  })).sort((a, b) => b.total - a.total)

  const comprometidoTotal = porCategoria.reduce((s, c) => s + c.total, 0)

  return NextResponse.json({
    refYm, refLabel: ymLabel(refYm),
    receitaRef: { ym: refLimit.baseYm, value: refLimit.baseYm ? (recliq.get(refLimit.baseYm) ?? 0) : 0, exato: refLimit.exato },
    metaCmvPct, limiteCmvMensal: refLimit.limite,
    limiteTotal, compradoTotalMes, saldoTotal: limiteTotal - compradoTotalMes, cmvAtualPct,
    resumoCompradores,
    categorias, months, projecao, porCategoria, comprometidoTotal,
    nPedidos: pedidos.length,
    boletos: { count: commits.length, total: boletosTotal, imobilizadoExcluido: boletosImobilizado },
  })
}
