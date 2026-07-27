'use client'
import { useEffect, useMemo, useState } from 'react'
import Shell from '@/components/Shell'

interface Row {
  code: string; nome: string; classe: string; qtd: number; faturamento: number
  tabela: number | null; praticado: number; custo: number | null
  desconto: number | null; mgTabela: number | null; mgReal: number | null; gapMargem: number | null
}
interface Radar {
  hasData: boolean
  kpis: { nItens: number; nComTabela: number; descontoMedio: number | null; mgTabelaMedia: number | null; mgRealMedia: number | null; nAcimaTabela: number; nDescontoForte: number; nMgRealBaixa: number; semTabela: number; semCusto: number }
  rows: Row[]
}

const C = { navy: '#0a2540', navyMid: '#142c4e', yellow: '#f5c518', gold: '#d4a017', line: '#e3e7ed', textSoft: '#4a5670', textMuted: '#7a869a', green: '#197a4a', red: '#b03022', amber: '#c98a14', blue: '#2f5a96' }
const ABC_COLOR: Record<string, string> = { A: C.green, B: C.gold, C: C.textMuted }
const fmt = (n: number) => 'R$ ' + Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtK = (n: number) => { const a = Math.abs(n); return (a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(0)}k` : a.toFixed(0)) }
const pc = (n: number | null, dec = 1) => n == null ? '—' : `${(n * 100).toFixed(dec)}%`
const mgColor = (m: number | null) => m == null ? C.textMuted : m >= 0.2 ? C.green : m >= 0.1 ? C.amber : C.red

type FiltroRapido = '' | 'descontoForte' | 'acimaTabela' | 'mgBaixa'

export default function RadarPrecificacao() {
  const [data, setData] = useState<Radar | null>(null)
  const [loading, setLoading] = useState(true)
  const [classeF, setClasseF] = useState('')
  const [rapido, setRapido] = useState<FiltroRapido>('')
  const [search, setSearch] = useState('')

  useEffect(() => { fetch('/api/radar-precos').then(r => r.json()).then(d => { setData(d); setLoading(false) }) }, [])

  const rows = useMemo(() => {
    if (!data?.rows) return []
    const q = search.trim().toUpperCase()
    return data.rows.filter(r =>
      (!classeF || r.classe === classeF) &&
      (!q || r.nome.toUpperCase().includes(q) || r.code.includes(q)) &&
      (rapido === '' ||
        (rapido === 'descontoForte' && (r.desconto ?? 0) > 0.10) ||
        (rapido === 'acimaTabela' && (r.desconto ?? 0) < -0.005) ||
        (rapido === 'mgBaixa' && r.mgReal != null && r.mgReal < 0.2)))
  }, [data, classeF, rapido, search])

  const chip = (active: boolean, color = C.navy): React.CSSProperties => ({ border: `1px solid ${active ? color : C.line}`, background: active ? color : '#fff', color: active ? '#fff' : C.textSoft, borderRadius: 20, padding: '4px 12px', fontSize: 12, cursor: 'pointer' })

  return (
    <Shell>
      <div className="page-header">
        <div>
          <div className="page-eyebrow">Módulo · Comercial</div>
          <h1 className="page-title">Radar de Precificação</h1>
          <p className="page-subtitle">
            Preço de <b>tabela</b> × preço médio <b>praticado</b> nas vendas × custo de reposição —
            quanto de desconto está sendo dado e onde a margem real foge da planejada.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="empty-state"><div className="empty-state-icon">◌</div><div className="empty-state-title">Carregando…</div></div>
      ) : !data?.hasData ? (
        <div className="card"><div className="empty-state"><div className="empty-state-icon">⊚</div><div className="empty-state-title">Sem dados</div><div className="empty-state-sub">Atualize o ABC de Vendas (com MÉDIA/UN), a Lista de Preços e o Estoque na Análise Comercial.</div></div></div>
      ) : (
        <>
          <div className="grid-5 mb-6">
            <Kpi label="Desconto médio praticado" value={pc(data.kpis.descontoMedio)} sub="tabela → praticado, ponderado" color={(data.kpis.descontoMedio ?? 0) > 0.1 ? C.red : C.gold} />
            <Kpi label="Margem de tabela (média)" value={pc(data.kpis.mgTabelaMedia)} sub="se vendesse pela tabela" color={C.blue} />
            <Kpi label="Margem REAL (média)" value={pc(data.kpis.mgRealMedia)} sub="pelo preço praticado" color={mgColor(data.kpis.mgRealMedia)} />
            <Kpi label="Desconto forte (>10%)" value={String(data.kpis.nDescontoForte)} sub="itens pra revisar mínimo" color={C.red} />
            <Kpi label="Vendendo ACIMA da tabela" value={String(data.kpis.nAcimaTabela)} sub="dá pra subir a tabela" color={C.green} />
          </div>

          <div className="card mb-6" style={{ padding: '12px 20px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.textMuted, fontWeight: 600 }}>Classe</span>
              {['A', 'B', 'C'].map(c => <button key={c} style={chip(classeF === c, ABC_COLOR[c])} onClick={() => setClasseF(classeF === c ? '' : c)}>{c}</button>)}
              <span style={{ width: 12 }} />
              <button style={chip(rapido === 'descontoForte', C.red)} onClick={() => setRapido(rapido === 'descontoForte' ? '' : 'descontoForte')}>Desconto &gt; 10% · {data.kpis.nDescontoForte}</button>
              <button style={chip(rapido === 'acimaTabela', C.green)} onClick={() => setRapido(rapido === 'acimaTabela' ? '' : 'acimaTabela')}>Acima da tabela · {data.kpis.nAcimaTabela}</button>
              <button style={chip(rapido === 'mgBaixa', C.amber)} onClick={() => setRapido(rapido === 'mgBaixa' ? '' : 'mgBaixa')}>Margem real &lt; 20% · {data.kpis.nMgRealBaixa}</button>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar produto…" style={{ marginLeft: 'auto', padding: '7px 10px', border: `1px solid ${C.line}`, borderRadius: 4, fontSize: 13, minWidth: 220 }} />
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.line}` }}>
              <div className="card-title" style={{ fontSize: 14 }}>Produtos <span style={{ color: C.textMuted, fontWeight: 400 }}>({rows.length})</span></div>
            </div>
            <div className="table-wrap sticky-first" style={{ maxHeight: '64vh' }}>
              <table style={{ minWidth: '100%' }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 3 }}>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Produto</th>
                    <th>Classe</th>
                    <th style={{ textAlign: 'right' }}>Qtd</th>
                    <th style={{ textAlign: 'right' }}>Faturamento</th>
                    <th style={{ textAlign: 'right' }}>Tabela</th>
                    <th style={{ textAlign: 'right' }}>Praticado</th>
                    <th style={{ textAlign: 'right' }}>Desconto</th>
                    <th style={{ textAlign: 'right' }}>Custo</th>
                    <th style={{ textAlign: 'right' }}>Mg tabela</th>
                    <th style={{ textAlign: 'right' }}>Mg REAL</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 400).map(r => (
                    <tr key={r.code}>
                      <td style={{ fontSize: 12, color: C.navy, fontWeight: 600, background: '#fff', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.nome}<span style={{ color: C.textMuted, fontWeight: 400, fontSize: 10 }}> · {r.code}</span></td>
                      <td style={{ textAlign: 'center' }}><span style={{ background: ABC_COLOR[r.classe] ?? C.textMuted, color: '#fff', borderRadius: 3, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>{r.classe}</span></td>
                      <td style={{ textAlign: 'right', fontSize: 11, color: C.textMuted }}>{r.qtd.toLocaleString('pt-BR')}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 600 }}>{fmtK(r.faturamento)}</td>
                      <td style={{ textAlign: 'right', fontSize: 12 }}>{r.tabela != null ? fmt(r.tabela) : '—'}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 600 }}>{fmt(r.praticado)}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, color: r.desconto == null ? C.textMuted : r.desconto < -0.005 ? C.green : r.desconto > 0.10 ? C.red : C.textSoft }}>
                        {r.desconto == null ? '—' : r.desconto < -0.005 ? `+${pc(-r.desconto)}` : pc(r.desconto)}
                      </td>
                      <td style={{ textAlign: 'right', fontSize: 11, color: C.textMuted }}>{r.custo != null ? fmt(r.custo) : '—'}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, color: mgColor(r.mgTabela) }}>{pc(r.mgTabela)}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, color: mgColor(r.mgReal) }}>{pc(r.mgReal)}</td>
                    </tr>
                  ))}
                  {rows.length > 400 && <tr><td colSpan={10} style={{ textAlign: 'center', padding: 12, fontSize: 11, color: C.textMuted }}>Mostrando 400 de {rows.length}. Use os filtros ou a busca.</td></tr>}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '8px 20px', fontSize: 11, color: C.textMuted, borderTop: `1px solid ${C.line}` }}>
              <b>Desconto</b> = (tabela − praticado) ÷ tabela; verde com “+” = vendendo acima da tabela. <b>Mg REAL</b> = (praticado − custo) ÷ praticado.
              Itens sem tabela: {data.kpis.semTabela} · sem custo: {data.kpis.semCusto}. Ordenado por faturamento.
            </div>
          </div>
        </>
      )}
    </Shell>
  )
}

function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div style={{ borderLeft: `3px solid ${color}`, paddingLeft: 14 }}>
      <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-serif), serif', fontSize: 18, color, lineHeight: 1.15 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: C.textMuted, marginTop: 3 }}>{sub}</div>}
    </div>
  )
}
