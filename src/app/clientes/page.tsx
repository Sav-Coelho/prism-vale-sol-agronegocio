'use client'
import { useEffect, useMemo, useState } from 'react'
import Shell from '@/components/Shell'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceArea, Cell,
} from 'recharts'

type CreditRow = {
  id: number
  name: string
  cpf?: string | null
  active: boolean
  alpha: number
  beta: number
  paid: number
  defaulted: number
  pending: number
  score: number
  risk: number
  confidenceLow: number
  confidenceHigh: number
  observations: number
  salesCount: number
  openBalance: number
  aging: { bucket0_30: number; bucket31_60: number; bucket61_90: number; bucket90plus: number }
}

type RiskPoint = {
  key: string
  label: string
  year: number
  month: number
  weightedRisk: number
  meanRisk: number
  exposure: number
  clientsWithExposure: number
}

const fmt    = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`

const COLORS = {
  dark:    '#2b2d42',
  yellow:  '#eaca2d',
  green:   '#1a7a4a',
  red:     '#c0392b',
  blue:    '#3a6ea5',
  purple:  '#7d3c98',
  orange:  '#d35400',
  gray:    '#8d99ae',
  light:   '#edf2f4',
}

const riskColor = (r: number) =>
  r < 0.2 ? COLORS.green  :
  r < 0.4 ? '#7da93f'     :
  r < 0.6 ? COLORS.yellow :
  r < 0.8 ? COLORS.orange :
            COLORS.red

const riskLabel = (r: number) =>
  r < 0.2 ? 'AA' :
  r < 0.4 ? 'A'  :
  r < 0.6 ? 'B'  :
  r < 0.8 ? 'C'  :
            'D'

export default function Clientes() {
  const [rows, setRows] = useState<CreditRow[]>([])
  const [risk, setRisk] = useState<RiskPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<CreditRow | null>(null)
  const [name, setName] = useState('')
  const [cpf, setCpf] = useState('')
  const [phone, setPhone] = useState('')

  const load = async () => {
    setLoading(true)
    const [r, s] = await Promise.all([
      fetch('/api/credit').then(x => x.json()),
      fetch('/api/credit/aggregate-risk?months=12').then(x => x.json()),
    ])
    setRows(r)
    setRisk(s.series || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3000) }

  const portfolio = useMemo(() => {
    const open = rows.reduce((s, r) => s + r.openBalance, 0)
    const weightedRisk = open > 0
      ? rows.reduce((s, r) => s + r.openBalance * r.risk, 0) / open
      : 0
    return { open, weightedRisk }
  }, [rows])

  const distribution = useMemo(() => {
    const bands = [
      { label: 'AA (<20%)', min: 0,   max: 0.2,  color: COLORS.green  },
      { label: 'A (20–40)', min: 0.2, max: 0.4,  color: '#7da93f'     },
      { label: 'B (40–60)', min: 0.4, max: 0.6,  color: COLORS.yellow },
      { label: 'C (60–80)', min: 0.6, max: 0.8,  color: COLORS.orange },
      { label: 'D (≥80%)',  min: 0.8, max: 1.01, color: COLORS.red    },
    ]
    return bands.map(b => ({
      ...b,
      clientes: rows.filter(r => r.risk >= b.min && r.risk < b.max).length,
    }))
  }, [rows])

  const agingTotals = useMemo(() => {
    const t = { '0–30': 0, '31–60': 0, '61–90': 0, '>90': 0 }
    rows.forEach(r => {
      t['0–30']  += r.aging.bucket0_30
      t['31–60'] += r.aging.bucket31_60
      t['61–90'] += r.aging.bucket61_90
      t['>90']   += r.aging.bucket90plus
    })
    return Object.entries(t).map(([faixa, valor]) => ({ faixa, valor }))
  }, [rows])

  const sortedRows = [...rows].sort((a, b) => b.risk - a.risk)

  const openNew  = () => { setEditing(null); setName(''); setCpf(''); setPhone(''); setModal(true) }
  const openEdit = (r: CreditRow) => { setEditing(r); setName(r.name); setCpf(r.cpf || ''); setPhone(''); setModal(true) }

  const save = async () => {
    if (!name.trim()) return
    const url = editing ? `/api/clients/${editing.id}` : '/api/clients'
    const method = editing ? 'PUT' : 'POST'
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, cpf, phone }),
    })
    const data = await res.json()
    if (!res.ok) { showToast(`Erro: ${data.error}`); return }
    setModal(false)
    load()
    showToast(editing ? '✓ Cliente atualizado' : '✓ Cliente cadastrado')
  }

  const remove = async (r: CreditRow) => {
    if (!confirm(`Excluir cliente "${r.name}"?`)) return
    const res = await fetch(`/api/clients/${r.id}`, { method: 'DELETE' })
    if (res.ok) { load(); showToast('✓ Cliente excluído') }
  }

  return (
    <Shell>
      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">Análise de Crédito</h1>
          <p className="page-subtitle">
            Score bayesiano (prior Beta(2,2)) · Carteira em aberto: <b>{fmt(portfolio.open)}</b> · Risco médio ponderado: <b>{fmtPct(portfolio.weightedRisk)}</b>
          </p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ Novo Cliente</button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--brave-gray)' }}>Calculando scores...</div>
      ) : (
        <>
          <div className="card mb-6">
            <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
              Risco de Crédito Agregado — últimos 12 meses
            </div>
            <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 14 }}>
              Probabilidade esperada de inadimplência ponderada pela exposição em aberto da carteira no fim de cada mês
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={risk}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.light} />
                <ReferenceArea y1={0}    y2={0.2}  fill={COLORS.green}  fillOpacity={0.06} />
                <ReferenceArea y1={0.2}  y2={0.4}  fill="#7da93f"       fillOpacity={0.06} />
                <ReferenceArea y1={0.4}  y2={0.6}  fill={COLORS.yellow} fillOpacity={0.08} />
                <ReferenceArea y1={0.6}  y2={0.8}  fill={COLORS.orange} fillOpacity={0.08} />
                <ReferenceArea y1={0.8}  y2={1}    fill={COLORS.red}    fillOpacity={0.08} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} domain={[0, 1]} tickFormatter={v => `${(v*100).toFixed(0)}%`} />
                <Tooltip formatter={(v: number) => fmtPct(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="weightedRisk" name="Risco ponderado pela exposição" stroke={COLORS.red}  strokeWidth={3} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="meanRisk"     name="Risco médio simples"             stroke={COLORS.gray} strokeWidth={2} strokeDasharray="4 4" dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="grid-2 mb-6">
            <div className="card">
              <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                Distribuição de Clientes por Faixa de Risco
              </div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 14 }}>
                AA (muito baixo) a D (crítico), baseado no posterior Beta
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={distribution}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.light} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="clientes" name="Clientes" radius={[3, 3, 0, 0]}>
                    {distribution.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="card">
              <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                Aging da Carteira em Aberto
              </div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 14 }}>
                Valor em aberto por idade do vencimento (dias)
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={agingTotals}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.light} />
                  <XAxis dataKey="faixa" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Bar dataKey="valor" name="Em aberto" fill={COLORS.orange} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--brave-light)', fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13 }}>
              Clientes — ordenados por risco (mais críticos primeiro)
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Pagas / Inadimplentes / Pendentes</th>
                    <th style={{ width: 240 }}>Probabilidade de Pagar (IC 95%)</th>
                    <th>Faixa</th>
                    <th style={{ textAlign: 'right' }}>Em aberto</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.length === 0 && (
                    <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center', color: 'var(--brave-gray)' }}>
                      Nenhum cliente cadastrado.
                    </td></tr>
                  )}
                  {sortedRows.map(r => (
                    <tr key={r.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{r.name}</div>
                        {r.cpf && <div style={{ fontSize: 11, color: 'var(--brave-gray)' }}>{r.cpf}</div>}
                      </td>
                      <td style={{ fontSize: 12 }}>
                        <span style={{ color: COLORS.green }}>{r.paid}</span> / <span style={{ color: COLORS.red }}>{r.defaulted}</span> / <span style={{ color: COLORS.gray }}>{r.pending}</span>
                      </td>
                      <td>
                        <div style={{ position: 'relative', height: 16, background: COLORS.light, borderRadius: 4 }}>
                          <div style={{
                            position: 'absolute',
                            left:  `${r.confidenceLow * 100}%`,
                            width: `${(r.confidenceHigh - r.confidenceLow) * 100}%`,
                            top: 3, bottom: 3,
                            background: riskColor(r.risk),
                            opacity: 0.35,
                            borderRadius: 2,
                          }} />
                          <div style={{
                            position: 'absolute',
                            left: `${r.score * 100}%`,
                            top: -1, bottom: -1,
                            width: 3,
                            background: riskColor(r.risk),
                            borderRadius: 1,
                          }} />
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 3 }}>
                          {fmtPct(r.score)} · IC: {fmtPct(r.confidenceLow)}–{fmtPct(r.confidenceHigh)}
                        </div>
                      </td>
                      <td>
                        <span style={{
                          fontSize: 11, fontWeight: 700,
                          color: riskColor(r.risk),
                          background: riskColor(r.risk) + '22',
                          padding: '3px 8px',
                          borderRadius: 4,
                        }}>
                          {riskLabel(r.risk)}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: r.openBalance > 0 ? COLORS.orange : COLORS.gray }}>
                        {fmt(r.openBalance)}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn btn-sm" onClick={() => openEdit(r)}>✏️</button>
                        <button className="btn btn-sm btn-danger" onClick={() => remove(r)} style={{ marginLeft: 4 }}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div className="card" style={{ width: 400, padding: 24 }}>
            <h3 style={{ fontFamily: 'var(--font-sub)', marginBottom: 16 }}>{editing ? 'Editar' : 'Novo'} Cliente</h3>
            <label style={{ fontSize: 12, color: 'var(--brave-gray)' }}>Nome</label>
            <input className="form-input" style={{ width: '100%', marginBottom: 10 }} value={name} onChange={e => setName(e.target.value)} autoFocus />
            <label style={{ fontSize: 12, color: 'var(--brave-gray)' }}>CPF/CNPJ</label>
            <input className="form-input" style={{ width: '100%', marginBottom: 10 }} value={cpf} onChange={e => setCpf(e.target.value)} />
            <label style={{ fontSize: 12, color: 'var(--brave-gray)' }}>Telefone</label>
            <input className="form-input" style={{ width: '100%', marginBottom: 16 }} value={phone} onChange={e => setPhone(e.target.value)} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={save} disabled={!name.trim()}>Salvar</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </Shell>
  )
}
