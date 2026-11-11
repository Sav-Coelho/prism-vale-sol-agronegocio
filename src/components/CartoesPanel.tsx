'use client'
/**
 * Fluxo de Caixa › Cartões: o financeiro sobe a fatura do cartão (PDF), confere os itens,
 * classifica cada um no plano de contas e a DRE do mês do pagamento muda sozinha — trocando o
 * pagamento da fatura no caixa pelos itens classificados, sempre pelo mesmo valor.
 *
 * A leitura do PDF acontece aqui no navegador: pdf.js (texto, Itaú) e, quando o PDF não tem
 * texto utilizável (Safra), OCR com tesseract.js. As duas bibliotecas vêm da CDN só quando o
 * financeiro envia um arquivo.
 */
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { conferir, detectarBanco, lerItau, lerSafraOcr, parcelaDe, dataDaCompra, type FaturaLida, type ItemFatura } from '@/lib/cartao-parser'

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'

const C = { navy: '#0f2d52', green: '#15803d', red: '#b91c1c', amber: '#b45309', gray: '#64748b', line: '#e2e8f0', soft: '#f8fafc' }
const brl = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataBR = (iso: string | null | undefined) => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—'
const mesBR = (ym: string | null | undefined) => { if (!ym) return '—'; const [y, m] = ym.split('-'); return `${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(m) - 1]}/${y.slice(2)}` }

// ── tipos da API ──
interface LinhaJ { chave: string; data: string; filial: string; historico: string | null; documento: string | null; conta: string; caminho: string; valor: number; mes: string; usada?: boolean }
interface Pagamento { modo: 'TOTAL' | 'ITENS' | 'MISTO' | 'NAO_ENCONTRADO'; manual: boolean; filial: string | null; linhasTotal: LinhaJ[]; capacidade: number; itensCasados: number; valorCasado: number; mes: string | null }
interface CartaoJ { id: number; banco: string; final: string; nome: string | null; titular: string | null; filial: string | null }
interface FaturaResumo { id: number; arquivo: string; leitura: string; cartao: CartaoJ; vencimento: string; total: number; saldoAnterior: number; nItens: number; nClassificados: number; valorClassificado: number; aplicado: number; erro: string | null; pagamento: Pagamento | null; caixaImportado: boolean }
interface Conta { caminho: string; folha: string; loja: string | null; linha: string; linhaLabel: string; usos: number; recente: boolean }
interface Lista { cartoes: CartaoJ[]; contas: Conta[]; caixaMeses: string[]; faturas: FaturaResumo[] }
type Estado = 'NA_DRE' | 'A_CLASSIFICAR' | 'SEM_PAGAMENTO' | 'MES_FECHADO' | 'SEM_SALDO' | 'CONTA_INVALIDA'
interface ItemJ { id: number; ordem: number; data: string | null; descricao: string; parcela: string | null; portador: string | null; valor: number; caminho: string | null; sugestao: string | null; estado: Estado; mes?: string }
interface Detalhe extends Omit<FaturaResumo, 'nItens' | 'nClassificados' | 'valorClassificado' | 'caixaImportado'> { classificado: number; vinculosManuais: string[]; itens: ItemJ[]; candidatos: LinhaJ[] }

const ESTADO: Record<Estado, { txt: string; cor: string }> = {
  NA_DRE: { txt: 'na DRE', cor: C.green },
  A_CLASSIFICAR: { txt: 'a classificar', cor: C.gray },
  SEM_PAGAMENTO: { txt: 'sem pagamento no caixa', cor: C.amber },
  MES_FECHADO: { txt: 'mês fechado', cor: C.gray },
  SEM_SALDO: { txt: 'não cabe no pagamento', cor: C.red },
  CONTA_INVALIDA: { txt: 'conta não é despesa', cor: C.red },
}
const FILIAIS = ['RIO BONITO', 'MATRIZ RB', '3 RIOS', 'QUATIS 2', 'APERIBÉ', 'SETE LAGOAS']
const LOJA_DA_FILIAL: Record<string, string> = { 'RIO BONITO': 'VS - RIO BONITO', 'MATRIZ RB': 'MM - RIO BONITO', '3 RIOS': 'VS - TRÊS RIOS', 'QUATIS 2': 'VS - QUATIS', 'APERIBÉ': 'VS - APERIBÉ', 'SETE LAGOAS': 'MM - 7 LAGOAS' }

// ── leitura do PDF no navegador ──
const scripts = new Map<string, Promise<void>>()
function carregar(src: string): Promise<void> {
  const ja = scripts.get(src); if (ja) return ja
  const p = new Promise<void>((ok, erro) => {
    const s = document.createElement('script'); s.src = src; s.async = true
    s.onload = () => ok(); s.onerror = () => { scripts.delete(src); erro(new Error('Não consegui carregar ' + src.split('/').slice(2, 3)[0] + '. Verifique a internet.')) }
    document.head.appendChild(s)
  })
  scripts.set(src, p); return p
}
async function sha256(buf: ArrayBuffer) {
  const h = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('')
}
type PdfLib = { getDocument: (o: { data: Uint8Array }) => { promise: Promise<PdfDoc> }; GlobalWorkerOptions: { workerSrc: string } }
interface PdfDoc { numPages: number; getPage: (n: number) => Promise<PdfPage> }
interface PdfPage { getTextContent: () => Promise<{ items: Array<{ str: string; transform: number[] }> }>; getViewport: (o: { scale: number }) => { width: number; height: number }; render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> } }

async function lerFaturaPdf(file: File, aviso: (m: string) => void): Promise<FaturaLida> {
  await carregar(PDFJS)
  const lib = (window as unknown as { pdfjsLib: PdfLib }).pdfjsLib
  lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const linhas: string[][] = []
  let uteis = 0
  for (let p = 1; p <= doc.numPages; p++) {
    aviso(`Lendo o texto da página ${p} de ${doc.numPages}…`)
    const tc = await (await doc.getPage(p)).getTextContent()
    const its = tc.items.filter(i => i.str && i.str.trim()).map(i => ({ x: i.transform[4], y: i.transform[5], s: i.str }))
    its.forEach(i => { uteis += (i.s.match(/[A-Za-z0-9]/g) ?? []).length })
    its.sort((a, b) => b.y - a.y || a.x - b.x)
    let g: typeof its = [], y0 = NaN
    const fecha = () => { if (g.length) linhas.push(g.sort((a, b) => a.x - b.x).map(t => t.s)); g = [] }
    its.forEach(i => { if (Number.isNaN(y0) || Math.abs(i.y - y0) > 2) { fecha(); y0 = i.y } g.push(i) })
    fecha()
  }
  const texto = linhas.map(l => l.join(' ')).join('\n')
  if (uteis > 200 && detectarBanco(texto) === 'ITAU') return lerItau(linhas)

  // sem texto utilizável: OCR página por página
  await carregar(TESSERACT)
  const T = (window as unknown as { Tesseract: { createWorker: (lang: string) => Promise<{ recognize: (c: HTMLCanvasElement) => Promise<{ data: { text: string } }>; terminate: () => Promise<void> }> } }).Tesseract
  aviso('Preparando o OCR (a primeira vez demora um pouco)…')
  const w = await T.createWorker('por')
  let ocr = ''
  const n = Math.min(doc.numPages, 8)
  for (let p = 1; p <= n; p++) {
    aviso(`OCR da página ${p} de ${n}…`)
    const page = await doc.getPage(p)
    const viewport = page.getViewport({ scale: 200 / 72 })
    const canvas = document.createElement('canvas'); canvas.width = viewport.width; canvas.height = viewport.height
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('O navegador não deixou desenhar a página.')
    await page.render({ canvasContext: ctx, viewport }).promise
    ocr += (await w.recognize(canvas)).data.text + '\n'
  }
  await w.terminate()
  const banco = detectarBanco(ocr)
  const lida = lerSafraOcr(ocr)
  if (banco !== 'SAFRA') { lida.banco = banco ?? 'OUTRO'; lida.avisos.unshift('Banco não reconhecido: confira o cabeçalho e os itens com cuidado.') }
  return lida
}

// ── componente ──
export default function CartoesPanel({ showToast }: { showToast: (m: string) => void }) {
  const [lista, setLista] = useState<Lista | null>(null)
  const [aberta, setAberta] = useState<number | null>(null)
  const [revisao, setRevisao] = useState<(FaturaLida & { arquivo: string; hash: string }) | null>(null)
  const [lendo, setLendo] = useState<string | null>(null)
  const carregarLista = () => fetch('/api/cartao').then(r => r.json()).then(d => { if (d.error) showToast(d.error); else setLista(d) })
  useEffect(() => { carregarLista() }, [])

  const enviar = async (file: File | null | undefined) => {
    if (!file) return
    if (!/\.pdf$/i.test(file.name)) { showToast('Envie a fatura em PDF.'); return }
    try {
      setLendo('Abrindo o PDF…')
      const hash = await sha256(await file.arrayBuffer())
      const lida = await lerFaturaPdf(file, setLendo)
      setRevisao({ ...lida, arquivo: file.name, hash })
    } catch (e) { showToast('Não consegui ler o PDF: ' + (e as Error).message) }
    finally { setLendo(null) }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div className="card-title">Faturas de cartão</div>
            <p style={{ margin: '4px 0 0', color: C.gray, fontSize: 13, maxWidth: 760 }}>
              Suba a fatura em PDF e classifique cada item no plano de contas. A DRE do mês em que a fatura foi paga troca o
              pagamento que está no caixa pelos itens classificados, sempre pelo mesmo valor — nada é contado duas vezes.
              Item sem pagamento achado no caixa não entra na DRE.
            </p>
          </div>
          <label className="btn btn-primary" style={{ cursor: lendo ? 'wait' : 'pointer' }}>
            {lendo ? 'Lendo…' : 'Enviar fatura (PDF)'}
            <input type="file" accept="application/pdf,.pdf" style={{ display: 'none' }} disabled={!!lendo}
              onChange={e => { enviar(e.target.files?.[0]); e.target.value = '' }} />
          </label>
        </div>
        {lendo && <div style={{ marginTop: 12, fontSize: 13, color: C.navy }}>⏳ {lendo}</div>}
      </div>

      {revisao && <Revisao lida={revisao} showToast={showToast} onCancelar={() => setRevisao(null)}
        onSalva={id => { setRevisao(null); carregarLista().then(() => setAberta(id)) }} />}

      {lista && <ListaFaturas lista={lista} aberta={aberta} onAbrir={setAberta} />}
      {lista && aberta != null && <DetalheFatura key={aberta} id={aberta} lista={lista} showToast={showToast}
        onMudou={carregarLista} onApagada={() => { setAberta(null); carregarLista() }} />}
    </div>
  )
}

// ── revisão do que foi lido, antes de gravar ──
type ItemRev = ItemFatura & { _k: number }
function Revisao({ lida, showToast, onCancelar, onSalva }: { lida: FaturaLida & { arquivo: string; hash: string }; showToast: (m: string) => void; onCancelar: () => void; onSalva: (id: number) => void }) {
  const [f, setF] = useState(() => ({ ...lida, itens: lida.itens.map((i, k) => ({ ...i, _k: k })) as ItemRev[] }))
  const [salvando, setSalvando] = useState(false)
  const conf = conferir(f)
  const setItem = (k: number, p: Partial<ItemFatura>) => setF(x => ({ ...x, itens: x.itens.map(i => i._k === k ? { ...i, ...p, aviso: undefined } : i) }))
  const num = (s: string) => { const v = Number(String(s).replace(/\./g, '').replace(',', '.')); return Number.isFinite(v) ? v : 0 }
  const salvar = async () => {
    setSalvando(true)
    const r = await fetch('/api/cartao/faturas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...f, itens: f.itens.map(({ _k, ...i }) => ({ ...i, dataCompra: dataDaCompra(i.data, f.vencimento), parcela: i.parcela ?? parcelaDe(i.descricao) })) }) })
    const d = await r.json(); setSalvando(false)
    if (!r.ok) { showToast(d.error ?? 'Não foi possível salvar.'); if (d.id) onSalva(d.id); return }
    showToast('Fatura salva. Agora classifique os itens.'); onSalva(d.id)
  }
  return (
    <div className="card card-accent-yellow">
      <div className="card-title">Confira a fatura antes de salvar · {lida.arquivo}</div>
      <p style={{ fontSize: 12, color: C.gray, margin: '4px 0 12px' }}>
        Leitura por {f.leitura === 'OCR' ? 'OCR (o PDF não tem texto — confira os valores marcados)' : 'texto do PDF'}.
        {f.avisos.length ? ' ' + f.avisos.join(' ') : ''}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
        <Campo rotulo="Banco"><select className="form-select" value={f.banco} onChange={e => setF({ ...f, banco: e.target.value })}>{['ITAU', 'SAFRA', 'OUTRO'].map(b => <option key={b}>{b}</option>)}</select></Campo>
        <Campo rotulo="Final do cartão"><input className="form-input" value={f.final ?? ''} maxLength={4} onChange={e => setF({ ...f, final: e.target.value.replace(/\D/g, '') })} /></Campo>
        <Campo rotulo="Titular"><input className="form-input" value={f.titular ?? ''} onChange={e => setF({ ...f, titular: e.target.value })} /></Campo>
        <Campo rotulo="Vencimento"><input className="form-input" type="date" value={f.vencimento ?? ''} onChange={e => setF({ ...f, vencimento: e.target.value })} /></Campo>
        <Campo rotulo="Total da fatura"><input className="form-input" defaultValue={f.total?.toFixed(2).replace('.', ',') ?? ''} onBlur={e => setF({ ...f, total: num(e.target.value) })} /></Campo>
        <Campo rotulo="Sobra da fatura anterior"><input className="form-input" defaultValue={f.saldoAnterior.toFixed(2).replace('.', ',')} onBlur={e => setF({ ...f, saldoAnterior: num(e.target.value) })} /></Campo>
      </div>
      <div className="table-wrap" style={{ maxHeight: '45vh' }}>
        <table>
          <thead><tr><th>Data</th><th>Descrição</th><th>Parcela</th><th style={{ textAlign: 'right' }}>Valor</th><th /></tr></thead>
          <tbody>
            {f.itens.map(i => (
              <tr key={i._k} style={i.aviso ? { background: '#fff7ed' } : undefined}>
                <td style={{ width: 80 }}><input className="form-input" value={i.data} onChange={e => setItem(i._k, { data: e.target.value })} style={{ width: 70 }} /></td>
                <td><input className="form-input" value={i.descricao} onChange={e => setItem(i._k, { descricao: e.target.value })} />{i.aviso && <div style={{ fontSize: 11, color: C.amber }}>⚠ {i.aviso}</div>}</td>
                <td style={{ width: 80 }}>{i.parcela ?? parcelaDe(i.descricao) ?? '—'}</td>
                <td style={{ width: 120 }}><input className="form-input" style={{ textAlign: 'right' }} defaultValue={i.valor.toFixed(2).replace('.', ',')} onBlur={e => setItem(i._k, { valor: num(e.target.value) })} /></td>
                <td style={{ width: 40 }}><button className="btn btn-sm" title="Tirar a linha" onClick={() => setF(x => ({ ...x, itens: x.itens.filter(j => j._k !== i._k) }))}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, gap: 12, flexWrap: 'wrap' }}>
        <button className="btn btn-sm" onClick={() => setF(x => ({ ...x, itens: [...x.itens, { _k: Date.now(), data: '', dataCompra: null, descricao: '', parcela: null, portador: x.titular, valor: 0 }] }))}>+ Adicionar item</button>
        <div style={{ fontSize: 13, color: conf.ok ? C.green : C.red, fontWeight: 600 }}>
          {f.itens.length} itens · soma {brl(conf.soma)} · total {brl(conf.esperado)} {conf.ok ? '✓ confere' : `✗ diferença ${brl(conf.diferenca)}`}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={onCancelar}>Descartar</button>
          <button className="btn btn-primary" disabled={!conf.ok || !f.final || f.final.length !== 4 || !f.vencimento || salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar fatura'}</button>
        </div>
      </div>
    </div>
  )
}
const Campo = ({ rotulo, children }: { rotulo: string; children: ReactNode }) => (
  <label style={{ display: 'grid', gap: 4, fontSize: 11, color: C.gray, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{rotulo}{children}</label>
)

// ── lista das faturas ──
function textoPagamento(f: { pagamento: Pagamento | null; total: number; caixaImportado: boolean; vencimento: string }) {
  const p = f.pagamento
  if (!p || p.modo === 'NAO_ENCONTRADO') return f.caixaImportado ? 'não achado no caixa' : `aguardando o caixa de ${mesBR(f.vencimento.slice(0, 7))}`
  if (p.modo === 'TOTAL') return `achado: ${brl(p.capacidade)}${p.manual ? ' (manual)' : ''}`
  if (p.modo === 'ITENS') return `${p.itensCasados} itens achados (${brl(p.valorCasado)})`
  return `${p.itensCasados} itens + ${brl(p.capacidade)}`
}
function ListaFaturas({ lista, aberta, onAbrir }: { lista: Lista; aberta: number | null; onAbrir: (id: number) => void }) {
  if (!lista.faturas.length) return <div className="card"><div className="empty-state"><div className="empty-state-title">Nenhuma fatura enviada ainda</div><p style={{ color: C.gray, fontSize: 13 }}>Envie o PDF da fatura do Itaú ou do Safra para começar.</p></div></div>
  return (
    <div className="card">
      <div className="table-wrap">
        <table>
          <thead><tr><th>Cartão</th><th>Vencimento</th><th style={{ textAlign: 'right' }}>Total</th><th>Classificados</th><th style={{ textAlign: 'right' }}>Na DRE</th><th>Pagamento no caixa</th><th /></tr></thead>
          <tbody>
            {lista.faturas.map(f => (
              <tr key={f.id} style={f.id === aberta ? { background: C.soft } : undefined}>
                <td><b>{f.cartao.banco} {f.cartao.final}</b><div style={{ fontSize: 11, color: C.gray }}>{f.cartao.titular ?? f.cartao.nome ?? ''}</div></td>
                <td>{dataBR(f.vencimento)}</td>
                <td style={{ textAlign: 'right' }}>{brl(f.total)}</td>
                <td>{f.nClassificados}/{f.nItens}<div style={{ height: 4, background: C.line, borderRadius: 2, marginTop: 4, width: 90 }}><div style={{ height: 4, width: `${f.nItens ? (f.nClassificados / f.nItens) * 100 : 0}%`, background: C.navy, borderRadius: 2 }} /></div></td>
                <td style={{ textAlign: 'right', color: f.aplicado > 0 ? C.green : C.gray }}>{brl(f.aplicado)}{f.erro && <div style={{ color: C.red, fontSize: 11 }}>{f.erro}</div>}</td>
                <td style={{ fontSize: 12 }}>{textoPagamento(f)}</td>
                <td><button className={f.id === aberta ? 'btn btn-sm btn-primary' : 'btn btn-sm'} onClick={() => onAbrir(f.id)}>{f.id === aberta ? 'Aberta' : 'Abrir'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── uma fatura: pagamento, vínculo manual e classificação ──
function DetalheFatura({ id, lista, showToast, onMudou, onApagada }: { id: number; lista: Lista; showToast: (m: string) => void; onMudou: () => void; onApagada: () => void }) {
  const [d, setD] = useState<Detalhe | null>(null)
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [loja, setLoja] = useState<string>('')
  const [antigas, setAntigas] = useState(false)
  const [soAbertos, setSoAbertos] = useState(false)
  const [contaLote, setContaLote] = useState('')
  const [vinculando, setVinculando] = useState(false)
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set())
  const recarregar = () => fetch(`/api/cartao/faturas/${id}`).then(r => r.json()).then((x: Detalhe & { error?: string }) => {
    if (x.error) { showToast(x.error); return }
    setD(x); setMarcadas(new Set(x.vinculosManuais))
    setLoja(l => l || (x.cartao.filial ? LOJA_DA_FILIAL[x.cartao.filial] ?? '' : (x.pagamento?.filial ? LOJA_DA_FILIAL[x.pagamento.filial] ?? '' : '')))
  })
  useEffect(() => { recarregar() }, [id])

  const contas = useMemo(() => lista.contas.filter(c => (antigas || c.recente) && (!loja || c.loja === loja || c.loja == null)), [lista.contas, loja, antigas])
  const rotulo = (c: Conta) => `${c.folha} · ${c.loja ?? 'geral'} → ${c.linhaLabel}`
  const porRotulo = useMemo(() => new Map(lista.contas.map(c => [rotulo(c), c.caminho])), [lista.contas])
  const porCaminho = useMemo(() => new Map(lista.contas.map(c => [c.caminho, c])), [lista.contas])
  const lojas = useMemo(() => Array.from(new Set(lista.contas.map(c => c.loja).filter(Boolean) as string[])).sort(), [lista.contas])

  const classificar = async (ids: number[], caminho: string | null) => {
    if (!ids.length) return
    const r = await fetch('/api/cartao/itens', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, caminho }) })
    const x = await r.json()
    if (!r.ok) { showToast(x.error ?? 'Não foi possível classificar.'); return }
    setSel(new Set()); await recarregar(); onMudou()
  }
  const contaDoRotulo = (txt: string) => porRotulo.get(txt) ?? (lista.contas.some(c => c.caminho === txt) ? txt : null)
  const salvarVinculos = async () => {
    const r = await fetch(`/api/cartao/faturas/${id}/vinculos`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chaves: Array.from(marcadas) }) })
    const x = await r.json()
    if (!r.ok) { showToast(x.error ?? 'Não foi possível vincular.'); return }
    showToast(marcadas.size ? 'Pagamento vinculado.' : 'Vínculo manual removido.'); setVinculando(false); await recarregar(); onMudou()
  }
  const salvarFilial = async (filial: string) => {
    if (!d) return
    const r = await fetch(`/api/cartao/cartoes/${d.cartao.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filial }) })
    if (!r.ok) { showToast('Não foi possível salvar a filial.'); return }
    if (filial && LOJA_DA_FILIAL[filial]) setLoja(LOJA_DA_FILIAL[filial])
    await recarregar(); onMudou()
  }
  const apagar = async () => {
    if (!d || !confirm(`Apagar a fatura ${d.cartao.banco} ${d.cartao.final} de ${dataBR(d.vencimento)} e a classificação dos itens? A DRE volta ao que está no caixa.`)) return
    const r = await fetch(`/api/cartao/faturas/${id}`, { method: 'DELETE' })
    if (!r.ok) { showToast('Não foi possível apagar.'); return }
    showToast('Fatura apagada.'); onApagada()
  }
  if (!d) return <div className="card">Carregando a fatura…</div>

  const itens = d.itens.filter(i => !soAbertos || !i.caminho)
  const comSugestao = d.itens.filter(i => !i.caminho && i.sugestao && porCaminho.has(i.sugestao))
  const p = d.pagamento
  const somaMarcadas = d.candidatos.filter(l => marcadas.has(l.chave)).reduce((s, l) => s + l.valor, 0)
  const caixaDoMes = lista.caixaMeses.includes(d.vencimento.slice(0, 7))
  const semPag = d.itens.filter(i => i.estado === 'SEM_PAGAMENTO').reduce((s, i) => s + i.valor, 0)

  return (
    <div className="card">
      <datalist id="contas-cartao">{contas.map(c => <option key={c.caminho} value={rotulo(c)} />)}</datalist>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <div className="card-title">{d.cartao.nome ?? d.cartao.banco} final {d.cartao.final} · vencimento {dataBR(d.vencimento)}</div>
          <div style={{ fontSize: 13, color: C.gray, marginTop: 4 }}>
            Total {brl(d.total)} · classificados {brl(d.classificado)} · <b style={{ color: d.aplicado ? C.green : C.gray }}>na DRE {brl(d.aplicado)}{p?.mes ? ` (${mesBR(p.mes)})` : ''}</b>
            {d.erro && <span style={{ color: C.red }}> · {d.erro}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 11, color: C.gray }}>Filial em que o cartão é pago&nbsp;
            <select className="form-select" style={{ width: 170 }} value={d.cartao.filial ?? ''} onChange={e => salvarFilial(e.target.value)}>
              <option value="">descobrir pelo caixa</option>{FILIAIS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <button className="btn btn-sm btn-danger" onClick={apagar}>Apagar fatura</button>
        </div>
      </div>

      {/* pagamento no caixa */}
      <div style={{ marginTop: 14, padding: 12, borderRadius: 8, background: C.soft, border: `1px solid ${C.line}`, fontSize: 13 }}>
        <b>Pagamento no caixa: </b>
        {!p || p.modo === 'NAO_ENCONTRADO'
          ? (caixaDoMes
            ? <>não achei linha(s) do caixa que somem {brl(d.total)} perto de {dataBR(d.vencimento)}, nem itens de mesmo valor. Os itens só entram na DRE depois de vincular o pagamento.</>
            : <>o CashFlow realizado de {mesBR(d.vencimento.slice(0, 7))} ainda não foi importado. Pode classificar agora: quando ele entrar, a DRE troca sozinha.</>)
          : <>
            {p.linhasTotal.length > 0 && <>{p.manual ? 'vinculado à mão' : 'achado'} em {p.linhasTotal.map(l => `${dataBR(l.data)} ${l.filial} · ${l.historico ?? '—'} · ${l.conta} · ${brl(l.valor)}`).join(' + ')} = <b>{brl(p.capacidade)}</b>. </>}
            {p.itensCasados > 0 && <>{p.itensCasados} itens lançados um a um no caixa de {p.filial} ({brl(p.valorCasado)}). </>}
            {semPag > 0.005 && <span style={{ color: C.amber }}>{brl(semPag)} desta fatura não aparecem no caixa e não entram na DRE.</span>}
          </>}
        <div style={{ marginTop: 8 }}><button className="btn btn-sm" onClick={() => setVinculando(v => !v)}>{vinculando ? 'Fechar' : 'Vincular o pagamento à mão'}</button></div>
        {vinculando && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, color: C.gray, marginBottom: 6 }}>Marque as linhas do caixa (de {dataBR(d.vencimento)} −10 a +15 dias) que pagaram esta fatura. Marcadas: <b>{brl(somaMarcadas)}</b> de {brl(d.total)}. Os itens classificados consomem esse valor, nunca mais que ele.</div>
            <div className="table-wrap" style={{ maxHeight: 260 }}>
              <table>
                <thead><tr><th /><th>Data</th><th>Filial</th><th>Histórico</th><th>Conta</th><th style={{ textAlign: 'right' }}>Valor</th></tr></thead>
                <tbody>{d.candidatos.map(l => (
                  <tr key={l.chave}>
                    <td><input type="checkbox" checked={marcadas.has(l.chave)} onChange={e => setMarcadas(s => { const n = new Set(Array.from(s)); if (e.target.checked) n.add(l.chave); else n.delete(l.chave); return n })} /></td>
                    <td>{dataBR(l.data)}</td><td>{l.filial}</td><td>{l.historico}</td><td style={{ fontSize: 11 }}>{l.conta}</td><td style={{ textAlign: 'right' }}>{brl(l.valor)}</td>
                  </tr>))}
                  {!d.candidatos.length && <tr><td colSpan={6} style={{ color: C.gray }}>Nenhuma linha do caixa realizado nesse período.</td></tr>}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}><button className="btn btn-sm btn-primary" onClick={salvarVinculos}>Salvar vínculo</button></div>
          </div>
        )}
      </div>

      {/* classificação */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '14px 0 8px' }}>
        <label style={{ fontSize: 12, color: C.gray }}>Contas da loja&nbsp;
          <select className="form-select" style={{ width: 180 }} value={loja} onChange={e => setLoja(e.target.value)}>
            <option value="">todas as lojas</option>{lojas.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12, color: C.gray }}><input type="checkbox" checked={antigas} onChange={e => setAntigas(e.target.checked)} /> incluir contas antigas (até ago/26)</label>
        <label style={{ fontSize: 12, color: C.gray }}><input type="checkbox" checked={soAbertos} onChange={e => setSoAbertos(e.target.checked)} /> só a classificar</label>
        {comSugestao.length > 0 && <button className="btn btn-sm" onClick={async () => {
          const grupos = new Map<string, number[]>(); comSugestao.forEach(i => { const a = grupos.get(i.sugestao!) ?? []; a.push(i.id); grupos.set(i.sugestao!, a) })
          const lote = Array.from(grupos.entries())
          for (let k = 0; k < lote.length; k++) await classificar(lote[k][1], lote[k][0])
        }}>Usar as {comSugestao.length} sugestões</button>}
      </div>
      {sel.size > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, padding: 8, background: '#eef2ff', borderRadius: 6, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 13 }}>{sel.size} selecionados</b>
          <input className="form-input" list="contas-cartao" placeholder="Conta para todos…" style={{ minWidth: 380 }} value={contaLote} onChange={e => setContaLote(e.target.value)} />
          <button className="btn btn-sm btn-primary" onClick={() => { const c = contaDoRotulo(contaLote); if (!c) { showToast('Escolha uma conta da lista.'); return } classificar(Array.from(sel), c); setContaLote('') }}>Classificar</button>
          <button className="btn btn-sm" onClick={() => classificar(Array.from(sel), null)}>Tirar a conta</button>
          <button className="btn btn-sm" onClick={() => setSel(new Set())}>Limpar seleção</button>
        </div>
      )}
      <div className="table-wrap" style={{ maxHeight: '60vh' }}>
        <table>
          <thead><tr>
            <th><input type="checkbox" checked={itens.length > 0 && itens.every(i => sel.has(i.id))} onChange={e => setSel(e.target.checked ? new Set(itens.map(i => i.id)) : new Set())} /></th>
            <th>Compra</th><th>Descrição</th><th>Parcela</th><th style={{ textAlign: 'right' }}>Valor</th><th style={{ minWidth: 360 }}>Conta</th><th>Situação</th>
          </tr></thead>
          <tbody>
            {itens.map(i => {
              const conta = i.caminho ? porCaminho.get(i.caminho) : null
              const sug = !i.caminho && i.sugestao ? porCaminho.get(i.sugestao) : null
              return (
                <Fragment key={i.id}>
                  <tr>
                    <td><input type="checkbox" checked={sel.has(i.id)} onChange={e => setSel(s => { const n = new Set(Array.from(s)); if (e.target.checked) n.add(i.id); else n.delete(i.id); return n })} /></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{dataBR(i.data)}</td>
                    <td>{i.descricao}{i.portador && <div style={{ fontSize: 11, color: C.gray }}>{i.portador}</div>}</td>
                    <td>{i.parcela ?? '—'}</td>
                    <td style={{ textAlign: 'right', color: i.valor < 0 ? C.green : undefined }}>{brl(i.valor)}</td>
                    <td>
                      <input key={`${i.id}-${i.caminho ?? ''}`} className="form-input" list="contas-cartao" placeholder="Escolha a conta…"
                        defaultValue={conta ? rotulo(conta) : (i.caminho ?? '')}
                        onChange={e => { const c = porRotulo.get(e.target.value); if (c && c !== i.caminho) classificar([i.id], c) }}
                        onBlur={e => { const txt = e.target.value.trim(); if (!txt) { if (i.caminho) classificar([i.id], null); return } if (!contaDoRotulo(txt)) { showToast('Escolha uma conta da lista.'); e.target.value = conta ? rotulo(conta) : '' } }} />
                      {sug && <button className="btn btn-sm" style={{ marginTop: 4, fontSize: 11 }} onClick={() => classificar([i.id], sug.caminho)}>usar sugestão: {sug.folha}</button>}
                    </td>
                    <td><span className="badge" style={{ background: 'transparent', border: `1px solid ${ESTADO[i.estado].cor}`, color: ESTADO[i.estado].cor, whiteSpace: 'nowrap' }}>{ESTADO[i.estado].txt}{i.estado === 'NA_DRE' && i.mes ? ` ${mesBR(i.mes)}` : ''}</span></td>
                  </tr>
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
