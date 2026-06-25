'use client'
import { useEffect, useMemo, useState } from 'react'
import Shell from '@/components/Shell'
import { CommercialUploader } from '@/components/CommercialUploader'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell, ReferenceLine,
} from 'recharts'

interface MarginRow {
  code: string
  description: string
  retailPrice: number
  unitCost: number
  grossMarginPct: number
  grossMarginAbs: number
  contributionMarginPct: number
  contributionMarginAbs: number
  qtySold: number
  qtyStock: number
}

interface Analytics {
  counts: { prices: number; stock: number; sales: number; marginItems: number }
  fixedCost: {
    pct: number
    totalRevenue: number
    totalUnits: number
    fixedCostTotal: number
    fixedCostPerUnit: number
  }
  summary: { excellent: number; detractors: number }
  marginRows: MarginRow[]
}

const fmt    = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtPct = (n: number) => `${n.toFixed(1)}%`

const C = {
  navy: '#0a2540', yellow: '#f5c518', gold: '#d4a017',
  line: '#e3e7ed', textSoft: '#4a5670', textMuted: '#7a869a',
  green: '#197a4a', red: '#b03022', amber: '#c98a14',
}

export default function MargemContribuicao() {
  const [data, setData] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'excellent' | 'detractor'>('all')
  const [search, setSearch] = useState('')

  const load = async () => {
    setLoading(true)
    const r = await fetch('/api/commercial/analytics').then(r => r.json())
    setData(r)
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const rows = useMemo(() => {
    if (!data) return []
    let list = data.marginRows
    if (filter === 'excellent') list = list.filter(r => r.contributionMarginPct >= 30)
    else if (filter === 'detractor') list = list.filter(r => r.contributionMarginPct < 20)
    if (search.trim()) {
      const s = search.toLowerCase()
      list = list.filter(r => r.description.toLowerCase().includes(s) || r.code.includes(s))
    }
    return list
  }, [data, filter, search])

  // Distribuição em faixas (pra histograma)
  const distribution = useMemo(() => {
    if (!data) return []
    const bins = [
      { label: '< 0%',     min: -Infinity, max: 0,   color: C.red },
      { label: '0–10%',    min: 0,         max: 10,  color: C.red },
      { label: '10–20%',   min: 10,        max: 20,  color: C.amber },
      { label: '20–30%',   min: 20,        max: 30,  color: C.gold },
      { label: '30–40%',   min: 30,        max: 40,  color: '#5a8542' },
      { label: '40–50%',   min: 40,        max: 50,  color: C.green },
      { label: '≥ 50%',    min: 50,        max: 1e6, color: C.green },
    ]
    return bins.map(b => ({
      label: b.label,
      itens: data.marginRows.filter(r => r.contributionMarginPct >= b.min && r.contributionMarginPct < b.max).length,
      color: b.color,
    }))
  }, [data])

  return (
    <Shell>
      <div className="page-header">
        <div>
          <div className="page-eyebrow">Módulo · Análise Comercial</div>
          <h1 className="page-title">Margem de Contribuição</h1>
          <p className="page-subtitle">
            Cruzamento de <b>Preço de Venda</b> × <b>Custo Unitário</b> (do ABC de Estoque).
            A margem de contribuição incorpora um custo fixo operacional de <b>30% da receita</b>,
            rateado igualmente por unidade vendida no período.
          </p>
        </div>
      </div>

      <div className="grid-2 mb-6">
        <CommercialUploader
          title="Preço de Venda (tabela mestre)"
          description="XLSX com 3 colunas: CÓDIGO · DESCRIÇÃO · PR.VAREJO. Substitui toda a base de preços."
          endpoint="/api/commercial/prices"
          count={data?.counts.prices}
          onDone={load}
        />
        <CommercialUploader
          title="ABC de Estoque (custos unitários)"
          description="XLSX com sheet CONSOLIDADO: CÓDIGO · DESCRIÇÃO · QTDE · CUSTO · VALOR TOTAL."
          endpoint="/api/commercial/stock"
          count={data?.counts.stock}
          onDone={load}
        />
      </div>

      {loading ? (
        <div className="empty-state"><div className="empty-state-icon">◌</div><div className="empty-state-title">Calculando margens…</div></div>
      ) : !data || data.marginRows.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">◆</div>
            <div className="empty-state-title">Nenhum item com Preço e Custo cadastrados</div>
            <p style={{ fontSize: 13, color: C.textMuted, marginTop: 12, maxWidth: 480, marginInline: 'auto' }}>
              Suba os arquivos de <b>Preço de Venda</b> e <b>ABC de Estoque</b> acima.
              A margem só calcula para SKUs que existem nos dois.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="card mb-6">
            <div className="card-header">
              <div>
                <div className="card-eyebrow">Visão consolidada</div>
                <div className="card-title">Distribuição de Margens</div>
              </div>
            </div>
            <div className="grid-4" style={{ gap: 28 }}>
              <Kpi label="Itens analisados"
                   value={data.counts.marginItems.toLocaleString('pt-BR')}
                   sub={`${data.counts.prices} preços · ${data.counts.stock} custos`} color={C.navy} />
              <Kpi label="Margens excelentes (≥ 30%)"
                   value={data.summary.excellent.toLocaleString('pt-BR')}
                   sub={fmtPct(data.summary.excellent / data.counts.marginItems * 100) + ' do total'} color={C.green} />
              <Kpi label="Detratores (< 20%)"
                   value={data.summary.detractors.toLocaleString('pt-BR')}
                   sub={fmtPct(data.summary.detractors / data.counts.marginItems * 100) + ' do total'} color={C.red} />
              <Kpi label="Custo fixo /un"
                   value={fmt(data.fixedCost.fixedCostPerUnit)}
                   sub={`30% × ${fmt(data.fixedCost.totalRevenue)} ÷ ${data.fixedCost.totalUnits.toLocaleString('pt-BR')} un`} color={C.gold} />
            </div>
          </div>

          {/* Histograma */}
          <div className="card mb-6 card-accent-yellow">
            <div className="card-header">
              <div>
                <div className="card-eyebrow">Curva de margens</div>
                <div className="card-title">Quantos itens em cada faixa de margem?</div>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={distribution}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.line} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: C.textSoft }} stroke={C.line} />
                <YAxis tick={{ fontSize: 11, fill: C.textSoft }} stroke={C.line} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: C.navy, border: 'none', borderRadius: 4, padding: '10px 14px' }}
                  labelStyle={{ color: C.yellow, fontWeight: 600 }}
                  itemStyle={{ color: '#fff' }}
                />
                <ReferenceLine x="20–30%" stroke={C.textMuted} strokeDasharray="3 3" label={{ value: 'limiar saúde', position: 'top', fill: C.textMuted, fontSize: 10 }} />
                <Bar dataKey="itens" name="Itens" radius={[3, 3, 0, 0]}>
                  {distribution.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Filtros + tabela */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 24px', borderBottom: `1px solid ${C.line}`, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div>
                <div className="card-eyebrow">Detalhamento</div>
                <div className="card-title">Itens por margem</div>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  className="form-input"
                  placeholder="Buscar código ou produto…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  style={{ width: 220 }}
                />
                {(['all','excellent','detractor'] as const).map(k => (
                  <button key={k}
                    className={filter === k ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
                    onClick={() => setFilter(k)}>
                    {k === 'all' ? 'Todos' : k === 'excellent' ? '✓ ≥ 30%' : '⚠ < 20%'}
                  </button>
                ))}
              </div>
            </div>
            <div className="table-wrap" style={{ maxHeight: '65vh' }}>
              <table>
                <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                  <tr>
                    <th>Código</th>
                    <th>Produto</th>
                    <th style={{ textAlign: 'right' }}>Preço</th>
                    <th style={{ textAlign: 'right' }}>Custo</th>
                    <th style={{ textAlign: 'right' }}>MC bruta</th>
                    <th style={{ textAlign: 'right' }}>MC c/ custo fixo</th>
                    <th>Faixa</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 1000).map(r => {
                    const cm = r.contributionMarginPct
                    const color = cm >= 30 ? C.green : cm >= 20 ? C.gold : cm >= 0 ? C.amber : C.red
                    const tag = cm >= 30 ? 'EXCELENTE' : cm >= 20 ? 'OK' : cm >= 0 ? 'BAIXA' : 'NEGATIVA'
                    return (
                      <tr key={r.code}>
                        <td style={{ fontSize: 11, color: C.textMuted, whiteSpace: 'nowrap' }}>{r.code}</td>
                        <td style={{ fontSize: 12, maxWidth: 360 }}>{r.description}</td>
                        <td style={{ textAlign: 'right', fontSize: 12 }}>{fmt(r.retailPrice)}</td>
                        <td style={{ textAlign: 'right', fontSize: 12, color: C.textMuted }}>{fmt(r.unitCost)}</td>
                        <td style={{ textAlign: 'right', fontSize: 12 }}>{fmtPct(r.grossMarginPct)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600, fontSize: 13, color }}>
                          {fmtPct(cm)}
                        </td>
                        <td>
                          <span className="badge" style={{ color, background: color + '15', borderColor: color, fontSize: 9 }}>
                            {tag}
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

function Kpi({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div style={{ borderLeft: `3px solid ${color}`, paddingLeft: 16 }}>
      <div style={{ fontSize: 10, color: C.textMuted, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-serif), serif', fontSize: 26, color, lineHeight: 1.1, letterSpacing: '-0.01em' }}>{value}</div>
      <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>{sub}</div>
    </div>
  )
}
