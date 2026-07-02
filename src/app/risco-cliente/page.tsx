'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
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

const C = {
  navy:      '#0a2540',
  navyMid:   '#142c4e',
  navyLight: '#1e3a5f',
  yellow:    '#f5c518',
  gold:      '#d4a017',
  line:      '#e3e7ed',
  textSoft:  '#4a5670',
  textMuted: '#7a869a',
  green:     '#197a4a',
  red:       '#b03022',
  amber:     '#c98a14',
}

const riskColor = (r: number) =>
  r < 0.2 ? C.green :
  r < 0.4 ? '#5a8542' :
  r < 0.6 ? C.gold :
  r < 0.8 ? C.amber :
            C.red

const riskLabel = (r: number) =>
  r < 0.2 ? 'AA' :
  r < 0.4 ? 'A'  :
  r < 0.6 ? 'B'  :
  r < 0.8 ? 'C'  :
            'D'

export default function RiscoCliente() {
  const [rows, setRows] = useState<CreditRow[]>([])
  const [risk, setRisk] = useState<RiskPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<CreditRow | null>(null)
  const [name, setName] = useState('')
  const [cpf, setCpf] = useState('')
  const [phone, setPhone] = useState('')
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

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
    return { open, weightedRisk, total: rows.length }
  }, [rows])

  const distribution = useMemo(() => {
    const bands = [
      { label: 'AA',  range: '<20%',  min: 0,   max: 0.2,  color: C.green },
      { label: 'A',   range: '20-40', min: 0.2, max: 0.4,  color: '#5a8542' },
      { label: 'B',   range: '40-60', min: 0.4, max: 0.6,  color: C.gold },
      { label: 'C',   range: '60-80', min: 0.6, max: 0.8,  color: C.amber },
      { label: 'D',   range: '≥80%',  min: 0.8, max: 1.01, color: C.red },
    ]
    return bands.map(b => ({ ...b, clientes: rows.filter(r => r.risk >= b.min && r.risk < b.max).length }))
  }, [rows])

  const agingTotals = useMemo(() => {
    const t = { '0–30 dias': 0, '31–60 dias': 0, '61–90 dias': 0, '> 90 dias': 0 }
    rows.forEach(r => {
      t['0–30 dias']  += r.aging.bucket0_30
      t['31–60 dias'] += r.aging.bucket31_60
      t['61–90 dias'] += r.aging.bucket61_90
      t['> 90 dias']  += r.aging.bucket90plus
    })
    return Object.entries(t).map(([faixa, valor]) => ({ faixa, valor }))
  }, [rows])

  const sortedRows = [...rows].sort((a, b) => b.risk - a.risk)

  const uploadReceber = async (file: File) => {
    if (!confirm(`Isso vai APAGAR todos os clientes e títulos atuais e substituir pelo conteúdo de "${file.name}". Continuar?`)) return
    setImporting(true); setImportMsg('Lendo planilha…')
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await fetch('/api/credit/import', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) { setImportMsg('Erro: ' + (data.error || 'falha')); return }
      setImportMsg(`✓ ${data.createdClients} clientes · ${data.createdSales} títulos importados (${data.deletedSales} apagados)`)
      await load()
    } catch (e) {
      setImportMsg('Erro: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setImporting(false)
    }
  }

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
      <div className="page-header">
        <div>
          <div className="page-eyebrow">Módulo · Análise de Risco</div>
          <h1 className="page-title">Risco de Cliente</h1>
          <p className="page-subtitle">
            Avaliação bayesiana de inadimplência com prior Beta(2, 2). A pontuação de cada cliente é
            atualizada conforme suas vendas são quitadas ou caem em inadimplência (≥ 90 dias).
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) uploadReceber(f); e.target.value = '' }}
          />
          <button
            className="btn"
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            title="Substitui a base atual pelos títulos do XLSX. Chave por CÓDIGO do ERP."
          >
            {importing ? '◌ Importando…' : '⬆ Importar contas a receber (XLSX)'}
          </button>
          <button className="btn btn-primary" onClick={openNew}>+ Novo Cliente</button>
        </div>
      </div>

      {importMsg && (
        <div className="card mb-6" style={{ borderTopColor: importMsg.startsWith('✓') ? C.green : importMsg.startsWith('Erro') ? C.red : C.gold }}>
          <div style={{ fontSize: 13, color: C.textSoft }}>{importMsg}</div>
        </div>
      )}

      {loading ? (
        <div className="empty-state">
          <div className="empty-state-icon">◌</div>
          <div className="empty-state-title">Calculando scores…</div>
        </div>
      ) : rows.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">◆</div>
            <div className="empty-state-title">Nenhum cliente cadastrado</div>
            <p style={{ fontSize: 13, marginTop: 12, color: C.textMuted, maxWidth: 480, marginInline: 'auto' }}>
              Comece cadastrando seus clientes. À medida que vendas a prazo forem
              registradas e pagas — ou caírem em atraso —, o sistema calculará o score
              de crédito automaticamente.
            </p>
            <button className="btn btn-primary mt-6" onClick={openNew}>+ Cadastrar primeiro cliente</button>
          </div>
        </div>
      ) : (
        <>
          {/* Resumo executivo */}
          <div className="card mb-6">
            <div className="card-header">
              <div>
                <div className="card-eyebrow">Posição da carteira</div>
                <div className="card-title">Visão Consolidada</div>
              </div>
            </div>
            <div className="grid-3" style={{ gap: 32 }}>
              <ExecMetric label="Clientes na base"      value={String(portfolio.total)} />
              <ExecMetric label="Carteira em aberto"    value={fmt(portfolio.open)} />
              <ExecMetric label="Risco médio ponderado" value={fmtPct(portfolio.weightedRisk)}
                          accent={portfolio.weightedRisk >= 0.4 ? C.red : portfolio.weightedRisk >= 0.2 ? C.amber : C.green} />
            </div>
          </div>

          {/* Gráfico principal */}
          <div className="card mb-6 card-accent-yellow">
            <div className="card-header">
              <div>
                <div className="card-eyebrow">Série temporal · últimos 12 meses</div>
                <div className="card-title">Risco de Crédito Agregado</div>
              </div>
            </div>
            <p style={{ fontSize: 12, color: C.textMuted, marginBottom: 18, lineHeight: 1.6 }}>
              Probabilidade esperada de inadimplência ponderada pela exposição em aberto da
              carteira no fim de cada mês. As bandas de cor representam as faixas de risco AA → D.
            </p>
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={risk} margin={{ top: 8, right: 24, bottom: 4, left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.line} />
                <ReferenceArea y1={0}    y2={0.2}  fill={C.green}    fillOpacity={0.05} />
                <ReferenceArea y1={0.2}  y2={0.4}  fill="#5a8542"    fillOpacity={0.05} />
                <ReferenceArea y1={0.4}  y2={0.6}  fill={C.gold}     fillOpacity={0.07} />
                <ReferenceArea y1={0.6}  y2={0.8}  fill={C.amber}    fillOpacity={0.07} />
                <ReferenceArea y1={0.8}  y2={1}    fill={C.red}      fillOpacity={0.07} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: C.textSoft }} stroke={C.line} />
                <YAxis tick={{ fontSize: 11, fill: C.textSoft }} domain={[0, 1]}
                       tickFormatter={v => `${(v*100).toFixed(0)}%`} stroke={C.line} />
                <Tooltip
                  formatter={(v: number) => fmtPct(v)}
                  contentStyle={{ background: C.navy, border: 'none', borderRadius: 4, color: '#fff', fontSize: 12 }}
                  labelStyle={{ color: C.yellow, fontWeight: 600, marginBottom: 4 }}
                />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
                <Line type="monotone" dataKey="weightedRisk" name="Risco ponderado pela exposição"
                      stroke={C.navy} strokeWidth={2.5}
                      dot={{ r: 4, fill: C.yellow, stroke: C.navy, strokeWidth: 2 }} />
                <Line type="monotone" dataKey="meanRisk" name="Risco médio simples"
                      stroke={C.textMuted} strokeWidth={1.5} strokeDasharray="4 4"
                      dot={{ r: 3, fill: '#fff', stroke: C.textMuted, strokeWidth: 1.5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Distribuição + Aging */}
          <div className="grid-2 mb-6">
            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-eyebrow">Composição</div>
                  <div className="card-title">Distribuição por Faixa de Risco</div>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={distribution} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.line} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: C.textSoft }} stroke={C.line} />
                  <YAxis tick={{ fontSize: 11, fill: C.textSoft }} allowDecimals={false} stroke={C.line} />
                  <Tooltip contentStyle={{ background: C.navy, border: 'none', borderRadius: 4, color: '#fff', fontSize: 12 }} />
                  <Bar dataKey="clientes" name="Clientes" radius={[3, 3, 0, 0]}>
                    {distribution.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-eyebrow">Idade dos vencimentos</div>
                  <div className="card-title">Aging da Carteira</div>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={agingTotals} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.line} />
                  <XAxis dataKey="faixa" tick={{ fontSize: 11, fill: C.textSoft }} stroke={C.line} />
                  <YAxis tick={{ fontSize: 11, fill: C.textSoft }}
                         tickFormatter={v => `R$ ${(v/1000).toFixed(0)}k`} stroke={C.line} />
                  <Tooltip formatter={(v: number) => fmt(v)}
                           contentStyle={{ background: C.navy, border: 'none', borderRadius: 4, color: '#fff', fontSize: 12 }} />
                  <Bar dataKey="valor" name="Em aberto" fill={C.yellow} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Tabela detalhada */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '20px 28px', borderBottom: `1px solid ${C.line}` }}>
              <div className="card-eyebrow">Detalhamento</div>
              <div className="card-title">Clientes ordenados por risco</div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Histórico</th>
                    <th style={{ width: 260 }}>Probabilidade de pagar (IC 95%)</th>
                    <th>Faixa</th>
                    <th style={{ textAlign: 'right' }}>Em aberto</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map(r => (
                    <tr key={r.id}>
                      <td>
                        <div style={{ fontWeight: 600, color: C.navy }}>{r.name}</div>
                        {r.cpf && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{r.cpf}</div>}
                      </td>
                      <td style={{ fontSize: 12 }}>
                        <span style={{ color: C.green, fontWeight: 600 }}>{r.paid}</span>
                        <span style={{ color: C.textMuted }}> / </span>
                        <span style={{ color: C.red, fontWeight: 600 }}>{r.defaulted}</span>
                        <span style={{ color: C.textMuted }}> / </span>
                        <span style={{ color: C.textMuted }}>{r.pending}</span>
                        <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                          pagos / inadimpl. / pendentes
                        </div>
                      </td>
                      <td>
                        <div style={{ position: 'relative', height: 18, background: C.line, borderRadius: 2 }}>
                          <div style={{
                            position: 'absolute',
                            left:  `${r.confidenceLow * 100}%`,
                            width: `${(r.confidenceHigh - r.confidenceLow) * 100}%`,
                            top: 4, bottom: 4,
                            background: riskColor(r.risk),
                            opacity: 0.4,
                            borderRadius: 1,
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
                        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>
                          <b style={{ color: C.navy }}>{fmtPct(r.score)}</b> · IC: {fmtPct(r.confidenceLow)}–{fmtPct(r.confidenceHigh)}
                        </div>
                      </td>
                      <td>
                        <span className="badge" style={{
                          color: riskColor(r.risk),
                          background: riskColor(r.risk) + '15',
                          borderColor: riskColor(r.risk),
                        }}>{riskLabel(r.risk)}</span>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: r.openBalance > 0 ? C.amber : C.textMuted }}>
                        {fmt(r.openBalance)}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn btn-sm" onClick={() => openEdit(r)}>Editar</button>
                        <button className="btn btn-sm btn-danger" onClick={() => remove(r)} style={{ marginLeft: 6 }}>Excluir</button>
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
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(10, 37, 64, 0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 200,
        }}>
          <div className="card card-accent-yellow" style={{ width: 460, padding: 0 }}>
            <div style={{ padding: '24px 28px 16px', borderBottom: `1px solid ${C.line}` }}>
              <div className="card-eyebrow">Cadastro</div>
              <div className="card-title">{editing ? 'Editar Cliente' : 'Novo Cliente'}</div>
            </div>
            <div style={{ padding: '20px 28px' }}>
              <div className="form-group">
                <label className="form-label">Nome</label>
                <input className="form-input" value={name} onChange={e => setName(e.target.value)} autoFocus />
              </div>
              <div className="form-group">
                <label className="form-label">CPF / CNPJ</label>
                <input className="form-input" value={cpf} onChange={e => setCpf(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Telefone</label>
                <input className="form-input" value={phone} onChange={e => setPhone(e.target.value)} />
              </div>
            </div>
            <div style={{ padding: '14px 28px 24px', display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: `1px solid ${C.line}` }}>
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

function ExecMetric({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ borderLeft: `3px solid ${accent || C.yellow}`, paddingLeft: 18 }}>
      <div style={{
        fontSize: 10, color: C.textMuted, letterSpacing: '0.12em',
        textTransform: 'uppercase', fontWeight: 600, marginBottom: 6,
      }}>
        {label}
      </div>
      <div style={{
        fontFamily: 'var(--font-serif), Georgia, serif',
        fontSize: 30,
        color: accent || C.navy,
        letterSpacing: '-0.01em',
        lineHeight: 1.1,
      }}>
        {value}
      </div>
    </div>
  )
}
