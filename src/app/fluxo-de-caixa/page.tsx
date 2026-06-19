'use client'
import { useEffect, useRef, useState } from 'react'
import Shell from '@/components/Shell'
import {
  BarChart, Bar, LineChart, Line, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ReferenceLine,
} from 'recharts'

type Tab = 'import' | 'view'
type Kind = 'receivable' | 'payable'

interface ItemRow {
  fitid: string
  dueDate: string
  amount: number
  netAmount: number
  alreadyImported: boolean
  // Receivable
  customerName?: string
  customerDoc?: string | null
  issueDate?: string | null
  titulo?: string
  parcela?: string | null
  filial?: string | null
  // Payable
  supplierName?: string
  supplierDoc?: string | null
  entryDate?: string | null
  operacao?: string | null
}

interface PreviewResponse {
  kind: Kind
  total: number
  totalAmount: number
  newCount: number
  duplicateCount: number
  items: ItemRow[]
  errors: string[]
}

interface SeriesResponse {
  summary: {
    countReceivables: number
    countPayables: number
    totalReceber: number
    totalPagar: number
    totalReceberPending: number
    totalPagarPending: number
    netPosition: number
  }
  monthlyFlow: { key: string; label: string; receber: number; pagar: number; gap: number }[]
  cumulativeBalance: { date: string; label: string; balance: number }[]
  topReceivables: { name: string; total: number }[]
  topPayables:    { name: string; total: number }[]
  pmrScatter: { date: string; days: number; amount: number; label: string }[]
  pmpScatter: { date: string; days: number; amount: number; label: string }[]
  pmpPmrSeries: { key: string; label: string; pmp: number; pmr: number; gap: number }[]
}

const fmt = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtDate = (d?: string | null) => d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—'

const C = {
  navy: '#0a2540', navyLight: '#1e3a5f',
  yellow: '#f5c518', gold: '#d4a017',
  line: '#e3e7ed', textSoft: '#4a5670', textMuted: '#7a869a',
  green: '#197a4a', red: '#b03022', amber: '#c98a14',
  blue: '#2f5a96',
}

export default function FluxoDeCaixa() {
  const [tab, setTab] = useState<Tab>('view')
  const [series, setSeries] = useState<SeriesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3500) }

  const loadSeries = () => {
    setLoading(true)
    fetch('/api/cash-flow/series').then(r => r.json()).then(d => { setSeries(d); setLoading(false) })
  }
  useEffect(() => { loadSeries() }, [])

  return (
    <Shell>
      <div className="page-header">
        <div>
          <div className="page-eyebrow">Módulo · Tesouraria</div>
          <h1 className="page-title">Fluxo de Caixa</h1>
          <p className="page-subtitle">
            Importação de títulos a receber e pagamentos a efetuar diretamente do ERP.
            Os mesmos lançamentos não são duplicados — cada título é identificado por
            uma chave única gerada a partir de NF, parcela, CNPJ, vencimento e valor.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {([['view', 'Visão Geral'], ['import', 'Importar']] as [Tab, string][]).map(([k, label]) => (
            <button key={k}
              className={tab === k ? 'btn btn-primary' : 'btn'}
              onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'import' && <ImportPanel showToast={showToast} onSaved={loadSeries} />}
      {tab === 'view'   && (loading ? <Loading /> : series ? <ViewPanel series={series} /> : <Loading />)}

      {toast && <div className="toast">{toast}</div>}
    </Shell>
  )
}

function Loading() {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">◌</div>
      <div className="empty-state-title">Carregando séries…</div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────
//  IMPORT PANEL
// ─────────────────────────────────────────────────────────
function ImportPanel({ showToast, onSaved }: { showToast: (m: string) => void; onSaved: () => void }) {
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [drag, setDrag] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const upload = async (file: File) => {
    setParsing(true)
    const fd = new FormData()
    fd.append('file', file)
    const r = await fetch('/api/cash-flow/parse', { method: 'POST', body: fd })
    const d = await r.json()
    setParsing(false)
    if (!r.ok) { showToast(`Erro: ${d.error}`); return }
    setPreview(d)
  }

  const handleFile = (f?: File | null) => { if (f) upload(f) }

  const save = async () => {
    if (!preview) return
    const onlyNew = preview.items.filter(i => !i.alreadyImported)
    if (onlyNew.length === 0) { showToast('Nada novo pra salvar'); return }
    setSaving(true)
    const r = await fetch('/api/cash-flow/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: preview.kind, items: onlyNew }),
    })
    const d = await r.json()
    setSaving(false)
    if (!r.ok) { showToast(`Erro: ${d.error}`); return }
    showToast(`✓ ${d.imported} lançamentos importados (${d.skipped} ignorados)`)
    setPreview(null)
    onSaved()
  }

  if (!preview) {
    return (
      <>
        <div className="card mb-6">
          <div className="card-header">
            <div>
              <div className="card-eyebrow">Upload</div>
              <div className="card-title">Importar relatório XLSX do ERP</div>
            </div>
          </div>
          <p style={{ fontSize: 13, color: C.textSoft, lineHeight: 1.6, marginBottom: 18 }}>
            O sistema identifica automaticamente se o arquivo é de <b>títulos a receber</b>
            (coluna VECTO/EMISSÃO) ou de <b>pagamentos a efetuar</b> (VENCTO/ENTRADA). Após
            o upload, você verá uma prévia com cada linha marcada como nova ou já importada
            — somente as novas serão gravadas ao autorizar.
          </p>
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files?.[0]) }}
            style={{
              border: `2px dashed ${drag ? C.yellow : C.line}`,
              borderRadius: 4,
              padding: '40px 24px',
              textAlign: 'center',
              cursor: 'pointer',
              background: drag ? 'rgba(245, 197, 24, 0.05)' : '#fafbfc',
              transition: 'all 200ms ease',
            }}
          >
            <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
                   onChange={e => { handleFile(e.target.files?.[0]); e.target.value = '' }} />
            <div style={{ fontSize: 40, marginBottom: 8, color: C.navy }}>{parsing ? '◌' : '⬆'}</div>
            <div style={{ fontFamily: 'var(--font-serif), serif', fontSize: 18, color: C.navy, marginBottom: 6 }}>
              {parsing ? 'Lendo planilha…' : 'Clique ou arraste o arquivo .XLSX'}
            </div>
            <div style={{ fontSize: 12, color: C.textMuted }}>
              Relatório de Títulos a Receber · Relatório de Pagamentos a Efetuar
            </div>
          </div>
        </div>
      </>
    )
  }

  // Preview
  const isRecv = preview.kind === 'receivable'
  return (
    <>
      <div className="card mb-6">
        <div className="card-header">
          <div>
            <div className="card-eyebrow">
              Prévia · {isRecv ? 'Títulos a Receber' : 'Pagamentos a Efetuar'}
            </div>
            <div className="card-title">{preview.total} lançamentos · {fmt(preview.totalAmount)}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => setPreview(null)}>Descartar</button>
            <button className="btn btn-primary" onClick={save} disabled={saving || preview.newCount === 0}>
              {saving ? 'Salvando…' : `Autorizar e salvar ${preview.newCount}`}
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 24, marginBottom: 18 }}>
          <KpiInline label="Novos" value={String(preview.newCount)} color={C.green} />
          <KpiInline label="Duplicados (serão ignorados)" value={String(preview.duplicateCount)} color={C.textMuted} />
          <KpiInline label="Total no arquivo" value={String(preview.total)} color={C.navy} />
        </div>

        <div className="table-wrap" style={{ maxHeight: '55vh' }}>
          <table>
            <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
              <tr>
                <th style={{ width: 32 }}>•</th>
                <th>Vencimento</th>
                <th>{isRecv ? 'Cliente' : 'Fornecedor'}</th>
                <th>Documento</th>
                <th>Título / Parcela</th>
                <th style={{ textAlign: 'right' }}>Valor</th>
                <th>Filial</th>
              </tr>
            </thead>
            <tbody>
              {preview.items.slice(0, 500).map(i => (
                <tr key={i.fitid} style={{ opacity: i.alreadyImported ? 0.5 : 1 }}>
                  <td>
                    {i.alreadyImported
                      ? <span title="Já importado" style={{ color: C.textMuted, fontSize: 14 }}>≡</span>
                      : <span title="Novo" style={{ color: C.green, fontSize: 14, fontWeight: 700 }}>+</span>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDate(i.dueDate)}</td>
                  <td style={{ maxWidth: 280, fontSize: 13 }}>
                    {isRecv ? i.customerName : i.supplierName}
                  </td>
                  <td style={{ fontSize: 11, color: C.textMuted, whiteSpace: 'nowrap' }}>
                    {isRecv ? i.customerDoc : i.supplierDoc}
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {i.titulo} <span style={{ color: C.textMuted }}>· {i.parcela}</span>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{fmt(i.netAmount)}</td>
                  <td style={{ fontSize: 11, color: C.textMuted }}>{i.filial || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {preview.items.length > 500 && (
          <div style={{ fontSize: 11, color: C.textMuted, padding: '12px 0 0', textAlign: 'center' }}>
            Mostrando 500 de {preview.items.length} linhas. Todas serão consideradas no salvamento.
          </div>
        )}
      </div>
    </>
  )
}

function KpiInline({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ borderLeft: `3px solid ${color}`, paddingLeft: 14 }}>
      <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
                    fontWeight: 600, color: C.textMuted, marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-serif), serif', fontSize: 22, color, lineHeight: 1 }}>{value}</div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────
//  VIEW PANEL — 6 gráficos
// ─────────────────────────────────────────────────────────
function ViewPanel({ series }: { series: SeriesResponse }) {
  const s = series.summary
  const positionColor = s.netPosition >= 0 ? C.green : C.red

  if (s.countReceivables === 0 && s.countPayables === 0) {
    return (
      <div className="card">
        <div className="empty-state">
          <div className="empty-state-icon">◇</div>
          <div className="empty-state-title">Nenhum lançamento importado</div>
          <p style={{ fontSize: 13, color: C.textMuted, marginTop: 12, maxWidth: 520, marginInline: 'auto' }}>
            Use a aba <b>Importar</b> para subir os relatórios XLSX do seu ERP.
            Os títulos a receber e pagamentos a efetuar aparecerão aqui em forma de gráficos.
          </p>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Resumo */}
      <div className="card mb-6">
        <div className="card-header">
          <div>
            <div className="card-eyebrow">Posição financeira atual</div>
            <div className="card-title">Visão Consolidada</div>
          </div>
        </div>
        <div className="grid-4" style={{ gap: 28 }}>
          <KpiBig label="A receber em aberto" value={fmt(s.totalReceberPending)} sub={`${s.countReceivables} títulos`} color={C.green} />
          <KpiBig label="A pagar em aberto"   value={fmt(s.totalPagarPending)}   sub={`${s.countPayables} títulos`}   color={C.red} />
          <KpiBig label="Posição líquida"      value={fmt(s.netPosition)} sub="A receber - A pagar"          color={positionColor} />
          <KpiBig label="Volume total"         value={fmt(s.totalReceber + s.totalPagar)} sub="Recebido + pago"   color={C.navy} />
        </div>
      </div>

      {/* 1. Fluxo mensal */}
      <div className="card mb-6 card-accent-yellow">
        <div className="card-header">
          <div>
            <div className="card-eyebrow">Gráfico 1 · Próximos meses</div>
            <div className="card-title">A Receber × A Pagar (Mensal)</div>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={series.monthlyFlow} margin={{ top: 8, right: 24, bottom: 4, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.line} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: C.textSoft }} stroke={C.line} />
            <YAxis tick={{ fontSize: 11, fill: C.textSoft }}
                   tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} stroke={C.line} />
            <Tooltip formatter={(v: number) => fmt(v)}
                     contentStyle={{ background: C.navy, border: 'none', borderRadius: 4, fontSize: 12, padding: '10px 14px' }}
                     labelStyle={{ color: C.yellow, fontWeight: 600, marginBottom: 6, fontSize: 11, letterSpacing: '0.05em', textTransform: 'uppercase' }}
                     itemStyle={{ color: '#fff', padding: 0 }} />
            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
            <Bar dataKey="receber" name="A Receber" fill={C.green} radius={[3, 3, 0, 0]} />
            <Bar dataKey="pagar"   name="A Pagar"   fill={C.red}   radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* 2. Saldo acumulado */}
      <div className="card mb-6">
        <div className="card-header">
          <div>
            <div className="card-eyebrow">Gráfico 2 · Projeção</div>
            <div className="card-title">Saldo Acumulado ao Longo do Tempo</div>
          </div>
        </div>
        <p style={{ fontSize: 12, color: C.textMuted, marginBottom: 14, lineHeight: 1.6 }}>
          Soma cronológica de todas as entradas (a receber) menos saídas (a pagar). Mostra
          a posição esperada do caixa em cada data, assumindo que todos os títulos serão
          liquidados no vencimento.
        </p>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={series.cumulativeBalance} margin={{ top: 8, right: 24, bottom: 4, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.line} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: C.textSoft }} stroke={C.line}
                   interval={Math.max(1, Math.floor(series.cumulativeBalance.length / 12))} />
            <YAxis tick={{ fontSize: 11, fill: C.textSoft }}
                   tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} stroke={C.line} />
            <Tooltip
              cursor={{ stroke: C.yellow, strokeWidth: 1 }}
              formatter={(v: number) => [fmt(v), 'Saldo']}
              labelFormatter={(l: string) => `Data: ${l}`}
              contentStyle={{ background: C.navy, border: 'none', borderRadius: 4, fontSize: 12, padding: '10px 14px' }}
              labelStyle={{ color: C.yellow, fontWeight: 600, marginBottom: 6, fontSize: 11, letterSpacing: '0.05em', textTransform: 'uppercase' }}
              itemStyle={{ color: '#fff', padding: 0 }}
            />
            <Line type="monotone" dataKey="balance" name="Saldo projetado"
                  stroke={C.navy} strokeWidth={2}
                  dot={{ r: 2, fill: C.yellow, stroke: C.navy, strokeWidth: 1 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* 3. & 4. Top 10 ─ lado a lado */}
      <div className="grid-2 mb-6">
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-eyebrow">Gráfico 3 · Carteira de clientes</div>
              <div className="card-title">Top 10 Recebimentos em Aberto</div>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={Math.max(280, series.topReceivables.length * 30 + 40)}>
            <BarChart data={series.topReceivables} layout="vertical" margin={{ left: 100, right: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.line} />
              <XAxis type="number" tick={{ fontSize: 10, fill: C.textSoft }}
                     tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} stroke={C.line} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: C.textSoft }}
                     width={180} stroke={C.line}
                     tickFormatter={v => v.length > 24 ? v.slice(0, 22) + '…' : v} />
              <Tooltip formatter={(v: number) => fmt(v)}
                       contentStyle={{ background: C.navy, border: 'none', borderRadius: 4, fontSize: 12, padding: '10px 14px' }}
                     labelStyle={{ color: C.yellow, fontWeight: 600, marginBottom: 6, fontSize: 11, letterSpacing: '0.05em', textTransform: 'uppercase' }}
                     itemStyle={{ color: '#fff', padding: 0 }} />
              <Bar dataKey="total" fill={C.green} radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-eyebrow">Gráfico 4 · Carteira de fornecedores</div>
              <div className="card-title">Top 10 Pagamentos em Aberto</div>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={Math.max(280, series.topPayables.length * 30 + 40)}>
            <BarChart data={series.topPayables} layout="vertical" margin={{ left: 100, right: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.line} />
              <XAxis type="number" tick={{ fontSize: 10, fill: C.textSoft }}
                     tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} stroke={C.line} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: C.textSoft }}
                     width={180} stroke={C.line}
                     tickFormatter={v => v.length > 24 ? v.slice(0, 22) + '…' : v} />
              <Tooltip formatter={(v: number) => fmt(v)}
                       contentStyle={{ background: C.navy, border: 'none', borderRadius: 4, fontSize: 12, padding: '10px 14px' }}
                     labelStyle={{ color: C.yellow, fontWeight: 600, marginBottom: 6, fontSize: 11, letterSpacing: '0.05em', textTransform: 'uppercase' }}
                     itemStyle={{ color: '#fff', padding: 0 }} />
              <Bar dataKey="total" fill={C.red} radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 5. Dispersão valor × data ─ separados */}
      <div className="grid-2 mb-6">
        <ScatterDaysVsValue
          title="Dispersão dos Recebíveis — PMR"
          eyebrow="Gráfico 5a · Títulos a Receber"
          description="Cada ponto é um título a receber individual, posicionado pelo prazo concedido em dias (X) e valor (Y). A linha tracejada vertical é a média de dias ponderada pelo valor."
          points={series.pmrScatter}
          color={C.green}
        />
        <ScatterDaysVsValue
          title="Dispersão dos Pagáveis — PMP"
          eyebrow="Gráfico 5b · Pagamentos a Efetuar"
          description="Cada ponto é um pagamento a efetuar individual, posicionado pelo prazo recebido em dias (X) e valor (Y). A linha tracejada vertical é a média de dias ponderada pelo valor."
          points={series.pmpScatter}
          color={C.red}
        />
      </div>

      {/* 6. Gap PMP - PMR */}
      {(() => {
        // Mostrar só meses com ambos PMP e PMR > 0 (evita vies de sobrevivencia:
        // meses antigos onde só sobrou contas a receber em aberto, ou meses
        // futuros sem dados ainda).
        const validSeries = series.pmpPmrSeries.filter(p => p.pmp > 0 && p.pmr > 0)
        const omitted = series.pmpPmrSeries.length - validSeries.length
        return (
          <div className="card mb-6 card-accent-yellow">
            <div className="card-header">
              <div>
                <div className="card-eyebrow">Gráfico 6 · Indicador estratégico</div>
                <div className="card-title">Gap PMP × PMR — Série Temporal</div>
              </div>
            </div>
            <p style={{ fontSize: 12, color: C.textMuted, marginBottom: 14, lineHeight: 1.6 }}>
              Diferença mensal (ponderada pelos valores) entre o prazo médio que você <b>tem</b> para
              pagar fornecedores (PMP) e o prazo que você <b>concede</b> aos clientes (PMR). Agrupado
              pelo <b>mês de emissão</b> do título. Mostramos apenas meses com PMP e PMR válidos
              simultaneamente (omitidos {omitted} bucket(s) sem dado de um dos lados).
              Gap positivo = fornecedor te financia (saudável); negativo = você financia o cliente.
            </p>
            {validSeries.length === 0 ? (
              <div className="empty-state" style={{ padding: '40px 16px' }}>
                <div className="empty-state-icon">◇</div>
                <div style={{ fontSize: 12, color: C.textMuted }}>
                  Não há nenhum mês com PMP e PMR registrados simultaneamente.
                </div>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={340}>
                <LineChart data={validSeries} margin={{ top: 12, right: 32, bottom: 4, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.line} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: C.textSoft }} stroke={C.line} />
                  <YAxis tick={{ fontSize: 11, fill: C.textSoft }}
                         tickFormatter={v => `${v}d`} stroke={C.line} />
                  <Tooltip formatter={(v: number) => `${v} dias`}
                           contentStyle={{ background: C.navy, border: 'none', borderRadius: 4, fontSize: 12, padding: '10px 14px' }}
                           labelStyle={{ color: C.yellow, fontWeight: 600, marginBottom: 6, fontSize: 11, letterSpacing: '0.05em', textTransform: 'uppercase' }}
                           itemStyle={{ color: '#fff', padding: 0 }} />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
                  <ReferenceLine y={0} stroke={C.textMuted} strokeDasharray="3 3"
                                 label={{ value: 'Equilíbrio', position: 'insideTopRight', fill: C.textMuted, fontSize: 10 }} />
                  <Line type="monotone" dataKey="pmp" name="PMP — Prazo de pagamento" stroke={C.red}
                        strokeWidth={1.8} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="pmr" name="PMR — Prazo de recebimento" stroke={C.green}
                        strokeWidth={1.8} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="gap" name="Gap (PMP − PMR)" stroke={C.navy}
                        strokeWidth={3} dot={{ r: 5, fill: C.yellow, stroke: C.navy, strokeWidth: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        )
      })()}
    </>
  )
}

// ─────────────────────────────────────────────────────────
//  Scatter — dias (X) × valor (Y), com linha vertical na média de dias
// ─────────────────────────────────────────────────────────
function ScatterDaysVsValue({
  title, eyebrow, description, points, color,
}: {
  title: string; eyebrow: string; description: string
  points: { date: string; days: number; amount: number }[]
  color: string
}) {
  // X = dias para pagamento/recebimento, Y = valor
  // Cada bolinha = 1 título individual (sem agregação por fornecedor/cliente)
  const data = points
    .filter(p => Number.isFinite(p.days) && p.days >= 0 && Number.isFinite(p.amount) && p.amount > 0)
    .map(p => ({ x: p.days, y: p.amount, date: p.date }))

  if (data.length === 0) {
    return (
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-eyebrow">{eyebrow}</div>
            <div className="card-title">{title}</div>
          </div>
        </div>
        <div className="empty-state" style={{ padding: '32px 16px' }}>
          <div className="empty-state-icon">◇</div>
          <div style={{ fontSize: 12, color: C.textMuted }}>Sem dados pra exibir</div>
        </div>
      </div>
    )
  }

  // Média de dias ponderada pelo valor
  const sumAmt = data.reduce((s, p) => s + p.y, 0)
  const avgDays = sumAmt > 0
    ? data.reduce((s, p) => s + p.x * p.y, 0) / sumAmt
    : 0
  const avgRound = Math.round(avgDays)

  // Domínios pra deixar a linha vertical bem visível
  const maxDays = Math.max(...data.map(p => p.x))
  const maxValue = Math.max(...data.map(p => p.y))

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-eyebrow">{eyebrow}</div>
          <div className="card-title">{title}</div>
        </div>
      </div>
      <p style={{ fontSize: 11, color: C.textMuted, marginBottom: 12, lineHeight: 1.5 }}>
        {description}
      </p>
      <ResponsiveContainer width="100%" height={340}>
        <ScatterChart margin={{ top: 12, right: 32, bottom: 12, left: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.line} />
          <XAxis
            type="number"
            dataKey="x"
            name="Dias"
            domain={[0, Math.ceil(maxDays / 30) * 30]}
            tickFormatter={v => `${v}d`}
            tick={{ fontSize: 11, fill: C.textSoft }}
            stroke={C.line}
            label={{ value: 'Dias para vencimento', position: 'insideBottom', offset: -2, fontSize: 11, fill: C.textMuted }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name="Valor"
            domain={[0, maxValue]}
            tickFormatter={v => v >= 1000 ? `R$${(v/1000).toFixed(0)}k` : `R$${v.toFixed(0)}`}
            tick={{ fontSize: 11, fill: C.textSoft }}
            stroke={C.line}
          />
          <Tooltip
            cursor={{ strokeDasharray: '3 3', stroke: C.textMuted }}
            content={(props) => {
              const payload = (props as { active?: boolean; payload?: { payload?: { x: number; y: number; date: string } }[] }).payload
              const active = (props as { active?: boolean }).active
              if (!active || !payload || !payload[0]?.payload) return null
              const p = payload[0].payload
              return (
                <div style={{ background: C.navy, padding: '10px 14px', borderRadius: 4, fontSize: 12 }}>
                  <div style={{ color: C.yellow, fontWeight: 600, marginBottom: 6, fontSize: 11, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                    {new Date(p.date).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}
                  </div>
                  <div style={{ color: '#fff' }}>Prazo: <b>{p.x} dias</b></div>
                  <div style={{ color: '#fff' }}>Valor: <b>{fmt(p.y)}</b></div>
                </div>
              )
            }}
          />
          <ReferenceLine
            x={avgRound}
            stroke={C.navy}
            strokeDasharray="6 4"
            strokeWidth={2}
            label={{
              value: `Média ${avgRound} dias`,
              position: 'insideTopLeft',
              fill: C.navy,
              fontSize: 11,
              fontWeight: 600,
            }}
          />
          <Scatter data={data} fill={color} fillOpacity={0.4} shape="circle" />
        </ScatterChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 11, color: C.textMuted, marginTop: 8, textAlign: 'right' }}>
        {data.length} títulos · média ponderada pelo valor: <b style={{ color: C.navy }}>{avgRound} dias</b>
      </div>
    </div>
  )
}

function KpiBig({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div style={{ borderLeft: `3px solid ${color}`, paddingLeft: 16 }}>
      <div style={{
        fontSize: 10, color: C.textMuted, letterSpacing: '0.1em',
        textTransform: 'uppercase', fontWeight: 600, marginBottom: 6,
      }}>{label}</div>
      <div style={{
        fontFamily: 'var(--font-serif), serif',
        fontSize: 24, color, lineHeight: 1.1, letterSpacing: '-0.01em',
      }}>{value}</div>
      <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>{sub}</div>
    </div>
  )
}
