'use client'
import { useEffect, useMemo, useState } from 'react'
import Shell from '@/components/Shell'
import { CommercialUploader } from '@/components/CommercialUploader'
import {
  BarChart, Bar, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell, ReferenceLine, ReferenceArea, ComposedChart, Line, ScatterChart, Scatter, Customized,
} from 'recharts'

type MarginTag = 'excellent' | 'ok' | 'low' | 'negative'
type TurnoverStatus = 'stockout' | 'rupture' | 'low' | 'healthy' | 'excess'
type AbcClass = 'A' | 'B' | 'C'
type Quadrante = 'ESTRELA' | 'VACA' | 'INTERROGACAO' | 'ABACAXI'

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
  bcgQuadrante: Quadrante | null
  bcgCrescimento: number | null
  bcgMargem: number | null
  bcgNovo: boolean
}

interface BcgItem {
  code: string | null; nome: string
  vendaCur: number; vendaPrev: number
  crescimento: number | null; novo: boolean
  margem: number | null; lucro: number | null
  estoque: number | null; capitalParado: number | null
  quadrante: Quadrante | null
}
interface Bcg {
  hasData: boolean; motivo?: string
  janela: { meses: number[]; label: string; curYear: number; prevYear: number }
  cortes: { crescimento: number; margem: number }
  totais: { vendaCur: number; vendaPrev: number; crescimentoCarteira: number; itens: number; comMargem: number; semCusto: number; novos: number; perdidos: number }
  resumo: Record<string, { itens: number; venda: number; lucro: number; margem: number; capitalParado: number }>
  itens: BcgItem[]
}

interface Analytics {
  counts: { prices: number; stock: number; sales: number; marginItems: number; turnoverItems: number; masterItems: number }
  summary: { excellent: number; detractors: number; ruptures: number; excess: number; stockouts: number; criticalStockouts: number; criticalStockoutValue: number; totalSalesValue: number; totalStockValue: number }
  masterRows: MasterRow[]
  abcRows: Array<{ rank: number; abcClass: string; cumulativePct: number; sharePct: number }>
  bcg: Bcg
}

const fmt    = (n: number | null) => n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtPct = (n: number | null, digits = 1) => n == null ? '—' : `${n.toFixed(digits)}%`
const fmtNum = (n: number | null, digits = 0) => n == null ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: digits })

const C = {
  navy: '#0a2540', yellow: '#f5c518', gold: '#d4a017',
  line: '#e3e7ed', textSoft: '#4a5670', textMuted: '#7a869a',
  green: '#197a4a', red: '#b03022', amber: '#c98a14',
  excellent: '#197a4a', ok: '#d4a017', low: '#c98a14', negative: '#b03022',
  stockout: '#7a1410', rupture: '#b03022', healthyTurn: '#197a4a', excess: '#5a6c8a',
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
  stockout: 'Ruptura total (estoque 0)',
  rupture: 'Ruptura (<1m)',
  low:     'Baixa (1–2m)',
  healthy: 'Saudável (2–6m)',
  excess:  'Excesso (>6m)',
}
const TURNOVER_COLOR: Record<TurnoverStatus, string> = {
  stockout: C.stockout, rupture: C.rupture, low: C.lowTurn, healthy: C.healthyTurn, excess: C.excess,
}
const MARGIN_COLOR: Record<MarginTag, string> = {
  excellent: C.excellent, ok: C.ok, low: C.low, negative: C.negative,
}

// ── Matriz BCG ──
const Q: Record<Quadrante, { label: string; icone: string; cor: string; acao: string }> = {
  ESTRELA:      { label: 'Estrela',       icone: '⭐', cor: C.green,   acao: 'Cresce e tem margem — proteger preço e nunca deixar faltar.' },
  VACA:         { label: 'Vaca leiteira', icone: '🐄', cor: '#2f5a96', acao: 'Margem boa sem crescer — colher; é o que financia o resto.' },
  INTERROGACAO: { label: 'Interrogação',  icone: '❓', cor: C.amber,   acao: 'Cresce sem margem — reprecificar ou renegociar a compra.' },
  ABACAXI:      { label: 'Abacaxi',       icone: '🍍', cor: C.red,     acao: 'Não cresce nem rende — candidato a sair da linha.' },
}
// Domínios fixos: sem eles um item com preço lançado a R$ 0,01 estica o eixo
// para −59.600% e empilha a carteira inteira na borda. Os fora de faixa são
// grampeados na moldura e o valor real fica no tooltip e na tabela.
const BX_MIN = -0.3, BX_MAX = 0.7, BY_MIN = -1, BY_MAX = 2
const grampo = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))
interface Offset { top: number; left: number; width: number; height: number }

type SortKey = keyof MasterRow

export default function AnaliseComercial() {
  const [data, setData] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [marginFilter, setMarginFilter] = useState<'all' | MarginTag>('all')
  const [abcFilter, setAbcFilter] = useState<'all' | AbcClass>('all')
  const [turnoverFilter, setTurnoverFilter] = useState<'all' | TurnoverStatus>('all')
  const [bcgFilter, setBcgFilter] = useState<'all' | Quadrante>('all')
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
    const groups: Record<TurnoverStatus, number> = { stockout: 0, rupture: 0, low: 0, healthy: 0, excess: 0 }
    data.masterRows.forEach(r => {
      if (r.turnoverStatus) groups[r.turnoverStatus] += r.stockValue
    })
    // stockout tem estoque 0 (capital R$ 0), então fica fora do gráfico de capital parado
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
    if (bcgFilter !== 'all')      list = list.filter(r => r.bcgQuadrante === bcgFilter)
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
  }, [data, search, marginFilter, abcFilter, turnoverFilter, bcgFilter, sort])

  // Pontos da matriz BCG (grampeados na moldura do gráfico)
  const bcgPontos = useMemo(() => {
    if (!data?.bcg?.itens) return []
    return data.bcg.itens
      .filter(i => i.quadrante && i.margem != null && i.vendaCur > 0)
      .map(i => ({
        ...i,
        x: grampo(i.margem as number, BX_MIN, BX_MAX),
        y: grampo(i.novo || i.crescimento == null ? BY_MAX : i.crescimento, BY_MIN, BY_MAX),
        z: i.vendaCur,
        foraDeFaixa: (i.margem as number) < BX_MIN || (i.margem as number) > BX_MAX
          || (i.crescimento != null && i.crescimento > BY_MAX),
      }))
  }, [data])

  /** Marca d'água de cada quadrante, desenhada dentro do gráfico. Os quadrantes
   *  não são quartos iguais — a posição vem da área de plotagem e dos cortes. */
  const MarcasBcg = (props: Record<string, unknown>) => {
    const offset = props.offset as Offset | undefined
    if (!offset || !data?.bcg?.hasData) return null
    const { top, left, width, height } = offset
    const px = (v: number) => left + ((v - BX_MIN) / (BX_MAX - BX_MIN)) * width
    const py = (v: number) => top + (1 - (v - BY_MIN) / (BY_MAX - BY_MIN)) * height
    const cx = px(data.bcg.cortes.margem), cy = py(data.bcg.cortes.crescimento)
    const fs = Math.min(104, Math.max(52, width / 8.5))
    const marcas: { k: Quadrante; x: number; y: number }[] = [
      { k: 'INTERROGACAO', x: (left + cx) / 2,         y: (top + cy) / 2 },
      { k: 'ESTRELA',      x: (cx + left + width) / 2, y: (top + cy) / 2 },
      { k: 'ABACAXI',      x: (left + cx) / 2,         y: (cy + top + height) / 2 },
      { k: 'VACA',         x: (cx + left + width) / 2, y: (cy + top + height) / 2 },
    ]
    return (
      <g style={{ pointerEvents: 'none' }}>
        {marcas.map(m => (
          <g key={m.k} opacity={bcgFilter !== 'all' && bcgFilter !== m.k ? 0.05 : 0.17}>
            <text x={m.x} y={m.y} textAnchor="middle" dominantBaseline="central" fontSize={fs}>{Q[m.k].icone}</text>
            <text x={m.x} y={m.y + fs * 0.6} textAnchor="middle" fontSize={12.5} fontWeight={800}
              letterSpacing="0.2em" fill={Q[m.k].cor}>{Q[m.k].label.toUpperCase()}</text>
          </g>
        ))}
      </g>
    )
  }

  /** Exporta a tabela filtrada (com o quadrante da BCG) em CSV para Excel. */
  const exportarCsv = () => {
    const cols = [
      'Código', 'Descrição', 'Classe ABC', 'Quadrante BCG', 'Crescimento a/a %', 'Margem BCG %',
      'Preço varejo', 'Custo unitário', 'Margem tabela %', 'Qtd vendida', 'Faturamento',
      'Qtd estoque', 'Valor estoque', 'Cobertura (meses)', 'Status do giro',
    ]
    const num = (n: number | null | undefined, casas = 2) => n == null ? '' : n.toFixed(casas).replace('.', ',')
    const txt = (s: string | null | undefined) => `"${String(s ?? '').replace(/"/g, '""')}"`
    const linhas = rows.map(r => [
      txt(r.code), txt(r.description), txt(r.abcClass),
      txt(r.bcgQuadrante ? Q[r.bcgQuadrante].label : ''),
      r.bcgNovo ? 'novo' : num(r.bcgCrescimento == null ? null : r.bcgCrescimento * 100, 1),
      num(r.bcgMargem == null ? null : r.bcgMargem * 100, 1),
      num(r.retailPrice), num(r.unitCost), num(r.marginPct, 1),
      num(r.qtySold, 0), num(r.salesValue), num(r.qtyStock, 0), num(r.stockValue),
      num(r.monthsCoverage, 1), txt(r.turnoverStatus ? TURNOVER_LABEL[r.turnoverStatus] : ''),
    ].join(';'))
    // BOM + ';' para o Excel pt-BR abrir com acento e colunas separadas
    const csv = '﻿' + [cols.join(';'), ...linhas].join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `analise-comercial-bcg-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

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
              <Kpi label="Ruptura total (estoque 0)"
                   value={data.summary.stockouts.toLocaleString('pt-BR')}
                   sub="venderam e zeraram o estoque" color={C.stockout} />
              <Kpi label="Ruptura iminente"
                   value={data.summary.ruptures.toLocaleString('pt-BR')}
                   sub="ainda tem estoque, cobre < 1 mês" color={C.rupture} />
            </div>
          </div>

          {/* Alerta de quebras críticas — Curva A sem estoque */}
          {data.summary.criticalStockouts > 0 && (
            <div className="card mb-6" style={{ borderTop: `3px solid ${C.stockout}`, background: '#fdf3f2' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 34, color: C.stockout, lineHeight: 1 }}>⚠</div>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div style={{ fontFamily: 'var(--font-serif), serif', fontSize: 19, color: C.stockout }}>
                    {data.summary.criticalStockouts} {data.summary.criticalStockouts === 1 ? 'produto crítico' : 'produtos críticos'} da Curva A sem estoque
                  </div>
                  <div style={{ fontSize: 13, color: C.textSoft, marginTop: 4 }}>
                    São os itens de maior peso na receita (Curva A) que venderam no período mas estão zerados hoje.
                    Somam <b style={{ color: C.stockout }}>{fmt(data.summary.criticalStockoutValue)}</b> de receita no período — venda em risco enquanto não repõe.
                  </div>
                </div>
                <button className="btn btn-sm"
                  style={{ background: C.stockout, borderColor: C.stockout, color: '#fff' }}
                  onClick={() => { setAbcFilter('A'); setTurnoverFilter('stockout'); setMarginFilter('all'); setSearch('') }}>
                  Ver os {data.summary.criticalStockouts} itens →
                </button>
              </div>
            </div>
          )}

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

          {/* ───────────── Matriz BCG ───────────── */}
          {data.bcg?.hasData && (
            <div className="mb-6">
              <div style={{ marginBottom: 14 }}>
                <div className="page-eyebrow">Portfólio</div>
                <h2 style={{ fontFamily: 'var(--font-serif), serif', fontSize: 24, color: C.navy, margin: '2px 0 6px' }}>Matriz BCG</h2>
                <p style={{ fontSize: 13, color: C.textSoft, maxWidth: 780, lineHeight: 1.6 }}>
                  Cada produto posicionado por <b>crescimento</b> — venda de {data.bcg.janela.label}/{data.bcg.janela.curYear}
                  contra os mesmos meses de {data.bcg.janela.prevYear} — e por <b>margem realizada</b>, o preço médio praticado
                  contra o custo de reposição. Os cortes são o crescimento da própria carteira ({fmtPct(data.bcg.cortes.crescimento * 100)})
                  e a margem média ({fmtPct(data.bcg.cortes.margem * 100)}).
                </p>
              </div>

              {/* quadrantes dispostos como na matriz */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
                <div style={{
                  writingMode: 'vertical-rl', transform: 'rotate(180deg)', textAlign: 'center',
                  fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: C.textMuted, fontWeight: 600,
                }}>← menos crescimento · mais crescimento →</div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                    {(['INTERROGACAO', 'ESTRELA', 'ABACAXI', 'VACA'] as Quadrante[]).map(k => {
                      const r = data.bcg.resumo[k]
                      const on = bcgFilter === k
                      const share = data.bcg.totais.vendaCur > 0 ? (r?.venda ?? 0) / data.bcg.totais.vendaCur : 0
                      return (
                        <div key={k} className="card" onClick={() => setBcgFilter(on ? 'all' : k)}
                          style={{
                            cursor: 'pointer', position: 'relative', overflow: 'hidden',
                            borderTop: `3px solid ${Q[k].cor}`,
                            background: on ? Q[k].cor + '0d' : undefined,
                            boxShadow: on ? `0 0 0 1px ${Q[k].cor}55` : undefined,
                          }}>
                          <span aria-hidden style={{ position: 'absolute', right: 12, top: 6, fontSize: 68, opacity: on ? 0.16 : 0.09, lineHeight: 1, pointerEvents: 'none' }}>{Q[k].icone}</span>
                          <div style={{ position: 'relative' }}>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                              <span style={{ fontSize: 13.5, fontWeight: 700, color: Q[k].cor }}>{Q[k].label}</span>
                              <span style={{ fontSize: 11, color: C.textMuted }}>{r?.itens ?? 0} produtos</span>
                            </div>
                            <div style={{ fontFamily: 'var(--font-serif), serif', fontSize: 22, color: C.navy, marginTop: 10, lineHeight: 1.1 }}>{fmt(r?.venda ?? 0)}</div>
                            <div style={{ fontSize: 11.5, color: C.textSoft, marginTop: 4 }}>
                              {fmtPct(share * 100)} da venda · margem <b style={{ color: Q[k].cor }}>{fmtPct((r?.margem ?? 0) * 100)}</b>
                            </div>
                            <div style={{ height: 4, background: '#eef2f8', borderRadius: 2, marginTop: 10, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${Math.min(100, share * 100)}%`, background: Q[k].cor, opacity: 0.75 }} />
                            </div>
                            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 10, lineHeight: 1.5, minHeight: 32 }}>{Q[k].acao}</div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <div style={{ textAlign: 'center', fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: C.textMuted, fontWeight: 600, marginTop: 10 }}>
                    ← menos margem · mais margem →
                  </div>
                </div>
              </div>

              {/* dispersão */}
              <div className="card card-accent-yellow">
                <div className="card-header">
                  <div>
                    <div className="card-eyebrow">Posicionamento</div>
                    <div className="card-title">Crescimento × Margem</div>
                  </div>
                </div>
                <p style={{ fontSize: 12, color: C.textMuted, marginBottom: 10, lineHeight: 1.6 }}>
                  Cada bolha é um produto e o tamanho dela é o faturamento. As tracejadas azuis são os cortes; a vermelha
                  marca a margem zero — à esquerda dela o produto é vendido abaixo do custo. Produtos novos e casos fora
                  de faixa ficam grampeados na moldura, com o valor real no tooltip. Clique num quadrante para isolá-lo.
                </p>
                <ResponsiveContainer width="100%" height={520}>
                  <ScatterChart margin={{ top: 16, right: 28, bottom: 24, left: 12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.line} vertical={false} />
                    <Customized component={MarcasBcg} />
                    <XAxis type="number" dataKey="x" domain={[BX_MIN, BX_MAX]} allowDataOverflow
                      tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                      tick={{ fontSize: 11, fill: C.textSoft }} stroke={C.line}
                      label={{ value: 'Margem realizada', position: 'insideBottom', offset: -8, fontSize: 11, fill: C.textMuted }} />
                    <YAxis type="number" dataKey="y" domain={[BY_MIN, BY_MAX]} allowDataOverflow
                      tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                      tick={{ fontSize: 11, fill: C.textSoft }} stroke={C.line}
                      label={{ value: 'Crescimento a/a', angle: -90, position: 'insideLeft', fontSize: 11, fill: C.textMuted }} />
                    <ZAxis type="number" dataKey="z" range={[25, 900]} />
                    <ReferenceLine x={data.bcg.cortes.margem} stroke={C.navy} strokeDasharray="5 4" strokeWidth={1.5} />
                    <ReferenceLine y={data.bcg.cortes.crescimento} stroke={C.navy} strokeDasharray="5 4" strokeWidth={1.5} />
                    <ReferenceLine x={0} stroke={C.red} strokeOpacity={0.35} strokeDasharray="2 4" />
                    <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ payload }) => {
                      const p = payload?.[0]?.payload as (BcgItem & { foraDeFaixa: boolean }) | undefined
                      if (!p) return null
                      return (
                        <div style={{ background: C.navy, color: '#fff', padding: '10px 13px', borderRadius: 5, fontSize: 12, maxWidth: 300, boxShadow: '0 6px 20px rgba(0,0,0,0.3)' }}>
                          <div style={{ fontWeight: 600, marginBottom: 6 }}>{p.nome}</div>
                          <div>Venda {data.bcg.janela.curYear}: <b style={{ color: C.yellow }}>{fmt(p.vendaCur)}</b></div>
                          <div>{data.bcg.janela.prevYear}: {fmt(p.vendaPrev)}</div>
                          <div>Crescimento: <b>{p.novo ? 'produto novo' : p.crescimento == null ? '—' : `${(p.crescimento * 100).toFixed(0)}%`}</b></div>
                          <div>Margem: <b>{p.margem == null ? '—' : `${(p.margem * 100).toFixed(1)}%`}</b></div>
                          {p.estoque != null && <div style={{ color: '#9fb0c6' }}>Estoque: {fmtNum(p.estoque)} un{p.capitalParado ? ` · ${fmt(p.capitalParado)}` : ''}</div>}
                          {p.foraDeFaixa && <div style={{ color: C.yellow, marginTop: 4, fontSize: 11 }}>fora da faixa do gráfico — posição grampeada na moldura</div>}
                        </div>
                      )
                    }} />
                    <Scatter data={bcgPontos} shape="circle">
                      {bcgPontos.map((p, i) => {
                        const cor = p.quadrante ? Q[p.quadrante].cor : C.textMuted
                        const apagado = bcgFilter !== 'all' && p.quadrante !== bcgFilter
                        return <Cell key={i} fill={cor} fillOpacity={apagado ? 0.07 : 0.55} stroke={cor} strokeOpacity={apagado ? 0.1 : 0.85} strokeWidth={1} />
                      })}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 8, lineHeight: 1.6 }}>
                  {data.bcg.totais.comMargem} produtos posicionados · {data.bcg.totais.novos} novos ·
                  {' '}{data.bcg.totais.semCusto} fora por falta de custo ·
                  {' '}{data.bcg.totais.perdidos} venderam em {data.bcg.janela.prevYear} e não venderam em {data.bcg.janela.curYear}.
                </div>
              </div>
            </div>
          )}

          {/* Tabela unificada */}
          <div className="card">
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 14 }}>
              <div>
                <div className="card-eyebrow">Detalhamento</div>
                <div className="card-title">Tabela unificada — {rows.length.toLocaleString('pt-BR')} SKUs</div>
              </div>
              <button className="btn btn-sm" onClick={exportarCsv} style={{ marginLeft: 'auto' }}
                title="Exporta as linhas filtradas, com o quadrante da BCG, em CSV para Excel">
                ⬇ Exportar CSV
              </button>
              <input
                className="form-input"
                placeholder="Buscar código ou produto…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ width: 240 }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
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
                  ...(['stockout','rupture','low','healthy','excess'] as TurnoverStatus[]).map(t => ({ v: t, label: TURNOVER_LABEL[t].split(' (')[0], color: TURNOVER_COLOR[t] })),
                ]}
              />
              {data.bcg?.hasData && (
                <FilterRow
                  label="BCG"
                  value={bcgFilter}
                  onChange={setBcgFilter}
                  options={[
                    { v: 'all', label: 'Todos' },
                    ...(['ESTRELA','VACA','INTERROGACAO','ABACAXI'] as Quadrante[]).map(q => ({ v: q, label: `${Q[q].icone} ${Q[q].label}`, color: Q[q].cor })),
                  ]}
                />
              )}
            </div>

            <div className="table-wrap sticky-first" style={{ maxHeight: '70vh', margin: '0 -28px -24px -28px' }}>
              <table style={{ minWidth: '100%' }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                  <tr>
                    <SortableTh field="code"           sort={sort} onSort={toggleSort}>Código</SortableTh>
                    <SortableTh field="description"    sort={sort} onSort={toggleSort}>Produto</SortableTh>
                    <SortableTh field="retailPrice"    sort={sort} onSort={toggleSort} align="right">Preço</SortableTh>
                    <SortableTh field="unitCost"       sort={sort} onSort={toggleSort} align="right">Custo</SortableTh>
                    <SortableTh field="marginPct"      sort={sort} onSort={toggleSort} align="right">Margem %</SortableTh>
                    <SortableTh field="abcClass"       sort={sort} onSort={toggleSort}>ABC</SortableTh>
                    <SortableTh field="bcgQuadrante"   sort={sort} onSort={toggleSort}>BCG</SortableTh>
                    <SortableTh field="bcgCrescimento" sort={sort} onSort={toggleSort} align="right">Cresc. a/a</SortableTh>
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
                      <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                        {r.bcgQuadrante ? (
                          <span title={Q[r.bcgQuadrante].acao} style={{ color: Q[r.bcgQuadrante].cor, fontWeight: 700 }}>
                            {Q[r.bcgQuadrante].icone} {Q[r.bcgQuadrante].label}
                          </span>
                        ) : <span style={{ color: C.textMuted }}>—</span>}
                      </td>
                      <td style={{
                        textAlign: 'right', fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap',
                        color: r.bcgNovo ? '#2f5a96' : r.bcgCrescimento == null ? C.textMuted
                          : r.bcgCrescimento >= (data.bcg?.cortes.crescimento ?? 0) ? C.green : C.red,
                      }}>
                        {r.bcgNovo ? 'novo' : r.bcgCrescimento == null ? '—' : `${r.bcgCrescimento >= 0 ? '+' : ''}${(r.bcgCrescimento * 100).toFixed(0)}%`}
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
