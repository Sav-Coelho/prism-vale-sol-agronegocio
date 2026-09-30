'use client'
/**
 * Orçamento — sub-aba da DRE.
 *
 * A separação que organiza a tela inteira: RECEITA é previsão estatística, com
 * intervalo de 95%; CUSTO e DESPESA são PREMISSAS que o gestor edita; o
 * RESULTADO é a consequência aritmética das duas coisas, e por isso aparece
 * rotulado como cenário. O check-up cobra o mês fechado contra o que o
 * orçamento havia dito, com a divergência decomposta linha a linha.
 */
import { useEffect, useMemo, useState } from 'react'
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea } from 'recharts'

const C = {
  navy: '#0a2540', navyMid: '#142c4e', navyLight: '#1e3a5f',
  yellow: '#f5c518', gold: '#d4a017', line: '#e3e7ed', lineStrong: '#c8d1dc',
  textSoft: '#4a5670', textMuted: '#7a869a',
  green: '#197a4a', red: '#b03022', amber: '#c98a14', blue: '#2f5a96',
}
const fmt = (n: number) => (n < 0 ? '−' : '') + 'R$ ' + Math.abs(n).toLocaleString('pt-BR', { maximumFractionDigits: 0 })
const fmtK = (n: number) => { const a = Math.abs(n); return (n < 0 ? '−' : '') + (a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(0)}k` : a.toFixed(0)) }
const pct = (n: number, d = 1) => (n * 100).toFixed(d).replace('.', ',') + '%'
const sinal = (n: number, f: (x: number) => string) => (n >= 0 ? '+' : '') + f(n)

type ModoLinha = 'RECEITA' | 'FIXO'
interface Premissa { linha: string; modo: ModoLinha; valor: number; origem: 'padrao' | 'medido' | 'editado'; valorAncora: number; valorPeriodo: number; min: number; max: number; desvio: number; editado: boolean }
interface MesOrcado { mes: string; receita: { p: number; lo: number; hi: number }; amplitude: number; fragil: boolean; linhas: Record<string, number>; cmv: number; despesas: number; resultado: number }
interface BacktestPonto { mes: string; nTreino: number; previsto: number; real: number; erro: number; lo: number; hi: number; dentroIC: boolean; resultadoPrevisto: number; resultadoReal: number }
interface CheckupLinha { linha: string; modo: ModoLinha; premissa: number; realizado: number; previstoRS: number; realizadoRS: number; impacto: number }
interface Checkup {
  mes: string; nTreino: number
  receita: { previsto: number; realizado: number; erro: number; lo: number; hi: number; dentroIC: boolean }
  efeitoReceita: number
  linhas: CheckupLinha[]
  resultado: { previsto: number; realizado: number; diferenca: number }
  residuo: number
}
interface Orc {
  hasData: boolean; motivo?: string
  base: { mesesRealizados: string[]; ultimoFechado: string; serieLonga: { n: number; de: string; ate: string }; descartados: { mes: string; lancamentos: number }[]; corteDensidade: number }
  historico: { mes: string; receita: number; cmv: number; despesas: number; resultado: number }[]
  params: { ancora: number; phi: number; horizonte: number; crescimento: number | null }
  tendencia: { mensalEstimada: number; mensalUsada: number; phi: number; fonte: string }
  sazonalidade: { mes: number; fator: number; obs: number; fragil: boolean }[]
  premissas: Premissa[]
  backtest: BacktestPonto[]
  checkups: Checkup[]
  metricas: { mapeReceita: number; mapeResultado: number; coberturaIC: string; nTestes: number }
  meses: MesOrcado[]
  totais: { receita: number; cmv: number; despesas: number; resultado: number }
}

const LABEL: Record<string, string> = {
  CMV: 'CMV — mercadoria', IMPOSTOS: 'Impostos sobre venda', COM: 'Comercial e comissões',
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
  const [crescimento, setCrescimento] = useState('')
  const [mesCheckup, setMesCheckup] = useState('')
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
    const hist: Record<string, unknown>[] = d.historico.map(h => ({ mes: h.mes, real: h.receita }))
    const proj = d.meses.map(m => ({ mes: m.mes, prev: m.receita.p, faixaBase: m.receita.lo, faixa: m.receita.hi - m.receita.lo }))
    const ult = d.historico[d.historico.length - 1]
    if (ult && hist.length) { hist[hist.length - 1].prev = ult.receita; hist[hist.length - 1].faixaBase = ult.receita; hist[hist.length - 1].faixa = 0 }
    return [...hist, ...proj]
  }, [d])

  if (loading && !d) {
    return <div className="empty-state"><div className="empty-state-icon">◌</div><div className="empty-state-title">Calculando o modelo…</div></div>
  }
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
  const confiavel = d.metricas.mapeReceita <= 0.1 && d.metricas.coberturaIC.split('/')[0] === d.metricas.coberturaIC.split('/')[1]
  const cmvP = d.premissas.find(p => p.linha === 'CMV')
  const inicioProj = d.meses[0]?.mes

  return (
    <>
      {/* ════ cabeçalho executivo ════ */}
      <div className="orc-hero mb-6">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24, flexWrap: 'wrap', position: 'relative' }}>
          <div style={{ flex: 1, minWidth: 320 }}>
            <div className="orc-hero-eyebrow">Projeção econométrica · intervalo de 95%</div>
            <h2 className="orc-hero-title">Orçamento {inicioProj} — {d.meses[d.meses.length - 1]?.mes}</h2>
            <p className="orc-hero-sub">
              A receita é previsão estatística; custo e despesa são premissas que você edita; o resultado é a
              consequência das duas. Sazonalidade e tendência vêm da série de vendas de {d.base.serieLonga.n} meses,
              o nível vem dos {nReal} meses de DRE fechada até {d.base.ultimoFechado}.
            </p>
          </div>
          <span className={`orc-pill ${confiavel ? 'orc-pill-ok' : 'orc-pill-alerta'}`} style={{ fontSize: 10, padding: '5px 12px' }}>
            {confiavel ? 'modelo validado' : 'atenção ao erro'}
          </span>
        </div>

        <div className="orc-kpis">
          <Kpi rotulo="Receita projetada" valor={fmt(d.totais.receita)} nota={`${d.meses.length} meses`} />
          <Kpi rotulo="CMV" valor={fmt(d.totais.cmv)} nota={`${pct(d.totais.cmv / d.totais.receita)} da receita`} />
          <Kpi rotulo="Despesas" valor={fmt(d.totais.despesas)} nota={`${pct(d.totais.despesas / d.totais.receita)} da receita`} />
          <Kpi rotulo="Resultado (cenário)" valor={fmt(d.totais.resultado)}
            cor={d.totais.resultado >= 0 ? '#7ce3a8' : '#ff9c8f'} nota={pct(d.totais.resultado / d.totais.receita) + ' de margem'} />
          <Kpi rotulo="Erro da previsão" valor={pct(d.metricas.mapeReceita)}
            cor={d.metricas.mapeReceita <= 0.1 ? '#7ce3a8' : C.yellow} nota={`${d.metricas.coberturaIC} dentro do IC 95%`} />
        </div>
      </div>

      {d.base.descartados.length > 0 && (
        <div className="card mb-6 card-accent-gold" style={{ padding: '16px 22px' }}>
          <div style={{ fontSize: 12.5, color: C.textSoft, lineHeight: 1.7 }}>
            <b style={{ color: C.gold }}>Fora do treino:</b>{' '}
            {d.base.descartados.map(x => `${x.mes} (${x.lancamentos} lançamentos)`).join(', ')}. O import do CashFlow traz
            títulos futuros, a receber e a pagar, então esses meses já aparecem na base sem estarem realizados — um mês
            fechado tem o razão inteiro, acima de {d.base.corteDensidade} lançamentos.
          </div>
        </div>
      )}

      {/* ════ ① parametrização ════ */}
      <div className="card mb-6">
        <Secao num="①" titulo="Parametrização" sub="o modelo responde a cada mudança na hora" />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28, alignItems: 'flex-end', marginTop: 18 }}>
          <Campo rotulo="Âncora do nível" ajuda="Quantos meses recentes definem o nível e os coeficientes. Menos meses = mais reativo, mais ruidoso.">
            <select className="form-select" style={{ width: 118 }} value={ancora} onChange={e => setAncora(+e.target.value)}>
              {[1, 2, 3, 4, 6, 8].filter(n => n <= nReal).map(n => <option key={n} value={n}>{n} {n === 1 ? 'mês' : 'meses'}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Amortecimento φ" ajuda="Reduz a tendência a cada mês à frente. Com poucos meses de base, extrapolar reta livre (φ = 1) produz absurdos no fim do horizonte.">
            <select className="form-select" style={{ width: 100 }} value={phi} onChange={e => setPhi(+e.target.value)}>
              {[1, 0.95, 0.9, 0.85, 0.8, 0.7, 0.5].map(n => <option key={n} value={n}>{n.toFixed(2)}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Horizonte" ajuda="Meses projetados a partir do próximo.">
            <select className="form-select" style={{ width: 112 }} value={horizonte} onChange={e => setHorizonte(+e.target.value)}>
              {[3, 6, 7, 9, 12].map(n => <option key={n} value={n}>{n} meses</option>)}
            </select>
          </Campo>
          <Campo rotulo="Crescimento a.m." ajuda={`Em branco usa o estimado da série longa (${pct(d.tendencia.mensalEstimada, 2)} ao mês). Preencha para impor uma premissa.`}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <input className="form-input" style={{ width: 82, textAlign: 'right' }}
                placeholder={(d.tendencia.mensalEstimada * 100).toFixed(2).replace('.', ',')}
                value={crescimento} onChange={e => setCrescimento(e.target.value)} />
              <span style={{ fontSize: 12, color: C.textMuted }}>%</span>
            </div>
          </Campo>
          <button className="btn btn-sm" style={{ marginLeft: 'auto' }}
            onClick={() => { setAncora(3); setPhi(0.85); setHorizonte(7); setCrescimento(''); setEdits({}) }}>
            ↺ Restaurar padrão
          </button>
        </div>

        <div className="orc-nota">
          Tendência em uso <b>{pct(d.tendencia.mensalUsada, 2)} ao mês</b> ({d.params.crescimento != null ? 'imposta por você' : d.tendencia.fonte}),
          amortecida por φ&nbsp;=&nbsp;{d.tendencia.phi}.
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
            {d.sazonalidade.map(s => (
              <span key={s.mes} title={s.fragil ? 'Um único ano observado — fator frágil' : `${s.obs} anos observados`}
                style={{ fontSize: 11, color: s.fragil ? C.amber : C.textSoft, whiteSpace: 'nowrap' }}>
                <b style={{ color: C.navy }}>{MES_NOME[s.mes]}</b> {sinal(s.fator - 1, x => pct(x, 0))}{s.fragil ? '*' : ''}
              </span>
            ))}
          </div>
          <div style={{ marginTop: 6, color: C.textMuted }}>* mês com um único ano observado — fator sazonal frágil.</div>
        </div>
      </div>

      {/* ════ ② check-up ════ */}
      {d.checkups.length > 0 && (() => {
        const c = d.checkups.find(x => x.mes === mesCheckup) ?? d.checkups[0]
        const ordenadas = c.linhas.slice().sort((a, b) => Math.abs(b.impacto) - Math.abs(a.impacto))
        const maxImp = Math.max(Math.abs(c.efeitoReceita), ...ordenadas.map(l => Math.abs(l.impacto)), 1)
        const maior = ordenadas[0]
        const dif = c.resultado.diferenca
        return (
          <div className="card mb-6" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '22px 28px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
                <Secao num="②" titulo={`Check-up de ${c.mes}`} sub="o que o orçamento previu × o que fechou de fato" />
                <div>
                  <div className="orc-tile-label">Mês fechado</div>
                  <select className="form-select" style={{ width: 128 }} value={c.mes} onChange={e => setMesCheckup(e.target.value)}>
                    {d.checkups.map(x => <option key={x.mes} value={x.mes}>{x.mes}</option>)}
                  </select>
                </div>
              </div>

              <div className="orc-tiles" style={{ marginTop: 18 }}>
                <Tile rotulo="Receita prevista" valor={fmt(c.receita.previsto)} />
                <Tile rotulo="Receita realizada" valor={fmt(c.receita.realizado)} cor={C.navy}
                  nota={`${sinal(-c.receita.erro, x => pct(x))} contra o previsto`} />
                <Tile rotulo="Intervalo de 95%" valor={`${fmtK(c.receita.lo)} – ${fmtK(c.receita.hi)}`}
                  cor={c.receita.dentroIC ? C.green : C.red} nota={c.receita.dentroIC ? 'realizado dentro da faixa' : 'realizado FORA da faixa'} />
                <Tile rotulo="Resultado previsto" valor={fmt(c.resultado.previsto)} />
                <Tile rotulo="Resultado realizado" valor={fmt(c.resultado.realizado)}
                  cor={c.resultado.realizado >= 0 ? C.green : C.red} nota={sinal(dif, fmt) + ' contra o orçado'} />
              </div>

              <p style={{ fontSize: 12, color: C.textSoft, lineHeight: 1.7, margin: '16px 0 0' }}>
                A previsão é reconstruída com <b>origem travada antes de {c.mes}</b> — o modelo só enxerga os {c.nTreino} meses
                anteriores. Sem isso ele treinaria com o próprio mês e acertaria por construção.
              </p>
            </div>

            <div className="table-wrap" style={{ marginTop: 18 }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Ponto de divergência</th>
                    <th style={{ textAlign: 'right' }}>Premissa</th>
                    <th style={{ textAlign: 'right' }}>Realizado</th>
                    <th style={{ textAlign: 'right' }}>Diferença</th>
                    <th style={{ width: 150 }}>Impacto no resultado</th>
                    <th style={{ textAlign: 'right' }}>R$</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <div style={{ fontWeight: 700, color: C.navy }}>Receita líquida</div>
                      <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
                        {c.receita.dentroIC ? 'dentro do intervalo — variação normal' : 'fora do intervalo — o modelo errou'}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}>{fmt(c.receita.previsto)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(c.receita.realizado)}</td>
                    <td style={{ textAlign: 'right', color: c.receita.realizado >= c.receita.previsto ? C.green : C.amber }}>
                      {sinal(c.receita.realizado - c.receita.previsto, fmt)}
                    </td>
                    <td><Barra valor={c.efeitoReceita} max={maxImp} /></td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: c.efeitoReceita >= 0 ? C.green : C.red }}>
                      {sinal(c.efeitoReceita, fmt)}
                    </td>
                  </tr>
                  {ordenadas.map(l => {
                    const ehPct = l.modo === 'RECEITA'
                    const dPts = l.realizado - l.premissa
                    return (
                      <tr key={l.linha}>
                        <td>
                          <div style={{ fontWeight: 600, color: C.navy, fontSize: 13 }}>{LABEL[l.linha] ?? l.linha}</div>
                          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
                            {ehPct ? `consumiu ${pct(l.realizado)} da receita realizada` : `gastou ${fmt(l.realizadoRS)} no mês`}
                          </div>
                        </td>
                        <td style={{ textAlign: 'right' }}>{ehPct ? pct(l.premissa) : fmt(l.premissa)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{ehPct ? pct(l.realizado) : fmt(l.realizado)}</td>
                        <td style={{ textAlign: 'right', color: dPts <= 0 ? C.green : C.amber }}>
                          {ehPct ? `${dPts >= 0 ? '+' : '−'}${Math.abs(dPts * 100).toFixed(1).replace('.', ',')} pts` : sinal(dPts, fmt)}
                        </td>
                        <td><Barra valor={l.impacto} max={maxImp} /></td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: l.impacto >= 0 ? C.green : C.red }}>
                          {sinal(l.impacto, fmt)}
                        </td>
                      </tr>
                    )
                  })}
                  <tr className="orc-total">
                    <td colSpan={4} style={{ color: C.navy }}>
                      Soma dos efeitos
                      <span style={{ fontWeight: 400, fontSize: 11, color: C.textMuted, marginLeft: 8 }}>
                        {Math.abs(c.residuo) > 1 ? `resíduo de ${fmt(c.residuo)} — conferir` : 'fecha exatamente com a diferença, resíduo zero'}
                      </span>
                    </td>
                    <td></td>
                    <td style={{ textAlign: 'right', color: dif >= 0 ? C.green : C.red }}>{sinal(dif, fmt)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div style={{ padding: '16px 28px 20px', background: 'var(--arken-paper)', borderTop: `1px solid ${C.line}` }}>
              <div style={{ fontSize: 12.5, color: C.textSoft, lineHeight: 1.7 }}>
                <b style={{ color: C.navy }}>Leitura do mês.</b> O resultado ficou {dif >= 0 ? 'acima' : 'abaixo'} do orçado
                em <b>{fmt(Math.abs(dif))}</b>.{' '}
                {maior && Math.abs(maior.impacto) > Math.abs(c.efeitoReceita)
                  ? <>A maior divergência veio de <b>{LABEL[maior.linha] ?? maior.linha}</b> ({sinal(maior.impacto, fmt)}), e não da receita.</>
                  : <>A receita foi o principal fator ({sinal(c.efeitoReceita, fmt)}).</>}
                {' '}Cada linha é medida contra a receita realizada, para não contar duas vezes o que o efeito de receita já explicou.
              </div>
            </div>
          </div>
        )
      })()}

      {/* ════ ③ projeção ════ */}
      <div className="card mb-6">
        <Secao num="③" titulo="Receita líquida" sub="realizado e projetado, com a faixa de 95%" />
        <div style={{ marginTop: 18 }}>
          <ResponsiveContainer width="100%" height={310}>
            <ComposedChart data={serie} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
              <defs>
                <linearGradient id="faixaIC" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.blue} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={C.blue} stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 5" stroke={C.line} vertical={false} />
              {inicioProj && <ReferenceArea x1={inicioProj} x2={serie[serie.length - 1]?.mes as string} fill={C.navy} fillOpacity={0.022} />}
              <XAxis dataKey="mes" tick={{ fontSize: 10.5, fill: C.textMuted }} stroke={C.line} tickLine={false} axisLine={{ stroke: C.line }} />
              <YAxis tick={{ fontSize: 10.5, fill: C.textMuted }} stroke={C.line} tickLine={false} axisLine={false} tickFormatter={fmtK} width={54} />
              <Tooltip
                cursor={{ stroke: C.lineStrong, strokeDasharray: '3 3' }}
                contentStyle={{ background: C.navy, border: 'none', borderRadius: 6, fontSize: 12, padding: '10px 14px', boxShadow: '0 8px 24px rgba(10,37,64,0.28)' }}
                labelStyle={{ color: C.yellow, fontWeight: 700, marginBottom: 4 }} itemStyle={{ color: '#fff', padding: '2px 0' }}
                formatter={(v: number, n: string) => {
                  if (n === 'faixaBase' || n === 'faixa') return [null, null] as unknown as [string, string]
                  return [fmt(v), n === 'real' ? 'realizado' : 'projetado']
                }} />
              <Area dataKey="faixaBase" stackId="ic" stroke="none" fill="transparent" isAnimationActive={false} legendType="none" />
              <Area dataKey="faixa" stackId="ic" stroke="none" fill="url(#faixaIC)" isAnimationActive={false} legendType="none" />
              <Line dataKey="real" stroke={C.navy} strokeWidth={2.5} dot={{ r: 3, fill: C.navy, strokeWidth: 0 }} isAnimationActive={false} />
              <Line dataKey="prev" stroke={C.gold} strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 3, fill: C.gold, strokeWidth: 0 }} isAnimationActive={false} />
              <ReferenceLine x={d.base.ultimoFechado} stroke={C.lineStrong}
                label={{ value: 'último fechado', fontSize: 10, fill: C.textMuted, position: 'insideTopRight', offset: 10 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div style={{ display: 'flex', gap: 22, marginTop: 6, fontSize: 11.5, color: C.textMuted, flexWrap: 'wrap' }}>
          <Legenda cor={C.navy} texto="realizado" />
          <Legenda cor={C.gold} texto="projetado" tracejado />
          <Legenda cor={C.blue} texto="intervalo de 95%" area />
        </div>
      </div>

      {/* ════ ④ premissas ════ */}
      <div className="card mb-6" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '22px 28px 0' }}>
          <Secao num="④" titulo="Premissas" sub={`o coeficiente de cada linha, medido nos últimos ${d.params.ancora} meses e editável`} />
        </div>
        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Linha</th>
                <th style={{ textAlign: 'center' }}>Comportamento</th>
                <th style={{ textAlign: 'center' }}>Origem</th>
                <th style={{ textAlign: 'right' }}>Premissa</th>
                <th style={{ textAlign: 'right' }}>Últimos {d.params.ancora}m</th>
                <th style={{ textAlign: 'right' }}>Base inteira</th>
                <th style={{ textAlign: 'right' }}>Faixa no realizado</th>
                <th style={{ width: 34 }}></th>
              </tr>
            </thead>
            <tbody>
              {d.premissas.map(p => {
                const ehPct = p.modo === 'RECEITA'
                const val = edits[p.linha]?.valor ?? (ehPct ? (p.valor * 100).toFixed(1).replace('.', ',') : Math.round(p.valor).toString())
                const f = (v: number) => (ehPct ? pct(v) : fmt(v))
                return (
                  <tr key={p.linha}>
                    <td style={{ fontWeight: 600, color: C.navy, fontSize: 13 }}>{LABEL[p.linha] ?? p.linha}</td>
                    <td style={{ textAlign: 'center' }}>
                      <select className="form-select" style={{ fontSize: 11, padding: '4px 8px', width: 116 }} value={p.modo}
                        onChange={e => setEdits(s => ({ ...s, [p.linha]: { modo: e.target.value as ModoLinha, valor: undefined } }))}>
                        <option value="RECEITA">% da receita</option>
                        <option value="FIXO">valor fixo</option>
                      </select>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`orc-pill orc-pill-${p.origem === 'padrao' ? 'meta' : p.origem}`}
                        title={p.origem === 'padrao' ? 'Premissa de negócio da consultoria, não estimada do histórico'
                          : p.origem === 'editado' ? 'Valor que você digitou' : 'Coeficiente medido no realizado'}>
                        {p.origem === 'padrao' ? 'meta' : p.origem}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <input className="form-input" style={{ width: 84, textAlign: 'right', padding: '5px 8px', fontSize: 12.5, borderColor: p.editado ? C.blue : undefined }}
                          value={val} onChange={e => setEdits(s => ({ ...s, [p.linha]: { ...s[p.linha], valor: e.target.value } }))} />
                        <span style={{ fontSize: 11, color: C.textMuted, width: 18 }}>{ehPct ? '%' : 'R$'}</span>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', fontSize: 12, color: C.textMuted }}>{f(p.valorAncora)}</td>
                    <td style={{ textAlign: 'right', fontSize: 12, color: C.textMuted }}>{f(p.valorPeriodo)}</td>
                    <td style={{ textAlign: 'right', fontSize: 11.5, color: C.textMuted, whiteSpace: 'nowrap' }}>{f(p.min)} – {f(p.max)}</td>
                    <td style={{ textAlign: 'center' }}>
                      {p.editado && (
                        <button className="btn btn-sm" style={{ fontSize: 10, padding: '2px 7px' }} title="Voltar ao valor do modelo"
                          onClick={() => setEdits(s => { const n = { ...s }; delete n[p.linha]; return n })}>↺</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '16px 28px 20px', background: 'var(--arken-paper)', borderTop: `1px solid ${C.line}` }}>
          <div style={{ fontSize: 12, color: C.textSoft, lineHeight: 1.7 }}>
            Linhas com selo <span className="orc-pill orc-pill-meta">meta</span> usam premissa de negócio da consultoria,
            não o coeficiente estimado — hoje o <b>CMV entra a {cmvP ? pct(cmvP.valor) : '70,0%'}</b>, enquanto o realizado
            mede {cmvP ? pct(cmvP.valorAncora) : '—'} nos últimos {d.params.ancora} meses e {cmvP ? pct(cmvP.valorPeriodo) : '—'} na base
            inteira. As colunas de medição ficam ao lado justamente para a distância entre a meta e o realizado não sumir.
            O <b>comportamento</b> também vem de premissa econômica, e não de teste estatístico: com {nReal} meses de base a
            classificação automática chegava a apontar o CMV como custo fixo, e a regressão dava imposto caindo quando a
            receita sobe. Linhas não operacionais ficam fora do resultado.
          </div>
        </div>
      </div>

      {/* ════ ⑤ orçamento ════ */}
      <div className="card mb-6" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '22px 28px 0' }}>
          <Secao num="⑤" titulo="Orçamento mês a mês" sub="receita prevista · resultado em cenário" />
        </div>
        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Mês</th>
                <th style={{ textAlign: 'right' }}>Receita líquida</th>
                <th style={{ textAlign: 'right' }}>Intervalo de 95%</th>
                <th style={{ textAlign: 'right' }}>CMV</th>
                <th style={{ textAlign: 'right' }}>Despesas</th>
                <th style={{ textAlign: 'right' }}>Resultado</th>
                <th style={{ textAlign: 'right' }}>Margem</th>
              </tr>
            </thead>
            <tbody>
              {d.meses.map(m => (
                <tr key={m.mes} className={m.fragil ? 'orc-fragil' : undefined}>
                  <td style={{ fontWeight: 600, color: C.navy, whiteSpace: 'nowrap' }}>
                    {m.mes}
                    {m.fragil && (
                      <span className="orc-pill orc-pill-alerta" style={{ marginLeft: 8 }}
                        title="Amplitude acima de ±40% — a faixa é mais larga que a informação">frágil</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(m.receita.p)}</td>
                  <td style={{ textAlign: 'right', fontSize: 11.5, color: C.textMuted, whiteSpace: 'nowrap' }}>
                    {fmtK(m.receita.lo)} – {fmtK(m.receita.hi)}
                    <span style={{ color: m.fragil ? C.amber : C.textMuted, marginLeft: 6 }}>±{pct(m.amplitude, 0)}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {fmt(m.cmv)}
                    <span style={{ fontSize: 11, color: C.textMuted, marginLeft: 6 }}>{pct(m.cmv / m.receita.p, 0)}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>{fmt(m.despesas)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: m.resultado >= 0 ? C.green : C.red }}>{fmt(m.resultado)}</td>
                  <td style={{ textAlign: 'right', fontSize: 12, color: m.resultado >= 0 ? C.green : C.red }}>{pct(m.resultado / m.receita.p)}</td>
                </tr>
              ))}
              <tr className="orc-total">
                <td style={{ color: C.navy }}>Acumulado</td>
                <td style={{ textAlign: 'right' }}>{fmt(d.totais.receita)}</td>
                <td></td>
                <td style={{ textAlign: 'right' }}>
                  {fmt(d.totais.cmv)}
                  <span style={{ fontWeight: 400, fontSize: 11, color: C.textMuted, marginLeft: 6 }}>{pct(d.totais.cmv / d.totais.receita, 0)}</span>
                </td>
                <td style={{ textAlign: 'right' }}>{fmt(d.totais.despesas)}</td>
                <td style={{ textAlign: 'right', color: d.totais.resultado >= 0 ? C.green : C.red }}>{fmt(d.totais.resultado)}</td>
                <td style={{ textAlign: 'right', color: d.totais.resultado >= 0 ? C.green : C.red }}>{pct(d.totais.resultado / d.totais.receita)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div style={{ padding: '16px 28px 20px', background: 'var(--arken-paper)', borderTop: `1px solid ${C.line}` }}>
          <div style={{ fontSize: 12, color: C.textSoft, lineHeight: 1.7 }}>
            Meses marcados como <span className="orc-pill orc-pill-alerta">frágil</span> têm intervalo acima de ±40%: a faixa
            fica mais larga que a informação. A incerteza cresce ao longo do horizonte porque a DRE tem apenas {nReal} meses
            fechados — importar o <b>CashFlow Analítico de 2025</b> levaria a base a cerca de 20 meses e estreitaria a faixa
            de forma relevante.
          </div>
        </div>
      </div>

      {/* ════ ⑥ validação ════ */}
      <div className="card">
        <Secao num="⑥" titulo="Validação do modelo" sub="backtest de origem móvel — cada mês previsto só com o que existia antes dele" />
        <div className="orc-tiles" style={{ marginTop: 18 }}>
          <Tile rotulo="Erro médio da receita" valor={pct(d.metricas.mapeReceita)}
            cor={d.metricas.mapeReceita <= 0.1 ? C.green : C.amber} nota="um mês à frente" />
          <Tile rotulo="Cobertura do IC 95%" valor={d.metricas.coberturaIC}
            cor={C.green} nota="realizado dentro da faixa" />
          <Tile rotulo="Erro médio do resultado" valor={pct(d.metricas.mapeResultado, 0)}
            cor={C.red} nota="por isso é cenário, não previsão" />
          <Tile rotulo="Meses testados" valor={String(d.metricas.nTestes)} nota={`base de ${nReal} meses fechados`} />
        </div>

        <div className="table-wrap" style={{ marginTop: 18 }}>
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Mês previsto</th>
                <th style={{ textAlign: 'right' }}>Treino</th>
                <th style={{ textAlign: 'right' }}>Previsto</th>
                <th style={{ textAlign: 'right' }}>Realizado</th>
                <th style={{ textAlign: 'right' }}>Erro</th>
                <th style={{ textAlign: 'center' }}>IC 95%</th>
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
                    {sinal(b.erro, x => pct(x))}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <span className={`orc-pill ${b.dentroIC ? 'orc-pill-ok' : 'orc-pill-alerta'}`}>{b.dentroIC ? 'dentro' : 'fora'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="orc-nota">
          <b style={{ color: C.navy }}>Receita</b> erra {pct(d.metricas.mapeReceita)} em média a um mês, com o realizado dentro
          do intervalo em {d.metricas.coberturaIC} dos testes. <b style={{ color: C.navy }}>Resultado</b> erra {pct(d.metricas.mapeResultado, 0)},
          e não é defeito do modelo: o resultado operacional é uma diferença pequena entre números grandes — o CMV consome
          cerca de {cmvP ? pct(cmvP.valor) : '70%'} da receita líquida, então um erro de 1 ponto no CMV vale mais que o
          resultado de um mês inteiro. É por isso que o resultado aparece como cenário e as premissas ficam editáveis.
        </div>
      </div>
    </>
  )
}

/* ── peças ── */
function Kpi({ rotulo, valor, nota, cor }: { rotulo: string; valor: string; nota?: string; cor?: string }) {
  return (
    <div>
      <div className="orc-kpi-label">{rotulo}</div>
      <div className="orc-kpi-value" style={{ color: cor ?? '#fff' }}>{valor}</div>
      {nota && <div className="orc-kpi-note">{nota}</div>}
    </div>
  )
}
function Tile({ rotulo, valor, nota, cor }: { rotulo: string; valor: string; nota?: string; cor?: string }) {
  return (
    <div className="orc-tile">
      <div className="orc-tile-label">{rotulo}</div>
      <div className="orc-tile-value" style={{ color: cor ?? C.navy }}>{valor}</div>
      {nota && <div className="orc-tile-note">{nota}</div>}
    </div>
  )
}
function Secao({ num, titulo, sub }: { num: string; titulo: string; sub: string }) {
  return (
    <div>
      <div className="orc-secao">
        <span className="orc-secao-num">{num}</span>
        <div>
          <div className="orc-secao-tit">{titulo}</div>
          <div className="orc-secao-sub">{sub}</div>
        </div>
      </div>
    </div>
  )
}
function Campo({ rotulo, ajuda, children }: { rotulo: string; ajuda: string; children: React.ReactNode }) {
  return (
    <div title={ajuda}>
      <div className="orc-tile-label" style={{ marginBottom: 6 }}>{rotulo}</div>
      {children}
    </div>
  )
}
/** Barra divergente: positivo cresce para a direita do eixo, negativo para a esquerda. */
function Barra({ valor, max }: { valor: number; max: number }) {
  const frac = Math.min(1, Math.abs(valor) / max)
  const positivo = valor >= 0
  return (
    <div className="orc-barra">
      <div className="orc-barra-eixo" />
      <div className="orc-barra-fill" style={{
        background: positivo ? C.green : C.red,
        opacity: 0.75,
        left: positivo ? '50%' : `${50 - frac * 50}%`,
        width: `${frac * 50}%`,
      }} />
    </div>
  )
}
function Legenda({ cor, texto, tracejado, area }: { cor: string; texto: string; tracejado?: boolean; area?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
      <span style={{
        width: 18, height: area ? 9 : 0,
        borderTop: area ? 'none' : `2.5px ${tracejado ? 'dashed' : 'solid'} ${cor}`,
        background: area ? cor : 'none', opacity: area ? 0.2 : 1, borderRadius: area ? 2 : 0,
      }} />
      {texto}
    </span>
  )
}
