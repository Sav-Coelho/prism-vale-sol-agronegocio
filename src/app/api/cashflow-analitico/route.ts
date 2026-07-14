/**
 * Serve o CashFlow Analítico já agregado: por escopo (CONSOLIDADO + cada filial),
 * árvore de classificação contábil (entradas E e saídas S) com quebra mensal,
 * KPIs e comparativo por filial. Puramente leitura — não toca na DRE.
 */
import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const CONS = 'CONSOLIDADO'

interface Node {
  label: string
  byMonth: Record<string, number>
  total: number
  children: Map<string, Node>
}
interface OutNode {
  label: string
  total: number
  byMonth: Record<string, number>
  children: OutNode[]
}

export async function GET() {
  const entries = await prisma.cashflowEntry.findMany()

  const months = Array.from(new Set(entries.map(e => `${e.year}-${String(e.month).padStart(2, '0')}`))).sort()
  const filiais = Array.from(new Set(entries.map(e => e.filial))).sort()
  const empty = () => { const o: Record<string, number> = {}; months.forEach(m => o[m] = 0); return o }

  // scope -> tipo -> root Node
  const roots = new Map<string, { E: Node; S: Node }>()
  const newRoot = (): Node => ({ label: '', byMonth: empty(), total: 0, children: new Map() })
  const ensure = (scope: string) => {
    if (!roots.has(scope)) roots.set(scope, { E: newRoot(), S: newRoot() })
    return roots.get(scope)!
  }

  const insert = (root: Node, path: string[], m: string, amount: number) => {
    let node = root
    node.total += amount; node.byMonth[m] = (node.byMonth[m] ?? 0) + amount
    path.forEach(label => {
      if (!node.children.has(label)) node.children.set(label, { label, byMonth: empty(), total: 0, children: new Map() })
      node = node.children.get(label)!
      node.total += amount; node.byMonth[m] = (node.byMonth[m] ?? 0) + amount
    })
  }

  entries.forEach(e => {
    const m = `${e.year}-${String(e.month).padStart(2, '0')}`
    const path = [e.c1, e.c2, e.c3, e.c4, e.c5, e.c6].filter((x): x is string => !!x && x !== '—')
    const useAmt = Math.abs(e.amount) // magnitude para a árvore (sinal implícito no tipo)
    const consR = ensure(CONS), filR = ensure(e.filial)
    const rootCons = e.tipo === 'S' ? consR.S : consR.E
    const rootFil = e.tipo === 'S' ? filR.S : filR.E
    insert(rootCons, path.length ? path : [e.c1], m, useAmt)
    insert(rootFil, path.length ? path : [e.c1], m, useAmt)
  })

  const serialize = (node: Node): OutNode[] =>
    Array.from(node.children.values())
      .sort((a, b) => b.total - a.total)
      .map(c => ({ label: c.label, total: c.total, byMonth: c.byMonth, children: serialize(c) }))

  // comparativo por filial (independe de escopo; frontend filtra meses)
  const byFilial = filiais.map(f => {
    const r = roots.get(f)
    return { filial: f, entrada: r?.E.byMonth ?? empty(), saida: r?.S.byMonth ?? empty() }
  })

  const data: Record<string, { entradaByMonth: Record<string, number>; saidaByMonth: Record<string, number>; treeE: OutNode[]; treeS: OutNode[] }> = {}
  ;[CONS, ...filiais].forEach(scope => {
    const r = ensure(scope)
    data[scope] = {
      entradaByMonth: r.E.byMonth,
      saidaByMonth: r.S.byMonth,
      treeE: serialize(r.E),
      treeS: serialize(r.S),
    }
  })

  return NextResponse.json({ hasData: entries.length > 0, months, filiais, byFilial, data })
}
