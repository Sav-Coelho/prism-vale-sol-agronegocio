'use client'
import { useEffect, useState } from 'react'
import Shell from '@/components/Shell'
import { MONTH_NAMES } from '@/lib/dre'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend
} from 'recharts'

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

const fmtPct = (v: number) => `${v.toFixed(1)}%`

const now = new Date()

const COLORS = {
  dark:    '#2b2d42',
  yellow:  '#eaca2d',
  green:   '#1a7a4a',
  red:     '#c0392b',
  blue:    '#3a6ea5',
  purple:  '#7d3c98',
  orange:  '#d35400',
}

export default function Dashboard() {
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/dre?month=${month}&year=${year}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [month, year])

  const dre = data?.dre
  const yearData = (data?.yearData || []).map((d: any, i: number) => ({
    mes: MONTH_NAMES[i + 1],
    'Receita Bruta':       d.receitaBruta,
    'Receita Líquida':     d.receitaLiquida,
    'Margem Bruta':        d.margemBruta,
    'Margem Contribuição': d.margemContribuicao,
    'EBITDA':              d.ebitda,
    'EBIT':                d.resultadoOperacional,
    'Lucro Líquido':       d.resultadoLiquido,
    'Margem Bruta %':      d.margemBrutaPct,
    'Margem EBITDA %':     d.margemEbitdaPct,
    'Margem Operacional %': d.margemOperacionalPct,
    'Margem Líquida %':    d.margemLiquidaPct,
  }))

  return (
    <Shell>
      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">Dashboard Mensal</h1>
          <p className="page-subtitle">Indicadores financeiros e evolução do resultado</p>
        </div>
        <div className="flex gap-2">
          <select className="form-select" style={{ width: 120 }} value={month} onChange={e => setMonth(+e.target.value)}>
            {MONTH_NAMES.slice(1).map((m, i) => (
              <option key={i + 1} value={i + 1}>{m}</option>
            ))}
          </select>
          <select className="form-select" style={{ width: 90 }} value={year} onChange={e => setYear(+e.target.value)}>
            {[2023, 2024, 2025, 2026].map(y => <option key={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--brave-gray)' }}>Carregando...</div>
      ) : !dre ? (
        <div className="card" style={{ textAlign: 'center', padding: 60 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📊</div>
          <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 15 }}>Sem dados para este período</div>
          <div style={{ color: 'var(--brave-gray)', fontSize: 13, marginTop: 6 }}>
            Importe um extrato OFX e classifique as transações para gerar o DRE
          </div>
        </div>
      ) : (
        <>
          <div className="metrics-grid">
            {[
              { label: 'Receita Líquida',  value: dre.receitaLiquida,        cls: '' },
              { label: 'Margem Bruta',     value: dre.margemBruta,           cls: dre.margemBruta >= 0 ? 'positive' : 'negative' },
              { label: 'EBITDA',           value: dre.ebitda,                cls: dre.ebitda >= 0 ? 'positive' : 'negative' },
              { label: 'Lucro Operacional',value: dre.resultadoOperacional,  cls: dre.resultadoOperacional >= 0 ? 'positive' : 'negative' },
              { label: 'Lucro Líquido',    value: dre.resultadoLiquido,      cls: dre.resultadoLiquido >= 0 ? 'positive' : 'negative' },
              { label: 'Margem Líquida',   display: fmtPct(dre.margemLiquidaPct), cls: dre.margemLiquidaPct >= 0 ? 'positive' : 'negative' },
            ].map(m => (
              <div className="metric-card" key={m.label}>
                <div className="metric-accent"></div>
                <div className="metric-label">{m.label}</div>
                <div className={`metric-value ${m.cls}`}>
                  {m.display ?? fmt(m.value!)}
                </div>
              </div>
            ))}
          </div>

          <div className="grid-2 mb-6">
            <div className="card">
              <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                Receitas e Margens — {year}
              </div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 14 }}>
                Receita bruta, líquida e margens absolutas
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={yearData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#edf2f4" />
                  <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="Receita Bruta"       stroke={COLORS.dark}   strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="Receita Líquida"     stroke={COLORS.blue}   strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="Margem Bruta"        stroke={COLORS.green}  strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="Margem Contribuição" stroke={COLORS.yellow} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="card">
              <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                Resultados — {year}
              </div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 14 }}>
                EBITDA, EBIT e Lucro Líquido por mês
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={yearData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#edf2f4" />
                  <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="EBITDA"        stroke={COLORS.purple} strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="EBIT"          stroke={COLORS.orange} strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="Lucro Líquido" stroke={COLORS.yellow} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid-2">
            <div className="card">
              <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                Margens Percentuais — {year}
              </div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 14 }}>
                Indicadores de rentabilidade sobre Receita Líquida
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={yearData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#edf2f4" />
                  <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v.toFixed(0)}%`} />
                  <Tooltip formatter={(v: number) => fmtPct(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="Margem Bruta %"       stroke={COLORS.green}  strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="Margem EBITDA %"      stroke={COLORS.purple} strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="Margem Operacional %" stroke={COLORS.orange} strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="Margem Líquida %"     stroke={COLORS.yellow} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="card">
              <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                Receita Bruta vs Lucro Líquido — {year}
              </div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 14 }}>
                Comparativo mensal entre faturamento e resultado
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={yearData} barSize={14}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#edf2f4" />
                  <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Receita Bruta" fill={COLORS.dark}   radius={[3,3,0,0]} />
                  <Bar dataKey="Lucro Líquido" fill={COLORS.yellow} radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </Shell>
  )
}
