'use client'
import { useEffect, useMemo, useState } from 'react'
import Shell from '@/components/Shell'
import { CommercialUploader } from '@/components/CommercialUploader'
import {
  ComposedChart, Bar, Line, BarChart, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Cell,
} from 'recharts'

type Tab = 'dashboard' | 'pedidos' | 'reposicao' | 'config'
interface Comprador { id: number; nome: string; limite: number; setor: string | null; ativo: boolean }
interface FornecedorReg { id: number; nome: string; ativo: boolean }
interface Pedido { id: number; comprador: string; fornecedor: string | null; tipo: string | null; categoria: string | null; dataPedido: string; valor: number; parcelas: number; datas?: string[] | null; primeiraDias: number; intervaloDias: number; status: string }
interface Config { compradores: Comprador[]; categorias: string[]; fornecedores: FornecedorReg[]; settings: Record<string, number>; receitaRef: { ym: string | null; value: number } }
interface Analytics {
  refLabel: string; receitaRef: { ym: string | null; value: number; exato?: boolean; modo?: string }; metaCmvPct: number; limiteCmvMensal: number
  limiteTotal: number; compradoTotalMes: number; saldoTotal: number; cmvAtualPct: number
  resumoCompradores: { nome: string; setor: string | null; limite: number; comprado: number; saldo: number; util: number; status: string }[]
  categorias: string[]; months: string[]; projecao: Record<string, number | string>[]; porCategoria: { categoria: string; total: number }[]; comprometidoTotal: number; nPedidos: number
  boletos?: { count: number; total: number; imobilizadoExcluido: number; importadoEm?: string | null }
}

const C = { navy: '#0a2540', navyMid: '#142c4e', yellow: '#f5c518', gold: '#d4a017', line: '#e3e7ed', textSoft: '#4a5670', textMuted: '#7a869a', green: '#197a4a', red: '#b03022', amber: '#c98a14' }
const CAT_COLORS = ['#0a2540', '#f5c518', '#197a4a', '#b03022', '#2f5a96', '#d4a017', '#7a869a', '#5b8c5a', '#8a5a2b', '#6a5acd', '#b5651d', '#2e8b8b']
const fmt = (n: number) => (n < 0 ? '−' : '') + 'R$ ' + Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtK = (n: number) => { const a = Math.abs(n); return (n < 0 ? '−' : '') + (a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(0)}k` : a.toFixed(0)) }
const pct = (n: number) => `${(n * 100).toFixed(1)}%`

export default function ControleCompras() {
  const [tab, setTab] = useState<Tab>('dashboard')
  const [cfg, setCfg] = useState<Config | null>(null)
  const [an, setAn] = useState<Analytics | null>(null)
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3000) }

  const load = async () => {
    setLoading(true)
    const [c, a, p] = await Promise.all([
      fetch('/api/compras/config').then(r => r.json()),
      fetch('/api/compras/analytics').then(r => r.json()),
      fetch('/api/compras/pedidos').then(r => r.json()),
    ])
    setCfg(c); setAn(a); setPedidos(p.pedidos ?? []); setLoading(false)
  }
  useEffect(() => { load() }, [])

  return (
    <Shell>
      <div className="page-header">
        <div>
          <div className="page-eyebrow">Módulo · Suprimentos</div>
          <h1 className="page-title">Controle de Compras</h1>
          <p className="page-subtitle">
            Lance os pedidos com prazo e parcelas. A ferramenta mostra o limite por comprador e a
            <b> projeção de pagamentos comprometidos</b> mês a mês — quanto do caixa de compras já está tomado à frente.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {([['dashboard', 'Dashboard'], ['pedidos', 'Pedidos'], ['reposicao', 'Reposição por Giro'], ['config', 'Config']] as [Tab, string][]).map(([k, l]) => (
            <button key={k} className={tab === k ? 'btn btn-primary' : 'btn'} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
      </div>

      {loading || !an || !cfg ? (
        <div className="empty-state"><div className="empty-state-icon">◌</div><div className="empty-state-title">Carregando…</div></div>
      ) : (
        <>
          {tab === 'dashboard' && <Dashboard an={an} onReload={load} />}
          {tab === 'pedidos' && <Pedidos cfg={cfg} pedidos={pedidos} onChange={load} showToast={showToast} />}
          {tab === 'reposicao' && <ReposicaoPanel an={an} />}
          {tab === 'config' && <ConfigPanel cfg={cfg} an={an} onChange={load} showToast={showToast} />}
        </>
      )}
      {toast && <div className="toast">{toast}</div>}
    </Shell>
  )
}

// ─────────────────────────── DASHBOARD ───────────────────────────
function Dashboard({ an, onReload }: { an: Analytics; onReload: () => void }) {
  const tooltipStyle = { contentStyle: { background: C.navy, border: 'none', borderRadius: 4, fontSize: 12 }, labelStyle: { color: C.yellow, fontWeight: 600 }, itemStyle: { color: '#fff' } }
  const catColor = (i: number) => CAT_COLORS[i % CAT_COLORS.length]
  const refBaseLabel = an.receitaRef.modo === '3m'
    ? `média 3 meses (${an.receitaRef.ym})`
    : `Rec. Líq. ${an.receitaRef.ym ? an.receitaRef.ym.split('-').reverse().join('/') : '—'}${an.receitaRef.exato === false ? ' (últ. disp.)' : ''}`
  const boletosIdade = an.boletos?.importadoEm
    ? Math.floor((Date.now() - new Date(an.boletos.importadoEm).getTime()) / 86400000)
    : null
  return (
    <>
      <div className="grid-5 mb-6">
        <Kpi label="Limite total (compradores)" value={fmt(an.limiteTotal)} color={C.navy} />
        <Kpi label={`Comprado em ${an.refLabel}`} value={fmt(an.compradoTotalMes)} color={C.gold} />
        <Kpi label="Saldo disponível" value={fmt(an.saldoTotal)} color={an.saldoTotal >= 0 ? C.green : C.red} />
        <Kpi label="CMV atual (% rec. líq.)" value={pct(an.cmvAtualPct)} sub={`meta ${pct(an.metaCmvPct)}`} color={an.cmvAtualPct <= an.metaCmvPct ? C.green : C.red} />
        <Kpi label={`Limite de compras · ${an.refLabel}`} value={fmt(an.limiteCmvMensal)}
          sub={an.receitaRef.value ? `${pct(an.metaCmvPct)} × ${refBaseLabel}` : 'sem receita na DRE'}
          color={C.navyMid} />
      </div>

      <div className="mb-6" style={{ maxWidth: 620 }}>
        <CommercialUploader
          title="Pagamentos a Efetuar (ERP)"
          description={`Boletos já lançados — viram o comprometido real por mês. Substitui a base de boletos.${an.boletos?.count ? ` Hoje: ${an.boletos.count} boletos · ${fmtK(an.boletos.total)}.` : ''}`}
          endpoint="/api/compras/import-pagamentos"
          onDone={onReload}
        />
        {boletosIdade != null && (
          <div style={{ marginTop: 6, fontSize: 11.5, color: boletosIdade > 7 ? C.amber : C.textMuted, fontWeight: boletosIdade > 7 ? 600 : 400 }}>
            {boletosIdade > 7 ? '⚠ ' : ''}Base de boletos importada há {boletosIdade} dia{boletosIdade === 1 ? '' : 's'}
            {boletosIdade > 7 ? ' — pedidos novos lançados no ERP desde então não aparecem no comprometido. Reimporte o relatório.' : '.'}
          </div>
        )}
      </div>

      {/* PROJEÇÃO — o gráfico central */}
      <div className="card card-accent-yellow mb-6">
        <div className="card-header">
          <div>
            <div className="card-eyebrow">Projeção de pagamentos de compras</div>
            <div className="card-title">Comprometido por mês (boletos ERP + pedidos) × limite de compras</div>
          </div>
        </div>
        <p style={{ fontSize: 12, color: C.textMuted, marginBottom: 12, lineHeight: 1.6 }}>
          Cada barra soma os <b>boletos do ERP</b> e as parcelas dos <b>pedidos lançados aqui</b> que vencem no mês.
          A linha tracejada é o limite de cada mês ({pct(an.metaCmvPct)} × receita líquida do mês anterior).
          Barra acima da linha = mês já comprometido além do saudável. Compras de imobilizado (veículo/equipamento) ficam fora{an.boletos?.imobilizadoExcluido ? ` (${fmtK(an.boletos.imobilizadoExcluido)} excluídos)` : ''}.
        </p>
        <ResponsiveContainer width="100%" height={360}>
          <ComposedChart data={an.projecao} margin={{ top: 8, right: 20, left: 8, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.line} />
            <XAxis dataKey="mes" tick={{ fontSize: 11, fill: C.textSoft }} stroke={C.line} />
            <YAxis tick={{ fontSize: 10, fill: C.textSoft }} stroke={C.line} tickFormatter={fmtK} />
            <Tooltip {...tooltipStyle} formatter={(v: number, n: string) => [fmt(v), n]} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {an.categorias.map((cat, i) => (
              <Bar key={cat} dataKey={cat} stackId="a" fill={catColor(i)} radius={i === an.categorias.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
            ))}
            <Line type="stepAfter" dataKey="limite" name="Limite de compras (mês)" stroke={C.red} strokeWidth={2} strokeDasharray="6 4" dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
        <p style={{ fontSize: 11, color: C.textMuted, marginTop: 8 }}>
          💡 Ao reimportar os boletos do ERP, remova daqui os pedidos manuais que já viraram boleto — senão contam em dobro.
        </p>
      </div>

      <div className="grid-2 mb-6">
        {/* Resumo por comprador */}
        <div className="card">
          <div className="card-eyebrow">Limite por comprador</div>
          <div className="card-title" style={{ fontSize: 14, marginBottom: 12 }}>Comprado × limite em {an.refLabel}</div>
          <div className="table-wrap">
            <table>
              <thead><tr><th style={{ textAlign: 'left' }}>Comprador</th><th style={{ textAlign: 'right' }}>Limite</th><th style={{ textAlign: 'right' }}>Comprado</th><th style={{ minWidth: 120 }}>Utilização</th><th>Status</th></tr></thead>
              <tbody>
                {an.resumoCompradores.map(c => (
                  <tr key={c.nome}>
                    <td style={{ fontWeight: 600, color: C.navy }}>{c.nome}<div style={{ fontSize: 10, color: C.textMuted }}>{c.setor}</div></td>
                    <td style={{ textAlign: 'right', fontSize: 12 }}>{fmtK(c.limite)}</td>
                    <td style={{ textAlign: 'right', fontSize: 12 }}>{fmtK(c.comprado)}</td>
                    <td>
                      <div style={{ background: '#eef2f8', borderRadius: 3, height: 16, position: 'relative', overflow: 'hidden' }}>
                        <div style={{ position: 'absolute', inset: 0, width: `${Math.min(100, c.util * 100)}%`, background: c.util > 1 ? C.red : c.util > 0.9 ? C.amber : C.green }} />
                        <span style={{ position: 'relative', fontSize: 10, color: C.navy, fontWeight: 600, paddingLeft: 6, lineHeight: '16px' }}>{pct(c.util)}</span>
                      </div>
                    </td>
                    <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{c.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Comprometido por categoria */}
        <div className="card">
          <div className="card-eyebrow">Comprometido à frente</div>
          <div className="card-title" style={{ fontSize: 14, marginBottom: 12 }}>Total por categoria (horizonte) — {fmt(an.comprometidoTotal)}</div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={an.porCategoria} layout="vertical" margin={{ left: 20, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.line} />
              <XAxis type="number" tick={{ fontSize: 10, fill: C.textSoft }} stroke={C.line} tickFormatter={fmtK} />
              <YAxis type="category" dataKey="categoria" tick={{ fontSize: 10, fill: C.textSoft }} stroke={C.line} width={130} />
              <Tooltip {...tooltipStyle} formatter={(v: number) => fmt(v)} />
              <Bar dataKey="total" radius={[0, 3, 3, 0]}>{an.porCategoria.map((_, i) => <Cell key={i} fill={CAT_COLORS[i % CAT_COLORS.length]} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </>
  )
}

// ─────────────────────────── PEDIDOS ───────────────────────────
const addDays = (iso: string, days: number) => {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
const fmtDia = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y.slice(2)}` }

function Pedidos({ cfg, pedidos, onChange, showToast }: { cfg: Config; pedidos: Pedido[]; onChange: () => void; showToast: (m: string) => void }) {
  const hoje = new Date().toISOString().slice(0, 10)
  const fornecedoresAtivos = cfg.fornecedores.filter(x => x.ativo)
  const [f, setF] = useState({ fornecedor: '', valor: '', comprador: cfg.compradores[0]?.nome ?? '', dataPedido: hoje, parcelado: 'nao', nParcelas: '2' })
  const [datas, setDatas] = useState<string[]>([addDays(hoje, 30)])
  const [busy, setBusy] = useState(false)
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }))

  // regenera as datas-sugestão (30/60/90…) quando muda o nº de parcelas ou o modo
  const regen = (n: number, base: string) => setDatas(Array.from({ length: n }, (_, k) => addDays(base, 30 * (k + 1))))
  const onParcelado = (v: string) => { set('parcelado', v); regen(v === 'sim' ? Math.max(2, +f.nParcelas || 2) : 1, f.dataPedido) }
  const onNParcelas = (v: string) => { set('nParcelas', v); const n = Math.max(2, Math.min(24, Math.round(+v) || 2)); regen(n, f.dataPedido) }
  const setData = (i: number, v: string) => setDatas(ds => ds.map((d, k) => k === i ? v : d))

  const valorNum = +f.valor || 0
  const add = async () => {
    if (!f.fornecedor) { showToast('Selecione o fornecedor (cadastre em Config se faltar)'); return }
    if (!valorNum) { showToast('Informe o valor do pedido'); return }
    if (datas.some(d => !d)) { showToast('Preencha todas as datas de pagamento'); return }
    setBusy(true)
    const r = await fetch('/api/compras/pedidos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fornecedor: f.fornecedor, comprador: f.comprador, dataPedido: f.dataPedido, valor: valorNum, datas }) })
    setBusy(false)
    if (!r.ok) { showToast('Erro ao salvar'); return }
    setF(p => ({ ...p, valor: '' })); showToast('✓ Pedido lançado'); onChange()
  }
  const del = async (id: number) => { if (!confirm('Remover este pedido?')) return; await fetch('/api/compras/pedidos/' + id, { method: 'DELETE' }); showToast('Removido'); onChange() }

  const inp: React.CSSProperties = { padding: '7px 9px', border: `1px solid ${C.line}`, borderRadius: 4, fontSize: 13, width: '100%' }
  return (
    <>
      <div className="card mb-6">
        <div className="card-eyebrow">Novo pedido</div>
        <div className="card-title" style={{ fontSize: 14, marginBottom: 14 }}>Lançar pedido de compra</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Field label="Fornecedor">
            <select className="form-select" value={f.fornecedor} onChange={e => set('fornecedor', e.target.value)}>
              <option value="">— Selecione —</option>
              {fornecedoresAtivos.map(x => <option key={x.id} value={x.nome}>{x.nome}</option>)}
            </select>
          </Field>
          <Field label="Valor do pedido (R$)"><input style={inp} type="number" value={f.valor} onChange={e => set('valor', e.target.value)} placeholder="0,00" /></Field>
          <Field label="Comprador"><select className="form-select" value={f.comprador} onChange={e => set('comprador', e.target.value)}>{cfg.compradores.map(c => <option key={c.id} value={c.nome}>{c.nome}</option>)}</select></Field>
          <Field label="Data do pedido"><input style={inp} type="date" value={f.dataPedido} onChange={e => { set('dataPedido', e.target.value); if (e.target.value) regen(datas.length, e.target.value) }} /></Field>
          <Field label="Pagamento parcelado?">
            <select className="form-select" value={f.parcelado} onChange={e => onParcelado(e.target.value)}>
              <option value="nao">Não — à vista / pagamento único</option>
              <option value="sim">Sim — parcelado</option>
            </select>
          </Field>
          {f.parcelado === 'sim' && (
            <Field label="Nº de parcelas"><input style={inp} type="number" min={2} max={24} value={f.nParcelas} onChange={e => onNParcelas(e.target.value)} /></Field>
          )}
          <div style={{ gridColumn: f.parcelado === 'sim' ? 'span 2' : 'span 2', display: 'flex', alignItems: 'flex-end' }}>
            <button className="btn btn-primary" disabled={busy} onClick={add} style={{ width: '100%' }}>{busy ? '…' : '+ Lançar pedido'}</button>
          </div>
        </div>

        {/* Datas de pagamento */}
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px dashed ${C.line}` }}>
          <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.textMuted, fontWeight: 600, marginBottom: 8 }}>
            {f.parcelado === 'sim' ? `Datas das ${datas.length} parcelas${valorNum ? ` (${fmtK(valorNum / datas.length)} cada)` : ''}` : 'Data do pagamento'}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {datas.map((d, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {f.parcelado === 'sim' && <span style={{ fontSize: 11, color: C.textMuted, fontWeight: 600 }}>{i + 1}ª</span>}
                <input style={{ ...inp, width: 150 }} type="date" value={d} onChange={e => setData(i, e.target.value)} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.line}` }}><div className="card-title" style={{ fontSize: 14 }}>{pedidos.length} pedidos lançados</div></div>
        <div className="table-wrap" style={{ maxHeight: '60vh' }}>
          <table>
            <thead style={{ position: 'sticky', top: 0 }}><tr><th style={{ textAlign: 'left' }}>Data</th><th style={{ textAlign: 'left' }}>Comprador</th><th style={{ textAlign: 'left' }}>Fornecedor</th><th style={{ textAlign: 'right' }}>Valor</th><th style={{ textAlign: 'left' }}>Pagamentos</th><th></th></tr></thead>
            <tbody>
              {pedidos.map(p => (
                <tr key={p.id}>
                  <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{new Date(p.dataPedido).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</td>
                  <td style={{ fontSize: 12, fontWeight: 600, color: C.navy }}>{p.comprador}</td>
                  <td style={{ fontSize: 12 }}>{p.fornecedor || '—'}</td>
                  <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>{fmt(p.valor)}</td>
                  <td style={{ fontSize: 11, color: C.textSoft }}>
                    {Array.isArray(p.datas) && p.datas.length
                      ? `${p.datas.length}× · ` + p.datas.map(fmtDia).join(' · ')
                      : `${p.parcelas}× (${p.primeiraDias}/${p.intervaloDias}d)`}
                  </td>
                  <td style={{ textAlign: 'center' }}><button className="btn btn-sm btn-danger" onClick={() => del(p.id)}>×</button></td>
                </tr>
              ))}
              {!pedidos.length && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32, color: C.textMuted }}>Nenhum pedido lançado ainda.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// ─────────────────────────── CONFIG ───────────────────────────
function ConfigPanel({ cfg, an, onChange, showToast }: { cfg: Config; an: Analytics; onChange: () => void; showToast: (m: string) => void }) {
  const [novoForn, setNovoForn] = useState('')
  const [buscaForn, setBuscaForn] = useState('')
  const [novoComp, setNovoComp] = useState({ nome: '', limite: '', setor: '' })
  const post = async (body: unknown) => { const r = await fetch('/api/compras/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) showToast('Erro'); else onChange() }
  const inp: React.CSSProperties = { padding: '6px 9px', border: `1px solid ${C.line}`, borderRadius: 4, fontSize: 13 }

  return (
    <div className="grid-2">
      <div className="card">
        <div className="card-eyebrow">Compradores</div>
        <div className="card-title" style={{ fontSize: 14, marginBottom: 12 }}>Limite mensal por comprador</div>
        {cfg.compradores.filter(c => c.ativo).every(c => !c.limite) && an.limiteCmvMensal > 0 && (
          <div style={{ fontSize: 12, color: C.amber, fontWeight: 600, marginBottom: 10, lineHeight: 1.5 }}>
            ⚠ Nenhum comprador tem limite definido — o quadro &quot;Comprado × limite&quot; do Dashboard fica sem status.
            O limite de compras de {an.refLabel} é <b>{fmt(an.limiteCmvMensal)}</b>: distribua esse valor entre os compradores ativos.
          </div>
        )}
        <div className="table-wrap">
          <table>
            <thead><tr><th style={{ textAlign: 'left' }}>Nome</th><th style={{ textAlign: 'left' }}>Setor</th><th style={{ textAlign: 'right' }}>Limite (R$)</th><th>Ativo</th><th></th></tr></thead>
            <tbody>
              {cfg.compradores.map(c => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600, color: C.navy }}>{c.nome}</td>
                  <td style={{ fontSize: 12, color: C.textMuted }}>{c.setor || '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <input style={{ ...inp, width: 110, textAlign: 'right' }} type="number" defaultValue={c.limite}
                      onBlur={e => { const v = +e.target.value; if (v !== c.limite) post({ kind: 'comprador', op: 'upsert', data: { ...c, limite: v } }) }} />
                  </td>
                  <td style={{ textAlign: 'center' }}><input type="checkbox" defaultChecked={c.ativo} onChange={e => post({ kind: 'comprador', op: 'upsert', data: { ...c, ativo: e.target.checked } })} /></td>
                  <td style={{ textAlign: 'center' }}><button className="btn btn-sm btn-danger" onClick={() => post({ kind: 'comprador', op: 'delete', data: { id: c.id } })}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <input style={{ ...inp, flex: 1, minWidth: 100 }} placeholder="Nome" value={novoComp.nome} onChange={e => setNovoComp(p => ({ ...p, nome: e.target.value }))} />
          <input style={{ ...inp, width: 100 }} placeholder="Setor" value={novoComp.setor} onChange={e => setNovoComp(p => ({ ...p, setor: e.target.value }))} />
          <input style={{ ...inp, width: 110 }} type="number" placeholder="Limite" value={novoComp.limite} onChange={e => setNovoComp(p => ({ ...p, limite: e.target.value }))} />
          <button className="btn btn-primary btn-sm" onClick={() => { if (novoComp.nome) { post({ kind: 'comprador', op: 'upsert', data: { nome: novoComp.nome, setor: novoComp.setor, limite: +novoComp.limite || 0, ativo: true } }); setNovoComp({ nome: '', limite: '', setor: '' }) } }}>+ Adicionar</button>
        </div>
      </div>

      <div>
        <div className="card mb-6">
          <div className="card-eyebrow">Parâmetro</div>
          <div className="card-title" style={{ fontSize: 14, marginBottom: 12 }}>Meta de CMV / limite de compras</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input style={{ ...inp, width: 90 }} type="number" step={1} defaultValue={Math.round((an.metaCmvPct) * 100)}
              onBlur={e => { const v = (+e.target.value) / 100; if (v !== an.metaCmvPct) post({ kind: 'setting', data: { key: 'metaCmvPct', value: v } }) }} />
            <span style={{ color: C.textSoft, fontSize: 13 }}>% da receita = teto de compras por mês</span>
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: C.textMuted, lineHeight: 1.6 }}>
            Receita <b>líquida</b> de referência (mês anterior{an.receitaRef.ym ? ` · ${an.receitaRef.ym}` : ''}{an.receitaRef.exato === false ? ' — último disponível na DRE' : ''}): <b>{fmt(an.receitaRef.value)}</b><br />
            Limite de compras do mês atual: <b style={{ color: C.navy }}>{fmt(an.limiteCmvMensal)}</b>
          </div>
        </div>
        <div className="card">
          <div className="card-eyebrow">Fornecedores</div>
          <div className="card-title" style={{ fontSize: 14, marginBottom: 12 }}>Pré-cadastro usado no lançamento de pedidos ({cfg.fornecedores.length})</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input style={{ ...inp, flex: 1 }} placeholder="Novo fornecedor" value={novoForn} onChange={e => setNovoForn(e.target.value)} />
            <button className="btn btn-primary btn-sm" onClick={() => { if (novoForn.trim()) { post({ kind: 'fornecedor', op: 'upsert', data: { nome: novoForn.trim() } }); setNovoForn('') } }}>+ Adicionar</button>
          </div>
          <input style={{ ...inp, width: '100%', marginBottom: 8 }} placeholder="Buscar…" value={buscaForn} onChange={e => setBuscaForn(e.target.value)} />
          <div style={{ maxHeight: 260, overflow: 'auto', border: `1px solid ${C.line}`, borderRadius: 4 }}>
            {cfg.fornecedores.filter(x => !buscaForn.trim() || x.nome.toUpperCase().includes(buscaForn.trim().toUpperCase())).map(x => (
              <div key={x.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', borderBottom: `1px solid ${C.line}`, opacity: x.ativo ? 1 : 0.5 }}>
                <span style={{ flex: 1, fontSize: 12, color: C.navy }}>{x.nome}</span>
                <label style={{ fontSize: 10, color: C.textMuted, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="checkbox" defaultChecked={x.ativo} onChange={e => post({ kind: 'fornecedor', op: 'upsert', data: { id: x.id, nome: x.nome, ativo: e.target.checked } })} />ativo
                </label>
                <button className="btn btn-sm btn-danger" onClick={() => post({ kind: 'fornecedor', op: 'delete', data: { id: x.id } })}>×</button>
              </div>
            ))}
            {!cfg.fornecedores.length && <div style={{ padding: 16, fontSize: 12, color: C.textMuted, textAlign: 'center' }}>Nenhum fornecedor — importe os boletos do ERP (o cadastro é semeado automaticamente) ou adicione acima.</div>}
          </div>
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 8 }}>💡 Ao importar os boletos do ERP pela 1ª vez, os fornecedores reais são cadastrados automaticamente.</div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────── REPOSIÇÃO POR GIRO ───────────────────────────
interface RepRow { code: string; nome: string; classe: string; qtdVendida: number; faturamento: number; giroDia: number; estoque: number; cobertura: number | null; status: string; sugQtd: number; sugCusto: number | null; custo: number | null; semCadastroEstoque: boolean }
interface RepData { hasData: boolean; params: { alvoDias: number; baseDias: number; baseAuto?: string | null }; kpis: { itens: number; precisaRepor: number; rupturasA: number; custoReporTudo: number; custoReporA: number; semCusto: number }; statusDist: Record<string, number>; rows: RepRow[] }
const REP_COLOR: Record<string, string> = { RUPTURA: C.red, 'CRÍTICO': '#d3542c', REPOR: C.amber, OK: C.green, EXCESSO: '#6a5acd' }

function ReposicaoPanel({ an }: { an: Analytics }) {
  const [alvo, setAlvo] = useState(30)
  const [rep, setRep] = useState<RepData | null>(null)
  const [statusF, setStatusF] = useState('')
  const [classeF, setClasseF] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    setRep(null)
    fetch(`/api/compras/reposicao?dias=${alvo}`).then(r => r.json()).then(setRep)
  }, [alvo])

  const folgaProx = (() => {
    const next = an.projecao.find(p => (p.total as number) > 0 && (p.folga as number) !== undefined)
    return next ? { mes: String(next.mes), folga: Number(next.folga) } : null
  })()

  const chip = (active: boolean, color = C.navy): React.CSSProperties => ({ border: `1px solid ${active ? color : C.line}`, background: active ? color : '#fff', color: active ? '#fff' : C.textSoft, borderRadius: 20, padding: '4px 12px', fontSize: 12, cursor: 'pointer' })
  const rows = (rep?.rows ?? []).filter(r =>
    (!statusF || r.status === statusF) && (!classeF || r.classe === classeF) &&
    (!search.trim() || r.nome.toUpperCase().includes(search.trim().toUpperCase()) || r.code.includes(search.trim())))

  if (!rep) return <div className="empty-state"><div className="empty-state-icon">◌</div><div className="empty-state-title">Calculando giro…</div></div>
  if (!rep.hasData) return <div className="card"><div className="empty-state"><div className="empty-state-icon">♻</div><div className="empty-state-title">Sem dados de vendas/estoque</div><div className="empty-state-sub">Atualize o ABC de Vendas e o Estoque na Análise Comercial.</div></div></div>

  return (
    <>
      <div className="grid-5 mb-6">
        <Kpi label="Rupturas curva A" value={String(rep.kpis.rupturasA)} sub="vendem muito, estoque zero" color={C.red} />
        <Kpi label="Itens a repor" value={String(rep.kpis.precisaRepor)} sub={`p/ cobertura de ${rep.params.alvoDias} dias`} color={C.amber} />
        <Kpi label="Custo repor SÓ curva A" value={fmt(rep.kpis.custoReporA)} color={C.navy} />
        <Kpi label="Custo repor tudo" value={fmt(rep.kpis.custoReporTudo)} sub={rep.kpis.semCusto ? `${rep.kpis.semCusto} itens sem custo fora` : undefined} color={C.navyMid} />
        {folgaProx && <Kpi label={`Folga do limite · ${folgaProx.mes}`} value={fmt(folgaProx.folga)} sub="o que cabe sem estourar" color={folgaProx.folga >= rep.kpis.custoReporA ? C.green : C.red} />}
      </div>

      <div className="card mb-6" style={{ padding: '12px 20px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.textMuted, fontWeight: 600 }}>Cobertura-alvo</span>
          {[15, 30, 45, 60].map(d => <button key={d} style={chip(alvo === d, C.gold)} onClick={() => setAlvo(d)}>{d} dias</button>)}
          <span style={{ width: 12 }} />
          <span style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.textMuted, fontWeight: 600 }}>Status</span>
          {Object.entries(rep.statusDist).map(([s, n]) => (
            <button key={s} style={chip(statusF === s, REP_COLOR[s] ?? C.navy)} onClick={() => setStatusF(statusF === s ? '' : s)}>{s} · {n}</button>
          ))}
          <span style={{ width: 12 }} />
          {['A', 'B', 'C'].map(c => <button key={c} style={chip(classeF === c)} onClick={() => setClasseF(classeF === c ? '' : c)}>{c}</button>)}
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar produto…" style={{ marginLeft: 'auto', padding: '7px 10px', border: `1px solid ${C.line}`, borderRadius: 4, fontSize: 13, minWidth: 200 }} />
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.line}` }}>
          <div className="card-eyebrow">Prioridade: curva A → ruptura → cobertura</div>
          <div className="card-title" style={{ fontSize: 14 }}>Sugestão de reposição <span style={{ color: C.textMuted, fontWeight: 400 }}>({rows.length} itens)</span></div>
        </div>
        <div className="table-wrap sticky-first" style={{ maxHeight: '62vh' }}>
          <table style={{ minWidth: '100%' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 3 }}>
              <tr>
                <th style={{ textAlign: 'left' }}>Produto</th>
                <th>Classe</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Giro/dia</th>
                <th style={{ textAlign: 'right' }}>Estoque</th>
                <th style={{ textAlign: 'right' }}>Cobertura</th>
                <th style={{ textAlign: 'right' }}>Sugerir compra</th>
                <th style={{ textAlign: 'right' }}>Custo sugerido</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 300).map(r => (
                <tr key={r.code}>
                  <td style={{ fontSize: 12, color: C.navy, fontWeight: 600, background: '#fff', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.nome}<span style={{ color: C.textMuted, fontWeight: 400, fontSize: 10 }}> · {r.code}</span></td>
                  <td style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: r.classe === 'A' ? C.green : r.classe === 'B' ? C.gold : C.textMuted }}>{r.classe}</td>
                  <td style={{ textAlign: 'center' }}><span style={{ background: REP_COLOR[r.status] ?? C.navy, color: '#fff', borderRadius: 3, padding: '2px 8px', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>{r.status}</span></td>
                  <td style={{ textAlign: 'right', fontSize: 12 }}>{r.giroDia >= 1 ? r.giroDia.toFixed(1) : r.giroDia.toFixed(2)}</td>
                  <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color: r.estoque <= 0 ? C.red : C.navy }}>{r.estoque.toLocaleString('pt-BR')}{r.semCadastroEstoque ? ' *' : ''}</td>
                  <td style={{ textAlign: 'right', fontSize: 12, color: r.cobertura != null && r.cobertura < rep.params.alvoDias ? C.red : C.textSoft }}>{r.cobertura != null ? `${Math.round(r.cobertura)} d` : '—'}</td>
                  <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, color: r.sugQtd > 0 ? C.navy : C.textMuted }}>{r.sugQtd > 0 ? r.sugQtd.toLocaleString('pt-BR') + ' un' : '—'}</td>
                  <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 600 }}>{r.sugCusto != null ? fmt(r.sugCusto) : r.sugQtd > 0 ? 'sem custo' : '—'}</td>
                </tr>
              ))}
              {rows.length > 300 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 12, fontSize: 11, color: C.textMuted }}>Mostrando 300 de {rows.length}. Use os filtros.</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '8px 20px', fontSize: 11, color: C.textMuted, borderTop: `1px solid ${C.line}` }}>
          Giro/dia = vendas de {rep.params.baseDias} dias ÷ {rep.params.baseDias}
          {rep.params.baseAuto ? ` (período 01/01 → ${rep.params.baseAuto.split('-').reverse().slice(0, 2).join('/')}, automático pelo último ABC importado)` : ''}.
          {' '}Cobertura = estoque ÷ giro. Sugestão = giro × {rep.params.alvoDias}d − estoque.
          “*” = item vendido sem cadastro no relatório de estoque. Compare o custo da curva A com a folga do limite antes de aprovar os pedidos.
        </div>
      </div>
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label style={{ display: 'block', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.textMuted, fontWeight: 600, marginBottom: 4 }}>{label}</label>{children}</div>
}
function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div style={{ borderLeft: `3px solid ${color}`, paddingLeft: 14 }}>
      <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-serif), serif', fontSize: 17, color, lineHeight: 1.15 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>{sub}</div>}
    </div>
  )
}
