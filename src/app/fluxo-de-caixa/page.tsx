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
  isStale: boolean      // vencimento <= hoje → não entra em análise
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
  filial: string
  total: number
  totalAmount: number
  validCount: number
  validAmount: number
  staleCount: number
  items: ItemRow[]
  errors: string[]
}

interface SeriesResponse {
  filiais: string[]
  selectedUnit: string | null
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
  pmrScatter: { name: string; days: number; amount: number; count: number }[]
  pmpScatter: { name: string; days: number; amount: number; count: number }[]
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

// Filiais canônicas conhecidas + auto-detect pelo nome do arquivo
const KNOWN_FILIAIS = [
  'VS - APERIBÉ',
  'VS - TRÊS RIOS',
  'VS - QUATIS',
  'VS - RIO BONITO',
  'MM - RIO BONITO',
  'MM - SETE LAGOAS',
]

function detectFilialFromFilename(name: string): string | null {
  const up = name.toUpperCase()
  if (up.includes('APERIBE'))                              return 'VS - APERIBÉ'
  if (up.includes('TRES RIOS') || up.includes('TRÊS RIOS')) return 'VS - TRÊS RIOS'
  if (up.includes('QUATIS'))                                return 'VS - QUATIS'
  if (up.includes('MULTMUNDE') && up.includes('RIO BONITO'))return 'MM - RIO BONITO'
  if (up.includes('MULTMUNDE') && (up.includes('7 LAGOAS') || up.includes('SETE LAGOAS'))) return 'MM - SETE LAGOAS'
  if (up.includes('RIO BONITO'))                            return 'VS - RIO BONITO'
  return null
}

export default function FluxoDeCaixa() {
  const [tab, setTab] = useState<Tab>('view')
  const [series, setSeries] = useState<SeriesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedUnit, setSelectedUnit] = useState<string>('') // '' = Consolidado
  const [toast, setToast] = useState('')
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3500) }

  const loadSeries = (unit: string = selectedUnit) => {
    setLoading(true)
    const qs = unit ? `?unit=${encodeURIComponent(unit)}` : ''
    fetch('/api/cash-flow/series' + qs).then(r => r.json()).then(d => { setSeries(d); setLoading(false) })
  }
  useEffect(() => { loadSeries(selectedUnit) }, [selectedUnit])

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
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {tab === 'view' && series && series.filiais.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ fontSize: 10, color: 'var(--arken-text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600 }}>
                Filial
              </label>
              <select
                className="form-select"
                style={{ width: 220 }}
                value={selectedUnit}
                onChange={e => setSelectedUnit(e.target.value)}
              >
                <option value="">Consolidado (todas)</option>
                {series.filiais.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          )}
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
      </div>

      {tab === 'import' && <ImportPanel showToast={showToast} onSaved={() => loadSeries(selectedUnit)} />}
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
  const [filial, setFilial] = useState<string>('')
  const [filialCustom, setFilialCustom] = useState<string>('')
  const [drag, setDrag] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const effectiveFilial = () => (filial === '__custom__' ? filialCustom.trim() : filial)

  const upload = async (file: File) => {
    const f = effectiveFilial()
    if (!f) { showToast('Selecione a filial antes de enviar'); return }
    setParsing(true)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('filial', f)
    const r = await fetch('/api/cash-flow/parse', { method: 'POST', body: fd })
    const d = await r.json()
    setParsing(false)
    if (!r.ok) { showToast(`Erro: ${d.error}`); return }
    setPreview({ ...d, filial: f })
  }

  const handleFile = (f?: File | null) => {
    if (!f) return
    // Auto-detect pelo nome do arquivo (só se ainda não escolheu)
    if (!filial) {
      const detected = detectFilialFromFilename(f.name)
      if (detected) setFilial(detected)
    }
    upload(f)
  }

  const save = async () => {
    if (!preview) return
    const valid = preview.items.filter(i => !i.isStale)
    if (valid.length === 0) { showToast('Nenhum título com vencimento futuro pra salvar'); return }
    const kindLabel = preview.kind === 'receivable' ? 'títulos a receber' : 'pagamentos a efetuar'
    const confirmMsg = `Isso vai APAGAR todos os ${kindLabel} da filial "${preview.filial}" e substituir pelos ${valid.length} desta planilha. Demais filiais não são afetadas. Confirma?`
    if (!confirm(confirmMsg)) return
    setSaving(true)
    const r = await fetch('/api/cash-flow/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: preview.kind, filial: preview.filial, items: valid }),
    })
    const d = await r.json()
    setSaving(false)
    if (!r.ok) { showToast(`Erro: ${d.error}`); return }
    showToast(`✓ [${d.filial}] ${d.deleted} antigos removidos · ${d.imported} novos · ${d.staleIgnored} vencidos ignorados`)
    setPreview(null)
    setFilial('')
    setFilialCustom('')
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
            Selecione a <b>filial</b> e suba o arquivo. O sistema identifica se é de
            <b> títulos a receber</b> (VECTO/EMISSÃO) ou <b>pagamentos a efetuar</b>
            (VENCTO/ENTRADA). Após o upload, você verá uma prévia. Ao autorizar, apenas a
            base daquela filial é substituída — outras filiais não são afetadas.
          </p>

          <div style={{ marginBottom: 16 }}>
            <label className="form-label">Filial *</label>
            <select
              className="form-select"
              value={filial}
              onChange={e => setFilial(e.target.value)}
              style={{ maxWidth: 380 }}
            >
              <option value="">— Selecione a unidade —</option>
              {KNOWN_FILIAIS.map(f => <option key={f} value={f}>{f}</option>)}
              <option value="__custom__">+ Outra filial (digitar)</option>
            </select>
            {filial === '__custom__' && (
              <input
                className="form-input"
                style={{ maxWidth: 380, marginTop: 8 }}
                placeholder="Digite o nome da filial"
                value={filialCustom}
                onChange={e => setFilialCustom(e.target.value)}
              />
            )}
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 6 }}>
              💡 Ao arrastar o arquivo, a filial é detectada automaticamente pelo nome
              (ex: <i>QUATIS VS.xlsx</i> → VS - QUATIS).
            </div>
          </div>

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
              Prévia · {isRecv ? 'Títulos a Receber' : 'Pagamentos a Efetuar'} · <b style={{ color: C.gold }}>{preview.filial}</b>
            </div>
            <div className="card-title">{preview.total} lançamentos · {fmt(preview.totalAmount)}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => setPreview(null)}>Descartar</button>
            <button className="btn btn-primary" onClick={save} disabled={saving || preview.validCount === 0}>
              {saving ? 'Salvando…' : `Autorizar e substituir base (${preview.validCount})`}
            </button>
          </div>
        </div>

        <div style={{ marginBottom: 14, padding: '10px 14px', background: '#fff8e1', border: `1px solid ${C.gold}`, borderRadius: 4, fontSize: 12, color: '#7a5c00', lineHeight: 1.5 }}>
          ⚠ <b>Substituição completa.</b> Ao salvar, todos os {isRecv ? 'títulos a receber' : 'pagamentos a efetuar'} atualmente
          no banco serão <b>apagados</b> e substituídos pelos {preview.validCount} desta planilha. Isso garante
          que títulos cancelados no ERP entre importações também sumam aqui. Títulos com vencimento <b>vencido ou do dia atual</b>
          ({preview.staleCount}) são ignorados automaticamente — não entram em análise de fluxo futuro.
        </div>

        <div style={{ display: 'flex', gap: 24, marginBottom: 18 }}>
          <KpiInline label="Válidos (vencimento futuro)" value={String(preview.validCount)} color={C.green} />
          <KpiInline label="Vencidos / do dia (ignorados)" value={String(preview.staleCount)} color={C.amber} />
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
                <tr key={i.fitid} style={{ opacity: i.isStale ? 0.45 : 1 }}>
                  <td>
                    {i.isStale
                      ? <span title="Vencido ou do dia — não entra em análise" style={{ color: C.amber, fontSize: 14 }}>⊘</span>
                      : <span title="Vencimento futuro — válido" style={{ color: C.green, fontSize: 14, fontWeight: 700 }}>+</span>}
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
          eyebrow="Gráfico 5a · Clientes"
          description="Cada ponto é um cliente único, posicionado pelo prazo médio de recebimento em dias (X) e exposição total em R$ (Y). A linha tracejada vertical é a média de dias ponderada pelo valor."
          points={series.pmrScatter}
          color={C.green}
          entityLabel="cliente"
        />
        <ScatterDaysVsValue
          title="Dispersão dos Pagáveis — PMP"
          eyebrow="Gráfico 5b · Fornecedores"
          description="Cada ponto é um fornecedor único, posicionado pelo prazo médio de pagamento em dias (X) e exposição total em R$ (Y). A linha tracejada vertical é a média de dias ponderada pelo valor."
          points={series.pmpScatter}
          color={C.red}
          entityLabel="fornecedor"
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
//  Scatter — dias (X) × exposição (Y), 1 ponto por cliente/fornecedor
// ─────────────────────────────────────────────────────────
function ScatterDaysVsValue({
  title, eyebrow, description, points, color, entityLabel,
}: {
  title: string; eyebrow: string; description: string
  points: { name: string; days: number; amount: number; count: number }[]
  color: string
  entityLabel: string  // "cliente" ou "fornecedor"
}) {
  const data = points
    .filter(p => Number.isFinite(p.days) && p.days >= 0 && Number.isFinite(p.amount) && p.amount > 0)
    .map(p => ({ x: p.days, y: p.amount, name: p.name, count: p.count }))

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

  // Média de dias ponderada pela exposição
  const sumAmt = data.reduce((s, p) => s + p.y, 0)
  const avgDays = sumAmt > 0
    ? data.reduce((s, p) => s + p.x * p.y, 0) / sumAmt
    : 0
  const avgRound = Math.round(avgDays)

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
        <ScatterChart margin={{ top: 12, right: 32, bottom: 24, left: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.line} />
          <XAxis
            type="number"
            dataKey="x"
            name="Dias"
            domain={[0, Math.ceil(maxDays / 30) * 30]}
            tickFormatter={v => `${v}d`}
            tick={{ fontSize: 11, fill: C.textSoft }}
            stroke={C.line}
            label={{ value: 'Prazo médio em dias', position: 'insideBottom', offset: -10, fontSize: 11, fill: C.textMuted }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name="Exposição"
            domain={[0, maxValue]}
            tickFormatter={v => v >= 1000 ? `R$${(v/1000).toFixed(0)}k` : `R$${v.toFixed(0)}`}
            tick={{ fontSize: 11, fill: C.textSoft }}
            stroke={C.line}
          />
          <Tooltip
            cursor={{ strokeDasharray: '3 3', stroke: C.textMuted }}
            content={(props) => {
              const payload = (props as { active?: boolean; payload?: { payload?: { x: number; y: number; name: string; count: number } }[] }).payload
              const active = (props as { active?: boolean }).active
              if (!active || !payload || !payload[0]?.payload) return null
              const p = payload[0].payload
              return (
                <div style={{ background: C.navy, padding: '10px 14px', borderRadius: 4, fontSize: 12, maxWidth: 320 }}>
                  <div style={{ color: C.yellow, fontWeight: 600, marginBottom: 6, fontSize: 11, letterSpacing: '0.04em' }}>
                    {p.name}
                  </div>
                  <div style={{ color: '#fff' }}>Prazo médio: <b>{p.x} dias</b></div>
                  <div style={{ color: '#fff' }}>Exposição: <b>{fmt(p.y)}</b></div>
                  <div style={{ color: '#fff', opacity: 0.8 }}>Títulos: {p.count}</div>
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
          <Scatter data={data} fill={color} fillOpacity={0.55} shape="circle" />
        </ScatterChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 11, color: C.textMuted, marginTop: 8, textAlign: 'right' }}>
        {data.length} {entityLabel}{data.length !== 1 ? 'es' : ''} · média ponderada pela exposição: <b style={{ color: C.navy }}>{avgRound} dias</b>
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
