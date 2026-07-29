'use client'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import Shell from '@/components/Shell'

// Renderiza no <body> — escapa de qualquer ancestral com transform que
// prenderia o position:fixed ao container da página em vez do viewport.
function BodyPortal({ children }: { children: React.ReactNode }) {
  if (typeof document === 'undefined') return null
  return createPortal(children, document.body)
}
import { CommercialUploader } from '@/components/CommercialUploader'
import { BarChart, Bar, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

interface Cli { code: string; nome: string; vendedor: string | null; total: number; qtd: number; nProd: number; abc: string; share: number; status: string; byMonth: Record<string, number>; tCur: number; tPrev: number; yoy: number | null; perdidoYoY: boolean; margem: number | null }
interface VendRank { nome: string; total: number; tCur: number; tPrev: number; yoy: number | null; clientesAtivos: number; clientesPerdidos: number; clientesNovos: number; margem: number | null }
interface Overview {
  hasData: boolean; months: string[]
  curYear: number; prevYear: number | null; cmpUpTo: number; hasYoY: boolean
  filtros: { vendedores: string[]; anos: number[]; vendedor: string | null; years: number[]; months: number[] }
  kpis: { totalGeral: number; nClientes: number; nProdutos: number; ticketMedio: number; totalCur: number; totalPrev: number; yoyGeral: number | null; perdidosYoY: number }
  monthlyTotal: Record<string, number>; clientes: Cli[]; distAbc: Record<string, number>; statusDist: Record<string, number>; vendedoresRank: VendRank[]
}
interface DetailProduto { code: string | null; nome: string; total: number; qtd: number; byMonth: Record<string, number>; margem: number | null }
interface Detail {
  hasData: boolean; cliente: string; nome: string; vendedor: string | null; months: string[]
  monthly: Record<string, number>; total: number; curYear?: number; prevYear?: number | null; margemMedia: number | null
  produtos: DetailProduto[]
  dropped: { nome: string; code: string | null; total: number; ultimoMes: string | null }[]
  droppedYoY: { nome: string; code: string | null; totalPrev: number }[]
}

const C = { navy: '#0a2540', navyMid: '#142c4e', yellow: '#f5c518', gold: '#d4a017', line: '#e3e7ed', textSoft: '#4a5670', textMuted: '#7a869a', green: '#197a4a', red: '#b03022', amber: '#c98a14', blue: '#2f5a96' }
const ABC_COLOR: Record<string, string> = { A: C.green, B: C.gold, C: C.textMuted }
const STATUS_COLOR: Record<string, string> = { Crescendo: C.green, Estável: C.blue, 'Em queda': C.amber, Sumiu: C.red, Novo: C.navy }
const fmt = (n: number) => (n < 0 ? '−' : '') + 'R$ ' + Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtK = (n: number) => { const a = Math.abs(n); return (n < 0 ? '−' : '') + (a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(0)}k` : a.toFixed(0)) }
const MONTHS = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const mLabel = (m: string) => { const [y, mm] = m.split('-'); return `${MONTHS[+mm]}/${y.slice(2)}` }
const mgColor = (m: number | null) => m == null ? C.textMuted : m >= 0.2 ? C.green : m >= 0.1 ? C.amber : C.red
const mgFmt = (m: number | null) => m == null ? '—' : `${(m * 100).toFixed(1)}%`

export default function DemandaCliente() {
  const [ov, setOv] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [statusF, setStatusF] = useState<string>('')
  const [soPerdidos, setSoPerdidos] = useState(false)
  // filtros (pedido do Felipe): vendedor × anos × meses
  const [vendF, setVendF] = useState('')
  const [yearsF, setYearsF] = useState<number[]>([])
  const [monthsF, setMonthsF] = useState<number[]>([])
  const [view, setView] = useState<'clientes' | 'vendedores'>('clientes')

  const [selNome, setSelNome] = useState('')
  const [errMsg, setErrMsg] = useState('')

  const load = async () => {
    setLoading(true)
    const p = new URLSearchParams()
    if (vendF) p.set('vendedor', vendF)
    if (yearsF.length) p.set('years', yearsF.join(','))
    if (monthsF.length) p.set('months', monthsF.join(','))
    const qs = p.toString()
    setOv(await fetch('/api/demanda' + (qs ? '?' + qs : '')).then(r => r.json()))
    setLoading(false)
  }
  useEffect(() => { load() }, [vendF, yearsF, monthsF])  // eslint-disable-line react-hooks/exhaustive-deps

  const fecharDrill = () => { setSel(null); setDetail(null); setSelNome('') }
  const openCliente = async (code: string, nome: string) => {
    setSel(code); setSelNome(nome); setDetail(null)
    try {
      const r = await fetch('/api/demanda?cliente=' + encodeURIComponent(code))
      if (!r.ok) throw new Error('HTTP ' + r.status)
      const d = await r.json()
      if (!d?.hasData || d.notFound || !Array.isArray(d.produtos)) throw new Error('sem dados')
      setDetail(d)
    } catch {
      fecharDrill()
      setErrMsg(`Não consegui abrir "${nome}" — tente novamente em alguns segundos.`)
      setTimeout(() => setErrMsg(''), 5000)
    }
  }

  const months = ov?.months ?? []
  const monthlySeries = useMemo(() => months.map(m => ({ mes: mLabel(m), valor: ov?.monthlyTotal[m] ?? 0 })), [ov, months])
  const filtered = useMemo(() => {
    if (!ov?.clientes) return []
    const q = search.trim().toUpperCase()
    return ov.clientes.filter(c => (!statusF || c.status === statusF) && (!soPerdidos || c.perdidoYoY) && (!q || c.nome.toUpperCase().includes(q) || c.code.includes(q)))
  }, [ov, search, statusF, soPerdidos])
  const tooltipStyle = { contentStyle: { background: C.navy, border: 'none', borderRadius: 4, fontSize: 12 }, labelStyle: { color: C.yellow, fontWeight: 600 }, itemStyle: { color: '#fff' } }
  const toggle = (arr: number[], v: number, set: (a: number[]) => void) => set(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v].sort((a, b) => a - b))
  const chip = (active: boolean, color = C.navy): React.CSSProperties => ({ border: `1px solid ${active ? color : C.line}`, background: active ? color : '#fff', color: active ? '#fff' : C.textSoft, borderRadius: 20, padding: '4px 12px', fontSize: 12, cursor: 'pointer' })

  return (
    <Shell>
      <div className="page-header">
        <div>
          <div className="page-eyebrow">Módulo · Comercial</div>
          <h1 className="page-title">Demanda por Cliente</h1>
          <p className="page-subtitle">
            O que cada cliente compra, quanto pesa, a <b>margem real de venda</b> e <b>quem está caindo ou deixou de comprar</b>.
            Filtre por vendedor, meses e anos — selecione dois anos para comparar o mesmo período.
          </p>
        </div>
      </div>

      <div className="mb-6" style={{ maxWidth: 620 }}>
        <CommercialUploader title="Relatório COMERCIAL / ABC COMERCIAL (por cliente)" description="XLSX com VENDEDOR · CLIENTE · PRODUTO · DATA · VLR TOTAL. Substitui apenas os meses presentes no arquivo (2025 e 2026 convivem)." endpoint="/api/demanda/import" onDone={load} />
      </div>

      {loading && !ov ? (
        <div className="empty-state"><div className="empty-state-icon">◌</div><div className="empty-state-title">Carregando…</div></div>
      ) : !ov?.hasData ? (
        <div className="card"><div className="empty-state"><div className="empty-state-icon">⌬</div><div className="empty-state-title">Sem dados de demanda</div><div className="empty-state-sub">Envie o relatório COMERCIAL acima.</div></div></div>
      ) : (
        <>
          {/* ── Filtros: vendedor × anos × meses ── */}
          <div className="card mb-6" style={{ padding: '14px 20px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.textMuted, fontWeight: 600 }}>Vendedor</span>
                <select className="form-select" style={{ minWidth: 170 }} value={vendF} onChange={e => setVendF(e.target.value)}>
                  <option value="">Todos</option>
                  {ov.filtros.vendedores.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.textMuted, fontWeight: 600 }}>Anos</span>
                {ov.filtros.anos.map(y => (
                  <button key={y} style={chip(yearsF.length ? yearsF.includes(y) : true, C.navy)} onClick={() => toggle(yearsF, y, setYearsF)}>{y}</button>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.textMuted, fontWeight: 600 }}>Meses</span>
                <button style={chip(monthsF.length === 0, C.gold)} onClick={() => setMonthsF([])}>Todos</button>
                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                  <button key={m} style={chip(monthsF.includes(m), C.gold)} onClick={() => toggle(monthsF, m, setMonthsF)}>{MONTHS[m]}</button>
                ))}
              </div>
              {loading && <span style={{ fontSize: 12, color: C.textMuted }}>◌ atualizando…</span>}
            </div>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 8 }}>
              {ov.hasYoY
                ? <>Comparando <b>{ov.prevYear}</b> × <b>{ov.curYear}</b> nos meses {ov.filtros.months.length ? ov.filtros.months.map(m => MONTHS[m]).join(', ') : `Jan–${MONTHS[ov.cmpUpTo]}`}{vendF ? <> · vendedor <b>{vendF}</b></> : null}.</>
                : <>Período: <b>{ov.filtros.years.join(', ')}</b>{ov.filtros.months.length ? <> · meses {ov.filtros.months.map(m => MONTHS[m]).join(', ')}</> : null}{vendF ? <> · vendedor <b>{vendF}</b></> : null} — selecione dois anos para comparar.</>}
            </div>
          </div>

          <div className="grid-4 mb-6">
            <Kpi label={`Faturamento ${ov.curYear}`} value={fmt(ov.kpis.totalCur)} color={C.navy} />
            {ov.hasYoY ? (
              <Kpi label={`vs ${ov.prevYear} (mesmos meses)`}
                value={ov.kpis.yoyGeral != null ? `${ov.kpis.yoyGeral >= 0 ? '+' : ''}${(ov.kpis.yoyGeral * 100).toFixed(1)}%` : '—'}
                color={(ov.kpis.yoyGeral ?? 0) >= 0 ? C.green : C.red} />
            ) : (
              <Kpi label="Clientes ativos" value={String(ov.kpis.nClientes)} color={C.gold} />
            )}
            <Kpi label={ov.hasYoY ? `Faturamento ${ov.prevYear}` : 'Produtos distintos'} value={ov.hasYoY ? fmt(ov.kpis.totalPrev) : String(ov.kpis.nProdutos)} color={C.blue} />
            <Kpi label={ov.hasYoY ? `Clientes perdidos vs ${ov.prevYear}` : 'Ticket médio / cliente'} value={ov.hasYoY ? String(ov.kpis.perdidosYoY) : fmt(ov.kpis.ticketMedio)} color={ov.hasYoY ? C.red : C.green} />
          </div>

          <div className="grid-2 mb-6">
            <div className="card card-accent-yellow">
              <div className="card-eyebrow">Evolução</div>
              <div className="card-title" style={{ fontSize: 14, marginBottom: 12 }}>Faturamento mensal {vendF ? `· ${vendF}` : '(todos os clientes)'}</div>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={monthlySeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.line} />
                  <XAxis dataKey="mes" tick={{ fontSize: 10, fill: C.textSoft }} stroke={C.line} />
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
                  <button key={s} onClick={() => setStatusF(statusF === s ? '' : s)} style={chip(statusF === s, STATUS_COLOR[s] ?? C.navy)}>{s} · {n}</button>
                ))}
                {ov.hasYoY && (
                  <button onClick={() => setSoPerdidos(p => !p)} style={{ ...chip(soPerdidos, C.red), color: soPerdidos ? '#fff' : C.red, fontWeight: 600 }}>
                    ⚠ Perdido vs {ov.prevYear} · {ov.kpis.perdidosYoY}
                  </button>
                )}
              </div>
              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 10 }}>Clique num status para filtrar. Janela de 2 meses (últimos 2 × 2 anteriores) — o último mês da base pode estar parcial.</div>
            </div>
          </div>

          {/* Toggle Clientes × Vendedores */}
          <div style={{ display: 'inline-flex', border: `1px solid ${C.line}`, borderRadius: 6, overflow: 'hidden', marginBottom: 14 }}>
            <button onClick={() => setView('clientes')} className="btn btn-sm" style={{ border: 'none', borderRadius: 0, background: view === 'clientes' ? C.navy : '#fff', color: view === 'clientes' ? '#fff' : C.textSoft, fontWeight: 600 }}>◉ Clientes</button>
            <button onClick={() => setView('vendedores')} className="btn btn-sm" style={{ border: 'none', borderRadius: 0, background: view === 'vendedores' ? C.navy : '#fff', color: view === 'vendedores' ? '#fff' : C.textSoft, fontWeight: 600 }}>★ Ranking de Vendedores</button>
          </div>

          {view === 'vendedores' && <VendedoresRank ov={ov} />}

          {/* Ranking de clientes */}
          {view === 'clientes' && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div className="card-title" style={{ fontSize: 14 }}>Clientes {statusF && `· ${statusF}`} <span style={{ color: C.textMuted, fontWeight: 400 }}>({filtered.length})</span></div>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar cliente ou código…" style={{ marginLeft: 'auto', padding: '7px 10px', border: `1px solid ${C.line}`, borderRadius: 4, fontSize: 13, minWidth: 240 }} />
            </div>
            <div className="table-wrap" style={{ maxHeight: '62vh' }}>
              <table>
                <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                  <tr><th style={{ textAlign: 'left' }}>Cliente</th><th>ABC</th><th>Status</th><th style={{ textAlign: 'right' }}>{ov.hasYoY ? ov.curYear : 'Faturamento'}</th>{ov.hasYoY && <th style={{ textAlign: 'right' }}>{ov.prevYear}</th>}{ov.hasYoY && <th style={{ textAlign: 'right' }}>Δ a/a</th>}<th style={{ textAlign: 'right' }}>Margem</th><th style={{ textAlign: 'right' }}>Prod.</th><th></th></tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 200).map(c => (
                    <tr key={c.code} style={{ cursor: 'pointer' }} onClick={() => openCliente(c.code, c.nome)}>
                      <td style={{ fontSize: 13, fontWeight: 600, color: C.navy }}>{c.nome}<div style={{ fontSize: 10, color: C.textMuted }}>{c.code}{c.vendedor ? ` · ${c.vendedor}` : ''}</div></td>
                      <td style={{ textAlign: 'center' }}><span style={{ background: ABC_COLOR[c.abc], color: '#fff', borderRadius: 3, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>{c.abc}</span></td>
                      <td style={{ textAlign: 'center', fontSize: 11, color: STATUS_COLOR[c.status] ?? C.textSoft, fontWeight: 600, whiteSpace: 'nowrap' }}>{c.status}</td>
                      <td style={{ textAlign: 'right', fontSize: 13, fontWeight: 600 }}>{fmt(ov.hasYoY ? c.tCur : c.total)}</td>
                      {ov.hasYoY && <td style={{ textAlign: 'right', fontSize: 12, color: C.textMuted }}>{fmtK(c.tPrev)}</td>}
                      {ov.hasYoY && (
                        <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', color: c.perdidoYoY ? C.red : c.yoy == null ? C.textMuted : c.yoy >= 0 ? C.green : C.amber }}>
                          {c.perdidoYoY ? '⚠ perdido' : c.yoy == null ? 'novo' : `${c.yoy >= 0 ? '+' : ''}${(c.yoy * 100).toFixed(0)}%`}
                        </td>
                      )}
                      <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color: mgColor(c.margem) }}>{mgFmt(c.margem)}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, color: C.textMuted }}>{c.nProd}</td>
                      <td style={{ textAlign: 'center', color: C.gold }}>›</td>
                    </tr>
                  ))}
                  {filtered.length > 200 && <tr><td colSpan={ov.hasYoY ? 10 : 8} style={{ textAlign: 'center', padding: 12, fontSize: 11, color: C.textMuted }}>Mostrando 200 de {filtered.length}. Use a busca para refinar.</td></tr>}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '8px 20px', fontSize: 11, color: C.textMuted, borderTop: `1px solid ${C.line}` }}>
              <b>Margem</b> = margem de venda real: (valor vendido − qtd × custo de reposição do ABC de Estoque) ÷ valor vendido, nos itens com custo conhecido.
            </div>
          </div>
          )}

          {sel && !detail && (
            <BodyPortal>
              <div onClick={fecharDrill} style={{ position: 'fixed', inset: 0, background: 'rgba(10,37,64,0.45)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 6, padding: '24px 34px', textAlign: 'center', maxWidth: 420 }}>
                  <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.textMuted, fontWeight: 600, marginBottom: 6 }}>Abrindo cliente</div>
                  <div style={{ fontFamily: 'var(--font-serif), serif', fontSize: 18, color: C.navy, marginBottom: 14 }}>◌ {selNome || sel}</div>
                  <button className="btn btn-sm" onClick={fecharDrill}>← Voltar</button>
                </div>
              </div>
            </BodyPortal>
          )}
          {sel && detail && <BodyPortal><ClienteDetail detail={detail} nomeFallback={selNome} onClose={fecharDrill} /></BodyPortal>}
          {errMsg && (
            <BodyPortal>
              <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: C.red, color: '#fff', padding: '10px 22px', borderRadius: 6, fontSize: 13, zIndex: 210, boxShadow: '0 4px 16px rgba(0,0,0,0.25)' }}>{errMsg}</div>
            </BodyPortal>
          )}
        </>
      )}
    </Shell>
  )
}

function VendedoresRank({ ov }: { ov: Overview }) {
  const vs = ov.vendedoresRank ?? []
  const maxCur = Math.max(1, ...vs.map(v => ov.hasYoY ? v.tCur : v.total))
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.line}` }}>
        <div className="card-eyebrow">Avaliação comercial</div>
        <div className="card-title" style={{ fontSize: 14 }}>Ranking de Vendedores <span style={{ color: C.textMuted, fontWeight: 400 }}>({vs.length}) — respeita os filtros acima</span></div>
      </div>
      <div className="table-wrap" style={{ maxHeight: '62vh' }}>
        <table>
          <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
            <tr>
              <th style={{ textAlign: 'left' }}>#</th>
              <th style={{ textAlign: 'left' }}>Vendedor</th>
              <th style={{ textAlign: 'right' }}>{ov.hasYoY ? `Faturamento ${ov.curYear}` : 'Faturamento'}</th>
              {ov.hasYoY && <th style={{ textAlign: 'right' }}>{ov.prevYear}</th>}
              {ov.hasYoY && <th style={{ textAlign: 'right' }}>Δ a/a</th>}
              <th style={{ textAlign: 'right' }}>Margem real</th>
              <th style={{ textAlign: 'right' }}>Clientes ativos</th>
              {ov.hasYoY && <th style={{ textAlign: 'right' }}>Perdidos</th>}
              {ov.hasYoY && <th style={{ textAlign: 'right' }}>Novos</th>}
            </tr>
          </thead>
          <tbody>
            {vs.map((v, i) => {
              const val = ov.hasYoY ? v.tCur : v.total
              return (
                <tr key={v.nome}>
                  <td style={{ fontSize: 12, color: C.textMuted }}>{i + 1}º</td>
                  <td style={{ fontSize: 13, fontWeight: 600, color: C.navy, whiteSpace: 'nowrap' }}>
                    {v.nome}
                    <div style={{ background: '#eef2f8', borderRadius: 2, height: 4, marginTop: 4, width: 160 }}>
                      <div style={{ width: `${Math.min(100, val / maxCur * 100)}%`, height: 4, background: C.gold, borderRadius: 2 }} />
                    </div>
                  </td>
                  <td style={{ textAlign: 'right', fontSize: 13, fontWeight: 700 }}>{fmt(val)}</td>
                  {ov.hasYoY && <td style={{ textAlign: 'right', fontSize: 12, color: C.textMuted }}>{fmtK(v.tPrev)}</td>}
                  {ov.hasYoY && (
                    <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, color: v.yoy == null ? C.textMuted : v.yoy >= 0 ? C.green : C.amber }}>
                      {v.yoy == null ? '—' : `${v.yoy >= 0 ? '+' : ''}${(v.yoy * 100).toFixed(0)}%`}
                    </td>
                  )}
                  <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color: mgColor(v.margem) }}>{mgFmt(v.margem)}</td>
                  <td style={{ textAlign: 'right', fontSize: 12 }}>{v.clientesAtivos}</td>
                  {ov.hasYoY && <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color: v.clientesPerdidos > 0 ? C.red : C.textMuted }}>{v.clientesPerdidos}</td>}
                  {ov.hasYoY && <td style={{ textAlign: 'right', fontSize: 12, color: v.clientesNovos > 0 ? C.green : C.textMuted }}>{v.clientesNovos}</td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div style={{ padding: '8px 20px', fontSize: 11, color: C.textMuted, borderTop: `1px solid ${C.line}` }}>
        <b>Perdidos</b> = clientes do vendedor que compravam em {ov.prevYear ?? 'ano anterior'} e não compraram em {ov.curYear}; <b>Novos</b> = o inverso. <b>Margem real</b> = sobre o preço efetivamente praticado × custo de reposição.
      </div>
    </div>
  )
}

function ClienteDetail({ detail, nomeFallback, onClose }: { detail: Detail; nomeFallback?: string; onClose: () => void }) {
  const [mode, setMode] = useState<'janela' | 'max' | 'min'>('janela')
  const months = detail.months ?? []
  const produtos = detail.produtos ?? []
  const nome = detail.nome || nomeFallback || `Cliente ${detail.cliente}`
  const monthly = useMemo(() => months.map(m => ({ mes: mLabel(m), valor: detail.monthly?.[m] ?? 0 })), [detail, months])
  const tooltipStyle = { contentStyle: { background: C.navy, border: 'none', borderRadius: 4, fontSize: 12 }, labelStyle: { color: C.yellow, fontWeight: 600 }, itemStyle: { color: '#fff' } }
  const thSticky: React.CSSProperties = { position: 'sticky', top: 0, zIndex: 3, background: C.navy, color: '#fff' }
  // ESC fecha e volta pro Arken
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  // ── Minimizada: barrinha no canto, Arken totalmente utilizável atrás ──
  if (mode === 'min') {
    return (
      <div style={{ position: 'fixed', bottom: 18, right: 18, zIndex: 201, background: C.navy, color: '#fff', borderRadius: 8, boxShadow: '0 8px 28px rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, padding: '0 14px', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>◉ {nome}</span>
        <button className="win-btn" title="Restaurar" onClick={() => setMode('janela')}>❐</button>
        <button className="win-btn close" title="Fechar" onClick={onClose}>✕</button>
      </div>
    )
  }

  const winStyle: React.CSSProperties = mode === 'max'
    ? { position: 'fixed', inset: 0, borderRadius: 0 }
    : { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 'min(1240px, 94vw)', height: 'min(88vh, 920px)', borderRadius: 10 }

  return (
    <>
      {/* fundo escurecido — o Arken continua visível atrás; clicar fora fecha.
          z-index acima da topbar (100) para a barra de título nunca ficar encoberta. */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(10,37,64,0.5)', zIndex: 200 }} />
      <div style={{ ...winStyle, zIndex: 201, background: '#f4f6fa', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 16px 56px rgba(0,0,0,0.45)' }}>

        {/* barra de título estilo navegador: nome à esquerda, — □ ✕ à direita */}
        <div style={{ background: C.navy, color: '#fff', display: 'flex', alignItems: 'center', height: 46, flexShrink: 0, paddingLeft: 18 }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 10, overflow: 'hidden' }}>
            <span style={{ fontFamily: 'var(--font-serif), serif', fontSize: 17, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>◉ {nome}</span>
            <span style={{ fontSize: 11, color: '#9fb0c6', whiteSpace: 'nowrap' }}>cliente {detail.cliente}{detail.vendedor ? ` · vendedor ${detail.vendedor}` : ''}</span>
          </div>
          <div style={{ display: 'flex', flexShrink: 0 }}>
            <button className="win-btn" title="Minimizar" onClick={() => setMode('min')}>—</button>
            <button className="win-btn" title={mode === 'max' ? 'Restaurar janela' : 'Expandir (tela cheia)'} onClick={() => setMode(mode === 'max' ? 'janela' : 'max')}>{mode === 'max' ? '❐' : '□'}</button>
            <button className="win-btn close" title="Fechar (Esc)" onClick={onClose}>✕</button>
          </div>
        </div>

        {/* faixa de indicadores */}
        <div style={{ background: C.navyMid, color: '#fff', padding: '8px 18px', display: 'flex', gap: 28, flexWrap: 'wrap', flexShrink: 0 }}>
          <div><span style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.7 }}>Total no período </span><b style={{ color: C.yellow, fontSize: 14 }}>{fmt(detail.total ?? 0)}</b></div>
          <div><span style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.7 }}>Produtos </span><b style={{ fontSize: 14 }}>{produtos.length}</b></div>
          <div><span style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.7 }}>Margem média real </span><b style={{ fontSize: 14, color: detail.margemMedia == null ? '#fff' : detail.margemMedia >= 0.2 ? '#7ce3a8' : detail.margemMedia >= 0.1 ? C.yellow : '#ff9c8f' }}>{mgFmt(detail.margemMedia)}</b></div>
        </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '18px 22px' }}>
        <div className="card mb-6">
          <div className="card-eyebrow">Tendência</div>
          <div className="card-title" style={{ fontSize: 13, marginBottom: 8 }}>Compras mês a mês</div>
          <ResponsiveContainer width="100%" height={200}>
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

        <div className="grid-2 mb-6">
          {(detail.droppedYoY?.length ?? 0) > 0 && (
            <div className="card" style={{ borderLeft: `3px solid ${C.red}` }}>
              <div className="card-eyebrow" style={{ color: C.red }}>Alerta ano a ano</div>
              <div className="card-title" style={{ fontSize: 13, marginBottom: 8 }}>Comprava em {detail.prevYear} — nada em {detail.curYear} · {detail.droppedYoY.length} itens</div>
              <div style={{ maxHeight: 190, overflow: 'auto' }}>
                {detail.droppedYoY.slice(0, 40).map((d, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: `1px solid ${C.line}` }}>
                    <span style={{ color: C.navy }}>{d.nome}</span>
                    <span style={{ color: C.textMuted, whiteSpace: 'nowrap', marginLeft: 8 }}>{fmtK(d.totalPrev)} em {detail.prevYear}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {(detail.dropped?.length ?? 0) > 0 && (
            <div className="card" style={{ borderLeft: `3px solid ${C.amber}` }}>
              <div className="card-eyebrow" style={{ color: C.amber }}>Alerta recente</div>
              <div className="card-title" style={{ fontSize: 13, marginBottom: 8 }}>Sem compra nos últimos 2 meses — {detail.dropped.length} itens</div>
              <div style={{ maxHeight: 190, overflow: 'auto' }}>
                {detail.dropped.slice(0, 40).map((d, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: `1px solid ${C.line}` }}>
                    <span style={{ color: C.navy }}>{d.nome}</span>
                    <span style={{ color: C.textMuted, whiteSpace: 'nowrap', marginLeft: 8 }}>{fmtK(d.total)} · últ. {d.ultimoMes ? mLabel(d.ultimoMes) : '—'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 18px', borderBottom: `1px solid ${C.line}` }}><div className="card-title" style={{ fontSize: 13 }}>Produtos comprados — colunas mensais</div></div>
          <div className="table-wrap sticky-first" style={{ maxHeight: '48vh', minHeight: 240 }}>
            <table style={{ minWidth: '100%' }}>
              {/* cabeçalho FIXO ao rolar na vertical (pedido da reunião) */}
              <thead>
                <tr>
                  <th style={{ ...thSticky, textAlign: 'left', zIndex: 4 }}>Produto</th>
                  <th style={{ ...thSticky, textAlign: 'right' }}>Margem</th>
                  {months.map(m => <th key={m} style={{ ...thSticky, textAlign: 'right', whiteSpace: 'nowrap' }}>{mLabel(m)}</th>)}
                  <th style={{ ...thSticky, textAlign: 'right', background: C.navyMid }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {produtos.map((p, i) => (
                  <tr key={i}>
                    <td style={{ fontSize: 12, color: C.navy, background: '#fff' }}>{p.nome}</td>
                    <td style={{ textAlign: 'right', fontSize: 11, fontWeight: 700, color: mgColor(p.margem) }}>{mgFmt(p.margem)}</td>
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
    </>
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
