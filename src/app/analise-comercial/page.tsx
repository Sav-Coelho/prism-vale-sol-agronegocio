'use client'
import { useEffect, useMemo, useState } from 'react'
import Shell from '@/components/Shell'
import { CommercialUploader } from '@/components/CommercialUploader'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell, ReferenceLine, ReferenceArea, ComposedChart, Line,
} from 'recharts'

type MarginTag = 'excellent' | 'ok' | 'low' | 'negative'
type TurnoverStatus = 'rupture' | 'low' | 'healthy' | 'excess'
type AbcClass = 'A' | 'B' | 'C'

interface MasterRow {
  code: string
  description: string
  hasPrice: boolean
  hasCost: boolean
  hasSale: boolean
  retailPrice: number | null
  unitCost: number | null
  marginPct: number | null
  marginAbs: number | null
  marginTag: MarginTag | null
  qtySold: number
  salesValue: number
  avgUnit: number | null
  abcClass: AbcClass | null
  abcRank: number | null
  sharePct: number | null
  cumulativePct: number | null
  qtyStock: number
  stockValue: number
  turnover: number | null
  monthsCoverage: number | null
  turnoverStatus: TurnoverStatus | null
}

interface Analytics {
  counts: { prices: number; stock: number; sales: number; marginItems: number; turnoverItems: number; masterItems: number }
  summary: { excellent: number; detractors: number; ruptures: number; excess: number; totalSalesValue: number; totalStockValue: number }
  masterRows: MasterRow[]
  abcRows: Array<{ rank: number; abcClass: string; cumulativePct: number; sharePct: number }>
}

const fmt    = (n: number | null) => n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtPct = (n: number | null, digits = 1) => n == null ? '—' : `${n.toFixed(digits)}%`
const fmtNum = (n: number | null, digits = 0) => n == null ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: digits })

const C = {
  navy: '#0a2540', yellow: '#f5c518', gold: '#d4a017',
  line: '#e3e7ed', textSoft: '#4a5670', textMuted: '#7a869a',
  green: '#197a4a', red: '#b03022', amber: '#c98a14',
  excellent: '#197a4a', ok: '#d4a017', low: '#c98a14', negative: '#b03022',
  rupture: '#b03022', healthyTurn: '#197a4a', excess: '#5a6c8a',
  lowTurn: '#c98a14',
  A: '#197a4a', B: '#d4a017', Cc: '#b03022',
}

const MARGIN_LABEL: Record<MarginTag, string> = {
  excellent: 'Excelente (≥30%)',
  ok:        'OK (20–30%)',
  low:       'Baixa (<20%)',
  negative:  'Negativa',
}
const TURNOVER_LABEL: Record<TurnoverStatus, string> = {
  rupture: 'Ruptura (<1m)',
  low:     'Baixa (1–2m)',
  healthy: 'Saudável (2–6m)',
  excess:  'Excesso (>6m)',
}
const TURNOVER_COLOR: Record<TurnoverStatus, string> = {
  rupture: C.rupture, low: C.lowTurn, healthy: C.healthyTurn, excess: C.excess,
}
const MARGIN_COLOR: Record<MarginTag, string> = {
  excellent: C.excellent, ok: C.ok, low: C.low, negative: C.negative,
}

type SortKey = keyof MasterRow

export default function AnaliseComercial() {
  const [data, setData] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [marginFilter, setMarginFilter] = useState<'all' | MarginTag>('all')
  const [abcFilter, setAbcFilter] = useState<'all' | AbcClass>('all')
  const [turnoverFilter, setTurnoverFilter] = useState<'all' | TurnoverStatus>('all')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'salesValue', dir: 'desc' })

  const toggleSort = (key: SortKey) =>
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' })

  const load = async () => {
    setLoading(true)
    const r = await fetch('/api/commercial/analytics').then(r => r.json())
    setData(r)
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  // Distribuição de margem (histograma)
  const marginDistribution = useMemo(() => {
    if (!data) return []
    const bins = [
      { label: '<0%',  min: -Infinity, max: 0,    color: C.red },
      { label: '0-10', min: 0,         max: 10,   color: C.red },
      { label: '10-20',min: 10,        max: 20,   color: C.amber },
      { label: '20-30',min: 20,        max: 30,   color: C.gold },
      { label: '30-40',min: 30,        max: 40,   color: '#5a8542' },
      { label: '40-50',min: 40,        max: 50,   color: C.green },
      { label: '≥50',  min: 50,        max: 1e6,  color: C.green },
    ]
    return bins.map(b => ({
      label: b.label,
      n: data.masterRows.filter(r => r.marginPct != null && r.marginPct >= b.min && r.marginPct < b.max).length,
      color: b.color,
    }))
  }, [data])

  // Curva ABC simplificada (sample 150 pontos)
  const abcCurve = useMemo(() => {
    if (!data || data.abcRows.length === 0) return []
    const all = data.abcRows
    const step = Math.max(1, Math.floor(all.length / 150))
    const out: typeof all = []
    for (let i = 0; i < all.length; i += step) out.push(all[i])
    if (out[out.length - 1] !== all[all.length - 1]) out.push(all[all.length - 1])
    return out
  }, [data])

  const abcCuts = useMemo(() => {
    if (!data) return { aEnd: 0, bEnd: 0 }
    let aEnd = 0, bEnd = 0
    data.abcRows.forEach(r => {
      if (r.abcClass === 'A') aEnd = r.rank
      else if (r.abcClass === 'B') bEnd = r.rank
    })
    return { aEnd, bEnd: Math.max(bEnd, aEnd) }
  }, [data])

  // Valor parado por status de giro
  const stockByStatus = useMemo(() => {
    if (!data) return []
    const groups: Record<TurnoverStatus, number> = { rupture: 0, low: 0, healthy: 0, excess: 0 }
    data.masterRows.forEach(r => {
      if (r.turnoverStatus) groups[r.turnoverStatus] += r.stockValue
    })
    return (['rupture','low','healthy','excess'] as const).map(s => ({
      label: TURNOVER_LABEL[s].split(' (')[0],
      status: s,
      value: groups[s],
      color: TURNOVER_COLOR[s],
    }))
  }, [data])

  // Linhas filtradas + ordenadas
  const rows = useMemo(() => {
    if (!data) return []
    let list = data.masterRows
    if (marginFilter !== 'all')   list = list.filter(r => r.marginTag === marginFilter)
    if (abcFilter !== 'all')      list = list.filter(r => r.abcClass === abcFilter)
    if (turnoverFilter !== 'all') list = list.filter(r => r.turnoverStatus === turnoverFilter)
    if (search.trim()) {
      const s = search.toLowerCase()
      list = list.filter(r => r.description.toLowerCase().includes(s) || r.code.includes(s))
    }
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      const va = a[sort.key]
      const vb = b[sort.key]
      if (va == null && vb == null) return 0
      if (va == null) return 1   // null sempre por último
      if (vb == null) return -1
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      return String(va).localeCompare(String(vb), 'pt-BR') * dir
    })
  }, [data, search, marginFilter, abcFilter, turnoverFilter, sort])

  return (
    <Shell>
      <div className="page-header">
        <div>
          <div className="page-eyebrow">Módulo · Análise Comercial</div>
          <h1 className="page-title">Análise Comercial Unificada</h1>
          <p className="page-subtitle">
            Margem de Contribuição, Curva ABC e Giro de Estoque <b>numa única visão por SKU</b>.
            Filtre por classe ABC, faixa de margem e status de giro pra cruzar as três dimensões.
          </p>
        </div>
      </div>

      {/* Uploaders */}
      <div className="grid-3 mb-6">
        <CommercialUploader
          title="Preço de Venda"
          description="XLSX: CÓDIGO · DESCRIÇÃO · PR.VAREJO. Substitui toda a base."
          endpoint="/api/commercial/prices"
          count={data?.counts.prices}
          onDone={load}
        />
        <CommercialUploader
          title="ABC de Estoque"
          description="XLSX com sheet CONSOLIDADO: CÓDIGO · DESCRIÇÃO · QTDE · CUSTO · VALOR."
          endpoint="/api/commercial/stock"
          count={data?.counts.stock}
          onDone={load}
        />
        <CommercialUploader
          title="ABC de Vendas"
          description="XLSX com sheet CONSOLIDADO do ABC de Vendas no mesmo período."
          endpoint="/api/commercial/sales-abc"
          count={data?.counts.sales}
          onDone={load}
        />
      </div>

      {loading ? (
        <div className="empty-state"><div className="empty-state-icon">◌</div><div className="empty-state-title">Calculando…</div></div>
      ) : !data || data.masterRows.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">◆</div>
            <div className="empty-state-title">Suba os 3 arquivos para começar</div>
          </div>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="card mb-6">
            <div className="card-header">
              <div>
                <div className="card-eyebrow">Visão consolidada</div>
                <div className="card-title">Indicadores principais</div>
              </div>
              <div style={{ fontSize: 11, color: C.textMuted, textAlign: 'right' }}>
                <div>Receita ABC: <b style={{ color: C.navy }}>{fmt(data.summary.totalSalesValue)}</b></div>
                <div>Estoque total: <b style={{ color: C.navy }}>{fmt(data.summary.totalStockValue)}</b></div>
              </div>
            </div>
            <div className="grid-5" style={{ gap: 24 }}>
              <Kpi label="SKUs analisados"
                   value={data.counts.masterItems.toLocaleString('pt-BR')}
                   sub={`${data.counts.prices} preços · ${data.counts.stock} estoques · ${data.counts.sales} vendas`}
                   color={C.navy} />
              <Kpi label="Margens excelentes"
                   value={data.summary.excellent.toLocaleString('pt-BR')}
                   sub={`≥ 30% · ${fmtPct(data.summary.excellent / Math.max(1,data.counts.marginItems) * 100)} dos calculáveis`}
                   color={C.green} />
              <Kpi label="Detratores"
                   value={data.summary.detractors.toLocaleString('pt-BR')}
                   sub={`< 20% · ${fmtPct(data.summary.detractors / Math.max(1,data.counts.marginItems) * 100)} dos calculáveis`}
                   color={C.red} />
              <Kpi label="Ruptura iminente"
                   value={data.summary.ruptures.toLocaleString('pt-BR')}
                   sub="cobertura < 1 mês" color={C.rupture} />
              <Kpi label="Capital em excesso"
                   value={data.summary.excess.toLocaleString('pt-BR')}
                   sub="cobertura > 6 meses" color={C.excess} />
            </div>
          </div>

          {/* 3 gráficos lado a lado */}
          <div className="grid-3 mb-6">
            {/* Margem */}
            <div className="card" style={{ paddingBottom: 12 }}>
              <div className="card-eyebrow" style={{ marginBottom: 4 }}>Margem</div>
              <div className="card-title" style={{ fontSize: 14, marginBottom: 12 }}>Distribuição de margem</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={marginDistribution}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.line} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: C.textSoft }} stroke={C.line} />
                  <YAxis tick={{ fontSize: 10, fill: C.textSoft }} stroke={C.line} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: C.navy, border: 'none', borderRadius: 4, padding: '8px 12px', fontSize: 11 }}
                    labelStyle={{ color: C.yellow, fontWeight: 600 }}
                    itemStyle={{ color: '#fff' }}
                  />
                  <Bar dataKey="n" name="SKUs" radius={[3, 3, 0, 0]}>
                    {marginDistribution.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* ABC */}
            <div className="card" style={{ paddingBottom: 12 }}>
              <div className="card-eyebrow" style={{ marginBottom: 4 }}>Curva ABC</div>
              <div className="card-title" style={{ fontSize: 14, marginBottom: 12 }}>% receita acumulada</div>
              <ResponsiveContainer width="100%" height={200}>
                <ComposedChart data={abcCurve}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.line} />
                  <XAxis dataKey="rank" type="number" domain={[1, data.abcRows.length]}
                         tick={{ fontSize: 10, fill: C.textSoft }} stroke={C.line} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: C.textSoft }} stroke={C.line} />
                  <Tooltip
                    contentStyle={{ background: C.navy, border: 'none', borderRadius: 4, padding: '8px 12px', fontSize: 11 }}
                    labelStyle={{ color: C.yellow, fontWeight: 600 }}
                    itemStyle={{ color: '#fff' }}
                    formatter={(v: number) => fmtPct(v)}
                  />
                  {abcCuts.aEnd > 0 && <ReferenceArea x1={1} x2={abcCuts.aEnd} y1={0} y2={100} fill={C.A} fillOpacity={0.07} />}
                  {abcCuts.bEnd > abcCuts.aEnd && <ReferenceArea x1={abcCuts.aEnd} x2={abcCuts.bEnd} y1={0} y2={100} fill={C.B} fillOpacity={0.07} />}
                  {abcCuts.bEnd < data.abcRows.length && <ReferenceArea x1={abcCuts.bEnd} x2={data.abcRows.length} y1={0} y2={100} fill={C.Cc} fillOpacity={0.07} />}
                  <ReferenceLine y={80} stroke={C.A} strokeDasharray="3 3" />
                  <Line type="monotone" dataKey="cumulativePct" stroke={C.navy} strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Giro */}
            <div className="card" style={{ paddingBottom: 12 }}>
              <div className="card-eyebrow" style={{ marginBottom: 4 }}>Giro</div>
              <div className="card-title" style={{ fontSize: 14, marginBottom: 12 }}>Capital em estoque por status</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={stockByStatus} layout="vertical" margin={{ left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.line} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: C.textSoft }} stroke={C.line}
                         tickFormatter={(v: number) => v >= 1e6 ? `${(v/1e6).toFixed(1)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}k` : String(v)} />
                  <YAxis type="category" dataKey="label" tick={{ fontSize: 10, fill: C.textSoft }} stroke={C.line} width={70} />
                  <Tooltip
                    contentStyle={{ background: C.navy, border: 'none', borderRadius: 4, padding: '8px 12px', fontSize: 11 }}
                    labelStyle={{ color: C.yellow, fontWeight: 600 }}
                    itemStyle={{ color: '#fff' }}
                    formatter={(v: number) => fmt(v)}
                  />
                  <Bar dataKey="value" radius={[0, 3, 3, 0]}>
                    {stockByStatus.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Tabela unificada */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 24px', borderBottom: `1px solid ${C.line}` }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 12 }}>
                <div>
                  <div className="card-eyebrow">Detalhamento</div>
                  <div className="card-title">Tabela unificada — {rows.length.toLocaleString('pt-BR')} SKUs</div>
                </div>
                <input
                  className="form-input"
                  placeholder="Buscar código ou produto…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  style={{ width: 240, marginLeft: 'auto' }}
                />
              </div>

              {/* Filtros em 3 linhas: margem · ABC · giro */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11 }}>
                <FilterRow
                  label="Margem"
                  value={marginFilter}
                  onChange={setMarginFilter}
                  options={[
                    { v: 'all', label: 'Todas' },
                    ...(['excellent','ok','low','negative'] as MarginTag[]).map(t => ({ v: t, label: MARGIN_LABEL[t], color: MARGIN_COLOR[t] })),
                  ]}
                />
                <FilterRow
                  label="ABC"
                  value={abcFilter}
                  onChange={setAbcFilter}
                  options={[
                    { v: 'all', label: 'Todas' },
                    { v: 'A', label: 'Sessão A', color: C.A },
                    { v: 'B', label: 'Sessão B', color: C.B },
                    { v: 'C', label: 'Sessão C', color: C.Cc },
                  ]}
                />
                <FilterRow
                  label="Giro"
                  value={turnoverFilter}
                  onChange={setTurnoverFilter}
                  options={[
                    { v: 'all', label: 'Todos' },
                    ...(['rupture','low','healthy','excess'] as TurnoverStatus[]).map(t => ({ v: t, label: TURNOVER_LABEL[t].split(' (')[0], color: TURNOVER_COLOR[t] })),
                  ]}
                />
              </div>
            </div>

            <div className="table-wrap" style={{ maxHeight: '70vh' }}>
              <table>
                <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                  <tr>
                    <SortableTh field="code"           sort={sort} onSort={toggleSort}>Código</SortableTh>
                    <SortableTh field="description"    sort={sort} onSort={toggleSort}>Produto</SortableTh>
                    <SortableTh field="retailPrice"    sort={sort} onSort={toggleSort} align="right">Preço</SortableTh>
                    <SortableTh field="unitCost"       sort={sort} onSort={toggleSort} align="right">Custo</SortableTh>
                    <SortableTh field="marginPct"      sort={sort} onSort={toggleSort} align="right">Margem %</SortableTh>
                    <SortableTh field="abcClass"       sort={sort} onSort={toggleSort}>ABC</SortableTh>
                    <SortableTh field="sharePct"       sort={sort} onSort={toggleSort} align="right">Share</SortableTh>
                    <SortableTh field="qtySold"        sort={sort} onSort={toggleSort} align="right">Vendido</SortableTh>
                    <SortableTh field="salesValue"     sort={sort} onSort={toggleSort} align="right">Receita</SortableTh>
                    <SortableTh field="qtyStock"       sort={sort} onSort={toggleSort} align="right">Estoque</SortableTh>
                    <SortableTh field="stockValue"     sort={sort} onSort={toggleSort} align="right">Val. estoque</SortableTh>
                    <SortableTh field="monthsCoverage" sort={sort} onSort={toggleSort} align="right">Cobertura</SortableTh>
                    <SortableTh field="turnoverStatus" sort={sort} onSort={toggleSort}>Giro</SortableTh>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 1500).map(r => (
                    <tr key={r.code}>
                      <td style={{ fontSize: 11, color: C.textMuted, whiteSpace: 'nowrap' }}>{r.code}</td>
                      <td style={{ fontSize: 12, maxWidth: 300 }}>{r.description}</td>
                      <td style={{ textAlign: 'right', fontSize: 12 }}>{fmt(r.retailPrice)}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, color: C.textMuted }}>{fmt(r.unitCost)}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color: r.marginTag ? MARGIN_COLOR[r.marginTag] : C.textMuted }}>
                        {fmtPct(r.marginPct)}
                      </td>
                      <td style={{ fontSize: 11 }}>
                        {r.abcClass ? (
                          <span className="badge" style={{
                            color: r.abcClass === 'A' ? C.A : r.abcClass === 'B' ? C.B : C.Cc,
                            background: (r.abcClass === 'A' ? C.A : r.abcClass === 'B' ? C.B : C.Cc) + '15',
                            borderColor: r.abcClass === 'A' ? C.A : r.abcClass === 'B' ? C.B : C.Cc,
                            fontSize: 10, fontWeight: 700,
                          }}>{r.abcClass}</span>
                        ) : <span style={{ color: C.textMuted }}>—</span>}
                      </td>
                      <td style={{ textAlign: 'right', fontSize: 11, color: C.textMuted }}>{fmtPct(r.sharePct, 2)}</td>
                      <td style={{ textAlign: 'right', fontSize: 12 }}>{r.qtySold ? fmtNum(r.qtySold) : <span style={{ color: C.textMuted }}>—</span>}</td>
                      <td style={{ textAlign: 'right', fontSize: 12 }}>{r.salesValue ? fmt(r.salesValue) : <span style={{ color: C.textMuted }}>—</span>}</td>
                      <td style={{ textAlign: 'right', fontSize: 12 }}>{fmtNum(r.qtyStock)}</td>
                      <td style={{ textAlign: 'right', fontSize: 12 }}>{r.stockValue ? fmt(r.stockValue) : <span style={{ color: C.textMuted }}>—</span>}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color: r.turnoverStatus ? TURNOVER_COLOR[r.turnoverStatus] : C.textMuted }}>
                        {r.monthsCoverage == null ? '—' : `${r.monthsCoverage.toFixed(1)}m`}
                      </td>
                      <td style={{ fontSize: 10 }}>
                        {r.turnoverStatus ? (
                          <span className="badge" style={{
                            color: TURNOVER_COLOR[r.turnoverStatus],
                            background: TURNOVER_COLOR[r.turnoverStatus] + '15',
                            borderColor: TURNOVER_COLOR[r.turnoverStatus],
                            fontSize: 9,
                          }}>{TURNOVER_LABEL[r.turnoverStatus].split(' (')[0].toUpperCase()}</span>
                        ) : <span style={{ color: C.textMuted }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > 1500 && (
              <div style={{ padding: '12px 24px', fontSize: 11, color: C.textMuted, textAlign: 'center' }}>
                Mostrando 1500 de {rows.length}. Use busca e filtros pra refinar.
              </div>
            )}
          </div>
        </>
      )}
    </Shell>
  )
}

function Kpi({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div style={{ borderLeft: `3px solid ${color}`, paddingLeft: 14 }}>
      <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-serif), serif', fontSize: 22, color, lineHeight: 1.1, letterSpacing: '-0.01em' }}>{value}</div>
      <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4 }}>{sub}</div>
    </div>
  )
}

function FilterRow<T extends string>({
  label, value, onChange, options,
}: {
  label: string
  value: T
  onChange: (v: T) => void
  options: Array<{ v: T; label: string; color?: string }>
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <div style={{ width: 56, fontSize: 10, color: C.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>{label}</div>
      {options.map(o => {
        const active = value === o.v
        const color = o.color ?? C.navy
        return (
          <button key={o.v}
            className={active ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
            onClick={() => onChange(o.v)}
            style={active
              ? { background: color, borderColor: color, fontSize: 10 }
              : { color: o.color ?? undefined, borderColor: o.color ?? undefined, fontSize: 10 }}>
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function SortableTh<K extends string>({
  field, sort, onSort, align, children,
}: {
  field: K
  sort: { key: string; dir: 'asc' | 'desc' }
  onSort: (k: K) => void
  align?: 'left' | 'right'
  children: React.ReactNode
}) {
  const cls = `sortable${sort.key === field ? ` sort-${sort.dir}` : ''}`
  return (
    <th className={cls} style={{ textAlign: align ?? 'left' }} onClick={() => onSort(field)}>
      {children}
    </th>
  )
}
