'use client'
import { useEffect, useMemo, useState } from 'react'
import Shell from '@/components/Shell'
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts'

interface Item {
  code: string | null; nome: string
  vendaCur: number; vendaPrev: number; qtdCur: number
  crescimento: number | null; novo: boolean; perdido: boolean
  precoMedio: number; custo: number | null; estoque: number | null
  margem: number | null; lucro: number | null; capitalParado: number | null
  quadrante: string | null
}
interface Resumo { itens: number; venda: number; lucro: number; margem: number; capitalParado: number }
interface BCG {
  hasData: boolean; motivo?: string
  janela: { meses: number[]; label: string; curYear: number; prevYear: number }
  cortes: { crescimento: number; margem: number }
  totais: { vendaCur: number; vendaPrev: number; crescimentoCarteira: number; itens: number; comMargem: number; semCusto: number; novos: number; perdidos: number }
  resumo: Record<string, Resumo>
  itens: Item[]
}

const C = { navy: '#0a2540', navyMid: '#142c4e', yellow: '#f5c518', gold: '#d4a017', line: '#e3e7ed', textSoft: '#4a5670', textMuted: '#7a869a', green: '#197a4a', red: '#b03022', amber: '#c98a14', blue: '#2f5a96' }

const Q = {
  ESTRELA:      { label: 'Estrela',       icone: '★', cor: C.green, acao: 'Cresce e tem margem — proteger preço e nunca deixar faltar.' },
  VACA:         { label: 'Vaca leiteira', icone: '✦', cor: C.blue,  acao: 'Margem boa sem crescer — colher; é o que financia o resto.' },
  INTERROGACAO: { label: 'Interrogação',  icone: '?', cor: C.amber, acao: 'Cresce sem margem — reprecificar ou renegociar a compra.' },
  ABACAXI:      { label: 'Abacaxi',       icone: '▽', cor: C.red,   acao: 'Não cresce nem rende — candidato a sair da linha.' },
} as const
type QKey = keyof typeof Q

const fmt = (n: number) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtK = (n: number) => { const a = Math.abs(n); return (n < 0 ? '−' : '') + (a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(0)}k` : a.toFixed(0)) }
const pct = (n: number | null, d = 1) => n == null ? '—' : `${(n * 100).toFixed(d)}%`
// Crescimento explode quando a base do ano anterior é pequena (um item que
// vendeu R$ 50 e passou a vender R$ 3.000 cresce 5.900%). O ponto é plotado no
// teto para não achatar o gráfico; o valor real fica na tabela e no tooltip.
const TETO = 2, PISO = -1
const clamp = (n: number) => Math.max(PISO, Math.min(TETO, n))

export default function MatrizBCG() {
  const [d, setD] = useState<BCG | null>(null)
  const [loading, setLoading] = useState(true)
  const [foco, setFoco] = useState<QKey | ''>('')
  const [busca, setBusca] = useState('')

  useEffect(() => {
    fetch('/api/produtos/bcg').then(r => r.json()).then(x => { setD(x); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  const pontos = useMemo(() => {
    if (!d?.itens) return []
    return d.itens
      .filter(i => i.quadrante && i.margem != null && i.vendaCur > 0)
      .map(i => ({
        ...i,
        x: i.margem as number,
        y: clamp(i.novo || i.crescimento == null ? TETO : i.crescimento),
        z: i.vendaCur,
        extrapolado: (i.crescimento ?? 0) > TETO || i.novo,
      }))
  }, [d])

  const tabela = useMemo(() => {
    if (!d?.itens) return []
    const q = busca.trim().toUpperCase()
    return d.itens
      .filter(i => i.quadrante && (!foco || i.quadrante === foco))
      .filter(i => !q || i.nome.toUpperCase().includes(q) || (i.code ?? '').includes(q))
      .sort((a, b) => b.vendaCur - a.vendaCur)
  }, [d, foco, busca])

  return (
    <Shell>
      <div className="page-header">
        <div>
          <div className="page-eyebrow">Módulo · Portfólio</div>
          <h1 className="page-title">Matriz BCG de Produtos</h1>
          <p className="page-subtitle">
            Cada produto posicionado por <b>crescimento</b> (histórico de vendas, mesma janela de meses nos dois anos)
            e <b>margem realizada</b> (preço médio praticado contra o custo de reposição). O tamanho da bolha é o faturamento.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="empty-state"><div className="empty-state-icon">◌</div><div className="empty-state-title">Carregando…</div></div>
      ) : !d?.hasData ? (
        <div className="empty-state">
          <div className="empty-state-icon">◍</div>
          <div className="empty-state-title">Sem histórico suficiente</div>
          <div style={{ fontSize: 13, color: C.textMuted, marginTop: 8 }}>{d?.motivo ?? 'Importe a base de Demanda por Cliente com dois anos de vendas.'}</div>
        </div>
      ) : (
        <>
          {/* Régua do período e dos cortes */}
          <div className="card mb-6" style={{ padding: '14px 20px', display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <div>
              <span style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.textMuted, fontWeight: 600 }}>Janela comparada </span>
              <b style={{ color: C.navy }}>{d.janela.label} · {d.janela.prevYear} → {d.janela.curYear}</b>
            </div>
            <div>
              <span style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.textMuted, fontWeight: 600 }}>Carteira </span>
              <b style={{ color: C.navy }}>{fmt(d.totais.vendaCur)}</b>
              <span style={{ color: d.totais.crescimentoCarteira >= 0 ? C.green : C.red, fontWeight: 600, marginLeft: 8 }}>
                {d.totais.crescimentoCarteira >= 0 ? '+' : ''}{pct(d.totais.crescimentoCarteira)}
              </span>
            </div>
            <div>
              <span style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.textMuted, fontWeight: 600 }}>Cortes </span>
              <b style={{ color: C.navy }}>crescimento {pct(d.cortes.crescimento)} · margem {pct(d.cortes.margem)}</b>
            </div>
            <div style={{ marginLeft: 'auto', fontSize: 11.5, color: C.textMuted }}>
              {d.totais.comMargem} produtos na matriz
              {d.totais.semCusto > 0 && <> · {d.totais.semCusto} fora por falta de custo</>}
            </div>
          </div>

          {/* Quadrantes */}
          <div className="grid-4 mb-6">
            {(Object.keys(Q) as QKey[]).map(k => {
              const r = d.resumo[k]
              const on = foco === k
              return (
                <div key={k} className="card" onClick={() => setFoco(on ? '' : k)}
                  style={{ cursor: 'pointer', borderLeft: `3px solid ${Q[k].cor}`, background: on ? Q[k].cor + '0e' : undefined }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 15, color: Q[k].cor }}>{Q[k].icone}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>{Q[k].label}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: C.textMuted }}>{r?.itens ?? 0} itens</span>
                  </div>
                  <div style={{ fontFamily: 'var(--font-serif), serif', fontSize: 19, color: Q[k].cor, marginTop: 8 }}>{fmt(r?.venda ?? 0)}</div>
                  <div style={{ fontSize: 11.5, color: C.textSoft, marginTop: 3 }}>
                    margem {pct(r?.margem ?? 0)} · lucro {fmtK(r?.lucro ?? 0)}
                  </div>
                  <div style={{ fontSize: 11, color: C.textMuted, marginTop: 8, lineHeight: 1.45 }}>{Q[k].acao}</div>
                </div>
              )
            })}
          </div>

          {/* Dispersão */}
          <div className="card card-accent-yellow mb-6">
            <div className="card-header">
              <div>
                <div className="card-eyebrow">Posicionamento</div>
                <div className="card-title">Crescimento × Margem</div>
              </div>
            </div>
            <p style={{ fontSize: 12, color: C.textMuted, marginBottom: 10, lineHeight: 1.6 }}>
              As linhas tracejadas são os cortes: crescimento da carteira ({pct(d.cortes.crescimento)}) e margem média ({pct(d.cortes.margem)}).
              Produtos novos e os que cresceram mais de {pct(TETO, 0)} aparecem no topo do gráfico — o valor real está na tabela.
              Clique num quadrante acima para isolá-lo.
            </p>
            <ResponsiveContainer width="100%" height={430}>
              <ScatterChart margin={{ top: 12, right: 24, bottom: 16, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.line} />
                <XAxis type="number" dataKey="x" name="Margem" domain={[-0.3, 0.7]}
                  tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                  tick={{ fontSize: 11, fill: C.textSoft }} stroke={C.line}
                  label={{ value: 'Margem realizada', position: 'insideBottom', offset: -8, fontSize: 11, fill: C.textMuted }} />
                <YAxis type="number" dataKey="y" name="Crescimento" domain={[PISO, TETO]}
                  tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                  tick={{ fontSize: 11, fill: C.textSoft }} stroke={C.line}
                  label={{ value: 'Crescimento a/a', angle: -90, position: 'insideLeft', fontSize: 11, fill: C.textMuted }} />
                <ZAxis type="number" dataKey="z" range={[25, 900]} />
                <ReferenceLine x={d.cortes.margem} stroke={C.navy} strokeDasharray="5 4" />
                <ReferenceLine y={d.cortes.crescimento} stroke={C.navy} strokeDasharray="5 4" />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  contentStyle={{ background: C.navy, border: 'none', borderRadius: 5, fontSize: 12 }}
                  labelStyle={{ display: 'none' }}
                  formatter={() => ''}
                  content={({ payload }) => {
                    const p = payload?.[0]?.payload as (Item & { extrapolado: boolean }) | undefined
                    if (!p) return null
                    return (
                      <div style={{ background: C.navy, color: '#fff', padding: '10px 13px', borderRadius: 5, fontSize: 12, maxWidth: 300, boxShadow: '0 6px 20px rgba(0,0,0,0.3)' }}>
                        <div style={{ fontWeight: 600, marginBottom: 6 }}>{p.nome}</div>
                        <div>Venda {d.janela.curYear}: <b style={{ color: C.yellow }}>{fmt(p.vendaCur)}</b></div>
                        <div>Ano anterior: {fmt(p.vendaPrev)}</div>
                        <div>Crescimento: <b>{p.novo ? 'produto novo' : pct(p.crescimento)}</b></div>
                        <div>Margem: <b>{pct(p.margem)}</b> · lucro {fmtK(p.lucro ?? 0)}</div>
                        {p.estoque != null && <div style={{ color: '#9fb0c6' }}>Estoque: {p.estoque} un{p.capitalParado ? ` · ${fmt(p.capitalParado)}` : ''}</div>}
                      </div>
                    )
                  }} />
                <Scatter data={pontos} fillOpacity={0.62}>
                  {pontos.map((p, i) => (
                    <Cell key={i}
                      fill={Q[(p.quadrante as QKey)]?.cor ?? C.textMuted}
                      opacity={foco && p.quadrante !== foco ? 0.1 : 0.62} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>

          {/* Tabela */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div className="card-title" style={{ fontSize: 14 }}>
                {foco ? `${Q[foco].icone} ${Q[foco].label}` : 'Todos os produtos'}
                <span style={{ color: C.textMuted, fontWeight: 400 }}> ({tabela.length})</span>
              </div>
              {foco && <button className="btn btn-sm" onClick={() => setFoco('')}>Limpar filtro</button>}
              <input className="form-input" placeholder="Buscar produto ou código…" value={busca}
                onChange={e => setBusca(e.target.value)} style={{ marginLeft: 'auto', maxWidth: 260, padding: '6px 10px', fontSize: 13 }} />
            </div>
            <div className="table-wrap" style={{ maxHeight: '60vh' }}>
              <table>
                <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Produto</th>
                    <th>Quadrante</th>
                    <th style={{ textAlign: 'right' }}>Venda {d.janela.curYear}</th>
                    <th style={{ textAlign: 'right' }}>{d.janela.prevYear}</th>
                    <th style={{ textAlign: 'right' }}>Crescimento</th>
                    <th style={{ textAlign: 'right' }}>Margem</th>
                    <th style={{ textAlign: 'right' }}>Lucro</th>
                    <th style={{ textAlign: 'right' }}>Capital parado</th>
                  </tr>
                </thead>
                <tbody>
                  {tabela.slice(0, 300).map((i, n) => {
                    const q = Q[i.quadrante as QKey]
                    return (
                      <tr key={(i.code ?? '') + n}>
                        <td style={{ fontSize: 12.5, fontWeight: 600, color: C.navy }}>
                          {i.nome}
                          {i.code && <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 400 }}>{i.code}</div>}
                        </td>
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <span style={{ color: q.cor, fontSize: 11, fontWeight: 700 }}>{q.icone} {q.label}</span>
                        </td>
                        <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 600 }}>{fmt(i.vendaCur)}</td>
                        <td style={{ textAlign: 'right', fontSize: 12, color: C.textMuted }}>{fmtK(i.vendaPrev)}</td>
                        <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', color: i.novo ? C.blue : (i.crescimento ?? 0) >= d.cortes.crescimento ? C.green : C.red }}>
                          {i.novo ? 'novo' : i.crescimento == null ? '—' : `${i.crescimento >= 0 ? '+' : ''}${(i.crescimento * 100).toFixed(0)}%`}
                        </td>
                        <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color: (i.margem ?? 0) < 0 ? C.red : (i.margem ?? 0) >= d.cortes.margem ? C.green : C.amber }}>{pct(i.margem)}</td>
                        <td style={{ textAlign: 'right', fontSize: 12 }}>{i.lucro == null ? '—' : fmtK(i.lucro)}</td>
                        <td style={{ textAlign: 'right', fontSize: 12, color: C.textMuted }}>{i.capitalParado ? fmt(i.capitalParado) : '—'}</td>
                      </tr>
                    )
                  })}
                  {tabela.length > 300 && (
                    <tr><td colSpan={8} style={{ textAlign: 'center', padding: 12, fontSize: 11, color: C.textMuted }}>
                      Mostrando 300 de {tabela.length}. Use a busca ou filtre por quadrante.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '8px 20px', fontSize: 11, color: C.textMuted, borderTop: `1px solid ${C.line}`, lineHeight: 1.6 }}>
              <b>Crescimento</b> = venda de {d.janela.label}/{d.janela.curYear} contra os mesmos meses de {d.janela.prevYear}; o mês em curso fica de fora para não distorcer.
              <b> Margem</b> = (preço médio praticado − custo de reposição) ÷ preço médio. Produtos sem custo cadastrado não entram na matriz.
              {d.totais.perdidos > 0 && <> {d.totais.perdidos} produtos venderam em {d.janela.prevYear} e não venderam em {d.janela.curYear} — não aparecem aqui por não terem posição.</>}
            </div>
          </div>
        </>
      )}
    </Shell>
  )
}
