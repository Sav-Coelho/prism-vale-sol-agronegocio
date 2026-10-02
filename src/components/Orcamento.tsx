'use client'
/**
 * Orçamento — sub-aba da DRE.
 *
 * RECEITA é previsão estatística com intervalo de 95%; CUSTO e DESPESA são
 * PREMISSAS editáveis; EBITDA e LUCRO LÍQUIDO são consequência das duas, com
 * as MESMAS fórmulas e os MESMOS nomes da aba de DRE.
 *
 * O centro da aba é a DRE PROJETADA: linha a linha, mês a mês, com os últimos
 * meses fechados ao lado como referência. Toda célula de premissa é editável
 * NO MÊS — o 13º de nov/dez, uma contratação, um investimento pontual, a
 * alíquota nova da reforma — e o orçamento fica GRAVADO (tabela
 * OrcamentoCenario): quem abrir a aba vê a mesma versão. Exporta em Excel e PDF.
 *
 * Arredondamento: na DRE projetada cada célula é o valor exato arredondado ao
 * real, como na aba DRE (uma soma pode diferir do total em R$ 1). No check-up,
 * que decompõe uma diferença, as parcelas fecham com o total e o resíduo de
 * arredondamento vai para a maior, como em demonstração publicada.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea } from 'recharts'
import { LINE_LABEL } from '@/lib/dre-classifier'

const C = {
  navy: '#0a2540', navyMid: '#142c4e', navyLight: '#1e3a5f',
  yellow: '#f5c518', gold: '#d4a017', line: '#e3e7ed', lineStrong: '#c8d1dc',
  textSoft: '#4a5670', textMuted: '#7a869a',
  green: '#197a4a', red: '#b03022', amber: '#c98a14', blue: '#2f5a96',
}
// ── formatação pt-BR: vírgula decimal SEMPRE ──
const dec = (n: number, d: number) => n.toFixed(d).replace('.', ',')
const fmt = (n: number) => (n < 0 ? '−' : '') + 'R$ ' + Math.abs(Math.round(n)).toLocaleString('pt-BR')
const fmtNum = (n: number) => (n < 0 ? '−' : '') + Math.abs(Math.round(n)).toLocaleString('pt-BR')
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
interface MesOrcado extends Subtotais {
  mes: string; ym: string
  receitaPrevista: number; receitaEditada: boolean
  receitaBruta: number; deducoes: number; deducaoPct: number
  ic: { lo: number; hi: number }; amplitude: number; fragil: boolean
  linhas: Record<string, number>; ajustados: string[]
}
interface MesRealizado extends Subtotais { mes: string; ym: string; receitaBruta: number; deducoes: number; linhas: Record<string, number> }
interface PremissaDeducao { valor: number; origem: 'medido' | 'editado'; valorAncora: number; valorPeriodo: number; min: number; max: number; editado: boolean }
type AjustesMes = Record<string, Record<string, number>>
/** o orçamento gravado — mesmas unidades da lib: fração para %, R$ para valor fixo */
interface Cenario {
  ancora?: number; phi?: number; horizonte?: number; crescimento?: number | null
  premissas?: Record<string, { modo?: ModoLinha; valor?: number }>
  ajustesMes?: AjustesMes
  receitaMes?: Record<string, number>
  desafio?: number
}
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
  hasData: boolean; motivo?: string; error?: string
  base: { mesesRealizados: string[]; ultimoFechado: string; serieLonga: { n: number; de: string; ate: string }; descartados: { mes: string; lancamentos: number }[]; corteDensidade: number }
  historico: MesRealizado[]
  params: { ancora: number; phi: number; horizonte: number; crescimento: number | null }
  tendencia: { mensalEstimada: number; mensalUsada: number; phi: number; fonte: string }
  sazonalidade: { mes: number; fator: number; obs: number; fragil: boolean }[]
  premissas: Premissa[]
  deducao: PremissaDeducao
  backtest: BacktestPonto[]
  checkups: Checkup[]
  metricas: { mapeReceita: number; mapeLucro: number; coberturaIC: string; nTestes: number; tCritico: number; grausLiberdade: number }
  meses: MesOrcado[]
  totais: Subtotais & { receitaBruta: number; deducoes: number }
  cenario?: Cenario
  salvoEm?: string | null
  aviso?: string | null
}

// rótulos curtos (premissas e check-up)
const LABEL: Record<string, string> = {
  DEDUCAO: 'Deduções sobre venda',
  CMV: 'CMV — mercadoria', IMPOSTOS: 'Impostos sobre venda', COM: 'Comercial e comissões',
  PESSOAL: 'Pessoal', ADM: 'Administrativas', LOG: 'Logística', FIN: 'Financeiras',
  INVEST: 'Investimentos (CAPEX)', NAOOP: 'Reembolsos recebidos (não operacional)', SOCIO: 'Retirada de sócio',
}
const MES_NOME = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const DESAFIO_PADRAO = 0.05

// ── DRE projetada: as mesmas linhas, na mesma ordem e com os mesmos nomes da aba DRE ──
interface LinhaGrade { key: string; label: string; tipo: 'linha' | 'subtotal' | 'margem'; sinal?: 1 | -1; destaque?: boolean }
const GRADE: LinhaGrade[] = [
  { key: 'BRUTA', label: 'Receita Operacional Bruta (recebimentos)', tipo: 'linha', sinal: 1 },
  { key: 'DEDUCAO', label: 'Deduções sobre Venda', tipo: 'linha', sinal: -1 },
  { key: 'RECLIQ', label: 'Receita Líquida', tipo: 'subtotal' },
  { key: 'CMV', label: LINE_LABEL.CMV, tipo: 'linha', sinal: -1 },
  { key: 'MC', label: 'Margem de Contribuição', tipo: 'subtotal' },
  { key: 'ADM', label: LINE_LABEL.ADM, tipo: 'linha', sinal: -1 },
  { key: 'PESSOAL', label: LINE_LABEL.PESSOAL, tipo: 'linha', sinal: -1 },
  { key: 'LOG', label: LINE_LABEL.LOG, tipo: 'linha', sinal: -1 },
  { key: 'COM', label: LINE_LABEL.COM, tipo: 'linha', sinal: -1 },
  { key: 'LUCROOP', label: 'Lucro Operacional', tipo: 'subtotal' },
  { key: 'IMPOSTOS', label: LINE_LABEL.IMPOSTOS, tipo: 'linha', sinal: -1 },
  { key: 'EBITDA', label: 'EBITDA', tipo: 'subtotal', destaque: true },
  { key: 'FIN', label: LINE_LABEL.FIN, tipo: 'linha', sinal: -1 },
  { key: 'SOCIO', label: 'Retirada de Sócio', tipo: 'linha', sinal: -1 },
  { key: 'INVEST', label: 'Investimentos (CAPEX)', tipo: 'linha', sinal: -1 },
  { key: 'NAOOP', label: 'Resultado Não-Operacional', tipo: 'linha', sinal: 1 },
  { key: 'LL', label: 'Lucro Líquido Gerencial', tipo: 'subtotal', destaque: true },
  { key: 'MARGEM', label: 'Margem líquida', tipo: 'margem' },
]
const LINHAS_CUSTO = ['CMV', 'ADM', 'PESSOAL', 'LOG', 'COM', 'IMPOSTOS', 'FIN', 'SOCIO', 'INVEST', 'NAOOP']

interface Coluna { ym: string; mes: string; real: boolean; fragil: boolean; v: Record<string, number>; ajustados: string[]; receitaEditada: boolean; m?: MesOrcado }
/**
 * Valores EXATOS de um mês — o arredondamento é só na exibição. Cada célula é o
 * valor verdadeiro arredondado, como na aba DRE (o mês realizado mostra aqui o
 * mesmo número de lá); arredondar as folhas antes de somar fazia o total do
 * horizonte andar alguns reais longe do valor real.
 */
function valoresDe(bruta: number, liquida: number, L: Record<string, number>): Record<string, number> {
  const v: Record<string, number> = { BRUTA: bruta, DEDUCAO: bruta - liquida, RECLIQ: liquida }
  LINHAS_CUSTO.forEach(k => { v[k] = L[k] ?? 0 })
  v.MC = v.RECLIQ - v.CMV
  v.LUCROOP = v.MC - v.ADM - v.PESSOAL - v.LOG - v.COM
  v.EBITDA = v.LUCROOP - v.IMPOSTOS
  v.LL = v.EBITDA - v.FIN - v.SOCIO - v.INVEST + v.NAOOP
  return v
}
function montarGrade(d: Orc, nReferencia = 3) {
  const refs: Coluna[] = d.historico.slice(-nReferencia).map(h => ({
    ym: h.ym, mes: h.mes, real: true, fragil: false,
    v: valoresDe(h.receitaBruta, h.receita, h.linhas), ajustados: [], receitaEditada: false,
  }))
  const proj: Coluna[] = d.meses.map(m => ({
    ym: m.ym, mes: m.mes, real: false, fragil: m.fragil,
    v: valoresDe(m.receitaBruta, m.receita, m.linhas), ajustados: m.ajustados, receitaEditada: m.receitaEditada, m,
  }))
  const total: Record<string, number> = {}
  GRADE.forEach(l => { if (l.tipo !== 'margem') total[l.key] = proj.reduce((s, c) => s + c.v[l.key], 0) })
  return { refs, proj, total }
}
type Grade = ReturnType<typeof montarGrade>
/** como a célula aparece: custo com sinal de menos, como na aba DRE */
const exibido = (l: LinhaGrade, v: Record<string, number>) =>
  l.tipo === 'margem' ? (v.RECLIQ ? v.LL / v.RECLIQ : 0) : l.tipo === 'linha' && l.sinal === -1 ? -v[l.key] : v[l.key]

// ── edição: em que unidade cada linha é editada ──
type Unidade = 'pctBruta' | 'pct' | 'rs' | 'receita'
function unidadeDe(key: string, d: Orc): Unidade | null {
  if (key === 'DEDUCAO') return 'pctBruta'
  if (key === 'RECLIQ') return 'receita'
  const p = d.premissas.find(x => x.linha === key)
  if (!p) return null
  return p.modo === 'RECEITA' ? 'pct' : 'rs'
}
const ehPct = (u: Unidade | null) => u === 'pct' || u === 'pctBruta'
/** valor que o editor abre, na unidade da linha */
function textoAtual(key: string, m: MesOrcado, d: Orc): string {
  const u = unidadeDe(key, d)
  if (u === 'pctBruta') return dec(m.deducaoPct * 100, 2)
  if (u === 'receita') return Math.round(m.receita).toLocaleString('pt-BR')
  if (u === 'pct') return dec(m.receita ? (m.linhas[key] ?? 0) / m.receita * 100 : 0, 2)
  return Math.round(m.linhas[key] ?? 0).toLocaleString('pt-BR')
}
/** o que a célula valeria sem o ajuste do mês */
function textoPadrao(key: string, m: MesOrcado, d: Orc): string {
  const u = unidadeDe(key, d)
  if (u === 'pctBruta') return `${pct(d.deducao.valor, 2)} da receita bruta`
  if (u === 'receita') return `${fmt(m.receitaPrevista)} (previsão do modelo)`
  const p = d.premissas.find(x => x.linha === key)
  if (!p) return '—'
  return u === 'pct' ? `${pct(p.valor)} da receita líquida` : `${fmt(p.valor)} por mês`
}
const contarAjustes = (c: Cenario) =>
  Object.values(c.ajustesMes ?? {}).reduce((s, m) => s + Object.keys(m).length, 0) + Object.keys(c.receitaMes ?? {}).length
const clonar = (c: Cenario): Cenario => JSON.parse(JSON.stringify(c ?? {}))
function limparVazios(c: Cenario): Cenario {
  if (c.ajustesMes) {
    Object.keys(c.ajustesMes).forEach(L => { if (!Object.keys(c.ajustesMes![L]).length) delete c.ajustesMes![L] })
    if (!Object.keys(c.ajustesMes).length) delete c.ajustesMes
  }
  if (c.receitaMes && !Object.keys(c.receitaMes).length) delete c.receitaMes
  if (c.premissas && !Object.keys(c.premissas).length) delete c.premissas
  return c
}
/** grava o que foi digitado nos meses `yms`; texto vazio devolve o mês ao padrão */
function aplicarEdicao(c: Cenario, key: string, yms: string[], texto: string, d: Orc): Cenario | string {
  const u = unidadeDe(key, d)
  if (!u) return 'Linha não editável'
  const novo = clonar(c)
  if (texto.trim() === '') {
    yms.forEach(ym => {
      if (u === 'receita') { if (novo.receitaMes) delete novo.receitaMes[ym] }
      else if (novo.ajustesMes?.[key]) delete novo.ajustesMes[key][ym]
    })
    return limparVazios(novo)
  }
  const n = paraNumero(texto, ehPct(u) ? 'RECEITA' : 'FIXO')
  if (n == null || n < 0) return 'Digite um número positivo.'
  if (ehPct(u) && n >= 100) return 'O percentual precisa ficar abaixo de 100%.'
  const valor = ehPct(u) ? n / 100 : n
  yms.forEach(ym => {
    if (u === 'receita') novo.receitaMes = { ...(novo.receitaMes ?? {}), [ym]: valor }
    else {
      const aj = { ...(novo.ajustesMes ?? {}) }
      aj[key] = { ...(aj[key] ?? {}), [ym]: valor }
      novo.ajustesMes = aj
    }
  })
  return novo
}

export function Orcamento() {
  const [d, setD] = useState<Orc | null>(null)
  const [cenario, setCenario] = useState<Cenario>({})
  const [loading, setLoading] = useState(true)
  const [estado, setEstado] = useState<'ok' | 'salvando' | 'erro'>('ok')
  const [erro, setErro] = useState('')
  const [mesCheckup, setMesCheckup] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pedido = useRef(0)

  useEffect(() => {
    let vivo = true
    fetch('/api/dre/orcamento').then(r => r.json()).then((j: Orc) => {
      if (!vivo) return
      setD(j); setCenario(j.cenario ?? {}); setLoading(false)
    }).catch(() => { if (vivo) { setLoading(false); setEstado('erro'); setErro('Não foi possível carregar o orçamento.') } })
    return () => { vivo = false }
  }, [])

  /** muda o cenário na tela e grava (com folga de 400 ms para juntar edições) */
  const gravar = (novo: Cenario) => {
    setCenario(novo)
    setEstado('salvando'); setErro('')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      const id = ++pedido.current
      try {
        const r = await fetch('/api/dre/orcamento', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cenario: novo }),
        })
        const j = await r.json() as Orc
        if (id !== pedido.current) return            // chegou uma edição mais nova
        if (!r.ok || j.error) { setEstado('erro'); setErro(j.error ?? 'Falha ao salvar.'); return }
        setD(j); setEstado('ok')
      } catch {
        if (id === pedido.current) { setEstado('erro'); setErro('Sem conexão — a alteração não foi salva.') }
      }
    }, 400)
  }

  const grade = useMemo(() => (d?.hasData ? montarGrade(d) : null), [d])
  const serie = useMemo(() => {
    if (!d?.hasData) return []
    const hist: Record<string, unknown>[] = d.historico.map(h => ({ mes: h.mes, real: h.receita }))
    const proj = d.meses.map(m => ({
      mes: m.mes, prev: m.receitaPrevista, faixaBase: m.ic.lo, faixa: m.ic.hi - m.ic.lo,
      ...(m.receitaEditada ? { cen: m.receita } : {}),
    }))
    const ult = d.historico[d.historico.length - 1]
    if (ult && hist.length) { hist[hist.length - 1].prev = ult.receita; hist[hist.length - 1].faixaBase = ult.receita; hist[hist.length - 1].faixa = 0 }
    return [...hist, ...proj]
  }, [d])

  if (loading && !d) {
    return <div className="empty-state"><div className="empty-state-icon">◌</div><div className="empty-state-title">Calculando o modelo…</div></div>
  }
  if (!d?.hasData || !grade) {
    return (
      <div className="card">
        <div className="empty-state">
          <div className="empty-state-icon">◎</div>
          <div className="empty-state-title">Orçamento indisponível</div>
          <div className="empty-state-sub">{d?.motivo || erro || 'Sem base suficiente.'}</div>
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
  const fimProj = d.meses[d.meses.length - 1]?.mes
  const T = grade.total
  const recMedia = d.historico.reduce((s, h) => s + h.receita, 0) / Math.max(1, d.historico.length)
  const umPontoCmv = recMedia * 0.01
  const algumCenarioReceita = d.meses.some(m => m.receitaEditada)

  return (
    <>
      {/* ════ cabeçalho executivo ════ */}
      <div className="orc-hero mb-6">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24, flexWrap: 'wrap', position: 'relative' }}>
          <div style={{ flex: 1, minWidth: 320 }}>
            <div className="orc-hero-eyebrow">Projeção econométrica · intervalo de 95%</div>
            <h2 className="orc-hero-title">Orçamento {inicioProj} — {fimProj}</h2>
            <p className="orc-hero-sub">
              A receita é previsão estatística; custo e despesa são premissas que você edita, na linha ou mês a mês; EBITDA e
              lucro líquido são a consequência das duas, com as mesmas fórmulas da aba de DRE. Sazonalidade e tendência vêm da
              série de vendas de {d.base.serieLonga.n} meses, e o nível, dos {nReal} meses de DRE fechada até {d.base.ultimoFechado}.
            </p>
          </div>
          <span className={`orc-pill ${confiavel ? 'orc-pill-ok' : 'orc-pill-alerta'}`} style={{ fontSize: 10, padding: '5px 12px' }}>
            {confiavel ? 'modelo validado' : 'atenção ao erro'}
          </span>
        </div>

        <div className="orc-kpis">
          <Kpi rotulo="Receita líquida projetada" valor={fmt(T.RECLIQ)} nota={`${d.meses.length} meses${algumCenarioReceita ? ' · com cenário' : ''}`} />
          <Kpi rotulo="CMV" valor={fmt(T.CMV)} nota={`${pct(T.CMV / T.RECLIQ)} da receita líquida`} />
          <Kpi rotulo="EBITDA" valor={fmt(T.EBITDA)} cor={T.EBITDA >= 0 ? '#7ce3a8' : '#ff9c8f'} nota={`${pct(T.EBITDA / T.RECLIQ)} de margem`} />
          <Kpi rotulo="Lucro líquido gerencial" valor={fmt(T.LL)} cor={T.LL >= 0 ? '#7ce3a8' : '#ff9c8f'} nota={`cenário · ${pct(T.LL / T.RECLIQ)} de margem`} />
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

      {/* ════ ① DRE projetada ════ */}
      <DreProjetada d={d} grade={grade} cenario={cenario} gravar={gravar} estado={estado} erro={erro} />

      {/* ════ ② premissas ════ */}
      <TabelaPremissas d={d} cenario={cenario} gravar={gravar} />

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
              {algumCenarioReceita && <Line dataKey="cen" stroke="none" dot={{ r: 5, fill: C.blue, strokeWidth: 0 }} isAnimationActive={false} />}
              <ReferenceLine x={d.base.ultimoFechado} stroke={C.lineStrong}
                label={{ value: 'último fechado', fontSize: 10, fill: C.textMuted, position: 'insideTopRight', offset: 10 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div style={{ display: 'flex', gap: 22, marginTop: 6, fontSize: 11.5, color: C.textMuted, flexWrap: 'wrap' }}>
          <Legenda cor={C.navy} texto="realizado" />
          <Legenda cor={C.gold} texto="projetado (modelo)" tracejado />
          <Legenda cor={C.blue} texto="intervalo de 95%" area />
          {algumCenarioReceita && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><span style={{ width: 9, height: 9, borderRadius: 5, background: C.blue }} />receita de cenário (editada)</span>}
        </div>
      </div>

      {/* ════ ④ check-up ════ */}
      {d.checkups.length > 0 && <CheckupCard d={d} mesCheckup={mesCheckup} setMesCheckup={setMesCheckup} />}

      {/* ════ ⑤ validação ════ */}
      <div className="card mb-6">
        <Secao num="⑤" titulo="Validação do modelo" sub="backtest de origem móvel — cada mês previsto só com o que existia antes dele" />
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

      {/* ════ ⑥ parâmetros do modelo ════ */}
      <ParametrosModelo d={d} cenario={cenario} gravar={gravar} />

      {/* documento de impressão — invisível na tela, sai no PDF */}
      <OrcamentoPrint d={d} grade={grade} cenario={cenario} />
    </>
  )
}

/* ── ① DRE projetada, editável mês a mês ── */
function DreProjetada({ d, grade, cenario, gravar, estado, erro }: {
  d: Orc; grade: Grade; cenario: Cenario; gravar: (c: Cenario) => void; estado: 'ok' | 'salvando' | 'erro'; erro: string
}) {
  const [av, setAv] = useState(false)
  const [edit, setEdit] = useState<{ key: string; ym: string; texto: string; msg?: string } | null>(null)
  const entrada = useRef<HTMLInputElement>(null)
  // foca ao abrir; com a barra já aberta o foco já está no campo, então refocar é inócuo
  useEffect(() => { if (edit) entrada.current?.focus() }, [edit])

  const desafio = cenario.desafio ?? DESAFIO_PADRAO
  const nAjustes = contarAjustes(cenario)
  const colunas = [...grade.refs, ...grade.proj]
  const mesEdit = edit ? d.meses.find(m => m.ym === edit.ym) : undefined
  const linhaEdit = edit ? GRADE.find(l => l.key === edit.key) : undefined
  const uEdit = edit ? unidadeDe(edit.key, d) : null

  const abrir = (key: string, m: MesOrcado) => setEdit({ key, ym: m.ym, texto: textoAtual(key, m, d) })
  const confirmar = (escopo: 'mes' | 'adiante' | 'padrao') => {
    if (!edit) return
    const yms = escopo === 'adiante' ? d.meses.filter(m => m.ym >= edit.ym).map(m => m.ym) : [edit.ym]
    const r = aplicarEdicao(cenario, edit.key, yms, escopo === 'padrao' ? '' : edit.texto, d)
    if (typeof r === 'string') { setEdit({ ...edit, msg: r }); return }
    gravar(r); setEdit(null)
  }
  const salvoEm = d.salvoEm ? new Date(d.salvoEm) : null

  return (
    <div className="card mb-6" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '22px 28px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <Secao num="①" titulo="DRE projetada" sub={`mês a mês, com os ${grade.refs.length} últimos meses fechados ao lado · clique numa célula para ajustar o mês`} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: estado === 'erro' ? C.red : C.textMuted, marginRight: 4 }}>
            {estado === 'salvando' ? 'Salvando…' : estado === 'erro' ? erro : salvoEm
              ? `Salvo ${salvoEm.toLocaleDateString('pt-BR')} às ${salvoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
              : 'Padrão do modelo (nada editado)'}
          </span>
          <div style={{ display: 'inline-flex', border: `1px solid ${C.line}`, borderRadius: 4, overflow: 'hidden' }}>
            <button className="btn btn-sm" style={{ border: 'none', borderRadius: 0, background: !av ? C.navy : '#fff', color: !av ? '#fff' : C.textSoft }} onClick={() => setAv(false)}>R$</button>
            <button className="btn btn-sm" style={{ border: 'none', borderRadius: 0, background: av ? C.navy : '#fff', color: av ? '#fff' : C.textSoft }} onClick={() => setAv(true)}>AV %</button>
          </div>
          <button className="btn btn-sm" onClick={() => exportarExcel(d, grade, cenario)} title="Planilha com a DRE projetada, as premissas e os ajustes">⬇ Excel</button>
          <button className="btn btn-sm" style={{ background: C.gold, color: '#fff', border: 'none', fontWeight: 600 }}
            onClick={() => imprimir(`Orçamento Vale Sol ${d.meses[0]?.mes ?? ''} a ${d.meses[d.meses.length - 1]?.mes ?? ''}`)}>⬇ PDF</button>
          {nAjustes > 0 && (
            <button className="btn btn-sm" title="Remove todos os ajustes mês a mês (as premissas de linha ficam)"
              onClick={() => { if (confirm(`Remover os ${nAjustes} ajustes mês a mês? As premissas de cada linha continuam como estão.`)) { const c = clonar(cenario); delete c.ajustesMes; delete c.receitaMes; gravar(c) } }}>
              ↺ Limpar ajustes ({nAjustes})
            </button>
          )}
        </div>
      </div>

      {/* barra de edição: aparece ao clicar numa célula editável */}
      {edit && mesEdit && linhaEdit && (
        <div style={{ margin: '0 28px 14px', padding: '12px 16px', border: `1px solid ${C.blue}`, borderRadius: 6, background: '#f2f6fc', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 12.5, color: C.navy, minWidth: 220 }}>
            <b>{linhaEdit.key === 'RECLIQ' ? 'Receita líquida (cenário)' : linhaEdit.label}</b> · {mesEdit.mes}
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
              padrão: {textoPadrao(edit.key, mesEdit, d)}{edit.key === 'PESSOAL' && (mesEdit.ym.endsWith('-11') || mesEdit.ym.endsWith('-12')) ? ' · lembre do 13º' : ''}
            </div>
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            {!ehPct(uEdit) && <span style={{ fontSize: 12, color: C.textMuted }}>R$</span>}
            <input ref={entrada} className="form-input" style={{ width: 130, textAlign: 'right' }} value={edit.texto}
              onChange={e => setEdit({ ...edit, texto: e.target.value, msg: undefined })}
              onKeyDown={e => { if (e.key === 'Enter') confirmar(e.shiftKey ? 'adiante' : 'mes'); if (e.key === 'Escape') setEdit(null) }} />
            {ehPct(uEdit) && <span style={{ fontSize: 12, color: C.textMuted }}>{uEdit === 'pctBruta' ? '% da bruta' : '% da líquida'}</span>}
          </div>
          <button className="btn btn-sm btn-primary" onClick={() => confirmar('mes')} title="Enter">Só {mesEdit.mes}</button>
          <button className="btn btn-sm" onClick={() => confirmar('adiante')} title="Shift+Enter">De {mesEdit.mes} em diante</button>
          <button className="btn btn-sm" onClick={() => confirmar('padrao')} title="Tira o ajuste deste mês">↺ Padrão</button>
          <button className="btn btn-sm" onClick={() => setEdit(null)} title="Esc">Cancelar</button>
          {edit.msg && <span style={{ fontSize: 12, color: C.red }}>{edit.msg}</span>}
        </div>
      )}

      <div className="table-wrap" style={{ opacity: estado === 'salvando' ? 0.7 : 1, transition: 'opacity .2s' }}>
        <table style={{ minWidth: '100%' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', minWidth: 230 }}>Linha</th>
              {colunas.map(c => (
                <th key={c.ym} style={{ textAlign: 'right', whiteSpace: 'nowrap', background: c.real ? C.navyLight : undefined }}
                  title={c.real ? 'realizado' : c.fragil ? 'intervalo acima de ±40% — previsão frágil' : 'projetado'}>
                  {c.mes}
                  <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.04em', color: c.real ? '#b8c6d8' : c.fragil ? C.yellow : '#b8c6d8' }}>
                    {c.real ? 'realizado' : c.fragil ? 'frágil' : 'projeção'}
                  </div>
                </th>
              ))}
              <th style={{ textAlign: 'right', background: C.navyMid, whiteSpace: 'nowrap' }}>Total<div style={{ fontSize: 9, color: '#b8c6d8' }}>projetado</div></th>
            </tr>
          </thead>
          <tbody>
            {GRADE.map(l => {
              const sub = l.tipo !== 'linha', big = !!l.destaque
              const fundo = big ? C.navy : sub ? '#eef2f8' : undefined
              const corTexto = big ? '#fff' : C.navy
              const celula = (c: { v: Record<string, number> }, extra?: React.CSSProperties) => {
                const val = exibido(l, c.v)
                const txt = l.tipo === 'margem' ? pct(val) : av ? pct(c.v.RECLIQ ? val / c.v.RECLIQ : 0) : fmtNum(val)
                return { txt, cor: big ? C.yellow : sub ? (val >= 0 ? C.green : C.red) : extra?.color ?? (val < 0 ? C.red : C.navy) }
              }
              return (
                <Fragment key={l.key}>
                  <tr style={{ background: fundo }}>
                    <td style={{ fontWeight: sub ? 700 : 500, fontSize: big ? 13 : 12.5, color: corTexto, whiteSpace: 'nowrap', background: fundo }}>
                      {sub && l.tipo !== 'margem' ? '(=) ' : ''}{l.label}
                    </td>
                    {colunas.map(c => {
                      const editavel = !c.real && !!c.m && l.tipo !== 'margem' && unidadeDe(l.key, d) != null
                      const ajustado = !c.real && (l.key === 'RECLIQ' ? c.receitaEditada : c.ajustados.includes(l.key))
                      const ativo = edit?.key === l.key && edit?.ym === c.ym
                      const { txt, cor } = celula(c)
                      return (
                        <td key={c.ym}
                          onClick={editavel ? () => abrir(l.key, c.m as MesOrcado) : undefined}
                          title={editavel ? (ajustado ? `ajustado neste mês — padrão: ${textoPadrao(l.key, c.m as MesOrcado, d)}` : 'clique para ajustar este mês') : undefined}
                          style={{
                            textAlign: 'right', fontSize: 12, whiteSpace: 'nowrap',
                            fontWeight: sub ? 600 : ajustado ? 700 : 400,
                            color: ajustado && !big ? C.blue : cor,
                            background: c.real ? (big ? C.navyLight : sub ? '#e6ebf3' : '#f7f8fa') : fundo,
                            cursor: editavel ? 'pointer' : undefined,
                            outline: ativo ? `2px solid ${C.blue}` : undefined, outlineOffset: -2,
                            borderBottom: editavel ? `1px dashed ${C.lineStrong}` : undefined,
                          }}>
                          {ajustado && <span style={{ fontSize: 8, marginRight: 4, verticalAlign: 'middle' }}>●</span>}{txt}
                        </td>
                      )
                    })}
                    <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', background: big ? C.navyMid : '#e2e9f3', color: big ? C.yellow : C.navy }}>
                      {l.tipo === 'margem' ? pct(grade.total.RECLIQ ? grade.total.LL / grade.total.RECLIQ : 0)
                        : av ? pct(grade.total.RECLIQ ? exibido(l, grade.total) / grade.total.RECLIQ : 0) : fmtNum(exibido(l, grade.total))}
                    </td>
                  </tr>
                  {l.key === 'RECLIQ' && (
                    <tr>
                      <td style={{ fontSize: 10.5, color: C.textMuted, paddingTop: 2, paddingBottom: 6 }}>intervalo de 95% da previsão</td>
                      {colunas.map(c => (
                        <td key={c.ym} style={{ textAlign: 'right', fontSize: 10.5, color: c.fragil ? C.amber : C.textMuted, whiteSpace: 'nowrap', paddingTop: 2, paddingBottom: 6, background: c.real ? '#f7f8fa' : undefined }}>
                          {c.m ? `${fmtK(c.m.ic.lo)} – ${fmtK(c.m.ic.hi)}` : ''}
                        </td>
                      ))}
                      <td style={{ background: '#e2e9f3' }} />
                    </tr>
                  )}
                </Fragment>
              )
            })}
            {/* meta comercial — pedido da reunião: previsão + desafio como meta mínima de venda */}
            <tr>
              <td colSpan={colunas.length + 2} style={{ background: '#fff8e6', borderTop: `2px solid ${C.gold}`, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700, color: C.gold }}>
                Meta comercial · desafio de{' '}
                <CampoNumero valor={dec(desafio * 100, 1)} largura={52}
                  onCommit={t => { const n = paraNumero(t, 'RECEITA'); if (n == null || n < -50 || n > 100) return false; const c = clonar(cenario); c.desafio = n / 100; gravar(c); return true }} />
                {' '}% sobre a previsão do modelo
              </td>
            </tr>
            {[
              { rot: 'Receita bruta prevista (modelo)', v: (m: MesOrcado) => m.receitaPrevista / (1 - m.deducaoPct) },
              { rot: `Meta de venda bruta (+${dec(desafio * 100, 1)}%)`, v: (m: MesOrcado) => m.receitaPrevista / (1 - m.deducaoPct) * (1 + desafio), forte: true },
              { rot: `Meta de receita líquida (+${dec(desafio * 100, 1)}%)`, v: (m: MesOrcado) => m.receitaPrevista * (1 + desafio) },
            ].map(r => (
              <tr key={r.rot}>
                <td style={{ fontSize: 12, fontWeight: r.forte ? 700 : 500, color: C.navy, whiteSpace: 'nowrap' }}>{r.rot}</td>
                {colunas.map(c => (
                  <td key={c.ym} style={{ textAlign: 'right', fontSize: 12, fontWeight: r.forte ? 700 : 400, color: c.real ? C.textMuted : C.navy, background: c.real ? '#f7f8fa' : undefined }}>
                    {c.m ? fmtNum(r.v(c.m)) : ''}
                  </td>
                ))}
                <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, background: '#e2e9f3', color: C.navy }}>
                  {fmtNum(d.meses.reduce((s, m) => s + r.v(m), 0))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ padding: '14px 28px 18px', background: 'var(--arken-paper)', borderTop: `1px solid ${C.line}`, fontSize: 12, color: C.textSoft, lineHeight: 1.7 }}>
        Células <span style={{ borderBottom: `1px dashed ${C.lineStrong}` }}>sublinhadas</span> são editáveis no mês: CMV, comissões, impostos e
        deduções em % da receita; as demais em R$. Um ajuste vale só para o mês (ou <b>de um mês em diante</b>) e aparece em
        <b style={{ color: C.blue }}> azul ●</b>; o resto segue a premissa da linha, abaixo. A <b>receita líquida</b> é a previsão do
        modelo e também pode virar cenário num mês — o intervalo de 95% continua sendo o da previsão. Cada célula é o valor exato
        arredondado ao real, como na aba DRE: uma soma pode diferir do total em R$ 1 por arredondamento. O orçamento fica salvo e
        vale para todos os usuários.
      </div>
    </div>
  )
}
/* ── ② premissas: o padrão de cada linha, para todos os meses ── */
function TabelaPremissas({ d, cenario, gravar }: { d: Orc; cenario: Cenario; gravar: (c: Cenario) => void }) {
  const cmvP = d.premissas.find(p => p.linha === 'CMV')
  const naoOp = d.premissas.find(p => p.linha === 'NAOOP')
  const nReal = d.base.mesesRealizados.length
  const ajustesDaLinha = (L: string) => Object.keys(cenario.ajustesMes?.[L] ?? {}).length
  const setPremissa = (L: string, e: { modo?: ModoLinha; valor?: number } | null, limparMeses = false) => {
    const c = clonar(cenario)
    const ps = { ...(c.premissas ?? {}) }
    if (e) ps[L] = e; else delete ps[L]
    c.premissas = ps
    if (limparMeses && c.ajustesMes) delete c.ajustesMes[L]
    gravar(limparVazios(c))
  }
  const ded = d.deducao
  return (
    <div className="card mb-6" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '22px 28px 0' }}>
        <Secao num="②" titulo="Premissas" sub={`o padrão de cada linha em todos os meses — medido nos últimos ${d.params.ancora} meses e editável`} />
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
              <th style={{ textAlign: 'center' }}>Ajustes no mês</th>
              <th style={{ width: 34 }}></th>
            </tr>
          </thead>
          <tbody>
            {/* deduções: % da receita BRUTA — de onde sai a receita bruta projetada */}
            <tr>
              <td>
                <div style={{ fontWeight: 600, color: C.navy, fontSize: 13 }}>{LABEL.DEDUCAO}</div>
                <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 2 }}>entre a receita bruta e a líquida</div>
              </td>
              <td style={{ textAlign: 'center', fontSize: 11.5, color: C.textSoft }}>% da receita bruta</td>
              <td style={{ textAlign: 'center' }}><span className={`orc-pill orc-pill-${ded.origem}`}>{ded.origem}</span></td>
              <td style={{ textAlign: 'right' }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <CampoNumero valor={dec(ded.valor * 100, 2)} largura={92} destaque={ded.editado}
                    onCommit={t => { const n = paraNumero(t, 'RECEITA'); if (n == null || n < 0 || n >= 100) return false; setPremissa('DEDUCAO', { valor: n / 100 }); return true }} />
                  <span style={{ fontSize: 11, color: C.textMuted, width: 18 }}>%</span>
                </div>
              </td>
              <td style={{ textAlign: 'right', fontSize: 12, color: C.textMuted }}>{pct(ded.valorAncora, 2)}</td>
              <td style={{ textAlign: 'right', fontSize: 12, color: C.textMuted }}>{pct(ded.valorPeriodo, 2)}</td>
              <td style={{ textAlign: 'right', fontSize: 11.5, color: C.textMuted, whiteSpace: 'nowrap' }}>{pct(ded.min, 2)} – {pct(ded.max, 2)}</td>
              <td style={{ textAlign: 'center', fontSize: 12, color: ajustesDaLinha('DEDUCAO') ? C.blue : C.textMuted }}>{ajustesDaLinha('DEDUCAO') || '—'}</td>
              <td style={{ textAlign: 'center' }}>
                {ded.editado && <button className="btn btn-sm" style={{ fontSize: 10, padding: '2px 7px' }} title="Voltar ao valor medido" onClick={() => setPremissa('DEDUCAO', null)}>↺</button>}
              </td>
            </tr>
            {d.premissas.map(p => {
              const pc = p.modo === 'RECEITA'
              const f = (v: number) => (pc ? pct(v) : fmt(v))
              const nMes = ajustesDaLinha(p.linha)
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
                      onChange={e => {
                        const modo = e.target.value as ModoLinha
                        if (nMes && !confirm(`Trocar o comportamento de "${LABEL[p.linha]}" apaga os ${nMes} ajustes mês a mês desta linha (a unidade muda). Continuar?`)) return
                        setPremissa(p.linha, { modo }, true)
                      }}>
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
                      <CampoNumero valor={pc ? dec(p.valor * 100, 1) : Math.round(p.valor).toLocaleString('pt-BR')} largura={92} destaque={p.editado}
                        onCommit={t => {
                          const n = paraNumero(t, p.modo); if (n == null || n < 0 || (pc && n >= 100)) return false
                          const modoEd = cenario.premissas?.[p.linha]?.modo
                          setPremissa(p.linha, { ...(modoEd ? { modo: modoEd } : {}), valor: pc ? n / 100 : n })
                          return true
                        }} />
                      <span style={{ fontSize: 11, color: C.textMuted, width: 18 }}>{pc ? '%' : 'R$'}</span>
                    </div>
                  </td>
                  <td style={{ textAlign: 'right', fontSize: 12, color: C.textMuted }}>{f(p.valorAncora)}</td>
                  <td style={{ textAlign: 'right', fontSize: 12, color: C.textMuted }}>{f(p.valorPeriodo)}</td>
                  <td style={{ textAlign: 'right', fontSize: 11.5, color: C.textMuted, whiteSpace: 'nowrap' }}>{f(p.min)} – {f(p.max)}</td>
                  <td style={{ textAlign: 'center', fontSize: 12, color: nMes ? C.blue : C.textMuted }}>{nMes || '—'}</td>
                  <td style={{ textAlign: 'center' }}>
                    {(p.editado || cenario.premissas?.[p.linha]?.modo) && (
                      <button className="btn btn-sm" style={{ fontSize: 10, padding: '2px 7px' }} title="Voltar ao valor do modelo"
                        onClick={() => setPremissa(p.linha, null, !!cenario.premissas?.[p.linha]?.modo)}>↺</button>
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
          A premissa vale para <b>todos os meses</b>; o que for diferente num mês específico se ajusta direto na DRE projetada,
          acima, e a coluna <b>Ajustes no mês</b> mostra quantos meses de cada linha estão com valor próprio.
          Linhas com selo <span className="orc-pill orc-pill-meta">meta</span> usam premissa de negócio da consultoria,
          não o coeficiente estimado — hoje o <b>CMV entra a {cmvP ? pct(cmvP.valor) : '—'}</b>, enquanto o realizado
          mede {cmvP ? pct(cmvP.valorAncora) : '—'} nos últimos {d.params.ancora} meses e {cmvP ? pct(cmvP.valorPeriodo) : '—'} na base inteira.
          {naoOp && (
            <> Os <b>reembolsos recebidos</b> somam ao lucro, como na DRE, e entram a {fmt(naoOp.valor)} por mês — mas variaram de {fmt(naoOp.min)} a {fmt(naoOp.max)} no
            realizado. Para um orçamento conservador, zere esta linha: o EBITDA não depende dela.</>
          )}
          {' '}O <b>comportamento</b> vem de premissa econômica, e não de teste estatístico: com {nReal} meses de base a
          classificação automática chegava a apontar o CMV como custo fixo.
        </div>
      </div>
    </div>
  )
}

/* ── ⑥ parâmetros do modelo estatístico (definidos pela consultoria) ── */
function ParametrosModelo({ d, cenario, gravar }: { d: Orc; cenario: Cenario; gravar: (c: Cenario) => void }) {
  const nReal = d.base.mesesRealizados.length
  const set = (campo: 'ancora' | 'phi' | 'horizonte', v: number) => { const c = clonar(cenario); c[campo] = v; gravar(c) }
  const editado = cenario.ancora != null || cenario.phi != null || cenario.horizonte != null || cenario.crescimento != null
  return (
    <div className="card mb-6">
      <Secao num="⑥" titulo="Parâmetros do modelo" sub="definidos pela consultoria — o orçamento responde a cada mudança" />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28, alignItems: 'flex-end', marginTop: 18 }}>
        <Campo rotulo="Âncora do nível" ajuda="Quantos meses recentes definem o nível e os coeficientes. Menos meses = mais reativo, mais ruidoso.">
          <select className="form-select" style={{ width: 118 }} value={d.params.ancora} onChange={e => set('ancora', +e.target.value)}>
            {[1, 2, 3, 4, 6, 8].filter(n => n <= nReal).map(n => <option key={n} value={n}>{n} {n === 1 ? 'mês' : 'meses'}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Amortecimento φ" ajuda="Reduz a tendência a cada mês à frente. Com poucos meses de base, extrapolar reta livre (φ = 1) produz absurdos no fim do horizonte.">
          <select className="form-select" style={{ width: 100 }} value={d.params.phi} onChange={e => set('phi', +e.target.value)}>
            {[1, 0.95, 0.9, 0.85, 0.8, 0.7, 0.5].map(n => <option key={n} value={n}>{dec(n, 2)}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Horizonte" ajuda="Meses projetados a partir do próximo.">
          <select className="form-select" style={{ width: 112 }} value={d.params.horizonte} onChange={e => set('horizonte', +e.target.value)}>
            {[3, 6, 7, 9, 12].map(n => <option key={n} value={n}>{n} meses</option>)}
          </select>
        </Campo>
        <Campo rotulo="Crescimento a.m." ajuda={`Em branco usa o estimado da série longa (${pct(d.tendencia.mensalEstimada, 2)} ao mês). Preencha para impor uma premissa.`}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <CampoNumero valor={d.params.crescimento != null ? dec(d.params.crescimento * 100, 2) : ''} largura={82}
              placeholder={dec(d.tendencia.mensalEstimada * 100, 2)}
              onCommit={t => {
                const c = clonar(cenario)
                if (t.trim() === '') { delete c.crescimento; gravar(c); return true }
                const n = paraNumero(t, 'RECEITA'); if (n == null || n < -50 || n > 50) return false
                c.crescimento = n / 100; gravar(c); return true
              }} />
            <span style={{ fontSize: 12, color: C.textMuted }}>%</span>
          </div>
        </Campo>
        {editado && (
          <button className="btn btn-sm" style={{ marginLeft: 'auto' }}
            onClick={() => { const c = clonar(cenario); delete c.ancora; delete c.phi; delete c.horizonte; delete c.crescimento; gravar(c) }}>
            ↺ Parâmetros padrão
          </button>
        )}
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
  )
}

/** Campo que só grava ao sair (Enter/blur) — digitar "7" a caminho de "70" não dispara cálculo. */
function CampoNumero({ valor, onCommit, largura = 90, destaque, placeholder }: {
  valor: string; onCommit: (texto: string) => boolean; largura?: number; destaque?: boolean; placeholder?: string
}) {
  const [texto, setTexto] = useState(valor)
  const [invalido, setInvalido] = useState(false)
  useEffect(() => { setTexto(valor); setInvalido(false) }, [valor])
  const commit = () => { if (texto === valor) return; const ok = onCommit(texto); setInvalido(!ok); if (!ok) setTexto(valor) }
  return (
    <input className="form-input" value={texto} placeholder={placeholder}
      style={{ width: largura, textAlign: 'right', padding: '5px 8px', fontSize: 12.5, borderColor: invalido ? C.red : destaque ? C.blue : undefined }}
      onChange={e => setTexto(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setTexto(valor); (e.target as HTMLInputElement).blur() } }} />
  )
}

/* ── exportação ── */
function imprimir(titulo: string) {
  const prev = document.title
  document.title = titulo
  const restaurar = () => { document.title = prev; window.removeEventListener('afterprint', restaurar) }
  window.addEventListener('afterprint', restaurar)
  window.print()
}

/** linhas da DRE projetada em matriz — a mesma para o Excel e o PDF */
function matrizDre(d: Orc, grade: Grade, cenario: Cenario) {
  const colunas = [...grade.refs, ...grade.proj]
  const desafio = cenario.desafio ?? DESAFIO_PADRAO
  const cab = ['Linha', ...colunas.map(c => `${c.mes}${c.real ? ' (realizado)' : c.fragil ? ' (frágil)' : ''}`), 'Total projetado']
  const linhas: Array<{ rot: string; vals: (number | null)[]; pct?: boolean; sub?: boolean }> = GRADE.map(l => ({
    rot: (l.tipo === 'subtotal' ? '(=) ' : '') + l.label,
    vals: [...colunas.map(c => exibido(l, c.v)), l.tipo === 'margem' ? (grade.total.RECLIQ ? grade.total.LL / grade.total.RECLIQ : 0) : exibido(l, grade.total)],
    pct: l.tipo === 'margem', sub: l.tipo !== 'linha',
  }))
  const prev = (f: (m: MesOrcado) => number) => [...colunas.map(c => (c.m ? f(c.m) : null)), d.meses.reduce((s, m) => s + f(m), 0)]
  linhas.push({ rot: 'Intervalo de 95% — mínimo (receita líquida)', vals: [...colunas.map(c => (c.m ? c.m.ic.lo : null)), null] })
  linhas.push({ rot: 'Intervalo de 95% — máximo (receita líquida)', vals: [...colunas.map(c => (c.m ? c.m.ic.hi : null)), null] })
  linhas.push({ rot: 'Receita bruta prevista (modelo)', vals: prev(m => m.receitaPrevista / (1 - m.deducaoPct)) })
  linhas.push({ rot: `Meta de venda bruta (+${dec(desafio * 100, 1)}%)`, vals: prev(m => m.receitaPrevista / (1 - m.deducaoPct) * (1 + desafio)), sub: true })
  linhas.push({ rot: `Meta de receita líquida (+${dec(desafio * 100, 1)}%)`, vals: prev(m => m.receitaPrevista * (1 + desafio)) })
  return { cab, linhas }
}
/** ajustes mês a mês em lista legível */
function listaAjustes(d: Orc, cenario: Cenario) {
  const nomeMes = (ym: string) => `${MES_NOME[+ym.slice(5)]}/${ym.slice(2, 4)}`
  const out: Array<{ linha: string; mes: string; valor: string }> = []
  Object.entries(cenario.receitaMes ?? {}).sort().forEach(([ym, v]) => out.push({ linha: 'Receita líquida (cenário)', mes: nomeMes(ym), valor: fmt(v) }))
  Object.entries(cenario.ajustesMes ?? {}).forEach(([L, meses]) => {
    const u = unidadeDe(L, d)
    Object.entries(meses).sort().forEach(([ym, v]) => out.push({
      linha: LABEL[L] ?? L, mes: nomeMes(ym),
      valor: u === 'pctBruta' ? `${pct(v, 2)} da receita bruta` : u === 'pct' ? `${pct(v)} da receita líquida` : fmt(v),
    }))
  })
  return out
}

async function exportarExcel(d: Orc, grade: Grade, cenario: Cenario) {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  const { cab, linhas } = matrizDre(d, grade, cenario)
  const inicio = d.meses[0]?.mes ?? '', fim = d.meses[d.meses.length - 1]?.mes ?? ''
  const agora = new Date()
  const aoa: (string | number | null)[][] = [
    [`Vale Sol Agronegócio — Orçamento ${inicio} a ${fim}`],
    [`DRE projetada · gerado em ${agora.toLocaleDateString('pt-BR')} ${agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · receita = previsão do modelo (IC 95%); custos = premissas; lucro = cenário`],
    [],
    cab,
    ...linhas.map(l => [l.rot, ...l.vals]),
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  linhas.forEach((l, i) => {
    l.vals.forEach((_, j) => {
      const cel = ws[XLSX.utils.encode_cell({ r: 4 + i, c: 1 + j })]
      if (cel && typeof cel.v === 'number') cel.z = l.pct ? '0.0%' : '#,##0;-#,##0'
    })
  })
  ws['!cols'] = [{ wch: 46 }, ...cab.slice(1).map(() => ({ wch: 16 }))]
  XLSX.utils.book_append_sheet(wb, ws, 'DRE projetada')

  const prem: (string | number)[][] = [
    ['Linha', 'Comportamento', 'Origem', 'Premissa', `Últimos ${d.params.ancora} meses`, 'Base inteira', 'Mínimo no realizado', 'Máximo no realizado'],
    [LABEL.DEDUCAO, '% da receita bruta', d.deducao.origem, d.deducao.valor, d.deducao.valorAncora, d.deducao.valorPeriodo, d.deducao.min, d.deducao.max],
    ...d.premissas.map(p => [LABEL[p.linha] ?? p.linha, p.modo === 'RECEITA' ? '% da receita líquida' : 'valor fixo (R$/mês)',
      p.origem === 'padrao' ? 'meta' : p.origem, p.valor, p.valorAncora, p.valorPeriodo, p.min, p.max]),
  ]
  const wp = XLSX.utils.aoa_to_sheet(prem)
  prem.slice(1).forEach((r, i) => {
    const ehP = i === 0 || d.premissas[i - 1]?.modo === 'RECEITA'
    for (let j = 3; j <= 7; j++) { const cel = wp[XLSX.utils.encode_cell({ r: 1 + i, c: j })]; if (cel) cel.z = ehP ? '0.00%' : '#,##0' }
  })
  wp['!cols'] = [{ wch: 40 }, { wch: 22 }, { wch: 10 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 18 }, { wch: 18 }]
  XLSX.utils.book_append_sheet(wb, wp, 'Premissas')

  const aj = listaAjustes(d, cenario)
  const wa = XLSX.utils.aoa_to_sheet([['Linha', 'Mês', 'Valor ajustado'], ...aj.map(a => [a.linha, a.mes, a.valor]), ...(aj.length ? [] : [['(nenhum ajuste mês a mês)']])])
  wa['!cols'] = [{ wch: 40 }, { wch: 10 }, { wch: 28 }]
  XLSX.utils.book_append_sheet(wb, wa, 'Ajustes do mês')

  XLSX.writeFile(wb, `Orcamento Vale Sol ${inicio.replace('/', '-')} a ${fim.replace('/', '-')}.xlsx`)
}

/** documento de impressão (Salvar como PDF) — mesmas linhas e números da tela */
function OrcamentoPrint({ d, grade, cenario }: { d: Orc; grade: Grade; cenario: Cenario }) {
  const { cab, linhas } = matrizDre(d, grade, cenario)
  const aj = listaAjustes(d, cenario)
  const th: React.CSSProperties = { padding: '3px 5px', fontSize: 7.5, textAlign: 'right', color: '#fff', background: C.navy, fontWeight: 600, whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '2px 5px', fontSize: 8, textAlign: 'right', borderBottom: '0.5px solid #e8ebf0', whiteSpace: 'nowrap' }
  const nRef = grade.refs.length
  return (
    <div className="dre-print" style={{ fontFamily: 'Arial, sans-serif', color: C.navy, padding: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: `2px solid ${C.navy}`, paddingBottom: 8, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color: C.gold, fontWeight: 700 }}>Vale Sol Agronegócio</div>
          <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.1 }}>Orçamento — DRE projetada</div>
          <div style={{ fontSize: 10, color: '#555' }}>Regime de caixa · consolidado · {d.meses[0]?.mes} a {d.meses[d.meses.length - 1]?.mes}</div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 9, color: '#555' }}>
          <div>Base: DRE fechada até {d.base.ultimoFechado}</div>
          <div>Emitido em {new Date().toLocaleDateString('pt-BR')}</div>
        </div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>{cab.map((h, i) => <th key={h} style={{ ...th, textAlign: i === 0 ? 'left' : 'right', background: i > 0 && i <= nRef ? C.navyLight : i === cab.length - 1 ? C.navyMid : C.navy }}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {linhas.map(l => (
            <tr key={l.rot} style={{ background: l.sub ? '#eef2f8' : undefined }}>
              <td style={{ ...td, textAlign: 'left', fontWeight: l.sub ? 700 : 400 }}>{l.rot}</td>
              {l.vals.map((v, j) => (
                <td key={j} style={{ ...td, fontWeight: l.sub ? 700 : 400, color: v != null && v < 0 ? C.red : C.navy, background: j < nRef ? '#f4f6f9' : undefined }}>
                  {v == null ? '' : l.pct ? pct(v) : fmtNum(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: 24, marginTop: 10, fontSize: 8, color: '#444', lineHeight: 1.5 }}>
        <div style={{ flex: 1 }}>
          <b>Premissas (padrão de cada linha)</b><br />
          {LABEL.DEDUCAO}: {pct(d.deducao.valor, 2)} da receita bruta · {d.premissas.map(p => `${LABEL[p.linha] ?? p.linha}: ${p.modo === 'RECEITA' ? pct(p.valor) + ' da receita' : fmt(p.valor) + '/mês'}`).join(' · ')}
        </div>
        <div style={{ flex: 1 }}>
          <b>Ajustes mês a mês</b><br />
          {aj.length ? aj.map(a => `${a.linha} ${a.mes}: ${a.valor}`).join(' · ') : 'nenhum'}
        </div>
      </div>
      <div style={{ marginTop: 6, fontSize: 7.5, color: '#666' }}>
        Receita líquida = previsão do modelo econométrico (intervalo de 95%), salvo onde marcada como cenário; custos e despesas = premissas;
        EBITDA e lucro líquido = cenário. Meses marcados como frágeis têm intervalo acima de ±40%.
      </div>
    </div>
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
          <div>projetado (modelo): <b>{fmt(p.prev)}</b></div>
          {p.faixa != null && p.faixaBase != null && (
            <div style={{ color: '#b8c6d8', marginTop: 2 }}>IC 95%: {fmt(p.faixaBase)} – {fmt(p.faixaBase + p.faixa)}</div>
          )}
          {p.cen != null && <div style={{ marginTop: 4 }}>cenário editado: <b>{fmt(p.cen)}</b></div>}
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
