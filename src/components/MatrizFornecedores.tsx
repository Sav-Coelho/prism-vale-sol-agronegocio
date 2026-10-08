'use client'
/**
 * Controle de Compras › Matriz de Fornecedores — matriz de Kraljic quantificada
 * (Montgomery, Ogden e Boehmke, 2018), com as correções da leitura de 07/10/2026.
 * Importância = gasto pago (DRE); risco = 3 perguntas respondidas aqui pelo
 * comprador. Cálculo em lib/matriz-fornecedores; regras em lib/matriz-fornecedores-regras.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip,
  ReferenceLine, ReferenceArea, Cell, ComposedChart, Bar, Line,
} from 'recharts'
import {
  PERGUNTAS, CAMPOS, TIPOS, TIPO_ROTULO, QUADRANTE, CORTE_RISCO, riscoDe, quadranteDe, acaoDe,
  type Quadrante, type CampoRisco, type LinhaMatriz, type ResultadoMatriz,
} from '@/lib/matriz-fornecedores-regras'

const C = { navy: '#0a2540', navyMid: '#142c4e', yellow: '#f5c518', gold: '#d4a017', line: '#e3e7ed', textSoft: '#4a5670', textMuted: '#7a869a', green: '#197a4a', red: '#b03022', amber: '#c98a14' }
const COR: Record<Quadrante, string> = { ALAVANCAGEM: C.green, ESTRATEGICO: C.gold, GARGALO: C.red, NAO_CRITICO: '#6b7a90', SEM_AVALIACAO: '#c3cad6' }
const ORDEM: Quadrante[] = ['ALAVANCAGEM', 'ESTRATEGICO', 'GARGALO', 'NAO_CRITICO']
const fmt0 = (n: number) => 'R$ ' + Math.round(n).toLocaleString('pt-BR')
const fmtK = (n: number) => { const a = Math.abs(n); return (n < 0 ? '−' : '') + (a >= 1e6 ? `${(a / 1e6).toFixed(1).replace('.', ',')} mi` : a >= 1e3 ? `${Math.round(a / 1e3)} mil` : a.toFixed(0)) }
const pctF = (f: number, casas = 1) => `${(f * 100).toFixed(casas).replace('.', ',')}%`
const mesRotulo = (ym: string) => { const n = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']; return `${n[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}` }
const GENERICAS = ['LABORATORIO', 'LABORATORIOS', 'COMERCIAL', 'INDUSTRIA', 'DISTRIBUIDORA']
function curto(nome: string): string {
  const p = nome.split(' ').filter(Boolean)
  if (p.length > 1 && GENERICAS.indexOf(p[0].normalize('NFD').replace(/[̀-ͯ]/g, '')) >= 0) return p[1]
  return p[0].length >= 6 || p.length === 1 ? p[0] : `${p[0]} ${p[1]}`
}
// eixo de importância em escala log: 0,05% a 20% do gasto
const Y_MIN = 0.0005, Y_MAX = 0.2
const Y_TICKS = [0.001, 0.003, 0.01, 0.03, 0.1]

type Filtro = 'curvaA' | 'todos' | Quadrante
type Estado = 'salvando' | 'ok' | 'erro'

export function MatrizFornecedores() {
  const [data, setData] = useState<ResultadoMatriz | null>(null)
  const [erro, setErro] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('curvaA')
  const [estado, setEstado] = useState<Record<string, Estado>>({})

  useEffect(() => {
    fetch('/api/compras/matriz').then(r => r.json()).then(setData).catch(() => setErro('Não foi possível carregar a matriz.'))
  }, [])

  const linhas = data?.linhas ?? []
  const avaliadas = useMemo(() => linhas.filter(l => l.risco != null), [linhas])
  const visiveis = useMemo(() => linhas.filter(l =>
    filtro === 'todos' ? true : filtro === 'curvaA' ? l.curvaA : l.quadrante === filtro), [linhas, filtro])

  async function salvar(l: LinhaMatriz, campo: 'tipo' | CampoRisco, bruto: string) {
    const valor = bruto === '' ? null : campo === 'tipo' ? bruto : Number(bruto)
    // otimista: a linha muda na hora; a resposta do servidor confirma (ou desfaz)
    setData(d => d && {
      ...d,
      linhas: d.linhas.map(x => {
        if (x.chave !== l.chave) return x
        const n = { ...x, [campo]: valor } as LinhaMatriz
        n.risco = riscoDe(n)
        n.quadrante = quadranteDe(n.curvaA, n.risco)
        n.acao = acaoDe(n.quadrante, n.tipo)
        return n
      }),
    })
    setEstado(e => ({ ...e, [l.chave]: 'salvando' }))
    try {
      const r = await fetch('/api/compras/matriz', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chave: l.chave, nome: l.nome, [campo]: valor }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'erro')
      setData(j)
      setEstado(e => ({ ...e, [l.chave]: 'ok' }))
    } catch (e) {
      setEstado(s => ({ ...s, [l.chave]: 'erro' }))
      setErro(`Não salvou a avaliação de ${l.nome}: ${(e as Error).message}. Recarregue a página e tente de novo.`)
    }
  }

  if (erro && !data) return <div className="card"><div className="empty-state"><div className="empty-state-title">{erro}</div></div></div>
  if (!data) return <div className="empty-state"><div className="empty-state-icon">◌</div><div className="empty-state-title">Calculando a matriz…</div></div>
  if (!data.hasData) return <div className="card"><div className="empty-state"><div className="empty-state-title">Sem dados para a matriz</div><div className="empty-state-sub">{data.motivo}</div></div></div>

  const periodo = data.meses.length ? `${mesRotulo(data.meses[0])} a ${mesRotulo(data.meses[data.meses.length - 1])}` : ''
  const corte = data.curvaA.corte
  const pontos = avaliadas.map(l => ({ ...l, x: l.risco as number, y: Math.min(Y_MAX, Math.max(Y_MIN * 1.2, l.participacao)), z: Math.max(l.aVencer + l.pedidosAbertos, 1) }))
  const pareto = linhas.filter(l => l.gasto > 0).slice(0, 25).map(l => ({ ...l, rotulo: curto(l.nome), acumPct: l.acumulada * 100 }))
  const chip = (ativo: boolean, cor: string = C.navy): React.CSSProperties => ({ border: `1px solid ${ativo ? cor : C.line}`, background: ativo ? cor : '#fff', color: ativo ? '#fff' : C.textSoft, borderRadius: 20, padding: '4px 12px', fontSize: 12, cursor: 'pointer' })
  const sel: React.CSSProperties = { fontSize: 11.5, padding: '3px 4px', border: `1px solid ${C.line}`, borderRadius: 4, background: '#fff', color: C.navy, maxWidth: 132 }
  const tooltipBox: React.CSSProperties = { background: C.navy, color: '#fff', padding: '10px 13px', borderRadius: 5, fontSize: 12, maxWidth: 280, boxShadow: '0 6px 20px rgba(0,0,0,0.3)' }

  return (
    <>
      <div className="grid-3 mb-6">
        <Kpi label={`Mercadoria paga · ${periodo}`} value={fmt0(data.gastoTotal)} sub={`${data.nFornecedores} fornecedores · ~${fmtK(data.gastoAnualizado)} por ano`} color={C.navy} />
        <Kpi label="Curva A de fornecedores" value={`${data.curvaA.n} fornecedores`} sub={`fazem 80% do gasto (cada um com ${pctF(corte, 2)} ou mais)`} color={C.gold} />
        <Kpi label="Risco avaliado" value={`${data.avaliados.curvaA} de ${data.curvaA.n}`} sub={data.avaliados.curvaA < data.curvaA.n ? 'da curva A — responda na tabela abaixo' : 'curva A completa'} color={data.avaliados.curvaA < data.curvaA.n ? C.red : C.green} />
      </div>

      <div className="card mb-6" style={{ padding: '14px 20px', fontSize: 12.5, color: C.textSoft, lineHeight: 1.7 }}>
        <b style={{ color: C.navy }}>Como usar:</b> (1) responda as 3 perguntas de risco dos {data.curvaA.n} fornecedores da curva A na tabela — cerca de 15 minutos;
        (2) cada fornecedor cai num quadrante, que diz o tipo de compra a fazer; (3) comece a negociar pelos de maior gasto em <b style={{ color: COR.ALAVANCAGEM }}>Alavancagem</b> e
        monte plano anual com os de <b style={{ color: COR.ESTRATEGICO }}>Estratégico</b>. Cada 1% de desconto no total vale cerca de <b>{fmtK(data.gastoAnualizado * 0.01)} por ano</b>.
      </div>
      {erro && <div className="card mb-6" style={{ padding: '10px 16px', color: C.red, fontSize: 12.5 }}>{erro}</div>}

      <div className="grid-2 mb-6" style={{ alignItems: 'stretch' }}>
        {/* A MATRIZ */}
        <div className="card card-accent-yellow">
          <div className="card-header">
            <div>
              <div className="card-eyebrow">Matriz de Kraljic</div>
              <div className="card-title">Risco de abastecimento × importância no gasto</div>
            </div>
          </div>
          <p style={{ fontSize: 12, color: C.textMuted, marginBottom: 8, lineHeight: 1.6 }}>
            Cada bolha é um fornecedor avaliado; o tamanho é o que ainda vai vencer (boletos + pedidos). A linha horizontal separa a curva A
            ({pctF(corte, 2)} do gasto ou mais); a vertical, risco {CORTE_RISCO}. Eixo vertical em escala log.
          </p>
          <div style={{ position: 'relative' }}>
            <ResponsiveContainer width="100%" height={420}>
              <ScatterChart margin={{ top: 12, right: 18, bottom: 26, left: 6 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.line} />
                <ReferenceArea x1={0} x2={CORTE_RISCO} y1={corte} y2={Y_MAX} fill={COR.ALAVANCAGEM} fillOpacity={0.06}
                  label={{ value: 'ALAVANCAGEM', position: 'insideTopLeft', fill: COR.ALAVANCAGEM, fontSize: 11, fontWeight: 700 }} />
                <ReferenceArea x1={CORTE_RISCO} x2={100} y1={corte} y2={Y_MAX} fill={COR.ESTRATEGICO} fillOpacity={0.07}
                  label={{ value: 'ESTRATÉGICO', position: 'insideTopRight', fill: COR.ESTRATEGICO, fontSize: 11, fontWeight: 700 }} />
                <ReferenceArea x1={0} x2={CORTE_RISCO} y1={Y_MIN} y2={corte} fill={COR.NAO_CRITICO} fillOpacity={0.05}
                  label={{ value: 'NÃO CRÍTICO', position: 'insideBottomLeft', fill: COR.NAO_CRITICO, fontSize: 11, fontWeight: 700 }} />
                <ReferenceArea x1={CORTE_RISCO} x2={100} y1={Y_MIN} y2={corte} fill={COR.GARGALO} fillOpacity={0.05}
                  label={{ value: 'GARGALO', position: 'insideBottomRight', fill: COR.GARGALO, fontSize: 11, fontWeight: 700 }} />
                <XAxis type="number" dataKey="x" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={{ fontSize: 11, fill: C.textSoft }} stroke={C.line}
                  label={{ value: 'Risco de abastecimento (0–100) →', position: 'insideBottom', offset: -12, fontSize: 11, fill: C.textMuted }} />
                <YAxis type="number" dataKey="y" scale="log" domain={[Y_MIN, Y_MAX]} ticks={Y_TICKS} allowDataOverflow
                  tickFormatter={(v: number) => pctF(v, v < 0.01 ? 1 : 0)} tick={{ fontSize: 11, fill: C.textSoft }} stroke={C.line}
                  label={{ value: 'Participação no gasto', angle: -90, position: 'insideLeft', fontSize: 11, fill: C.textMuted }} />
                <ZAxis type="number" dataKey="z" range={[60, 900]} />
                <ReferenceLine x={CORTE_RISCO} stroke={C.navy} strokeDasharray="5 4" strokeWidth={1.4} />
                <ReferenceLine y={corte} stroke={C.navy} strokeDasharray="5 4" strokeWidth={1.4} />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} wrapperStyle={{ pointerEvents: 'none', zIndex: 30 }} content={({ payload }) => {
                  const p = payload?.[0]?.payload as (LinhaMatriz | undefined)
                  if (!p) return null
                  return (
                    <div style={tooltipBox}>
                      <div style={{ fontWeight: 600, marginBottom: 5 }}>{p.nome}</div>
                      <div>Pago ({periodo}): <b style={{ color: C.yellow }}>{fmt0(p.gasto)}</b> · {pctF(p.participacao)}</div>
                      <div>A vencer: {fmt0(p.aVencer + p.pedidosAbertos)}</div>
                      <div>Risco: <b>{p.risco}</b> · <span style={{ color: C.yellow }}>{QUADRANTE[p.quadrante].rotulo}</span></div>
                      <div style={{ color: '#c9d4e3', fontSize: 11, marginTop: 5, lineHeight: 1.45 }}>{p.acao}</div>
                    </div>
                  )
                }} />
                <Scatter data={pontos} shape="circle">
                  {pontos.map(p => <Cell key={p.chave} fill={COR[p.quadrante]} fillOpacity={0.6} stroke={COR[p.quadrante]} strokeWidth={1.2} />)}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
            {!avaliadas.length && (
              <div style={{ position: 'absolute', inset: '30% 12% auto 12%', background: 'rgba(255,255,255,0.94)', border: `1px dashed ${C.line}`, borderRadius: 6, padding: '14px 18px', textAlign: 'center', fontSize: 12.5, color: C.textSoft, lineHeight: 1.6 }}>
                Nenhum fornecedor avaliado ainda. Responda as 3 perguntas de risco na tabela abaixo — comece pelos {data.curvaA.n} da curva A — e cada um aparece aqui no seu quadrante.
              </div>
            )}
          </div>
        </div>

        {/* CONCENTRAÇÃO DO GASTO */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-eyebrow">Concentração do gasto</div>
              <div className="card-title">Os 25 maiores fornecedores e o acumulado</div>
            </div>
          </div>
          <p style={{ fontSize: 12, color: C.textMuted, marginBottom: 8, lineHeight: 1.6 }}>
            Barras = mercadoria paga em {periodo}, na cor do quadrante (cinza claro = ainda sem avaliação). Linha = % acumulado do gasto; a tracejada marca 80%.
          </p>
          <ResponsiveContainer width="100%" height={420}>
            <ComposedChart data={pareto} margin={{ top: 12, right: 8, bottom: 62, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.line} vertical={false} />
              <XAxis dataKey="rotulo" interval={0} angle={-50} textAnchor="end" tick={{ fontSize: 10, fill: C.textSoft }} stroke={C.line} />
              <YAxis yAxisId="v" tickFormatter={(v: number) => fmtK(v)} tick={{ fontSize: 11, fill: C.textSoft }} stroke={C.line} width={56} />
              <YAxis yAxisId="p" orientation="right" domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 11, fill: C.textSoft }} stroke={C.line} width={40} />
              <ReferenceLine yAxisId="p" y={80} stroke={C.navy} strokeDasharray="5 4" />
              <Tooltip content={({ payload }) => {
                const p = payload?.[0]?.payload as ((LinhaMatriz & { acumPct: number }) | undefined)
                if (!p) return null
                return (
                  <div style={tooltipBox}>
                    <div style={{ fontWeight: 600, marginBottom: 5 }}>{p.nome}</div>
                    <div>Pago: <b style={{ color: C.yellow }}>{fmt0(p.gasto)}</b> · {pctF(p.participacao)}</div>
                    <div>Acumulado: {pctF(p.acumulada)}</div>
                    <div>{QUADRANTE[p.quadrante].rotulo}</div>
                  </div>
                )
              }} />
              <Bar yAxisId="v" dataKey="gasto" radius={[3, 3, 0, 0]}>
                {pareto.map(p => <Cell key={p.chave} fill={p.quadrante === 'SEM_AVALIACAO' ? (p.curvaA ? '#9aa7ba' : '#d5dbe4') : COR[p.quadrante]} />)}
              </Bar>
              <Line yAxisId="p" type="monotone" dataKey="acumPct" stroke={C.gold} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* O QUE FAZER EM CADA QUADRANTE */}
      <div className="grid-4 mb-6">
        {ORDEM.map(q => (
          <div key={q} className="card" style={{ borderTop: `3px solid ${COR[q]}`, padding: '14px 16px' }}>
            <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700, color: COR[q] }}>{QUADRANTE[q].rotulo}</div>
            <div style={{ fontSize: 11.5, color: C.textMuted, margin: '2px 0 8px' }}>{QUADRANTE[q].resumo}</div>
            <div style={{ fontFamily: 'var(--font-serif), serif', fontSize: 16, color: C.navy }}>
              {data.resumo[q].n} {data.resumo[q].n === 1 ? 'fornecedor' : 'fornecedores'}
            </div>
            <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 8 }}>{fmt0(data.resumo[q].gasto)} · {pctF(data.resumo[q].gasto / data.gastoTotal)} do gasto</div>
            <div style={{ fontSize: 12, color: C.textSoft, lineHeight: 1.55 }}>{QUADRANTE[q].acao}</div>
          </div>
        ))}
      </div>

      {/* TABELA COM A AVALIAÇÃO */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.line}` }}>
          <div className="card-eyebrow">Avaliação de risco pelo comprador</div>
          <div className="card-title" style={{ fontSize: 14, marginBottom: 8 }}>Fornecedores <span style={{ color: C.textMuted, fontWeight: 400 }}>({visiveis.length})</span></div>
          <div style={{ fontSize: 12, color: C.textSoft, lineHeight: 1.65, marginBottom: 10 }}>
            {CAMPOS.map(c => (
              <div key={c}><b style={{ color: C.navy }}>{PERGUNTAS[c].titulo}</b> ({Math.round(PERGUNTAS[c].peso * 100)}% da nota): {PERGUNTAS[c].pergunta}</div>
            ))}
            <div style={{ color: C.textMuted }}>Nota de risco = soma ponderada das 3 respostas (0 a 100); {CORTE_RISCO} ou mais = risco alto. Grava sozinho ao escolher.</div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <button style={chip(filtro === 'curvaA', C.gold)} onClick={() => setFiltro('curvaA')}>Curva A · {data.curvaA.n}</button>
            <button style={chip(filtro === 'todos')} onClick={() => setFiltro('todos')}>Todos · {linhas.length}</button>
            {(['ALAVANCAGEM', 'ESTRATEGICO', 'GARGALO', 'NAO_CRITICO', 'SEM_AVALIACAO'] as Quadrante[]).map(q => (
              <button key={q} style={chip(filtro === q, COR[q])} onClick={() => setFiltro(q)}>{QUADRANTE[q].rotulo} · {data.resumo[q].n}</button>
            ))}
          </div>
        </div>
        <div className="table-wrap sticky-first" style={{ maxHeight: '70vh' }}>
          <table style={{ minWidth: '100%' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 3 }}>
              <tr>
                <th style={{ textAlign: 'left' }}>Fornecedor</th>
                <th style={{ textAlign: 'right' }}>Pago ({periodo})</th>
                <th style={{ textAlign: 'right' }} title="Boletos de mercadoria e parcelas de pedidos ainda a vencer">A vencer</th>
                <th>Tipo</th>
                <th>{PERGUNTAS.alternativas.titulo}</th>
                <th>{PERGUNTAS.condicoes.titulo}</th>
                <th>{PERGUNTAS.falhas.titulo}</th>
                <th style={{ textAlign: 'right' }}>Risco</th>
                <th>Quadrante</th>
                <th style={{ textAlign: 'left', minWidth: 260 }}>O que fazer</th>
                <th style={{ textAlign: 'right' }} title="1% do gasto anualizado — referência do tamanho da negociação">1% vale/ano</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map(l => (
                <tr key={l.chave}>
                  <td style={{ fontSize: 12, color: C.navy, fontWeight: 600, background: '#fff', maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                    title={l.nomes.length > 1 ? `Cadastros agrupados: ${l.nomes.join(' · ')}` : l.nome}>
                    {l.curvaA && <span style={{ color: C.gold, fontWeight: 700, marginRight: 5 }}>A</span>}{l.nome}
                    {l.nomes.length > 1 && <span style={{ color: C.textMuted, fontWeight: 400, fontSize: 10 }}> · {l.nomes.length} cadastros</span>}
                    {estado[l.chave] && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 400, color: estado[l.chave] === 'erro' ? C.red : C.textMuted }}>{estado[l.chave] === 'salvando' ? 'salvando…' : estado[l.chave] === 'ok' ? '✓ salvo' : '✗ não salvou'}</span>}
                  </td>
                  <td style={{ textAlign: 'right', fontSize: 12, whiteSpace: 'nowrap' }}>
                    <div style={{ fontWeight: 600, color: C.navy }}>{fmt0(l.gasto)}</div>
                    <div style={{ fontSize: 10.5, color: C.textMuted }}>{pctF(l.participacao)} · acum. {pctF(l.acumulada, 0)}</div>
                  </td>
                  <td style={{ textAlign: 'right', fontSize: 12, color: C.textSoft, whiteSpace: 'nowrap' }} title={`Boletos ${fmt0(l.aVencer)} · pedidos ${fmt0(l.pedidosAbertos)}`}>{l.aVencer + l.pedidosAbertos > 0 ? fmt0(l.aVencer + l.pedidosAbertos) : '—'}</td>
                  <td style={{ textAlign: 'center' }}>
                    <select style={sel} value={l.tipo ?? ''} onChange={e => salvar(l, 'tipo', e.target.value)}>
                      <option value="">—</option>
                      {TIPOS.map(t => <option key={t} value={t}>{TIPO_ROTULO[t]}</option>)}
                    </select>
                  </td>
                  {CAMPOS.map(c => (
                    <td key={c} style={{ textAlign: 'center' }}>
                      <select style={{ ...sel, borderColor: l[c] == null ? '#f0c36b' : C.line }} value={l[c] == null ? '' : String(l[c])} onChange={e => salvar(l, c, e.target.value)} title={PERGUNTAS[c].pergunta}>
                        <option value="">— responder —</option>
                        {PERGUNTAS[c].opcoes.map(o => <option key={o.valor} value={String(o.valor)}>{o.rotulo}</option>)}
                      </select>
                    </td>
                  ))}
                  <td style={{ textAlign: 'right', fontSize: 13, fontWeight: 700, color: l.risco == null ? C.textMuted : l.risco >= CORTE_RISCO ? C.red : C.green }}>{l.risco ?? '—'}</td>
                  <td style={{ textAlign: 'center' }}>
                    <span style={{ background: COR[l.quadrante], color: '#fff', borderRadius: 3, padding: '2px 8px', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>{QUADRANTE[l.quadrante].rotulo}</span>
                  </td>
                  <td style={{ fontSize: 11.5, color: C.textSoft, lineHeight: 1.45, minWidth: 260, maxWidth: 380 }}>{l.acao}</td>
                  <td style={{ textAlign: 'right', fontSize: 12, color: C.textSoft, whiteSpace: 'nowrap' }}>{l.gasto > 0 ? fmt0(l.valor1pct) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '10px 20px', fontSize: 11, color: C.textMuted, borderTop: `1px solid ${C.line}`, lineHeight: 1.6 }}>
          Importância = mercadoria paga em {periodo} (DRE, regime de caixa; fornecedores do grupo e imobilizado fora). Curva A = os fornecedores que, somados do maior para o menor, chegam a 80% do gasto.
          Cadastros duplicados no ERP aparecem juntos (ex.: União Química, Ourofino, MSD). Método: matriz de Kraljic quantificada (Montgomery, Ogden e Boehmke, 2018),
          com cortes em unidades reais. Próxima versão: rupturas e alternativas medidas, com o relatório de laboratório × produto.
        </div>
      </div>
    </>
  )
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
