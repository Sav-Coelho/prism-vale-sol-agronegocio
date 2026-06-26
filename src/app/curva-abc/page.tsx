'use client'
import { useEffect, useMemo, useState } from 'react'
import Shell from '@/components/Shell'
import { CommercialUploader } from '@/components/CommercialUploader'
import {
  Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceArea, ReferenceLine, ComposedChart,
} from 'recharts'

interface AbcRow {
  rank: number
  code: string
  description: string
  qtySold: number
  totalValue: number
  avgUnit: number
  abcClass: string
  cumulativePct: number
  sharePct: number
}

interface Analytics {
  counts: { sales: number }
  summary: { totalSalesValue: number }
  abcRows: AbcRow[]
}

const fmt    = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtPct = (n: number) => `${n.toFixed(1)}%`

const C = {
  navy: '#0a2540', yellow: '#f5c518', gold: '#d4a017',
  line: '#e3e7ed', textSoft: '#4a5670', textMuted: '#7a869a',
  green: '#197a4a', red: '#b03022', amber: '#c98a14',
  A: '#197a4a',   // verde (top items)
  B: '#d4a017',   // dourado
  Cc: '#b03022',  // vermelho (cauda)
}

export default function CurvaAbc() {
  const [data, setData] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'A' | 'B' | 'C'>('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<{ key: keyof AbcRow; dir: 'asc' | 'desc' }>({ key: 'rank', dir: 'asc' })

  const toggleSort = (key: keyof AbcRow) =>
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' })

  const load = async () => {
    setLoading(true)
    const r = await fetch('/api/commercial/analytics').then(r => r.json())
    setData(r)
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  // Para o gráfico (linha cumulativa) — sample a cada N itens pra não pesar
  const chartData = useMemo(() => {
    if (!data) return []
    const all = data.abcRows
    if (all.length === 0) return []
    const step = Math.max(1, Math.floor(all.length / 200))
    const sampled: AbcRow[] = []
    for (let i = 0; i < all.length; i += step) sampled.push(all[i])
    if (sampled[sampled.length - 1] !== all[all.length - 1]) sampled.push(all[all.length - 1])
    return sampled.map(r => ({
      rank: r.rank,
      cumulativePct: r.cumulativePct,
      sharePct: r.sharePct,
      abcClass: r.abcClass,
    }))
  }, [data])

  // Cortes A/B/C — último rank de cada classe
  const cuts = useMemo(() => {
    if (!data) return { aEnd: 0, bEnd: 0 }
    let aEnd = 0, bEnd = 0
    for (let i = 0; i < data.abcRows.length; i++) {
      const r = data.abcRows[i]
      if (r.abcClass === 'A') aEnd = r.rank
      else if (r.abcClass === 'B') bEnd = r.rank
    }
    return { aEnd, bEnd: Math.max(bEnd, aEnd) }
  }, [data])

  const totals = useMemo(() => {
    if (!data) return { A: { count: 0, value: 0 }, B: { count: 0, value: 0 }, C: { count: 0, value: 0 } }
    const r = { A: { count: 0, value: 0 }, B: { count: 0, value: 0 }, C: { count: 0, value: 0 } }
    data.abcRows.forEach(x => {
      const cls = x.abcClass as 'A' | 'B' | 'C'
      if (r[cls]) { r[cls].count += 1; r[cls].value += x.totalValue }
    })
    return r
  }, [data])

  const rows = useMemo(() => {
    if (!data) return []
    let list = data.abcRows
    if (filter !== 'all') list = list.filter(r => r.abcClass === filter)
    if (search.trim()) {
      const s = search.toLowerCase()
      list = list.filter(r => r.description.toLowerCase().includes(s) || r.code.includes(s))
    }
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      const va = a[sort.key] as string | number
      const vb = b[sort.key] as string | number
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      return String(va).localeCompare(String(vb), 'pt-BR') * dir
    })
  }, [data, filter, search, sort])

  return (
    <Shell>
      <div className="page-header">
        <div>
          <div className="page-eyebrow">Módulo · Análise Comercial</div>
          <h1 className="page-title">Curva ABC de Vendas</h1>
          <p className="page-subtitle">
            Itens ordenados pela participação na receita. A <b>Sessão A</b> são os SKUs que somam os primeiros ~80% do faturamento,
            <b> B</b> os próximos ~15% e <b>C</b> a cauda longa restante.
          </p>
        </div>
      </div>

      <div className="mb-6">
        <CommercialUploader
          title="ABC de Vendas (consolidado do período)"
          description="XLSX com sheet CONSOLIDADO: CÓDIGO · DESCRIÇÃO · QTDE VENDIDA · VALOR TOTAL · CUSTO UN. MÉDIO · CLASSE."
          endpoint="/api/commercial/sales-abc"
          count={data?.counts.sales}
          onDone={load}
        />
      </div>

      {loading ? (
        <div className="empty-state"><div className="empty-state-icon">◌</div><div className="empty-state-title">Calculando curva…</div></div>
      ) : !data || data.abcRows.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">◆</div>
            <div className="empty-state-title">Nenhum dado de venda ainda</div>
            <p style={{ fontSize: 13, color: C.textMuted, marginTop: 12 }}>
              Suba o arquivo <b>ABC de Vendas</b> acima para enxergar a curva.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* KPIs A/B/C — 3 colunas, cada uma com count + share */}
          <div className="card mb-6">
            <div className="card-header">
              <div>
                <div className="card-eyebrow">Decomposição</div>
                <div className="card-title">Distribuição A · B · C</div>
              </div>
              <div style={{ fontSize: 11, color: C.textMuted }}>
                Receita total: <b style={{ color: C.navy }}>{fmt(data.summary.totalSalesValue)}</b>
              </div>
            </div>
            <div className="grid-3" style={{ gap: 28 }}>
              {(['A','B','C'] as const).map(cls => {
                const t = totals[cls]
                const share = data.summary.totalSalesValue > 0 ? t.value / data.summary.totalSalesValue * 100 : 0
                const color = cls === 'A' ? C.A : cls === 'B' ? C.B : C.Cc
                return (
                  <div key={cls} style={{ borderLeft: `3px solid ${color}`, paddingLeft: 16 }}>
                    <div style={{ fontSize: 10, color: C.textMuted, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 6 }}>
                      Sessão {cls}
                    </div>
                    <div style={{ fontFamily: 'var(--font-serif), serif', fontSize: 26, color, lineHeight: 1.1, letterSpacing: '-0.01em' }}>
                      {t.count.toLocaleString('pt-BR')} itens
                    </div>
                    <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>
                      {fmt(t.value)} · <b style={{ color }}>{fmtPct(share)}</b> da receita
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Curva acumulada — gráfico principal */}
          <div className="card mb-6 card-accent-yellow">
            <div className="card-header">
              <div>
                <div className="card-eyebrow">Curva acumulada</div>
                <div className="card-title">% da receita acumulada por ranking de itens</div>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={360}>
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.line} />
                <XAxis
                  dataKey="rank"
                  type="number"
                  domain={[1, data.abcRows.length]}
                  tick={{ fontSize: 11, fill: C.textSoft }}
                  stroke={C.line}
                  label={{ value: 'Ranking do item (1 = mais vendido)', position: 'bottom', offset: -5, fill: C.textMuted, fontSize: 11 }}
                />
                <YAxis
                  yAxisId="left"
                  domain={[0, 100]}
                  tick={{ fontSize: 11, fill: C.textSoft }}
                  stroke={C.line}
                  label={{ value: '% acumulado', angle: -90, position: 'insideLeft', fill: C.textMuted, fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={{ background: C.navy, border: 'none', borderRadius: 4, padding: '10px 14px' }}
                  labelStyle={{ color: C.yellow, fontWeight: 600 }}
                  itemStyle={{ color: '#fff' }}
                  formatter={(v: number) => fmtPct(v)}
                  labelFormatter={(rank: number) => `Posição #${rank}`}
                />

                {/* Áreas A/B/C */}
                {cuts.aEnd > 0 && (
                  <ReferenceArea yAxisId="left" x1={1} x2={cuts.aEnd} y1={0} y2={100} fill={C.A} fillOpacity={0.06} />
                )}
                {cuts.bEnd > cuts.aEnd && (
                  <ReferenceArea yAxisId="left" x1={cuts.aEnd} x2={cuts.bEnd} y1={0} y2={100} fill={C.B} fillOpacity={0.06} />
                )}
                {cuts.bEnd < data.abcRows.length && (
                  <ReferenceArea yAxisId="left" x1={cuts.bEnd} x2={data.abcRows.length} y1={0} y2={100} fill={C.Cc} fillOpacity={0.06} />
                )}

                {/* Linhas de referência 80/95 */}
                <ReferenceLine yAxisId="left" y={80} stroke={C.A} strokeDasharray="4 3" label={{ value: '80%', position: 'left', fill: C.A, fontSize: 10 }} />
                <ReferenceLine yAxisId="left" y={95} stroke={C.B} strokeDasharray="4 3" label={{ value: '95%', position: 'left', fill: C.B, fontSize: 10 }} />

                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="cumulativePct"
                  name="Acumulado"
                  stroke={C.navy}
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4, fill: C.yellow }}
                />
              </ComposedChart>
            </ResponsiveContainer>
            <div style={{ display: 'flex', gap: 18, justifyContent: 'center', fontSize: 11, color: C.textMuted, marginTop: 8 }}>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, background: C.A, opacity: 0.4, marginRight: 6 }} />Sessão A · 80% receita</span>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, background: C.B, opacity: 0.4, marginRight: 6 }} />Sessão B · +15%</span>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, background: C.Cc, opacity: 0.4, marginRight: 6 }} />Sessão C · cauda</span>
            </div>
          </div>

          {/* Tabela */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 24px', borderBottom: `1px solid ${C.line}`, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div>
                <div className="card-eyebrow">Detalhamento</div>
                <div className="card-title">Itens por classe ABC</div>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  className="form-input"
                  placeholder="Buscar código ou produto…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  style={{ width: 220 }}
                />
                {(['all','A','B','C'] as const).map(k => (
                  <button key={k}
                    className={filter === k ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
                    onClick={() => setFilter(k)}>
                    {k === 'all' ? 'Todos' : `Sessão ${k}`}
                  </button>
                ))}
              </div>
            </div>
            <div className="table-wrap" style={{ maxHeight: '65vh' }}>
              <table>
                <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                  <tr>
                    <SortableTh field="rank"          sort={sort} onSort={toggleSort}>#</SortableTh>
                    <SortableTh field="code"          sort={sort} onSort={toggleSort}>Código</SortableTh>
                    <SortableTh field="description"   sort={sort} onSort={toggleSort}>Produto</SortableTh>
                    <SortableTh field="qtySold"       sort={sort} onSort={toggleSort} align="right">Qtde vendida</SortableTh>
                    <SortableTh field="totalValue"    sort={sort} onSort={toggleSort} align="right">Receita</SortableTh>
                    <SortableTh field="sharePct"      sort={sort} onSort={toggleSort} align="right">Share</SortableTh>
                    <SortableTh field="cumulativePct" sort={sort} onSort={toggleSort} align="right">Acumulado</SortableTh>
                    <SortableTh field="abcClass"      sort={sort} onSort={toggleSort}>Classe</SortableTh>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 1000).map(r => {
                    const color = r.abcClass === 'A' ? C.A : r.abcClass === 'B' ? C.B : C.Cc
                    return (
                      <tr key={r.code}>
                        <td style={{ fontSize: 11, color: C.textMuted }}>{r.rank}</td>
                        <td style={{ fontSize: 11, color: C.textMuted, whiteSpace: 'nowrap' }}>{r.code}</td>
                        <td style={{ fontSize: 12, maxWidth: 360 }}>{r.description}</td>
                        <td style={{ textAlign: 'right', fontSize: 12 }}>{r.qtySold.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</td>
                        <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 600 }}>{fmt(r.totalValue)}</td>
                        <td style={{ textAlign: 'right', fontSize: 12, color: C.textMuted }}>{fmtPct(r.sharePct)}</td>
                        <td style={{ textAlign: 'right', fontSize: 12 }}>{fmtPct(r.cumulativePct)}</td>
                        <td>
                          <span className="badge" style={{ color, background: color + '15', borderColor: color, fontSize: 10, fontWeight: 700 }}>
                            {r.abcClass}
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
