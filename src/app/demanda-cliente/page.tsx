'use client'
import { useEffect, useMemo, useState } from 'react'
import Shell from '@/components/Shell'
import { CommercialUploader } from '@/components/CommercialUploader'
import { BarChart, Bar, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'

interface Cli { code: string; nome: string; vendedor: string | null; total: number; qtd: number; nProd: number; abc: string; share: number; status: string; byMonth: Record<string, number> }
interface Overview {
  hasData: boolean; months: string[]
  kpis: { totalGeral: number; nClientes: number; nProdutos: number; ticketMedio: number }
  monthlyTotal: Record<string, number>; clientes: Cli[]; distAbc: Record<string, number>; statusDist: Record<string, number>
}
interface Detail {
  hasData: boolean; cliente: string; nome: string; vendedor: string | null; months: string[]
  monthly: Record<string, number>; total: number
  produtos: { code: string | null; nome: string; total: number; qtd: number; byMonth: Record<string, number> }[]
  dropped: { nome: string; code: string | null; total: number; ultimoMes: string | null }[]
}

const C = { navy: '#0a2540', navyMid: '#142c4e', yellow: '#f5c518', gold: '#d4a017', line: '#e3e7ed', textSoft: '#4a5670', textMuted: '#7a869a', green: '#197a4a', red: '#b03022', amber: '#c98a14', blue: '#2f5a96' }
const ABC_COLOR: Record<string, string> = { A: C.green, B: C.gold, C: C.textMuted }
const STATUS_COLOR: Record<string, string> = { Crescendo: C.green, Estável: C.blue, 'Em queda': C.amber, Sumiu: C.red, Novo: C.navy }
const fmt = (n: number) => (n < 0 ? '−' : '') + 'R$ ' + Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtK = (n: number) => { const a = Math.abs(n); return (n < 0 ? '−' : '') + (a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(0)}k` : a.toFixed(0)) }
const MONTHS = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const mLabel = (m: string) => { const [y, mm] = m.split('-'); return `${MONTHS[+mm]}/${y.slice(2)}` }

export default function DemandaCliente() {
  const [ov, setOv] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [statusF, setStatusF] = useState<string>('')

  const load = async () => { setLoading(true); setOv(await fetch('/api/demanda').then(r => r.json())); setLoading(false) }
  useEffect(() => { load() }, [])
  const openCliente = async (code: string) => { setSel(code); setDetail(null); setDetail(await fetch('/api/demanda?cliente=' + encodeURIComponent(code)).then(r => r.json())) }

  const months = ov?.months ?? []
  const monthlySeries = useMemo(() => months.map(m => ({ mes: mLabel(m), valor: ov?.monthlyTotal[m] ?? 0 })), [ov, months])
  const filtered = useMemo(() => {
    if (!ov?.clientes) return []
    const q = search.trim().toUpperCase()
    return ov.clientes.filter(c => (!statusF || c.status === statusF) && (!q || c.nome.toUpperCase().includes(q) || c.code.includes(q)))
  }, [ov, search, statusF])
  const tooltipStyle = { contentStyle: { background: C.navy, border: 'none', borderRadius: 4, fontSize: 12 }, labelStyle: { color: C.yellow, fontWeight: 600 }, itemStyle: { color: '#fff' } }

  return (
    <Shell>
      <div className="page-header">
        <div>
          <div className="page-eyebrow">Módulo · Comercial</div>
          <h1 className="page-title">Demanda por Cliente</h1>
          <p className="page-subtitle">
            O que cada cliente compra, quanto pesa, e <b>quem está caindo ou deixou de comprar</b>.
            Base: relatório comercial por vendedor › cliente › produto.
          </p>
        </div>
      </div>

      <div className="mb-6" style={{ maxWidth: 620 }}>
        <CommercialUploader title="Relatório COMERCIAL (por cliente)" description="XLSX com VENDEDOR · CLIENTE · PRODUTO · DATA · QUANTIDADE · VLR TOTAL. Substitui toda a base." endpoint="/api/demanda/import" onDone={load} />
      </div>

      {loading ? (
        <div className="empty-state"><div className="empty-state-icon">◌</div><div className="empty-state-title">Carregando…</div></div>
      ) : !ov?.hasData ? (
        <div className="card"><div className="empty-state"><div className="empty-state-icon">⌬</div><div className="empty-state-title">Sem dados de demanda</div><div className="empty-state-sub">Envie o relatório COMERCIAL acima.</div></div></div>
      ) : (
        <>
          <div className="grid-4 mb-6">
            <Kpi label="Faturamento (período)" value={fmt(ov.kpis.totalGeral)} color={C.navy} />
            <Kpi label="Clientes ativos" value={String(ov.kpis.nClientes)} color={C.gold} />
            <Kpi label="Produtos distintos" value={String(ov.kpis.nProdutos)} color={C.blue} />
            <Kpi label="Ticket médio / cliente" value={fmt(ov.kpis.ticketMedio)} color={C.green} />
          </div>

          <div className="grid-2 mb-6">
            <div className="card card-accent-yellow">
              <div className="card-eyebrow">Evolução</div>
              <div className="card-title" style={{ fontSize: 14, marginBottom: 12 }}>Faturamento mensal (todos os clientes)</div>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={monthlySeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.line} />
                  <XAxis dataKey="mes" tick={{ fontSize: 11, fill: C.textSoft }} stroke={C.line} />
                  <YAxis tick={{ fontSize: 10, fill: C.textSoft }} stroke={C.line} tickFormatter={fmtK} />
                  <Tooltip {...tooltipStyle} formatter={(v: number) => fmt(v)} />
                  <Bar dataKey="valor" fill={C.navy} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="card">
              <div className="card-eyebrow">Concentração & saúde</div>
              <div className="card-title" style={{ fontSize: 14, marginBottom: 12 }}>Curva ABC de clientes · status</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                {(['A', 'B', 'C'] as const).map(k => (
                  <div key={k} style={{ flex: 1, borderLeft: `3px solid ${ABC_COLOR[k]}`, paddingLeft: 10 }}>
                    <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600 }}>CLASSE {k}</div>
                    <div style={{ fontFamily: 'var(--font-serif), serif', fontSize: 20, color: ABC_COLOR[k] }}>{ov.distAbc[k] ?? 0}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {Object.entries(ov.statusDist).sort((a, b) => b[1] - a[1]).map(([s, n]) => (
                  <button key={s} onClick={() => setStatusF(statusF === s ? '' : s)}
                    style={{ border: `1px solid ${statusF === s ? (STATUS_COLOR[s] ?? C.navy) : C.line}`, background: statusF === s ? (STATUS_COLOR[s] ?? C.navy) : '#fff', color: statusF === s ? '#fff' : C.textSoft, borderRadius: 20, padding: '4px 12px', fontSize: 12, cursor: 'pointer' }}>
                    {s} · {n}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 10 }}>Clique num status para filtrar a tabela. "Sumiu" = sem compra no último mês; "Em queda" = último mês abaixo da metade da média.</div>
            </div>
          </div>

          {/* Ranking de clientes */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div className="card-title" style={{ fontSize: 14 }}>Clientes {statusF && `· ${statusF}`} <span style={{ color: C.textMuted, fontWeight: 400 }}>({filtered.length})</span></div>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar cliente ou código…" style={{ marginLeft: 'auto', padding: '7px 10px', border: `1px solid ${C.line}`, borderRadius: 4, fontSize: 13, minWidth: 240 }} />
            </div>
            <div className="table-wrap" style={{ maxHeight: '62vh' }}>
              <table>
                <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                  <tr><th style={{ textAlign: 'left' }}>Cliente</th><th>ABC</th><th>Status</th><th style={{ textAlign: 'right' }}>Faturamento</th><th style={{ textAlign: 'right' }}>Prod.</th><th style={{ textAlign: 'right' }}>Share</th><th></th></tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 200).map(c => (
                    <tr key={c.code} style={{ cursor: 'pointer' }} onClick={() => openCliente(c.code)}>
                      <td style={{ fontSize: 13, fontWeight: 600, color: C.navy }}>{c.nome}<div style={{ fontSize: 10, color: C.textMuted }}>{c.code}{c.vendedor ? ` · ${c.vendedor}` : ''}</div></td>
                      <td style={{ textAlign: 'center' }}><span style={{ background: ABC_COLOR[c.abc], color: '#fff', borderRadius: 3, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>{c.abc}</span></td>
                      <td style={{ textAlign: 'center', fontSize: 11, color: STATUS_COLOR[c.status] ?? C.textSoft, fontWeight: 600, whiteSpace: 'nowrap' }}>{c.status}</td>
                      <td style={{ textAlign: 'right', fontSize: 13, fontWeight: 600 }}>{fmt(c.total)}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, color: C.textMuted }}>{c.nProd}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, color: C.textMuted }}>{(c.share * 100).toFixed(1)}%</td>
                      <td style={{ textAlign: 'center', color: C.gold }}>›</td>
                    </tr>
                  ))}
                  {filtered.length > 200 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 12, fontSize: 11, color: C.textMuted }}>Mostrando 200 de {filtered.length}. Use a busca para refinar.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {sel && detail && <ClienteDetail detail={detail} onClose={() => { setSel(null); setDetail(null) }} />}
        </>
      )}
    </Shell>
  )
}

function ClienteDetail({ detail, onClose }: { detail: Detail; onClose: () => void }) {
  const months = detail.months ?? []
  const monthly = useMemo(() => months.map(m => ({ mes: mLabel(m), valor: detail.monthly?.[m] ?? 0 })), [detail, months])
  const tooltipStyle = { contentStyle: { background: C.navy, border: 'none', borderRadius: 4, fontSize: 12 }, labelStyle: { color: C.yellow, fontWeight: 600 }, itemStyle: { color: '#fff' } }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(10,37,64,0.45)', zIndex: 50, display: 'flex', justifyContent: 'flex-end' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(760px, 94vw)', background: '#fff', height: '100%', overflow: 'auto', padding: 24, boxShadow: '-4px 0 24px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.textMuted, fontWeight: 600 }}>Cliente {detail.cliente}{detail.vendedor ? ` · ${detail.vendedor}` : ''}</div>
            <div style={{ fontFamily: 'var(--font-serif), serif', fontSize: 22, color: C.navy }}>{detail.nome}</div>
            <div style={{ fontSize: 13, color: C.gold, marginTop: 2 }}>{fmt(detail.total)} no período · {detail.produtos.length} produtos</div>
          </div>
          <button className="btn btn-sm" onClick={onClose}>✕ Fechar</button>
        </div>

        <div className="card mb-6">
          <div className="card-eyebrow">Tendência</div>
          <div className="card-title" style={{ fontSize: 13, marginBottom: 8 }}>Compras mês a mês</div>
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart data={monthly}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.line} />
              <XAxis dataKey="mes" tick={{ fontSize: 10, fill: C.textSoft }} stroke={C.line} />
              <YAxis tick={{ fontSize: 9, fill: C.textSoft }} stroke={C.line} tickFormatter={fmtK} />
              <Tooltip {...tooltipStyle} formatter={(v: number) => fmt(v)} />
              <Bar dataKey="valor" fill={C.navy} radius={[3, 3, 0, 0]} />
              <Line dataKey="valor" stroke={C.gold} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {detail.dropped.length > 0 && (
          <div className="card mb-6" style={{ borderLeft: `3px solid ${C.red}` }}>
            <div className="card-eyebrow" style={{ color: C.red }}>Alerta</div>
            <div className="card-title" style={{ fontSize: 13, marginBottom: 8 }}>Deixou de comprar (sem compra no último mês) — {detail.dropped.length} itens</div>
            <div style={{ maxHeight: 200, overflow: 'auto' }}>
              {detail.dropped.slice(0, 30).map((d, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: `1px solid ${C.line}` }}>
                  <span style={{ color: C.navy }}>{d.nome}</span>
                  <span style={{ color: C.textMuted, whiteSpace: 'nowrap', marginLeft: 8 }}>{fmtK(d.total)} · últ. {d.ultimoMes ? mLabel(d.ultimoMes) : '—'}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 18px', borderBottom: `1px solid ${C.line}` }}><div className="card-title" style={{ fontSize: 13 }}>Produtos comprados</div></div>
          <div className="table-wrap sticky-first" style={{ maxHeight: 380 }}>
            <table style={{ minWidth: '100%' }}>
              <thead><tr><th style={{ textAlign: 'left' }}>Produto</th>{months.map(m => <th key={m} style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{mLabel(m)}</th>)}<th style={{ textAlign: 'right', background: C.navyMid }}>Total</th></tr></thead>
              <tbody>
                {detail.produtos.map((p, i) => (
                  <tr key={i}>
                    <td style={{ fontSize: 12, color: C.navy, background: '#fff' }}>{p.nome}</td>
                    {months.map(m => <td key={m} style={{ textAlign: 'right', fontSize: 11, color: (p.byMonth[m] ?? 0) > 0 ? C.textSoft : '#cfd6e0' }}>{p.byMonth[m] ? fmtK(p.byMonth[m]) : '·'}</td>)}
                    <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, background: '#f6f8fb' }}>{fmtK(p.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

function Kpi({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ borderLeft: `3px solid ${color}`, paddingLeft: 14 }}>
      <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-serif), serif', fontSize: 18, color, lineHeight: 1.15 }}>{value}</div>
    </div>
  )
}
