'use client'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { CommercialUploader } from '@/components/CommercialUploader'
import {
  ComposedChart, Bar, Line, BarChart, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Legend,
} from 'recharts'

interface OutNode { label: string; total: number; byMonth: Record<string, number>; children: OutNode[] }
interface ScopeData { entradaByMonth: Record<string, number>; saidaByMonth: Record<string, number>; treeE: OutNode[]; treeS: OutNode[] }
interface CashflowData {
  hasData: boolean
  months: string[]
  filiais: string[]
  byFilial: { filial: string; entrada: Record<string, number>; saida: Record<string, number> }[]
  data: Record<string, ScopeData>
}

const CONS = 'CONSOLIDADO'
const fmt = (n: number) => (n < 0 ? '−' : '') + 'R$ ' + Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtShort = (n: number) => (n < 0 ? '−' : '') + Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
const fmtK = (n: number) => { const a = Math.abs(n); return (n < 0 ? '−' : '') + (a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(0)}k` : a.toFixed(0)) }
const MONTH_LABEL: Record<string, string> = { '01': 'Jan', '02': 'Fev', '03': 'Mar', '04': 'Abr', '05': 'Mai', '06': 'Jun', '07': 'Jul', '08': 'Ago', '09': 'Set', '10': 'Out', '11': 'Nov', '12': 'Dez' }
const mLabel = (m: string) => { const [y, mm] = m.split('-'); return `${MONTH_LABEL[mm] ?? mm}/${y.slice(2)}` }

const C = {
  navy: '#0a2540', navyMid: '#142c4e', yellow: '#f5c518', gold: '#d4a017',
  line: '#e3e7ed', textSoft: '#4a5670', textMuted: '#7a869a', green: '#197a4a', red: '#b03022',
}

export function CashflowAnalitico() {
  const [data, setData] = useState<CashflowData | null>(null)
  const [loading, setLoading] = useState(true)
  const [scope, setScope] = useState(CONS)
  const [selMonths, setSelMonths] = useState<string[]>([])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const load = async () => {
    setLoading(true)
    const r = await fetch('/api/cashflow-analitico').then(r => r.json())
    setData(r)
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const allMonths = data?.months ?? []
  const shownMonths = useMemo(() => selMonths.length ? allMonths.filter(m => selMonths.includes(m)) : allMonths, [allMonths, selMonths])
  const sumShown = (bm: Record<string, number>) => shownMonths.reduce((s, m) => s + (bm[m] ?? 0), 0)
  const toggleMonth = (m: string) => setSelMonths(p => p.includes(m) ? p.filter(x => x !== m) : [...p, m])
  const cur = data?.data?.[scope]

  const kpi = useMemo(() => {
    if (!cur) return { entrada: 0, saida: 0 }
    return { entrada: sumShown(cur.entradaByMonth), saida: sumShown(cur.saidaByMonth) }
  }, [cur, shownMonths])

  // evolução mensal (entrada × saída × saldo)
  const evolution = useMemo(() => {
    if (!cur) return []
    return shownMonths.map(m => {
      const e = cur.entradaByMonth[m] ?? 0, s = cur.saidaByMonth[m] ?? 0
      return { mes: mLabel(m), entrada: e, saida: s, saldo: e - s }
    })
  }, [cur, shownMonths])

  // comparativo por filial
  const filialCompare = useMemo(() => {
    if (!data) return []
    return data.byFilial.map(f => {
      const e = sumShown(f.entrada), s = sumShown(f.saida)
      return { filial: f.filial, entrada: e, saida: s, saldo: e - s }
    }).sort((a, b) => b.entrada - a.entrada)
  }, [data, shownMonths])

  const tooltipStyle = { contentStyle: { background: C.navy, border: 'none', borderRadius: 4, fontSize: 12 }, labelStyle: { color: C.yellow, fontWeight: 600 }, itemStyle: { color: '#fff' } }

  if (loading) return <div className="empty-state"><div className="empty-state-icon">◌</div><div className="empty-state-title">Carregando CashFlow…</div></div>

  return (
    <>
      <div className="mb-6" style={{ maxWidth: 620 }}>
        <CommercialUploader
          title="CashFlow Analítico (contabilidade)"
          description="XLSX plano com FILIAL, TIPO (E/S) e CLASSIF_CONTABIL. Substitui toda a base do CashFlow. Não altera a DRE."
          endpoint="/api/cashflow-analitico/import"
          onDone={load}
        />
      </div>

      {!data?.hasData ? (
        <div className="card"><div className="empty-state"><div className="empty-state-icon">◈</div><div className="empty-state-title">Sem CashFlow importado</div><div className="empty-state-sub">Envie o arquivo do razão de caixa analítico acima.</div></div></div>
      ) : (
        <>
          {/* Escopo (filiais) */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {[CONS, ...data.filiais].map(s => (
              <button key={s} className={scope === s ? 'btn btn-primary btn-sm' : 'btn btn-sm'} onClick={() => setScope(s)}>{s === CONS ? '★ Consolidado' : s}</button>
            ))}
          </div>
          {/* Meses */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 20, paddingBottom: 16, borderBottom: `1px solid ${C.line}` }}>
            <span style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.textMuted, fontWeight: 600 }}>Meses</span>
            <button className={selMonths.length === 0 ? 'btn btn-primary btn-sm' : 'btn btn-sm'} onClick={() => setSelMonths([])}>Todos</button>
            {allMonths.map(m => <button key={m} className={selMonths.includes(m) ? 'btn btn-primary btn-sm' : 'btn btn-sm'} onClick={() => toggleMonth(m)}>{mLabel(m)}</button>)}
          </div>

          {/* KPIs */}
          <div className="grid-3 mb-6">
            <Kpi label="Entradas (E)" value={fmt(kpi.entrada)} color={C.green} />
            <Kpi label="Saídas (S)" value={fmt(kpi.saida)} color={C.red} />
            <Kpi label="Saldo do período" value={fmt(kpi.entrada - kpi.saida)} color={kpi.entrada - kpi.saida >= 0 ? C.navy : C.red} />
          </div>

          {/* Gráficos */}
          <div className="grid-2 mb-6">
            <div className="card card-accent-yellow">
              <div className="card-eyebrow">Evolução mensal</div>
              <div className="card-title" style={{ fontSize: 14, marginBottom: 12 }}>Entradas × Saídas × Saldo</div>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={evolution}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.line} />
                  <XAxis dataKey="mes" tick={{ fontSize: 11, fill: C.textSoft }} stroke={C.line} />
                  <YAxis tick={{ fontSize: 10, fill: C.textSoft }} stroke={C.line} tickFormatter={fmtK} />
                  <Tooltip {...tooltipStyle} formatter={(v: number) => fmt(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="entrada" name="Entradas" fill={C.green} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="saida" name="Saídas" fill={C.red} radius={[3, 3, 0, 0]} />
                  <Line dataKey="saldo" name="Saldo" stroke={C.gold} strokeWidth={2.5} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="card">
              <div className="card-eyebrow">Comparativo</div>
              <div className="card-title" style={{ fontSize: 14, marginBottom: 12 }}>Entradas × Saídas por filial</div>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={filialCompare}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.line} />
                  <XAxis dataKey="filial" tick={{ fontSize: 9, fill: C.textSoft }} stroke={C.line} interval={0} angle={-12} textAnchor="end" height={50} />
                  <YAxis tick={{ fontSize: 10, fill: C.textSoft }} stroke={C.line} tickFormatter={fmtK} />
                  <Tooltip {...tooltipStyle} formatter={(v: number) => fmt(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="entrada" name="Entradas" fill={C.green} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="saida" name="Saídas" fill={C.red} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Árvores de classificação */}
          <TreeTable title="Entradas — por classificação contábil" accent={C.green} nodes={cur?.treeE ?? []} shownMonths={shownMonths} sumShown={sumShown} expanded={expanded} setExpanded={setExpanded} prefix="E" />
          <div style={{ height: 20 }} />
          <TreeTable title="Saídas — por classificação contábil" accent={C.red} nodes={cur?.treeS ?? []} shownMonths={shownMonths} sumShown={sumShown} expanded={expanded} setExpanded={setExpanded} prefix="S" />

          <p style={{ fontSize: 11, color: C.textMuted, marginTop: 16, lineHeight: 1.6 }}>
            <b>Razão de caixa analítico da contabilidade</b> — visão independente da DRE (não altera nenhum número dela).
            E = entradas, S = saídas, agregadas pela classificação contábil oficial (até 6 níveis). Clique nas linhas para abrir os níveis.
          </p>
        </>
      )}
    </>
  )
}

function TreeTable({ title, accent, nodes, shownMonths, sumShown, expanded, setExpanded, prefix }: {
  title: string; accent: string; nodes: OutNode[]; shownMonths: string[]
  sumShown: (bm: Record<string, number>) => number
  expanded: Record<string, boolean>; setExpanded: React.Dispatch<React.SetStateAction<Record<string, boolean>>>; prefix: string
}) {
  const grand = nodes.reduce((s, n) => s + sumShown(n.byMonth), 0)
  const render = (node: OutNode, depth: number, path: string): React.ReactNode => {
    const key = prefix + '|' + path
    const open = expanded[key]
    const hasKids = node.children.length > 0
    const total = sumShown(node.byMonth)
    if (total === 0) return null
    return (
      <Fragment key={key}>
        <tr onClick={() => hasKids && setExpanded(e => ({ ...e, [key]: !e[key] }))} style={{ cursor: hasKids ? 'pointer' : 'default', background: depth === 0 ? '#fbfcfe' : '#fff' }}>
          <td style={{ paddingLeft: 16 + depth * 20, fontSize: depth === 0 ? 12 : 11, color: depth === 0 ? C.navy : C.textSoft, fontWeight: depth === 0 ? 600 : 400, whiteSpace: 'nowrap' }}>
            <span style={{ display: 'inline-block', width: 12, color: C.textMuted }}>{hasKids ? (open ? '▾' : '▸') : ''}</span>{node.label}
          </td>
          {shownMonths.map(m => <td key={m} style={{ textAlign: 'right', fontSize: 11, color: C.textMuted }}>{fmtShort(node.byMonth[m] ?? 0)}</td>)}
          <td style={{ textAlign: 'right', fontSize: 11, fontWeight: 600, background: '#f6f8fb', color: accent }}>{fmtShort(total)}</td>
        </tr>
        {open && node.children.map((c, i) => render(c, depth + 1, path + '/' + i))}
      </Fragment>
    )
  }
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '14px 24px', borderBottom: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: accent, display: 'inline-block' }} />
        <div>
          <div className="card-eyebrow">Detalhamento</div>
          <div className="card-title" style={{ fontSize: 14 }}>{title}</div>
        </div>
        <div style={{ marginLeft: 'auto', fontFamily: 'var(--font-serif), serif', fontSize: 16, color: accent }}>{fmt(grand)}</div>
      </div>
      <div className="table-wrap sticky-first">
        <table style={{ minWidth: '100%' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Classificação</th>
              {shownMonths.map(m => <th key={m} style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{mLabel(m)}</th>)}
              <th style={{ textAlign: 'right', background: C.navyMid }}>Total</th>
            </tr>
          </thead>
          <tbody>{nodes.map((n, i) => render(n, 0, String(i)))}</tbody>
        </table>
      </div>
    </div>
  )
}

function Kpi({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ borderLeft: `3px solid ${color}`, paddingLeft: 14 }}>
      <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-serif), serif', fontSize: 19, color, lineHeight: 1.15, letterSpacing: '-0.01em' }}>{value}</div>
    </div>
  )
}
