'use client'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import Shell from '@/components/Shell'
import { CommercialUploader } from '@/components/CommercialUploader'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'

interface SubRow { sub: string; amount: number }
interface DreRow {
  type: 'group' | 'subtotal'
  key: string
  label: string
  sign?: 1 | -1
  amount: number
  subs?: SubRow[]
}
interface ScopeDre { recLiq: number; rows: DreRow[] }
interface Analytics {
  hasData: boolean
  units: string[]
  months: string[]
  dre: Record<string, ScopeDre>
}

const CONS = 'CONSOLIDADO'
const fmt = (n: number) => (n < 0 ? '−' : '') + 'R$ ' + Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtK = (n: number) => Math.abs(n) >= 1e6 ? `${(n/1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `${(n/1e3).toFixed(0)}k` : n.toFixed(0)

const C = {
  navy: '#0a2540', yellow: '#f5c518', gold: '#d4a017',
  line: '#e3e7ed', textSoft: '#4a5670', textMuted: '#7a869a',
  green: '#197a4a', red: '#b03022',
}
const UNITS = ['VS - TRÊS RIOS','VS - QUATIS','VS - APERIBÉ','VS - RIO BONITO','MM - RIO BONITO','MM - APERIBÉ','MM - 7 LAGOAS']

export default function DrePage() {
  const [data, setData] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [scope, setScope] = useState<string>(CONS)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [recUnit, setRecUnit] = useState<string>(UNITS[0])
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

  const uploadReceita = async (file: File) => {
    setRecBusy(true); setRecMsg(`Lendo recebidos de ${recUnit}…`)
    const fd = new FormData(); fd.append('file', file); fd.append('unit', recUnit)
    try {
      const res = await fetch('/api/dre/import', { method: 'POST', body: fd })
      const d = await res.json()
      if (!res.ok) { setRecMsg('Erro: ' + (d.error || 'falha')) }
      else { setRecMsg(`✓ ${recUnit}: ${d.inserted} lançamentos (total ${fmt(d.totalValor)})`); await load() }
    } catch (e) { setRecMsg('Erro: ' + (e instanceof Error ? e.message : String(e))) }
    setRecBusy(false)
  }

  const cur = data?.dre?.[scope]
  const kpi = useMemo(() => {
    if (!cur) return null
    const get = (k: string) => cur.rows.find(r => r.key === k)?.amount ?? 0
    return { recLiq: get('RECLIQ'), mc: get('MC'), lucroOp: get('LUCROOP'), ebitda: get('EBITDA'), ll: get('LL') }
  }, [cur])

  // gráfico: composição de despesas (grupos negativos)
  const chartData = useMemo(() => {
    if (!cur) return []
    return cur.rows
      .filter(r => r.type === 'group' && r.sign === -1 && r.amount !== 0)
      .map(r => ({ label: r.label.replace('Despesas ', '').replace('Custos Variáveis Operacionais', 'CMV'), value: r.amount }))
      .sort((a, b) => b.value - a.value)
  }, [cur])

  return (
    <Shell>
      <div className="page-header">
        <div>
          <div className="page-eyebrow">Módulo · Resultado</div>
          <h1 className="page-title">DRE Gerencial</h1>
          <p className="page-subtitle">
            Demonstração de resultado em <b>regime de caixa</b>, consolidada e por unidade.
            Receita dos títulos recebidos, despesas dos pagamentos efetuados, classificadas por linha e subconta.
          </p>
        </div>
      </div>

      {/* Uploaders */}
      <div className="grid-2 mb-6">
        <CommercialUploader
          title="Pagamentos Efetuados (consolidado)"
          description="XLSX com coluna VLR PAGO e FILIAL. Classifica as despesas e substitui toda a base de despesas."
          endpoint="/api/dre/import"
          onDone={load}
        />
        <div style={{ border: `2px dashed ${C.line}`, borderRadius: 4, padding: '16px 18px', background: 'var(--arken-paper)' }}>
          <div style={{ fontFamily: 'var(--font-serif), serif', fontSize: 15, color: C.navy, marginBottom: 8 }}>
            Títulos Recebidos (por unidade)
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select className="form-select" value={recUnit} onChange={e => setRecUnit(e.target.value)} style={{ flex: 1, minWidth: 160 }}>
              {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
            <input ref={recRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) uploadReceita(f); e.target.value = '' }} />
            <button className="btn btn-primary btn-sm" disabled={recBusy} onClick={() => recRef.current?.click()}>
              {recBusy ? '◌' : '⬆ Enviar recebidos'}
            </button>
          </div>
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 6 }}>
            Escolha a unidade e suba o arquivo de recebidos dela (VLR BAIXA). Substitui a receita daquela unidade.
          </div>
          {recMsg && <div style={{ fontSize: 11, marginTop: 6, color: recMsg.startsWith('✓') ? C.green : recMsg.startsWith('Erro') ? C.red : C.textMuted }}>{recMsg}</div>}
        </div>
      </div>

      {loading ? (
        <div className="empty-state"><div className="empty-state-icon">◌</div><div className="empty-state-title">Calculando DRE…</div></div>
      ) : !data?.hasData ? (
        <div className="card"><div className="empty-state">
          <div className="empty-state-icon">◆</div>
          <div className="empty-state-title">Sem dados ainda</div>
          <p style={{ fontSize: 13, color: C.textMuted, marginTop: 12 }}>Suba o consolidado de pagamentos e os recebidos de cada unidade acima.</p>
        </div></div>
      ) : (
        <>
          {/* Seletor de escopo */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
            {[CONS, ...data.units].map(s => (
              <button key={s} className={scope === s ? 'btn btn-primary btn-sm' : 'btn btn-sm'} onClick={() => setScope(s)}>
                {s === CONS ? '★ Consolidado' : s}
              </button>
            ))}
          </div>

          {/* KPIs */}
          {kpi && (
            <div className="grid-5 mb-6">
              <Kpi label="Receita Líquida" value={fmt(kpi.recLiq)} color={C.navy} />
              <Kpi label="Margem de Contribuição" value={fmt(kpi.mc)} sub={kpi.recLiq ? `${(kpi.mc/kpi.recLiq*100).toFixed(1)}%` : ''} color={C.gold} />
              <Kpi label="Lucro Operacional" value={fmt(kpi.lucroOp)} sub={kpi.recLiq ? `${(kpi.lucroOp/kpi.recLiq*100).toFixed(1)}%` : ''} color={kpi.lucroOp >= 0 ? C.green : C.red} />
              <Kpi label="EBITDA" value={fmt(kpi.ebitda)} sub={kpi.recLiq ? `${(kpi.ebitda/kpi.recLiq*100).toFixed(1)}%` : ''} color={kpi.ebitda >= 0 ? C.green : C.red} />
              <Kpi label="Lucro Líquido Gerencial" value={fmt(kpi.ll)} sub={kpi.recLiq ? `${(kpi.ll/kpi.recLiq*100).toFixed(1)}%` : ''} color={kpi.ll >= 0 ? C.green : C.red} />
            </div>
          )}

          {/* Gráfico composição de despesas */}
          {chartData.length > 0 && (
            <div className="card mb-6 card-accent-yellow">
              <div className="card-header"><div><div className="card-eyebrow">Para onde vai o dinheiro</div><div className="card-title">Composição das despesas — {scope === CONS ? 'Consolidado' : scope}</div></div></div>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartData} layout="vertical" margin={{ left: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.line} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: C.textSoft }} stroke={C.line} tickFormatter={fmtK} />
                  <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: C.textSoft }} stroke={C.line} width={150} />
                  <Tooltip contentStyle={{ background: C.navy, border: 'none', borderRadius: 4 }} labelStyle={{ color: C.yellow, fontWeight: 600 }} itemStyle={{ color: '#fff' }} formatter={(v: number) => fmt(v)} />
                  <Bar dataKey="value" radius={[0, 3, 3, 0]}>
                    {chartData.map((d, i) => <Cell key={i} fill={i === 0 ? C.red : C.navy} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Tabela DRE */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 24px', borderBottom: `1px solid ${C.line}` }}>
              <div className="card-eyebrow">Demonstração completa</div>
              <div className="card-title">DRE — {scope === CONS ? 'Consolidado (todas as unidades)' : scope}</div>
            </div>
            <div className="table-wrap">
              <table>
                <tbody>
                  {cur?.rows.map(row => {
                    if (row.type === 'subtotal') {
                      const pos = row.amount >= 0
                      const big = row.key === 'LL' || row.key === 'EBITDA'
                      return (
                        <tr key={row.key} style={{ background: big ? C.navy : '#f4f7fb' }}>
                          <td style={{ fontWeight: 700, fontSize: big ? 14 : 13, color: big ? '#fff' : C.navy, padding: '12px 24px' }}>
                            (=) {row.label}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 700, fontSize: big ? 15 : 13, padding: '12px 24px', color: big ? (pos ? C.yellow : '#ff8a7a') : (pos ? C.green : C.red) }}>
                            {fmt(row.amount)}
                          </td>
                        </tr>
                      )
                    }
                    const open = expanded[row.key]
                    const display = row.sign === -1 ? -row.amount : row.amount
                    return (
                      <Fragment key={row.key}>
                        <tr onClick={() => row.subs && row.subs.length > 0 && setExpanded(e => ({ ...e, [row.key]: !e[row.key] }))}
                          style={{ cursor: row.subs && row.subs.length ? 'pointer' : 'default', borderTop: `1px solid ${C.line}` }}>
                          <td style={{ padding: '10px 24px', fontSize: 13, color: C.textSoft }}>
                            <span style={{ display: 'inline-block', width: 16, color: C.textMuted }}>{row.subs && row.subs.length ? (open ? '▾' : '▸') : ''}</span>
                            {row.sign === -1 ? '(−) ' : '(+) '}{row.label}
                          </td>
                          <td style={{ textAlign: 'right', padding: '10px 24px', fontSize: 13, color: row.sign === -1 ? C.red : C.navy, fontWeight: 500 }}>
                            {fmt(display)}
                          </td>
                        </tr>
                        {open && row.subs?.map((s, i) => (
                          <tr key={row.key + i} style={{ background: '#fbfcfe' }}>
                            <td style={{ padding: '6px 24px 6px 56px', fontSize: 12, color: C.textMuted }}>{s.sub}</td>
                            <td style={{ textAlign: 'right', padding: '6px 24px', fontSize: 12, color: C.textMuted }}>{fmt(row.sign === -1 ? -s.amount : s.amount)}</td>
                          </tr>
                        ))}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <p style={{ fontSize: 11, color: C.textMuted, marginTop: 12, lineHeight: 1.6 }}>
            Regime de caixa (data de baixa). O CMV por unidade reflete quem <b>pagou</b> o fornecedor, não onde o produto foi vendido —
            a compra é centralizada, então a margem por unidade deve ser lida no consolidado. Multmunde é tratada como intragrupo dentro do CMV.
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
      <div style={{ fontFamily: 'var(--font-serif), serif', fontSize: 18, color, lineHeight: 1.15, letterSpacing: '-0.01em' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>{sub} da rec. líq.</div>}
    </div>
  )
}
