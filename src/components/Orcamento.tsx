'use client'
/**
 * Orçamento — sub-aba da DRE.
 *
 * A separação que organiza a tela inteira: RECEITA é previsão estatística, com
 * intervalo de 95%; CUSTO e DESPESA são PREMISSAS que o gestor edita; o
 * RESULTADO é a consequência aritmética das duas coisas, e por isso aparece
 * rotulado como cenário. O backtest fica visível ao lado justamente para
 * mostrar onde o modelo acerta (receita) e onde não acerta (resultado).
 */
import { useEffect, useMemo, useState } from 'react'
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'

const C = { navy: '#0a2540', navyMid: '#142c4e', yellow: '#f5c518', gold: '#d4a017', line: '#e3e7ed', textSoft: '#4a5670', textMuted: '#7a869a', green: '#197a4a', red: '#b03022', amber: '#c98a14', blue: '#2f5a96' }
const fmt = (n: number) => (n < 0 ? '−' : '') + 'R$ ' + Math.abs(n).toLocaleString('pt-BR', { maximumFractionDigits: 0 })
const fmtK = (n: number) => { const a = Math.abs(n); return (n < 0 ? '−' : '') + (a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(0)}k` : a.toFixed(0)) }
const pct = (n: number, d = 1) => (n * 100).toFixed(d).replace('.', ',') + '%'

type ModoLinha = 'RECEITA' | 'FIXO'
interface Premissa { linha: string; modo: ModoLinha; valor: number; valorPeriodo: number; min: number; max: number; desvio: number; editado: boolean }
interface MesOrcado { mes: string; receita: { p: number; lo: number; hi: number }; amplitude: number; fragil: boolean; linhas: Record<string, number>; cmv: number; despesas: number; resultado: number }
interface BacktestPonto { mes: string; nTreino: number; previsto: number; real: number; erro: number; lo: number; hi: number; dentroIC: boolean; resultadoPrevisto: number; resultadoReal: number }
interface Orc {
  hasData: boolean; motivo?: string
  base: { mesesRealizados: string[]; ultimoFechado: string; serieLonga: { n: number; de: string; ate: string } }
  historico: { mes: string; receita: number; cmv: number; despesas: number; resultado: number }[]
  params: { ancora: number; phi: number; horizonte: number; crescimento: number | null }
  tendencia: { mensalEstimada: number; mensalUsada: number; phi: number; fonte: string }
  sazonalidade: { mes: number; fator: number; obs: number; fragil: boolean }[]
  premissas: Premissa[]
  backtest: BacktestPonto[]
  metricas: { mapeReceita: number; mapeResultado: number; coberturaIC: string; nTestes: number }
  meses: MesOrcado[]
  totais: { receita: number; cmv: number; despesas: number; resultado: number }
}

const LABEL: Record<string, string> = {
  CMV: 'CMV — custo da mercadoria', IMPOSTOS: 'Impostos sobre venda', COM: 'Comercial / comissões',
  PESSOAL: 'Pessoal', ADM: 'Administrativas', LOG: 'Logística', FIN: 'Financeiras',
  INVEST: 'Investimentos', NAOOP: 'Não operacional', SOCIO: 'Sócios',
}
const MES_NOME = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

export function Orcamento() {
  const [d, setD] = useState<Orc | null>(null)
  const [loading, setLoading] = useState(true)
  const [ancora, setAncora] = useState(3)
  const [phi, setPhi] = useState(0.85)
  const [horizonte, setHorizonte] = useState(7)
  const [crescimento, setCrescimento] = useState<string>('')
  // premissas editadas: linha → { modo, valor na unidade da tela }
  const [edits, setEdits] = useState<Record<string, { modo?: ModoLinha; valor?: string }>>({})

  const qs = useMemo(() => {
    const p = new URLSearchParams()
    p.set('ancora', String(ancora)); p.set('phi', String(phi)); p.set('horizonte', String(horizonte))
    if (crescimento.trim() !== '') p.set('crescimento', crescimento.replace(',', '.'))
    Object.entries(edits).forEach(([L, e]) => {
      if (e.modo) p.set('m.' + L, e.modo)
      if (e.valor != null && e.valor.trim() !== '') p.set('p.' + L, e.valor.replace(',', '.'))
    })
    return p.toString()
  }, [ancora, phi, horizonte, crescimento, edits])

  useEffect(() => {
    let vivo = true
    setLoading(true)
    fetch('/api/dre/orcamento?' + qs).then(r => r.json()).then(j => { if (vivo) { setD(j); setLoading(false) } })
      .catch(() => { if (vivo) setLoading(false) })
    return () => { vivo = false }
  }, [qs])

  const serie = useMemo(() => {
    if (!d?.hasData) return []
    const hist = d.historico.map(h => ({ mes: h.mes, real: h.receita, resultadoReal: h.resultado }))
    const proj = d.meses.map(m => ({
      mes: m.mes, prev: m.receita.p, faixaBase: m.receita.lo, faixa: m.receita.hi - m.receita.lo,
      resultadoCen: m.resultado,
    }))
    // emenda: o último realizado also inicia a linha prevista, para não dar salto
    const ult = d.historico[d.historico.length - 1]
    if (ult) (hist[hist.length - 1] as Record<string, unknown>).prev = ult.receita
    return [...hist, ...proj]
  }, [d])

  if (loading && !d) return <div className="empty-state"><div className="empty-state-icon">◌</div><div className="empty-state-title">Calculando o modelo…</div></div>
  if (!d?.hasData) {
    return (
      <div className="card">
        <div className="empty-state">
          <div className="empty-state-icon">◎</div>
          <div className="empty-state-title">Orçamento indisponível</div>
          <div className="empty-state-sub">{d?.motivo ?? 'Sem base suficiente.'}</div>
        </div>
      </div>
    )
  }

  const nReal = d.base.mesesRealizados.length
  const inp: React.CSSProperties = { padding: '5px 8px', border: `1px solid ${C.line}`, borderRadius: 4, fontSize: 12, width: 78 }

  return (
    <>
      {/* ── o que é previsão e o que é cenário ── */}
      <div className="card mb-6" style={{ borderLeft: `3px solid ${C.gold}` }}>
        <div className="card-eyebrow">Como ler esta aba</div>
        <p style={{ fontSize: 13, color: C.textSoft, lineHeight: 1.6, margin: '6px 0 0', maxWidth: 900 }}>
          A <b>receita é previsão estatística</b>, com intervalo de 95%. A sazonalidade e a tendência vêm da série
          longa de vendas ({d.base.serieLonga.n} meses, {d.base.serieLonga.de}–{d.base.serieLonga.ate}); o nível vem
          da DRE realizada ({nReal} meses, último fechado {d.base.ultimoFechado}).
          <br />
          <b>Custo e despesa são premissas</b>, não previsões — o modelo as estima a partir do realizado, e você
          edita abaixo. Por consequência, o <b>resultado é um cenário</b>: ele responde “se a receita vier no
          previsto e as premissas se confirmarem, sobra isto”. O backtest ao lado mostra por que essa distinção
          existe — a receita acerta, o resultado não.
        </p>
      </div>

      {/* ── parametrizações ── */}
      <div className="card mb-6">
        <div className="card-eyebrow">Parametrização do modelo</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 22, alignItems: 'flex-end', marginTop: 10 }}>
          <Campo rotulo="Âncora do nível" ajuda="Quantos meses recentes definem o nível e os coeficientes. Menos meses = mais reativo, mais ruidoso.">
            <select className="form-select" style={{ width: 110 }} value={ancora} onChange={e => setAncora(+e.target.value)}>
              {[1, 2, 3, 4, 6, 8].filter(n => n <= nReal).map(n => <option key={n} value={n}>{n} {n === 1 ? 'mês' : 'meses'}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Amortecimento φ" ajuda="Reduz a tendência a cada mês à frente. Com poucos meses de base, extrapolar reta livre (φ=1) produz absurdos no fim do horizonte.">
            <select className="form-select" style={{ width: 110 }} value={phi} onChange={e => setPhi(+e.target.value)}>
              {[1, 0.95, 0.9, 0.85, 0.8, 0.7, 0.5].map(n => <option key={n} value={n}>{n.toFixed(2)}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Horizonte" ajuda="Meses projetados a partir do próximo.">
            <select className="form-select" style={{ width: 110 }} value={horizonte} onChange={e => setHorizonte(+e.target.value)}>
              {[3, 6, 7, 9, 12].map(n => <option key={n} value={n}>{n} meses</option>)}
            </select>
          </Campo>
          <Campo rotulo="Crescimento a.m." ajuda={`Em branco usa o estimado da série longa (${pct(d.tendencia.mensalEstimada, 2)} ao mês). Preencha para impor uma premissa de crescimento.`}>
            <input style={inp} placeholder={pct(d.tendencia.mensalEstimada, 2).replace('%', '')} value={crescimento}
              onChange={e => setCrescimento(e.target.value)} /> <span style={{ fontSize: 12, color: C.textMuted }}>%</span>
          </Campo>
          <button className="btn btn-sm" onClick={() => { setAncora(3); setPhi(0.85); setHorizonte(7); setCrescimento(''); setEdits({}) }}
            style={{ marginLeft: 'auto' }}>↺ Restaurar padrão</button>
        </div>
        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 12, lineHeight: 1.6 }}>
          Tendência em uso: <b>{pct(d.tendencia.mensalUsada, 2)} ao mês</b> ({d.params.crescimento != null ? 'imposta por você' : d.tendencia.fonte}),
          amortecida por φ = {d.tendencia.phi}. Sazonalidade estimada por mês:{' '}
          {d.sazonalidade.map(s => (
            <span key={s.mes} style={{ color: s.fragil ? C.amber : C.textMuted }}>
              {MES_NOME[s.mes]} {(s.fator - 1 >= 0 ? '+' : '') + pct(s.fator - 1, 0)}{s.fragil ? '*' : ''}{' '}
            </span>
          ))}
          <br />* mês com um único ano observado — fator frágil.
        </div>
      </div>

      {/* ── backtest ── */}
      <div className="card mb-6" style={{ borderLeft: `3px solid ${d.metricas.mapeReceita < 0.1 ? C.green : C.amber}` }}>
        <div className="card-eyebrow">Teste do modelo</div>
        <div className="card-title" style={{ fontSize: 14, marginBottom: 4 }}>
          Backtest de origem móvel — prevê cada mês usando só o que existia antes dele
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Mês previsto</th><th style={{ textAlign: 'right' }}>Treino</th>
                <th style={{ textAlign: 'right' }}>Receita prevista</th><th style={{ textAlign: 'right' }}>Receita real</th>
                <th style={{ textAlign: 'right' }}>Erro</th><th style={{ textAlign: 'center' }}>Dentro do IC 95%</th>
                <th style={{ textAlign: 'right' }}>Resultado previsto</th><th style={{ textAlign: 'right' }}>Resultado real</th>
              </tr>
            </thead>
            <tbody>
              {d.backtest.map(b => (
                <tr key={b.mes}>
                  <td style={{ fontWeight: 600, color: C.navy }}>{b.mes}</td>
                  <td style={{ textAlign: 'right', color: C.textMuted }}>{b.nTreino} meses</td>
                  <td style={{ textAlign: 'right' }}>{fmt(b.previsto)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(b.real)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: Math.abs(b.erro) <= 0.1 ? C.green : C.amber }}>
                    {(b.erro >= 0 ? '+' : '') + pct(b.erro)}
                  </td>
                  <td style={{ textAlign: 'center', color: b.dentroIC ? C.green : C.red, fontWeight: 700 }}>{b.dentroIC ? 'sim' : 'não'}</td>
                  <td style={{ textAlign: 'right', color: C.textMuted }}>{fmt(b.resultadoPrevisto)}</td>
                  <td style={{ textAlign: 'right', color: C.textMuted }}>{fmt(b.resultadoReal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 12, color: C.textSoft, marginTop: 10, lineHeight: 1.6 }}>
          <b>Receita:</b> erro médio de <b style={{ color: d.metricas.mapeReceita < 0.1 ? C.green : C.amber }}>{pct(d.metricas.mapeReceita)}</b> a
          um mês, com o real dentro do intervalo em <b>{d.metricas.coberturaIC}</b> dos testes.
          {' '}<b>Resultado:</b> erro médio de <b style={{ color: C.red }}>{pct(d.metricas.mapeResultado, 0)}</b> — e é por isso que ele
          aparece como cenário. O resultado operacional é uma diferença pequena entre números grandes: o CMV consome
          cerca de {d.premissas.find(p => p.linha === 'CMV') ? pct(d.premissas.find(p => p.linha === 'CMV')!.valor) : '—'} da
          receita líquida, então um erro de 1 ponto no CMV vale mais que o resultado de um mês inteiro.
        </div>
      </div>

      {/* ── gráfico ── */}
      <div className="card mb-6">
        <div className="card-eyebrow">Projeção</div>
        <div className="card-title" style={{ fontSize: 14, marginBottom: 10 }}>Receita líquida — realizado e previsto, com faixa de 95%</div>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={serie}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.line} />
            <XAxis dataKey="mes" tick={{ fontSize: 10, fill: C.textSoft }} stroke={C.line} />
            <YAxis tick={{ fontSize: 10, fill: C.textSoft }} stroke={C.line} tickFormatter={fmtK} />
            <Tooltip
              contentStyle={{ background: C.navy, border: 'none', borderRadius: 4, fontSize: 12 }}
              labelStyle={{ color: C.yellow, fontWeight: 600 }} itemStyle={{ color: '#fff' }}
              formatter={(v: number, n: string) => [fmt(v), n === 'real' ? 'realizado' : n === 'prev' ? 'previsto' : n === 'faixa' ? 'amplitude do IC' : n]} />
            <Area dataKey="faixaBase" stackId="ic" stroke="none" fill="transparent" isAnimationActive={false} />
            <Area dataKey="faixa" stackId="ic" stroke="none" fill={C.blue} fillOpacity={0.13} isAnimationActive={false} />
            <Line dataKey="real" stroke={C.navy} strokeWidth={2.5} dot={{ r: 2.5 }} isAnimationActive={false} />
            <Line dataKey="prev" stroke={C.gold} strokeWidth={2.5} strokeDasharray="5 4" dot={{ r: 2.5 }} isAnimationActive={false} />
            <ReferenceLine x={d.base.ultimoFechado} stroke={C.textMuted} strokeDasharray="3 3"
              label={{ value: 'último fechado', fontSize: 10, fill: C.textMuted, position: 'insideTopRight' }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* ── premissas editáveis ── */}
      <div className="card mb-6">
        <div className="card-eyebrow">Premissas</div>
        <div className="card-title" style={{ fontSize: 14, marginBottom: 4 }}>
          Como cada linha se comporta <span style={{ color: C.textMuted, fontWeight: 400 }}>— medido nos últimos {d.params.ancora} meses, editável</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Linha</th><th style={{ textAlign: 'center' }}>Comportamento</th>
                <th style={{ textAlign: 'right' }}>Premissa</th><th style={{ textAlign: 'right' }}>Em toda a base</th>
                <th style={{ textAlign: 'right' }}>Mín–máx no realizado</th><th></th>
              </tr>
            </thead>
            <tbody>
              {d.premissas.map(p => {
                const ehPct = p.modo === 'RECEITA'
                const val = edits[p.linha]?.valor ?? (ehPct ? (p.valor * 100).toFixed(1).replace('.', ',') : Math.round(p.valor).toString())
                return (
                  <tr key={p.linha}>
                    <td style={{ fontWeight: 600, color: C.navy, fontSize: 13 }}>{LABEL[p.linha] ?? p.linha}</td>
                    <td style={{ textAlign: 'center' }}>
                      <select className="form-select" style={{ fontSize: 11, padding: '3px 6px' }} value={p.modo}
                        onChange={e => setEdits(s => ({ ...s, [p.linha]: { modo: e.target.value as ModoLinha, valor: undefined } }))}>
                        <option value="RECEITA">% da receita</option>
                        <option value="FIXO">valor fixo</option>
                      </select>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <input style={{ ...inp, textAlign: 'right', borderColor: p.editado ? C.gold : C.line }} value={val}
                        onChange={e => setEdits(s => ({ ...s, [p.linha]: { ...s[p.linha], valor: e.target.value } }))} />
                      <span style={{ fontSize: 11, color: C.textMuted, marginLeft: 4 }}>{ehPct ? '%' : 'R$'}</span>
                    </td>
                    <td style={{ textAlign: 'right', fontSize: 12, color: C.textMuted }}>
                      {ehPct ? pct(p.valorPeriodo) : fmt(p.valorPeriodo)}
                    </td>
                    <td style={{ textAlign: 'right', fontSize: 12, color: C.textMuted }}>
                      {ehPct ? `${pct(p.min)} – ${pct(p.max)}` : `${fmt(p.min)} – ${fmt(p.max)}`}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {p.editado && (
                        <button className="btn btn-sm" style={{ fontSize: 10, padding: '2px 8px' }}
                          onClick={() => setEdits(s => { const n = { ...s }; delete n[p.linha]; return n })}>↺</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 8, lineHeight: 1.6 }}>
          O <b>comportamento</b> vem de premissa econômica, não de teste estatístico: com {nReal} meses de base a
          classificação automática chegava a apontar o CMV como custo fixo, e a regressão dava imposto caindo
          quando a receita sobe. O dado estima o coeficiente; a coluna “em toda a base” mostra o mesmo número
          medido em todos os {nReal} meses, para você ver se a âncora está puxando demais para o recente.
          Linhas <b>não operacionais</b> ficam fora do resultado.
        </div>
      </div>

      {/* ── tabela do orçamento ── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.line}` }}>
          <div className="card-eyebrow">Orçamento</div>
          <div className="card-title" style={{ fontSize: 14 }}>
            {d.meses.length} meses a partir de {d.meses[0]?.mes}
            <span style={{ color: C.textMuted, fontWeight: 400 }}> — receita prevista, resultado em cenário</span>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Mês</th>
                <th style={{ textAlign: 'right' }}>Receita líquida</th>
                <th style={{ textAlign: 'right' }}>IC 95%</th>
                <th style={{ textAlign: 'right' }}>CMV</th>
                <th style={{ textAlign: 'right' }}>CMV%</th>
                <th style={{ textAlign: 'right' }}>Despesas</th>
                <th style={{ textAlign: 'right' }}>Resultado (cenário)</th>
              </tr>
            </thead>
            <tbody>
              {d.meses.map(m => (
                <tr key={m.mes} style={m.fragil ? { background: '#fffaf0' } : undefined}>
                  <td style={{ fontWeight: 600, color: C.navy }}>
                    {m.mes}
                    {m.fragil && <span title="Amplitude do intervalo acima de ±40% — não planeje em cima deste mês" style={{ color: C.amber, marginLeft: 6, fontSize: 11 }}>⚠</span>}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(m.receita.p)}</td>
                  <td style={{ textAlign: 'right', fontSize: 11, color: C.textMuted, whiteSpace: 'nowrap' }}>
                    {fmtK(m.receita.lo)} – {fmtK(m.receita.hi)} <span style={{ color: m.fragil ? C.amber : C.textMuted }}>(±{pct(m.amplitude, 0)})</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>{fmt(m.cmv)}</td>
                  <td style={{ textAlign: 'right', fontSize: 12, color: C.textMuted }}>{pct(m.cmv / m.receita.p)}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(m.despesas)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: m.resultado >= 0 ? C.green : C.red }}>{fmt(m.resultado)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: `2px solid ${C.navy}`, background: '#f6f8fb' }}>
                <td style={{ fontWeight: 700, color: C.navy }}>Acumulado</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(d.totais.receita)}</td>
                <td></td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(d.totais.cmv)}</td>
                <td style={{ textAlign: 'right', fontSize: 12, color: C.textMuted }}>{pct(d.totais.cmv / d.totais.receita)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(d.totais.despesas)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: d.totais.resultado >= 0 ? C.green : C.red }}>{fmt(d.totais.resultado)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div style={{ padding: '10px 20px', fontSize: 11, color: C.textMuted, borderTop: `1px solid ${C.line}`, lineHeight: 1.6 }}>
          Meses marcados com <span style={{ color: C.amber }}>⚠</span> têm intervalo acima de ±40%: a faixa é mais larga que a
          informação. O horizonte cresce em incerteza porque a base de DRE tem apenas {nReal} meses fechados —
          importar o CashFlow Analítico de 2025 levaria a base a ~20 meses e estreitaria a faixa de forma relevante.
        </div>
      </div>
    </>
  )
}

function Campo({ rotulo, ajuda, children }: { rotulo: string; ajuda: string; children: React.ReactNode }) {
  return (
    <div title={ajuda}>
      <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.textMuted, fontWeight: 600, marginBottom: 5 }}>{rotulo}</div>
      {children}
    </div>
  )
}
