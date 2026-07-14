'use client'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import Shell from '@/components/Shell'
import { CommercialUploader } from '@/components/CommercialUploader'
import {
  BarChart, Bar, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Legend,
} from 'recharts'

interface SupplierRow { name: string; code: string | null; amount: number }
interface SubRow { sub: string; total: number; byMonth: Record<string, number>; suppliers?: SupplierRow[] }
interface DreRow {
  type: 'group' | 'subtotal' | 'memo'
  key: string
  label: string
  sign?: 1 | -1
  total: number
  byMonth: Record<string, number>
  subs?: SubRow[]
}
interface Analytics {
  hasData: boolean
  units: string[]
  months: string[]
  dre: Record<string, { rows: DreRow[] }>
}

const CONS = 'CONSOLIDADO'
const fmt = (n: number) => (n < 0 ? '−' : '') + 'R$ ' + Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtShort = (n: number) => (n < 0 ? '−' : '') + Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
const fmtK = (n: number) => { const a = Math.abs(n); return (n < 0 ? '−' : '') + (a >= 1e6 ? `${(a/1e6).toFixed(1)}M` : a >= 1e3 ? `${(a/1e3).toFixed(0)}k` : a.toFixed(0)) }
const pct = (n: number, base: number) => base ? `${(n / base * 100).toFixed(1)}%` : '—'
const MONTH_LABEL: Record<string, string> = { '01':'Jan','02':'Fev','03':'Mar','04':'Abr','05':'Mai','06':'Jun','07':'Jul','08':'Ago','09':'Set','10':'Out','11':'Nov','12':'Dez' }
const mLabel = (m: string) => { const [y, mm] = m.split('-'); return `${MONTH_LABEL[mm] ?? mm}/${y.slice(2)}` }

const C = {
  navy: '#0a2540', navyMid: '#142c4e', yellow: '#f5c518', gold: '#d4a017',
  line: '#e3e7ed', textSoft: '#4a5670', textMuted: '#7a869a',
  green: '#197a4a', red: '#b03022',
}

export default function DrePage() {
  const [data, setData] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [scope, setScope] = useState(CONS)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [expandedSub, setExpandedSub] = useState<Record<string, boolean>>({})
  const [selMonths, setSelMonths] = useState<string[]>([])
  const [avMode, setAvMode] = useState(false)
  const [recUnit, setRecUnit] = useState('VS - TRÊS RIOS')
  const [recMsg, setRecMsg] = useState('')
  const [recBusy, setRecBusy] = useState(false)
  const recRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    setLoading(true)
    const r = await fetch('/api/dre').then(r => r.json())
    setData(r)
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const UNITS = ['VS - TRÊS RIOS','VS - QUATIS','VS - APERIBÉ','VS - RIO BONITO','MM - RIO BONITO','MM - APERIBÉ','MM - 7 LAGOAS']
  const uploadReceita = async (file: File) => {
    setRecBusy(true); setRecMsg(`Lendo recebidos de ${recUnit}…`)
    const fd = new FormData(); fd.append('file', file); fd.append('unit', recUnit)
    try {
      const res = await fetch('/api/dre/import', { method: 'POST', body: fd })
      const d = await res.json()
      if (!res.ok) setRecMsg('Erro: ' + (d.error || 'falha'))
      else { setRecMsg(`✓ ${recUnit}: ${d.inserted} lançamentos`); await load() }
    } catch (e) { setRecMsg('Erro: ' + (e instanceof Error ? e.message : String(e))) }
    setRecBusy(false)
  }

  const allMonths = data?.months ?? []
  const shownMonths = useMemo(() => selMonths.length ? allMonths.filter(m => selMonths.includes(m)) : allMonths, [allMonths, selMonths])
  const cur = data?.dre?.[scope]
  const sumShown = (bm: Record<string, number>) => shownMonths.reduce((s, m) => s + (bm[m] ?? 0), 0)
  const rowOf = (key: string) => cur?.rows.find(r => r.key === key)
  const recLiqTotal = useMemo(() => { const r = rowOf('RECLIQ'); return r ? sumShown(r.byMonth) : 0 }, [cur, shownMonths])

  const kpis = useMemo(() => {
    if (!cur) return null
    const v = (k: string) => { const r = rowOf(k); return r ? sumShown(r.byMonth) : 0 }
    return { recLiq: v('RECLIQ'), mc: v('MC'), lucroOp: v('LUCROOP'), ebitda: v('EBITDA'), ll: v('LL') }
  }, [cur, shownMonths])

  // Evolução mensal (Receita Líquida vs Resultado)
  const evolution = useMemo(() => {
    if (!cur) return []
    const rl = rowOf('RECLIQ')?.byMonth ?? {}, ll = rowOf('LL')?.byMonth ?? {}
    return shownMonths.map(m => ({ mes: mLabel(m), receita: rl[m] ?? 0, resultado: ll[m] ?? 0 }))
  }, [cur, shownMonths])

  // Estrutura de despesas (% da Rec. Líq.)
  const expenseStruct = useMemo(() => {
    if (!cur) return []
    return cur.rows.filter(r => r.type === 'group' && r.sign === -1 && r.key !== 'DEDUCAO')
      .map(r => ({ label: r.label.replace('Despesas ', '').replace('Custos Variáveis Operacionais', 'CMV'), value: sumShown(r.byMonth) }))
      .filter(r => r.value > 0).sort((a, b) => b.value - a.value)
  }, [cur, shownMonths])

  // Por unidade (só no consolidado)
  const byUnit = useMemo(() => {
    if (!data || scope !== CONS) return []
    return data.units.map(u => {
      const rows = data.dre[u].rows
      const rl = rows.find(r => r.key === 'RECLIQ')?.byMonth ?? {}
      const ll = rows.find(r => r.key === 'LL')?.byMonth ?? {}
      return { unit: u.replace('VS - ', 'VS ').replace('MM - ', 'MM '), receita: sumShown(rl), resultado: sumShown(ll) }
    }).sort((a, b) => b.receita - a.receita)
  }, [data, scope, shownMonths])

  const toggleMonth = (m: string) => setSelMonths(p => p.includes(m) ? p.filter(x => x !== m) : [...p, m])

  const tooltipStyle = { contentStyle: { background: C.navy, border: 'none', borderRadius: 4, fontSize: 12 }, labelStyle: { color: C.yellow, fontWeight: 600 }, itemStyle: { color: '#fff' } }

  return (
    <Shell>
      <div className="page-header">
        <div>
          <div className="page-eyebrow">Módulo · Resultado</div>
          <h1 className="page-title">DRE Gerencial</h1>
          <p className="page-subtitle">
            Demonstração de resultado em <b>regime de caixa</b>, consolidada e por unidade, com evolução mensal e análise vertical.
          </p>
        </div>
      </div>

      <div className="grid-2 mb-6">
        <CommercialUploader
          title="Pagamentos Efetuados (consolidado)"
          description="XLSX com VLR PAGO e FILIAL. Classifica as despesas e substitui a base de despesas."
          endpoint="/api/dre/import"
          onDone={load}
        />
        <div style={{ border: `2px dashed ${C.line}`, borderRadius: 4, padding: '16px 18px', background: 'var(--arken-paper)' }}>
          <div style={{ fontFamily: 'var(--font-serif), serif', fontSize: 15, color: C.navy, marginBottom: 8 }}>Títulos Recebidos (por unidade)</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select className="form-select" value={recUnit} onChange={e => setRecUnit(e.target.value)} style={{ flex: 1, minWidth: 160 }}>
              {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
            <input ref={recRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) uploadReceita(f); e.target.value = '' }} />
            <button className="btn btn-primary btn-sm" disabled={recBusy} onClick={() => recRef.current?.click()}>{recBusy ? '◌' : '⬆ Enviar'}</button>
          </div>
          {recMsg && <div style={{ fontSize: 11, marginTop: 6, color: recMsg.startsWith('✓') ? C.green : recMsg.startsWith('Erro') ? C.red : C.textMuted }}>{recMsg}</div>}
        </div>
      </div>

      {loading ? (
        <div className="empty-state"><div className="empty-state-icon">◌</div><div className="empty-state-title">Calculando DRE…</div></div>
      ) : !data?.hasData ? (
        <div className="card"><div className="empty-state"><div className="empty-state-icon">◆</div><div className="empty-state-title">Sem dados ainda</div></div></div>
      ) : (
        <>
          {/* Escopo */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {[CONS, ...data.units].map(s => (
              <button key={s} className={scope === s ? 'btn btn-primary btn-sm' : 'btn btn-sm'} onClick={() => setScope(s)}>{s === CONS ? '★ Consolidado' : s}</button>
            ))}
          </div>
          {/* Controles: meses + modo */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 20, paddingBottom: 16, borderBottom: `1px solid ${C.line}` }}>
            <span style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.textMuted, fontWeight: 600 }}>Meses</span>
            <button className={selMonths.length === 0 ? 'btn btn-primary btn-sm' : 'btn btn-sm'} onClick={() => setSelMonths([])}>Todos</button>
            {allMonths.map(m => <button key={m} className={selMonths.includes(m) ? 'btn btn-primary btn-sm' : 'btn btn-sm'} onClick={() => toggleMonth(m)}>{mLabel(m)}</button>)}
            <div style={{ marginLeft: 'auto', display: 'inline-flex', border: `1px solid ${C.line}`, borderRadius: 4, overflow: 'hidden' }}>
              <button className="btn btn-sm" style={{ border: 'none', borderRadius: 0, background: !avMode ? C.navy : '#fff', color: !avMode ? '#fff' : C.textSoft }} onClick={() => setAvMode(false)}>R$</button>
              <button className="btn btn-sm" style={{ border: 'none', borderRadius: 0, background: avMode ? C.navy : '#fff', color: avMode ? '#fff' : C.textSoft }} onClick={() => setAvMode(true)}>AV %</button>
            </div>
          </div>

          {/* ═══ DASHBOARD ═══ */}
          {kpis && (
            <div className="grid-5 mb-6">
              <Kpi label="Receita Líquida" value={fmt(kpis.recLiq)} color={C.navy} />
              <Kpi label="Margem Contribuição" value={fmt(kpis.mc)} sub={pct(kpis.mc, kpis.recLiq)} color={C.gold} />
              <Kpi label="Lucro Operacional" value={fmt(kpis.lucroOp)} sub={pct(kpis.lucroOp, kpis.recLiq)} color={kpis.lucroOp >= 0 ? C.green : C.red} />
              <Kpi label="EBITDA" value={fmt(kpis.ebitda)} sub={pct(kpis.ebitda, kpis.recLiq)} color={kpis.ebitda >= 0 ? C.green : C.red} />
              <Kpi label="Lucro Líquido" value={fmt(kpis.ll)} sub={pct(kpis.ll, kpis.recLiq)} color={kpis.ll >= 0 ? C.green : C.red} />
            </div>
          )}

          <div className="grid-2 mb-6">
            <div className="card card-accent-yellow">
              <div className="card-eyebrow">Evolução mensal</div>
              <div className="card-title" style={{ fontSize: 14, marginBottom: 12 }}>Receita Líquida × Resultado</div>
              <ResponsiveContainer width="100%" height={250}>
                <ComposedChart data={evolution}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.line} />
                  <XAxis dataKey="mes" tick={{ fontSize: 11, fill: C.textSoft }} stroke={C.line} />
                  <YAxis tick={{ fontSize: 10, fill: C.textSoft }} stroke={C.line} tickFormatter={fmtK} />
                  <Tooltip {...tooltipStyle} formatter={(v: number) => fmt(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="receita" name="Receita Líquida" fill={C.navy} radius={[3, 3, 0, 0]} />
                  <Line dataKey="resultado" name="Resultado" stroke={C.gold} strokeWidth={2.5} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="card">
              <div className="card-eyebrow">Estrutura</div>
              <div className="card-title" style={{ fontSize: 14, marginBottom: 12 }}>Despesas — % da Receita Líquida</div>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={expenseStruct} layout="vertical" margin={{ left: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.line} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: C.textSoft }} stroke={C.line} tickFormatter={v => recLiqTotal ? `${(v/recLiqTotal*100).toFixed(0)}%` : fmtK(v)} />
                  <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: C.textSoft }} stroke={C.line} width={140} />
                  <Tooltip {...tooltipStyle} formatter={(v: number) => `${fmt(v)} (${pct(v, recLiqTotal)})`} />
                  <Bar dataKey="value" radius={[0, 3, 3, 0]}>{expenseStruct.map((d, i) => <Cell key={i} fill={i === 0 ? C.red : C.navy} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {scope === CONS && byUnit.length > 0 && (
            <div className="card mb-6">
              <div className="card-eyebrow">Comparativo</div>
              <div className="card-title" style={{ fontSize: 14, marginBottom: 12 }}>Receita Líquida × Resultado por unidade</div>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={byUnit}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.line} />
                  <XAxis dataKey="unit" tick={{ fontSize: 10, fill: C.textSoft }} stroke={C.line} />
                  <YAxis tick={{ fontSize: 10, fill: C.textSoft }} stroke={C.line} tickFormatter={fmtK} />
                  <Tooltip {...tooltipStyle} formatter={(v: number) => fmt(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="receita" name="Receita Líquida" fill={C.navy} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="resultado" name="Resultado" radius={[3, 3, 0, 0]}>{byUnit.map((d, i) => <Cell key={i} fill={d.resultado >= 0 ? C.green : C.red} />)}</Bar>
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ═══ TABELA COMPARATIVA ═══ */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 24px', borderBottom: `1px solid ${C.line}` }}>
              <div className="card-eyebrow">Demonstração completa</div>
              <div className="card-title">DRE mensal — {scope === CONS ? 'Consolidado' : scope} {avMode && '· análise vertical'}</div>
            </div>
            <div className="table-wrap sticky-first">
              <table style={{ minWidth: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Linha</th>
                    {shownMonths.map(m => <th key={m} style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{mLabel(m)}</th>)}
                    <th style={{ textAlign: 'right', background: C.navyMid }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {cur?.rows.map(row => {
                    const recliqRow = rowOf('RECLIQ')
                    const cell = (m: string | null) => {
                      const raw = m ? (row.byMonth[m] ?? 0) : sumShown(row.byMonth)
                      const disp = row.sign === -1 ? -raw : raw
                      if (avMode) {
                        const base = m ? (recliqRow?.byMonth[m] ?? 0) : recLiqTotal
                        return base ? `${(raw / base * 100).toFixed(1)}%` : '—'
                      }
                      return fmtShort(disp)
                    }
                    if (row.type === 'subtotal') {
                      const big = row.key === 'LL' || row.key === 'EBITDA'
                      const totalRaw = sumShown(row.byMonth)
                      return (
                        <tr key={row.key} style={{ background: big ? C.navy : '#eef2f8' }}>
                          <td style={{ fontWeight: 700, fontSize: big ? 13 : 12, color: big ? '#fff' : C.navy, whiteSpace: 'nowrap' }}>(=) {row.label}</td>
                          {shownMonths.map(m => <td key={m} style={{ textAlign: 'right', fontWeight: 600, fontSize: 12, color: big ? C.yellow : ((row.byMonth[m] ?? 0) >= 0 ? C.green : C.red) }}>{cell(m)}</td>)}
                          <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 12, background: big ? C.navyMid : '#e2e9f3', color: big ? C.yellow : (totalRaw >= 0 ? C.green : C.red) }}>{cell(null)}</td>
                        </tr>
                      )
                    }
                    const open = expanded[row.key]
                    const isMemo = row.type === 'memo'
                    const hasSubs = (row.subs?.length ?? 0) > 0
                    return (
                      <Fragment key={row.key}>
                        {isMemo && <tr><td colSpan={shownMonths.length + 2} style={{ padding: '8px 24px 2px', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.textMuted, borderTop: `2px solid ${C.line}` }}>Memorando — fora do resultado</td></tr>}
                        <tr onClick={() => hasSubs && setExpanded(e => ({ ...e, [row.key]: !e[row.key] }))} style={{ cursor: hasSubs ? 'pointer' : 'default', background: isMemo ? '#faf6ec' : undefined }}>
                          <td style={{ color: isMemo ? C.gold : C.textSoft, whiteSpace: 'nowrap', fontStyle: isMemo ? 'italic' : 'normal' }}>
                            <span style={{ display: 'inline-block', width: 14, color: C.textMuted }}>{hasSubs ? (open ? '▾' : '▸') : ''}</span>
                            {isMemo ? '' : row.sign === -1 ? '(−) ' : '(+) '}{row.label}
                          </td>
                          {shownMonths.map(m => <td key={m} style={{ textAlign: 'right', fontSize: 12, color: isMemo ? C.gold : row.sign === -1 ? C.red : C.navy }}>{cell(m)}</td>)}
                          <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, background: '#f6f8fb', color: isMemo ? C.gold : row.sign === -1 ? C.red : C.navy }}>{cell(null)}</td>
                        </tr>
                        {open && row.subs?.map((s, i) => {
                          const subKey = row.key + '|' + s.sub
                          const subOpen = expandedSub[subKey]
                          const hasSup = (s.suppliers?.length ?? 0) > 0
                          const subCell = (m: string | null) => {
                            const raw = m ? (s.byMonth[m] ?? 0) : sumShown(s.byMonth)
                            const disp = row.sign === -1 ? -raw : raw
                            if (avMode) { const base = m ? (recliqRow?.byMonth[m] ?? 0) : recLiqTotal; return base ? `${(raw / base * 100).toFixed(1)}%` : '—' }
                            return fmtShort(disp)
                          }
                          return (
                            <Fragment key={subKey}>
                              <tr onClick={ev => { ev.stopPropagation(); if (hasSup) setExpandedSub(e => ({ ...e, [subKey]: !e[subKey] })) }} style={{ background: '#fbfcfe', cursor: hasSup ? 'pointer' : 'default' }}>
                                <td style={{ paddingLeft: 44, fontSize: 11, color: C.textSoft, whiteSpace: 'nowrap' }}>
                                  <span style={{ display: 'inline-block', width: 12, color: C.textMuted }}>{hasSup ? (subOpen ? '▾' : '▸') : ''}</span>{s.sub}
                                </td>
                                {shownMonths.map(m => <td key={m} style={{ textAlign: 'right', fontSize: 11, color: C.textMuted }}>{subCell(m)}</td>)}
                                <td style={{ textAlign: 'right', fontSize: 11, color: C.textSoft, background: '#f6f8fb' }}>{subCell(null)}</td>
                              </tr>
                              {subOpen && s.suppliers?.map((sup, j) => (
                                <tr key={subKey + j} style={{ background: '#fff' }}>
                                  <td style={{ paddingLeft: 68, fontSize: 10.5, color: C.textMuted }}>{sup.code ? <span style={{ color: '#aab3c0' }}>{sup.code} · </span> : null}{sup.name}</td>
                                  <td colSpan={shownMonths.length} style={{ textAlign: 'right', fontSize: 10.5, color: C.textMuted, paddingRight: 8 }} />
                                  <td style={{ textAlign: 'right', fontSize: 10.5, color: C.textMuted, background: '#f6f8fb' }}>{avMode ? pct(sup.amount, recLiqTotal) : fmtShort(row.sign === -1 ? -sup.amount : sup.amount)}</td>
                                </tr>
                              ))}
                            </Fragment>
                          )
                        })}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <p style={{ fontSize: 11, color: C.textMuted, marginTop: 12, lineHeight: 1.6 }}>
            Regime de caixa (data de baixa). O CMV por unidade reflete quem <b>pagou</b> o fornecedor (compra centralizada) — a margem confiável é a do consolidado.
            Multmunde entra como memo intragrupo, fora do resultado. Valores da tabela sem centavos por espaço; abra as subcontas e fornecedores para o detalhe.
          </p>
        </>
      )}
    </Shell>
  )
}

function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div style={{ borderLeft: `3px solid ${color}`, paddingLeft: 14 }}>
      <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-serif), serif', fontSize: 17, color, lineHeight: 1.15, letterSpacing: '-0.01em' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>{sub} da rec. líq.</div>}
    </div>
  )
}
