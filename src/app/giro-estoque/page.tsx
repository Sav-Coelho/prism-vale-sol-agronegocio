'use client'
import { useEffect, useMemo, useState } from 'react'
import Shell from '@/components/Shell'
import { CommercialUploader } from '@/components/CommercialUploader'
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, ReferenceLine,
} from 'recharts'

interface TurnoverRow {
  code: string
  description: string
  qtyStock: number
  qtySold: number
  unitCost: number
  stockValue: number
  salesValue: number
  turnover: number
  monthsCoverage: number | null
  status: 'rupture' | 'low' | 'healthy' | 'excess' | 'dead'
  abcClass: 'A' | 'B' | 'C' | null
}

interface Analytics {
  counts: { stock: number; sales: number; turnoverItems: number }
  summary: { ruptures: number; excess: number; dead: number; totalStockValue: number }
  turnoverRows: TurnoverRow[]
}

const fmt    = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtPct = (n: number) => `${n.toFixed(1)}%`

const C = {
  navy: '#0a2540', yellow: '#f5c518', gold: '#d4a017',
  line: '#e3e7ed', textSoft: '#4a5670', textMuted: '#7a869a',
  green: '#197a4a', red: '#b03022', amber: '#c98a14',
  rupture: '#b03022',
  low: '#c98a14',
  healthy: '#197a4a',
  excess: '#5a6c8a',
  dead: '#3a3f55',
}

const STATUS_LABEL: Record<TurnoverRow['status'], string> = {
  rupture: 'Ruptura iminente (<1 mês)',
  low:     'Baixa cobertura (1–2 meses)',
  healthy: 'Saudável (2–6 meses)',
  excess:  'Excesso (>6 meses)',
  dead:    'Sem giro no período',
}

export default function GiroEstoque() {
  const [data, setData] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | TurnoverRow['status']>('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<{ key: keyof TurnoverRow; dir: 'asc' | 'desc' }>({ key: 'stockValue', dir: 'desc' })

  const toggleSort = (key: keyof TurnoverRow) =>
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' })

  const load = async () => {
    setLoading(true)
    const r = await fetch('/api/commercial/analytics').then(r => r.json())
    setData(r)
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const counts = useMemo(() => {
    if (!data) return { rupture: 0, low: 0, healthy: 0, excess: 0, dead: 0 }
    const r = { rupture: 0, low: 0, healthy: 0, excess: 0, dead: 0 }
    data.turnoverRows.forEach(x => { r[x.status] += 1 })
    return r
  }, [data])

  const valueByStatus = useMemo(() => {
    if (!data) return []
    const groups: Record<TurnoverRow['status'], number> = { rupture: 0, low: 0, healthy: 0, excess: 0, dead: 0 }
    data.turnoverRows.forEach(x => { groups[x.status] += x.stockValue })
    return (['rupture','low','healthy','excess','dead'] as const).map(s => ({
      label: STATUS_LABEL[s].split(' (')[0],
      status: s,
      value: groups[s],
      color: C[s],
    }))
  }, [data])

  // Scatter: cada ponto = SKU. X = meses de cobertura (cap em 24), Y = valor em estoque
  const scatterData = useMemo(() => {
    if (!data) return []
    return data.turnoverRows
      .filter(r => r.stockValue > 0)
      .map(r => ({
        x: r.monthsCoverage === null ? 24 : Math.min(r.monthsCoverage, 24),
        y: r.stockValue,
        code: r.code,
        description: r.description,
        status: r.status,
        coverage: r.monthsCoverage,
      }))
  }, [data])

  const rows = useMemo(() => {
    if (!data) return []
    let list = data.turnoverRows
    if (filter !== 'all') list = list.filter(r => r.status === filter)
    if (search.trim()) {
      const s = search.toLowerCase()
      list = list.filter(r => r.description.toLowerCase().includes(s) || r.code.includes(s))
    }
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      const va = a[sort.key]
      const vb = b[sort.key]
      // null (monthsCoverage) sempre por último
      if (va === null && vb === null) return 0
      if (va === null) return 1
      if (vb === null) return -1
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      return String(va).localeCompare(String(vb), 'pt-BR') * dir
    })
  }, [data, filter, search, sort])

  const totalValueAtRisk = useMemo(() => {
    if (!data) return 0
    return data.turnoverRows
      .filter(r => r.status === 'excess' || r.status === 'dead')
      .reduce((s, r) => s + r.stockValue, 0)
  }, [data])

  return (
    <Shell>
      <div className="page-header">
        <div>
          <div className="page-eyebrow">Módulo · Análise Comercial</div>
          <h1 className="page-title">Giro de Estoque</h1>
          <p className="page-subtitle">
            Cruza <b>ABC de Estoque</b> (quanto há em prateleira) com <b>ABC de Vendas</b> (quanto saiu no período de 6 meses).
            Identifica rupturas iminentes, capital parado e itens sem giro.
          </p>
        </div>
      </div>

      <div className="grid-2 mb-6">
        <CommercialUploader
          title="ABC de Estoque"
          description="XLSX com sheet CONSOLIDADO: CÓDIGO · DESCRIÇÃO · QTDE · CUSTO · VALOR TOTAL."
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
        <div className="empty-state"><div className="empty-state-icon">◌</div><div className="empty-state-title">Calculando giro…</div></div>
      ) : !data || data.turnoverRows.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">◆</div>
            <div className="empty-state-title">Sem dados de Estoque ou Vendas</div>
            <p style={{ fontSize: 13, color: C.textMuted, marginTop: 12 }}>
              Suba os dois arquivos acima para calcular meses de cobertura, giro e capital parado.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* KPIs status */}
          <div className="card mb-6">
            <div className="card-header">
              <div>
                <div className="card-eyebrow">Visão consolidada</div>
                <div className="card-title">Status do estoque</div>
              </div>
              <div style={{ fontSize: 11, color: C.textMuted, textAlign: 'right' }}>
                Capital parado (excesso + sem giro):<br/>
                <b style={{ color: C.rupture, fontSize: 14 }}>{fmt(totalValueAtRisk)}</b>
              </div>
            </div>
            <div className="grid-5" style={{ gap: 20 }}>
              {(['rupture','low','healthy','excess','dead'] as const).map(s => (
                <div key={s} style={{ borderLeft: `3px solid ${C[s]}`, paddingLeft: 14 }}>
                  <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 6 }}>
                    {STATUS_LABEL[s]}
                  </div>
                  <div style={{ fontFamily: 'var(--font-serif), serif', fontSize: 22, color: C[s], lineHeight: 1.1, letterSpacing: '-0.01em' }}>
                    {counts[s].toLocaleString('pt-BR')}
                  </div>
                  <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>
                    {fmtPct(counts[s] / data.counts.turnoverItems * 100)} dos itens
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Gráfico 1: Capital em estoque por categoria de status */}
          <div className="card mb-6 card-accent-yellow">
            <div className="card-header">
              <div>
                <div className="card-eyebrow">Onde está o capital</div>
                <div className="card-title">Valor em estoque por status</div>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={valueByStatus} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.line} />
                <XAxis type="number" tick={{ fontSize: 11, fill: C.textSoft }} stroke={C.line}
                       tickFormatter={(v: number) => v >= 1e6 ? `${(v/1e6).toFixed(1)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}k` : String(v)} />
                <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: C.textSoft }} stroke={C.line} width={130} />
                <Tooltip
                  contentStyle={{ background: C.navy, border: 'none', borderRadius: 4, padding: '10px 14px' }}
                  labelStyle={{ color: C.yellow, fontWeight: 600 }}
                  itemStyle={{ color: '#fff' }}
                  formatter={(v: number) => fmt(v)}
                />
                <Bar dataKey="value" name="Valor em estoque" radius={[0, 3, 3, 0]}>
                  {valueByStatus.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Gráfico 2: Scatter — meses de cobertura vs valor em estoque */}
          <div className="card mb-6">
            <div className="card-header">
              <div>
                <div className="card-eyebrow">Mapa de cobertura</div>
                <div className="card-title">Meses de cobertura × valor em estoque</div>
              </div>
              <div style={{ fontSize: 11, color: C.textMuted }}>
                Cada ponto = 1 SKU. Itens à direita ({'>'}6m) são candidatos a liquidação.
              </div>
            </div>
            <ResponsiveContainer width="100%" height={360}>
              <ScatterChart margin={{ top: 10, right: 30, left: 10, bottom: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.line} />
                <XAxis
                  type="number"
                  dataKey="x"
                  name="Meses"
                  domain={[0, 24]}
                  ticks={[0, 1, 2, 6, 12, 18, 24]}
                  tickFormatter={(v: number) => v === 24 ? '24+' : `${v}m`}
                  tick={{ fontSize: 11, fill: C.textSoft }}
                  stroke={C.line}
                  label={{ value: 'Meses de cobertura (estoque ÷ ritmo de venda)', position: 'bottom', offset: 0, fill: C.textMuted, fontSize: 11 }}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  name="Valor"
                  scale="log"
                  domain={['auto', 'auto']}
                  tick={{ fontSize: 11, fill: C.textSoft }}
                  stroke={C.line}
                  tickFormatter={(v: number) => v >= 1e6 ? `${(v/1e6).toFixed(1)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}k` : String(v)}
                  label={{ value: 'Valor em estoque (escala log)', angle: -90, position: 'insideLeft', fill: C.textMuted, fontSize: 11 }}
                />
                <ReferenceLine x={1} stroke={C.rupture} strokeDasharray="3 3" label={{ value: '1m', fill: C.rupture, fontSize: 10 }} />
                <ReferenceLine x={2} stroke={C.low} strokeDasharray="3 3" label={{ value: '2m', fill: C.low, fontSize: 10 }} />
                <ReferenceLine x={6} stroke={C.healthy} strokeDasharray="3 3" label={{ value: '6m', fill: C.healthy, fontSize: 10 }} />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  contentStyle={{ background: C.navy, border: 'none', borderRadius: 4, padding: '10px 14px' }}
                  labelStyle={{ color: C.yellow, fontWeight: 600 }}
                  itemStyle={{ color: '#fff' }}
                  content={({ payload }) => {
                    const p = payload?.[0]?.payload
                    if (!p) return null
                    return (
                      <div style={{ background: C.navy, padding: '10px 14px', borderRadius: 4, color: '#fff', fontSize: 12 }}>
                        <div style={{ color: C.yellow, fontWeight: 600, marginBottom: 4, fontSize: 11 }}>{p.code}</div>
                        <div style={{ marginBottom: 6, maxWidth: 260 }}>{p.description}</div>
                        <div>Cobertura: <b>{p.coverage === null ? '∞' : `${p.coverage.toFixed(1)} meses`}</b></div>
                        <div>Em estoque: <b>{fmt(p.y)}</b></div>
                        <div style={{ color: C[p.status as TurnoverRow['status']] }}>{STATUS_LABEL[p.status as TurnoverRow['status']]}</div>
                      </div>
                    )
                  }}
                />
                <Scatter
                  name="Itens"
                  data={scatterData}
                  fill={C.navy}
                  fillOpacity={0.55}
                >
                  {scatterData.map((d, i) => <Cell key={i} fill={C[d.status as TurnoverRow['status']]} fillOpacity={0.6} />)}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
            <div style={{ display: 'flex', gap: 14, justifyContent: 'center', fontSize: 10, color: C.textMuted, marginTop: 8, flexWrap: 'wrap' }}>
              {(['rupture','low','healthy','excess','dead'] as const).map(s => (
                <span key={s}><span style={{ display: 'inline-block', width: 10, height: 10, background: C[s], opacity: 0.65, marginRight: 6, borderRadius: '50%' }} />{STATUS_LABEL[s].split(' (')[0]}</span>
              ))}
            </div>
          </div>

          {/* Tabela */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 24px', borderBottom: `1px solid ${C.line}`, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div>
                <div className="card-eyebrow">Detalhamento</div>
                <div className="card-title">Itens por status de giro</div>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  className="form-input"
                  placeholder="Buscar código ou produto…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  style={{ width: 220 }}
                />
                <button className={filter === 'all' ? 'btn btn-primary btn-sm' : 'btn btn-sm'} onClick={() => setFilter('all')}>Todos</button>
                {(['rupture','low','healthy','excess','dead'] as const).map(s => (
                  <button key={s}
                    className={filter === s ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
                    onClick={() => setFilter(s)}
                    style={filter === s ? { background: C[s], borderColor: C[s] } : { color: C[s], borderColor: C[s] }}>
                    {STATUS_LABEL[s].split(' (')[0]}
                  </button>
                ))}
              </div>
            </div>
            <div className="table-wrap" style={{ maxHeight: '65vh' }}>
              <table>
                <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                  <tr>
                    <SortableTh field="code"           sort={sort} onSort={toggleSort}>Código</SortableTh>
                    <SortableTh field="description"    sort={sort} onSort={toggleSort}>Produto</SortableTh>
                    <SortableTh field="abcClass"       sort={sort} onSort={toggleSort}>ABC</SortableTh>
                    <SortableTh field="qtyStock"       sort={sort} onSort={toggleSort} align="right">Em estoque</SortableTh>
                    <SortableTh field="qtySold"        sort={sort} onSort={toggleSort} align="right">Vendido (6m)</SortableTh>
                    <SortableTh field="stockValue"     sort={sort} onSort={toggleSort} align="right">Valor estoque</SortableTh>
                    <SortableTh field="turnover"       sort={sort} onSort={toggleSort} align="right">Giro</SortableTh>
                    <SortableTh field="monthsCoverage" sort={sort} onSort={toggleSort} align="right">Cobertura</SortableTh>
                    <SortableTh field="status"         sort={sort} onSort={toggleSort}>Status</SortableTh>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 1000).map(r => {
                    const color = C[r.status]
                    return (
                      <tr key={r.code}>
                        <td style={{ fontSize: 11, color: C.textMuted, whiteSpace: 'nowrap' }}>{r.code}</td>
                        <td style={{ fontSize: 12, maxWidth: 320 }}>{r.description}</td>
                        <td style={{ fontSize: 11, color: C.textMuted, textAlign: 'center' }}>{r.abcClass ?? '—'}</td>
                        <td style={{ textAlign: 'right', fontSize: 12 }}>{r.qtyStock.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</td>
                        <td style={{ textAlign: 'right', fontSize: 12 }}>{r.qtySold.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</td>
                        <td style={{ textAlign: 'right', fontSize: 12 }}>{fmt(r.stockValue)}</td>
                        <td style={{ textAlign: 'right', fontSize: 12, color: C.textMuted }}>{r.turnover.toFixed(2)}×</td>
                        <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color }}>
                          {r.monthsCoverage === null ? '∞' : `${r.monthsCoverage.toFixed(1)}m`}
                        </td>
                        <td>
                          <span className="badge" style={{ color, background: color + '15', borderColor: color, fontSize: 9 }}>
                            {STATUS_LABEL[r.status].split(' (')[0].toUpperCase()}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {rows.length > 1000 && (
              <div style={{ padding: '12px 24px', fontSize: 11, color: C.textMuted, textAlign: 'center' }}>
                Mostrando 1000 de {rows.length}. Use a busca pra filtrar.
              </div>
            )}
          </div>
        </>
      )}
    </Shell>
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
