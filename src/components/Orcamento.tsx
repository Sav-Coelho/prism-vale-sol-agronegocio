'use client'
/**
 * Orçamento — sub-aba da DRE.
 *
 * RECEITA é previsão estatística com intervalo de 95%; CUSTO e DESPESA são
 * PREMISSAS editáveis; EBITDA e LUCRO LÍQUIDO são consequência das duas, com
 * as MESMAS fórmulas e os MESMOS nomes da aba de DRE — um mês fechado mostra
 * aqui exatamente o número que a DRE mostra.
 *
 * Arredondamento: toda tabela FECHA. Os valores-folha são arredondados ao
 * real e os subtotais são derivados deles, então a soma das linhas é sempre
 * o total exibido, na horizontal e na vertical. No check-up, o resíduo de
 * arredondamento vai para a maior parcela, como em demonstração publicada.
 */
import { useEffect, useMemo, useState } from 'react'
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea } from 'recharts'

const C = {
  navy: '#0a2540', navyMid: '#142c4e', navyLight: '#1e3a5f',
  yellow: '#f5c518', gold: '#d4a017', line: '#e3e7ed', lineStrong: '#c8d1dc',
  textSoft: '#4a5670', textMuted: '#7a869a',
  green: '#197a4a', red: '#b03022', amber: '#c98a14', blue: '#2f5a96',
}
// ── formatação pt-BR: vírgula decimal SEMPRE ──
const dec = (n: number, d: number) => n.toFixed(d).replace('.', ',')
const fmt = (n: number) => (n < 0 ? '−' : '') + 'R$ ' + Math.abs(Math.round(n)).toLocaleString('pt-BR')
const fmtK = (n: number) => {
  const a = Math.abs(n)
  return (n < 0 ? '−' : '') + (a >= 1e6 ? `${dec(a / 1e6, 1)}M` : a >= 1e3 ? `${Math.round(a / 1e3)}k` : String(Math.round(a)))
}
const pct = (n: number, d = 1) => `${n < 0 ? '−' : ''}${dec(Math.abs(n) * 100, d)}%`
const sinal = (n: number, f: (x: number) => string) => (n > 0 ? '+' : n < 0 ? '−' : '') + f(Math.abs(n))

/**
 * Lê o que a pessoa digitou. Percentual (70,5 ou 70.5): ponto e vírgula são
 * decimais — ninguém escreve milhar em % da receita. Valor em reais
 * (109.025 ou 109.025,50): o ponto é milhar, como a própria tela exibe.
 */
function paraNumero(texto: string, modo: ModoLinha): number | null {
  const t = texto.trim().replace(/\s|R\$|%/g, '')
  if (!t) return null
  const normal = modo === 'RECEITA' ? t.replace(',', '.') : t.replace(/\./g, '').replace(',', '.')
  const n = Number(normal)
  return Number.isFinite(n) ? n : null
}

/** Arredonda cada parcela e põe o resíduo na maior, para a soma fechar com o total exibido. */
function fecharSoma(valores: number[], totalExibido: number): number[] {
  const r = valores.map(v => Math.round(v))
  const resid = totalExibido - r.reduce((s, v) => s + v, 0)
  if (resid !== 0 && r.length) {
    let i = 0
    valores.forEach((v, j) => { if (Math.abs(v) > Math.abs(valores[i])) i = j })
    r[i] += resid
  }
  return r
}

type ModoLinha = 'RECEITA' | 'FIXO'
type GrupoLinha = 'CMV' | 'OPERACIONAL' | 'ABAIXO'
interface Subtotais { receita: number; cmv: number; despesasOperacionais: number; ebitda: number; abaixoEbitda: number; lucroLiquido: number }
interface Premissa { linha: string; grupo: GrupoLinha; sinal: 1 | -1; modo: ModoLinha; valor: number; origem: 'padrao' | 'medido' | 'editado'; valorAncora: number; valorPeriodo: number; min: number; max: number; desvio: number; editado: boolean }
interface MesOrcado extends Subtotais { mes: string; ic: { lo: number; hi: number }; amplitude: number; fragil: boolean; linhas: Record<string, number> }
interface BacktestPonto { mes: string; nTreino: number; previsto: number; real: number; erro: number; lo: number; hi: number; dentroIC: boolean; lucroPrevisto: number; lucroReal: number }
interface CheckupLinha { linha: string; grupo: GrupoLinha; sinal: 1 | -1; modo: ModoLinha; premissa: number; realizado: number; previstoRS: number; realizadoRS: number; impacto: number }
interface Checkup {
  mes: string; nTreino: number
  receita: { previsto: number; realizado: number; lo: number; hi: number; dentroIC: boolean }
  efeitoReceita: { ateEbitda: number; abaixo: number }
  linhas: CheckupLinha[]
  ebitda: { previsto: number; realizado: number }
  lucroLiquido: { previsto: number; realizado: number; diferenca: number }
  residuo: number; residuoEbitda: number
}
interface Orc {
  hasData: boolean; motivo?: string
  base: { mesesRealizados: string[]; ultimoFechado: string; serieLonga: { n: number; de: string; ate: string }; descartados: { mes: string; lancamentos: number }[]; corteDensidade: number }
  historico: ({ mes: string } & Subtotais)[]
  params: { ancora: number; phi: number; horizonte: number; crescimento: number | null }
  tendencia: { mensalEstimada: number; mensalUsada: number; phi: number; fonte: string }
  sazonalidade: { mes: number; fator: number; obs: number; fragil: boolean }[]
  premissas: Premissa[]
  backtest: BacktestPonto[]
  checkups: Checkup[]
  metricas: { mapeReceita: number; mapeLucro: number; coberturaIC: string; nTestes: number; tCritico: number; grausLiberdade: number }
  meses: MesOrcado[]
  totais: Subtotais
}

// mesmos rótulos da aba de DRE
const LABEL: Record<string, string> = {
  CMV: 'CMV — mercadoria', IMPOSTOS: 'Impostos sobre venda', COM: 'Comercial e comissões',
  PESSOAL: 'Pessoal', ADM: 'Administrativas', LOG: 'Logística', FIN: 'Financeiras',
  INVEST: 'Investimentos (CAPEX)', NAOOP: 'Reembolsos recebidos (não operacional)', SOCIO: 'Retirada de sócio',
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
    const cr = paraNumero(crescimento, 'RECEITA')
    if (cr != null) p.set('crescimento', String(cr))
    Object.entries(edits).forEach(([L, e]) => {
      // a unidade do que foi digitado é a do modo que a tela mostra naquela linha
      const modo = e.modo ?? d?.premissas.find(x => x.linha === L)?.modo ?? 'FIXO'
      if (e.modo) p.set('m.' + L, e.modo)
      const n = e.valor != null ? paraNumero(e.valor, modo) : null
      if (n != null) p.set('p.' + L, String(n))
    })
    return p.toString()
  }, [ancora, phi, horizonte, crescimento, edits, d])

  useEffect(() => {
    let vivo = true
    setLoading(true)
    fetch('/api/dre/orcamento?' + qs).then(r => r.json()).then(j => { if (vivo) { setD(j); setLoading(false) } })
      .catch(() => { if (vivo) setLoading(false) })
    return () => { vivo = false }
  }, [qs])

  // ── tabela do orçamento, fechada: folhas arredondadas, subtotais derivados ──
  const tabela = useMemo(() => {
    if (!d?.hasData) return null
    const linhas = d.meses.map(m => {
      const receita = Math.round(m.receita), cmv = Math.round(m.cmv)
      const despOp = Math.round(m.despesasOperacionais), abaixo = Math.round(m.abaixoEbitda)
      const ebitda = receita - cmv - despOp
      return { m, receita, cmv, despOp, ebitda, abaixo, ll: ebitda - abaixo }
    })
    const soma = (c: 'receita' | 'cmv' | 'despOp' | 'ebitda' | 'abaixo' | 'll') => linhas.reduce((s, l) => s + l[c], 0)
    return { linhas, tot: { receita: soma('receita'), cmv: soma('cmv'), despOp: soma('despOp'), ebitda: soma('ebitda'), abaixo: soma('abaixo'), ll: soma('ll') } }
  }, [d])

  const serie = useMemo(() => {
    if (!d?.hasData) return []
    const hist: Record<string, unknown>[] = d.historico.map(h => ({ mes: h.mes, real: h.receita }))
    const proj = d.meses.map(m => ({ mes: m.mes, prev: m.receita, faixaBase: m.ic.lo, faixa: m.ic.hi - m.ic.lo }))
    const ult = d.historico[d.historico.length - 1]
    if (ult && hist.length) { hist[hist.length - 1].prev = ult.receita; hist[hist.length - 1].faixaBase = ult.receita; hist[hist.length - 1].faixa = 0 }
    return [...hist, ...proj]
  }, [d])

  if (loading && !d) {
    return <div className="empty-state"><div className="empty-state-icon">◌</div><div className="empty-state-title">Calculando o modelo…</div></div>
  }
  if (!d?.hasData || !tabela) {
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
  const [dentro, testes] = d.metricas.coberturaIC.split('/').map(Number)
  const confiavel = d.metricas.mapeReceita <= 0.1 && dentro === testes && testes > 0
  const cmvP = d.premissas.find(p => p.linha === 'CMV')
  const naoOp = d.premissas.find(p => p.linha === 'NAOOP')
  const inicioProj = d.meses[0]?.mes
  const T = tabela.tot
  // quanto vale 1 ponto de CMV, na receita média realizada — base de texto que precisa ser verdade
  const recMedia = d.historico.reduce((s, h) => s + h.receita, 0) / Math.max(1, d.historico.length)
  const umPontoCmv = recMedia * 0.01

  return (
    <>
      {/* ════ cabeçalho executivo ════ */}
      <div className="orc-hero mb-6">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24, flexWrap: 'wrap', position: 'relative' }}>
          <div style={{ flex: 1, minWidth: 320 }}>
            <div className="orc-hero-eyebrow">Projeção econométrica · intervalo de 95%</div>
            <h2 className="orc-hero-title">Orçamento {inicioProj} — {d.meses[d.meses.length - 1]?.mes}</h2>
            <p className="orc-hero-sub">
              A receita é previsão estatística; custo e despesa são premissas que você edita; EBITDA e lucro líquido
              são a consequência das duas, com as mesmas fórmulas da aba de DRE. Sazonalidade e tendência vêm da série
              de vendas de {d.base.serieLonga.n} meses, e o nível, dos {nReal} meses de DRE fechada até {d.base.ultimoFechado}.
            </p>
          </div>
          <span className={`orc-pill ${confiavel ? 'orc-pill-ok' : 'orc-pill-alerta'}`} style={{ fontSize: 10, padding: '5px 12px' }}>
            {confiavel ? 'modelo validado' : 'atenção ao erro'}
          </span>
        </div>

        <div className="orc-kpis">
          <Kpi rotulo="Receita líquida projetada" valor={fmt(T.receita)} nota={`${d.meses.length} meses`} />
          <Kpi rotulo="CMV" valor={fmt(T.cmv)} nota={`${pct(T.cmv / T.receita)} da receita líquida`} />
          <Kpi rotulo="EBITDA" valor={fmt(T.ebitda)} cor={T.ebitda >= 0 ? '#7ce3a8' : '#ff9c8f'} nota={`${pct(T.ebitda / T.receita)} de margem`} />
          <Kpi rotulo="Lucro líquido gerencial" valor={fmt(T.ll)} cor={T.ll >= 0 ? '#7ce3a8' : '#ff9c8f'} nota={`cenário · ${pct(T.ll / T.receita)} de margem`} />
          <Kpi rotulo="Erro da previsão de receita" valor={pct(d.metricas.mapeReceita)}
            cor={d.metricas.mapeReceita <= 0.1 ? '#7ce3a8' : C.yellow} nota={`${d.metricas.coberturaIC} dentro do IC 95%`} />
        </div>
      </div>

      {d.base.descartados.length > 0 && (
        <div className="card mb-6 card-accent-gold" style={{ padding: '16px 22px' }}>
          <div style={{ fontSize: 12.5, color: C.textSoft, lineHeight: 1.7 }}>
            <b style={{ color: C.gold }}>Fora do treino:</b>{' '}
            {d.base.descartados.map(x => `${x.mes} (${x.lancamentos} lançamentos)`).join(', ')}. O import do CashFlow traz
            títulos futuros, a receber e a pagar, então esses meses já aparecem na base sem estarem realizados — um mês
            fechado tem o razão inteiro, acima de {d.base.corteDensidade.toLocaleString('pt-BR')} lançamentos.
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
              {[1, 0.95, 0.9, 0.85, 0.8, 0.7, 0.5].map(n => <option key={n} value={n}>{dec(n, 2)}</option>)}
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
                placeholder={dec(d.tendencia.mensalEstimada * 100, 2)}
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
          amortecida por φ&nbsp;=&nbsp;{dec(d.tendencia.phi, 2)}. Intervalo com t de Student de {d.metricas.grausLiberdade} graus
          de liberdade (t&nbsp;=&nbsp;{dec(d.metricas.tCritico, 3)}).
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
      {d.checkups.length > 0 && <CheckupCard d={d} mesCheckup={mesCheckup} setMesCheckup={setMesCheckup} />}

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
              <Tooltip cursor={{ stroke: C.lineStrong, strokeDasharray: '3 3' }} content={<DicaGrafico />} />
              {/* a faixa não entra no tooltip: é desenho, não dado */}
              <Area dataKey="faixaBase" stackId="ic" stroke="none" fill="transparent" isAnimationActive={false} tooltipType="none" legendType="none" />
              <Area dataKey="faixa" stackId="ic" stroke="none" fill="url(#faixaIC)" isAnimationActive={false} tooltipType="none" legendType="none" />
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
                <th style={{ textAlign: 'left' }}>Linha da DRE</th>
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
                const val = edits[p.linha]?.valor ?? (ehPct ? dec(p.valor * 100, 1) : Math.round(p.valor).toLocaleString('pt-BR'))
                const f = (v: number) => (ehPct ? pct(v) : fmt(v))
                return (
                  <tr key={p.linha}>
                    <td>
                      <div style={{ fontWeight: 600, color: C.navy, fontSize: 13 }}>{LABEL[p.linha] ?? p.linha}</div>
                      <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 2 }}>
                        {p.grupo === 'ABAIXO' ? 'abaixo do EBITDA' : 'até o EBITDA'} · {p.sinal > 0 ? 'soma ao lucro' : 'reduz o lucro'}
                      </div>
                    </td>
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
                        <input className="form-input" style={{ width: 92, textAlign: 'right', padding: '5px 8px', fontSize: 12.5, borderColor: p.editado ? C.blue : undefined }}
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
            não o coeficiente estimado — hoje o <b>CMV entra a {cmvP ? pct(cmvP.valor) : '—'}</b>, enquanto o realizado
            mede {cmvP ? pct(cmvP.valorAncora) : '—'} nos últimos {d.params.ancora} meses e {cmvP ? pct(cmvP.valorPeriodo) : '—'} na base
            inteira. As colunas de medição ficam ao lado justamente para a distância entre a meta e o realizado não sumir.
            {naoOp && (
              <> Os <b>reembolsos recebidos</b> somam ao lucro, como na DRE, e entram a {fmt(naoOp.valor)} por mês — mas variaram de {fmt(naoOp.min)} a {fmt(naoOp.max)} no
              realizado. Para um orçamento conservador, zere esta linha: o EBITDA não depende dela.</>
            )}
            {' '}O <b>comportamento</b> vem de premissa econômica, e não de teste estatístico: com {nReal} meses de base a
            classificação automática chegava a apontar o CMV como custo fixo.
          </div>
        </div>
      </div>

      {/* ════ ⑤ orçamento ════ */}
      <div className="card mb-6" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '22px 28px 0' }}>
          <Secao num="⑤" titulo="Orçamento mês a mês" sub="receita prevista · EBITDA e lucro líquido em cenário" />
        </div>
        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Mês</th>
                <th style={{ textAlign: 'right' }}>Receita líquida</th>
                <th style={{ textAlign: 'right' }}>Intervalo de 95%</th>
                <th style={{ textAlign: 'right' }}>CMV</th>
                <th style={{ textAlign: 'right' }}>Despesas oper.</th>
                <th style={{ textAlign: 'right' }}>EBITDA</th>
                <th style={{ textAlign: 'right' }}>Lucro líquido</th>
                <th style={{ textAlign: 'right' }}>Margem líq.</th>
              </tr>
            </thead>
            <tbody>
              {tabela.linhas.map(({ m, receita, cmv, despOp, ebitda, ll }) => (
                <tr key={m.mes} className={m.fragil ? 'orc-fragil' : undefined}>
                  <td style={{ fontWeight: 600, color: C.navy, whiteSpace: 'nowrap' }}>
                    {m.mes}
                    {m.fragil && (
                      <span className="orc-pill orc-pill-alerta" style={{ marginLeft: 8 }}
                        title="Amplitude acima de ±40% — a faixa é mais larga que a informação">frágil</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(receita)}</td>
                  <td style={{ textAlign: 'right', fontSize: 11.5, color: C.textMuted, whiteSpace: 'nowrap' }}>
                    {fmtK(m.ic.lo)} – {fmtK(m.ic.hi)}
                    <span style={{ color: m.fragil ? C.amber : C.textMuted, marginLeft: 6 }}>±{dec(m.amplitude * 100, 0)}%</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {fmt(cmv)}
                    <span style={{ fontSize: 11, color: C.textMuted, marginLeft: 6 }}>{pct(cmv / receita, 0)}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>{fmt(despOp)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600, color: ebitda >= 0 ? C.navy : C.red }}>{fmt(ebitda)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: ll >= 0 ? C.green : C.red }}>{fmt(ll)}</td>
                  <td style={{ textAlign: 'right', fontSize: 12, color: ll >= 0 ? C.green : C.red }}>{pct(ll / receita)}</td>
                </tr>
              ))}
              <tr className="orc-total">
                <td style={{ color: C.navy }}>Acumulado</td>
                <td style={{ textAlign: 'right' }}>{fmt(T.receita)}</td>
                <td></td>
                <td style={{ textAlign: 'right' }}>
                  {fmt(T.cmv)}
                  <span style={{ fontWeight: 400, fontSize: 11, color: C.textMuted, marginLeft: 6 }}>{pct(T.cmv / T.receita, 0)}</span>
                </td>
                <td style={{ textAlign: 'right' }}>{fmt(T.despOp)}</td>
                <td style={{ textAlign: 'right', color: T.ebitda >= 0 ? C.navy : C.red }}>{fmt(T.ebitda)}</td>
                <td style={{ textAlign: 'right', color: T.ll >= 0 ? C.green : C.red }}>{fmt(T.ll)}</td>
                <td style={{ textAlign: 'right', color: T.ll >= 0 ? C.green : C.red }}>{pct(T.ll / T.receita)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div style={{ padding: '16px 28px 20px', background: 'var(--arken-paper)', borderTop: `1px solid ${C.line}` }}>
          <div style={{ fontSize: 12, color: C.textSoft, lineHeight: 1.7 }}>
            <b>Receita líquida − CMV − Despesas operacionais = EBITDA</b> em toda linha, e a diferença entre EBITDA e lucro
            líquido são financeiras, retirada de sócio, investimentos e reembolsos recebidos ({fmt(T.ebitda - T.ll)} no
            acumulado). Valores arredondados ao real, com os subtotais derivados dos valores exibidos — as colunas fecham.
            Meses marcados como <span className="orc-pill orc-pill-alerta">frágil</span> têm intervalo acima de ±40%: a faixa
            fica mais larga que a informação. Importar o <b>CashFlow Analítico de 2025</b> levaria a base a cerca de 20 meses
            e estreitaria a faixa de forma relevante.
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
            cor={dentro === testes ? C.green : C.amber} nota="realizado dentro da faixa" />
          <Tile rotulo="Erro médio do lucro líquido" valor={pct(d.metricas.mapeLucro, 0)}
            cor={C.red} nota="por isso é cenário, não previsão" />
          <Tile rotulo="Meses testados" valor={String(d.metricas.nTestes)} nota={`base de ${nReal} meses fechados`} />
        </div>

        <div className="table-wrap" style={{ marginTop: 18 }}>
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Mês previsto</th>
                <th style={{ textAlign: 'right' }}>Treino</th>
                <th style={{ textAlign: 'right' }}>Receita prevista</th>
                <th style={{ textAlign: 'right' }}>Receita realizada</th>
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
          <b style={{ color: C.navy }}>Erro</b> = (previsto − realizado) ÷ realizado; positivo significa que o modelo previu acima.
          A <b style={{ color: C.navy }}>receita</b> erra {pct(d.metricas.mapeReceita)} em média a um mês, com o realizado dentro do
          intervalo em {d.metricas.coberturaIC} dos testes. O <b style={{ color: C.navy }}>lucro líquido</b> erra {pct(d.metricas.mapeLucro, 0)},
          e não é defeito do modelo: o lucro é uma diferença pequena entre números grandes. O CMV realizado consome
          {' '}{cmvP ? pct(cmvP.valorPeriodo) : '—'} da receita líquida, então cada ponto de erro no CMV vale cerca de {fmt(umPontoCmv)} por
          mês — e os reembolsos recebidos, que variaram de {naoOp ? fmt(naoOp.min) : '—'} a {naoOp ? fmt(naoOp.max) : '—'}, sozinhos
          mexem mais no lucro do que qualquer premissa de custo. Por isso o lucro aparece como cenário e as premissas ficam editáveis.
        </div>
      </div>
    </>
  )
}

/* ── check-up ── */
function CheckupCard({ d, mesCheckup, setMesCheckup }: { d: Orc; mesCheckup: string; setMesCheckup: (m: string) => void }) {
  const c = d.checkups.find(x => x.mes === mesCheckup) ?? d.checkups[0]
  // números exibidos nos tiles, e a diferença calculada A PARTIR deles
  const llPrev = Math.round(c.lucroLiquido.previsto), llReal = Math.round(c.lucroLiquido.realizado)
  const difExibida = llReal - llPrev
  const recVsPrev = c.receita.previsto !== 0 ? (c.receita.realizado - c.receita.previsto) / c.receita.previsto : 0

  const ate = c.linhas.filter(l => l.grupo !== 'ABAIXO').sort((a, b) => Math.abs(b.impacto) - Math.abs(a.impacto))
  const abaixo = c.linhas.filter(l => l.grupo === 'ABAIXO').sort((a, b) => Math.abs(b.impacto) - Math.abs(a.impacto))
  const temEfAbaixo = Math.abs(c.efeitoReceita.abaixo) >= 0.5
  // folhas na ordem da tabela, fechadas contra a diferença exibida
  const folhas = [c.efeitoReceita.ateEbitda, ...ate.map(l => l.impacto), ...(temEfAbaixo ? [c.efeitoReceita.abaixo] : []), ...abaixo.map(l => l.impacto)]
  const fechadas = fecharSoma(folhas, difExibida)
  let i = 0
  const efRecAte = fechadas[i++]
  const impAte = ate.map(() => fechadas[i++])
  const efRecAbaixo = temEfAbaixo ? fechadas[i++] : 0
  const impAbaixo = abaixo.map(() => fechadas[i++])
  const dEbitda = efRecAte + impAte.reduce((s, v) => s + v, 0)
  const maxImp = Math.max(1, ...folhas.map(Math.abs))

  // maior divergência, entre todas as parcelas
  const parcelas = [
    { nome: 'Receita líquida', v: efRecAte + efRecAbaixo },
    ...ate.map((l, j) => ({ nome: LABEL[l.linha] ?? l.linha, v: impAte[j] })),
    ...abaixo.map((l, j) => ({ nome: LABEL[l.linha] ?? l.linha, v: impAbaixo[j] })),
  ].sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
  const maior = parcelas[0]

  const linhaTabela = (l: CheckupLinha, impacto: number) => {
    const ehPct = l.modo === 'RECEITA'
    const dif = l.realizado - l.premissa
    return (
      <tr key={l.linha}>
        <td style={{ paddingLeft: 28 }}>
          <div style={{ fontWeight: 600, color: C.navy, fontSize: 13 }}>{LABEL[l.linha] ?? l.linha}</div>
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
            {ehPct ? `${pct(l.realizado)} da receita realizada` : `${l.sinal > 0 ? 'entrou' : 'saiu'} ${fmt(l.realizadoRS)} no mês`}
          </div>
        </td>
        <td style={{ textAlign: 'right' }}>{ehPct ? pct(l.premissa) : fmt(l.premissa)}</td>
        <td style={{ textAlign: 'right', fontWeight: 600 }}>{ehPct ? pct(l.realizado) : fmt(l.realizado)}</td>
        <td style={{ textAlign: 'right', color: impacto >= 0 ? C.green : C.amber }}>
          {ehPct ? `${sinal(dif, x => dec(x * 100, 1))} pts` : sinal(dif, fmt)}
        </td>
        <td><Barra valor={impacto} max={maxImp} /></td>
        <td style={{ textAlign: 'right', fontWeight: 700, color: impacto >= 0 ? C.green : C.red }}>{sinal(impacto, fmt)}</td>
      </tr>
    )
  }
  const subtotal = (rotulo: string, v: number, nota: string) => (
    <tr className="orc-total">
      <td colSpan={4} style={{ color: C.navy }}>
        {rotulo}
        <span style={{ fontWeight: 400, fontSize: 11, color: C.textMuted, marginLeft: 8 }}>{nota}</span>
      </td>
      <td></td>
      <td style={{ textAlign: 'right', color: v >= 0 ? C.green : C.red }}>{sinal(v, fmt)}</td>
    </tr>
  )

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
            nota={`${sinal(recVsPrev, x => pct(x))} sobre o previsto`} />
          <Tile rotulo="Intervalo de 95%" valor={`${fmtK(c.receita.lo)} – ${fmtK(c.receita.hi)}`}
            cor={c.receita.dentroIC ? C.green : C.red} nota={c.receita.dentroIC ? 'realizado dentro da faixa' : 'realizado FORA da faixa'} />
          <Tile rotulo="Lucro líquido previsto" valor={fmt(llPrev)} />
          <Tile rotulo="Lucro líquido realizado" valor={fmt(llReal)}
            cor={llReal >= 0 ? C.green : C.red} nota={`${sinal(difExibida, fmt)} contra o orçado`} />
        </div>

        <p style={{ fontSize: 12, color: C.textSoft, lineHeight: 1.7, margin: '16px 0 0' }}>
          A previsão é reconstruída com <b>origem travada antes de {c.mes}</b> — o modelo só enxerga os {c.nTreino} meses
          anteriores. Sem isso ele treinaria com o próprio mês e acertaria por construção. O lucro realizado é o mesmo da aba de DRE.
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
              <th style={{ width: 150 }}>Impacto no lucro</th>
              <th style={{ textAlign: 'right' }}>R$</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <div style={{ fontWeight: 700, color: C.navy }}>Receita líquida</div>
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
                  efeito volume · {c.receita.dentroIC ? 'dentro do intervalo, variação normal' : 'fora do intervalo, o modelo errou'}
                </div>
              </td>
              <td style={{ textAlign: 'right' }}>{fmt(c.receita.previsto)}</td>
              <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(c.receita.realizado)}</td>
              <td style={{ textAlign: 'right', color: c.receita.realizado >= c.receita.previsto ? C.green : C.amber }}>
                {sinal(Math.round(c.receita.realizado) - Math.round(c.receita.previsto), fmt)}
              </td>
              <td><Barra valor={efRecAte} max={maxImp} /></td>
              <td style={{ textAlign: 'right', fontWeight: 700, color: efRecAte >= 0 ? C.green : C.red }}>{sinal(efRecAte, fmt)}</td>
            </tr>
            {ate.map((l, j) => linhaTabela(l, impAte[j]))}
            {subtotal('Variação do EBITDA', dEbitda, 'receita, CMV e despesas operacionais')}
            {temEfAbaixo && (
              <tr>
                <td style={{ paddingLeft: 28 }}><div style={{ fontWeight: 600, color: C.navy, fontSize: 13 }}>Efeito receita nas linhas abaixo</div></td>
                <td colSpan={3}></td>
                <td><Barra valor={efRecAbaixo} max={maxImp} /></td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: efRecAbaixo >= 0 ? C.green : C.red }}>{sinal(efRecAbaixo, fmt)}</td>
              </tr>
            )}
            {abaixo.map((l, j) => linhaTabela(l, impAbaixo[j]))}
            {subtotal('Variação do lucro líquido', difExibida,
              Math.abs(c.residuo) > 0.01 ? `resíduo de ${fmt(c.residuo)} — conferir` : 'fecha com a diferença dos cartões acima')}
          </tbody>
        </table>
      </div>

      <div style={{ padding: '16px 28px 20px', background: 'var(--arken-paper)', borderTop: `1px solid ${C.line}` }}>
        <div style={{ fontSize: 12.5, color: C.textSoft, lineHeight: 1.7 }}>
          <b style={{ color: C.navy }}>Leitura do mês.</b> O lucro líquido ficou {difExibida >= 0 ? 'acima' : 'abaixo'} do orçado
          em <b>{fmt(Math.abs(difExibida))}</b>. A maior divergência foi <b>{maior.nome}</b> ({sinal(maior.v, fmt)}).
          {' '}Cada linha variável é medida contra a receita realizada, para não contar duas vezes o que o efeito volume já explicou.
          Valores arredondados ao real; a maior parcela absorve o arredondamento, para a soma fechar.
        </div>
      </div>
    </div>
  )
}

/**
 * Tooltip do gráfico. O mês de emenda (último fechado) carrega também o valor
 * da linha projetada, só para o traço não começar solto — o tooltip padrão o
 * rotulava de "projetado", como se o modelo tivesse acertado o mês na mosca.
 * Aqui mês realizado mostra só o realizado; mês projetado mostra projeção e IC.
 */
function DicaGrafico({ active, payload, label }: { active?: boolean; payload?: Array<{ payload: Record<string, number | undefined> }>; label?: string }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  const caixa: React.CSSProperties = { background: C.navy, borderRadius: 6, fontSize: 12, padding: '10px 14px', color: '#fff', boxShadow: '0 8px 24px rgba(10,37,64,0.28)' }
  return (
    <div style={caixa}>
      <div style={{ color: C.yellow, fontWeight: 700, marginBottom: 4 }}>{label}</div>
      {p.real != null ? (
        <div>realizado: <b>{fmt(p.real)}</b></div>
      ) : p.prev != null ? (
        <>
          <div>projetado: <b>{fmt(p.prev)}</b></div>
          {p.faixa != null && p.faixaBase != null && (
            <div style={{ color: '#b8c6d8', marginTop: 2 }}>IC 95%: {fmt(p.faixaBase)} – {fmt(p.faixaBase + p.faixa)}</div>
          )}
        </>
      ) : null}
    </div>
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
    <div className="orc-secao">
      <span className="orc-secao-num">{num}</span>
      <div>
        <div className="orc-secao-tit">{titulo}</div>
        <div className="orc-secao-sub">{sub}</div>
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
        background: positivo ? C.green : C.red, opacity: 0.75,
        left: positivo ? '50%' : `${50 - frac * 50}%`, width: `${frac * 50}%`,
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
