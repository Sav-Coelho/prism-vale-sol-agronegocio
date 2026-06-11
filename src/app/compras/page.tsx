'use client'
import { useEffect, useMemo, useState } from 'react'
import Shell from '@/components/Shell'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend
} from 'recharts'

type Tab = 'buyers' | 'suppliers' | 'purchases' | 'cashflow'

type Buyer = {
  id: number
  name: string
  monthlyBudget: number
  active: boolean
  purchases?: { id: number; totalAmount: number; month: number; year: number; status: string }[]
}

type Supplier = {
  id: number
  name: string
  cnpj?: string | null
  contactName?: string | null
  email?: string | null
  phone?: string | null
  paymentTermDays?: number
  notes?: string | null
  active?: boolean
  purchaseOrders?: { id: number; totalAmount: number }[]
}
type Unit = { id: number; name: string }

type Installment = {
  id?: number
  dueDate: string
  amount: number
  status?: 'PENDING' | 'PAID'
  paidDate?: string | null
}

type Purchase = {
  id: number
  supplierId: number
  supplier: Supplier
  buyerId?: number | null
  buyer?: Buyer | null
  unitId?: number | null
  unit?: Unit | null
  description?: string | null
  invoiceNumber?: string | null
  totalAmount: number
  expectedDate?: string | null
  month: number
  year: number
  installments: Installment[]
}

type CashflowPoint = {
  key: string
  label: string
  month: number
  year: number
  pending: number
  paid: number
  overdue: number
  total: number
}

const fmt = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtDate = (d?: string | null) => d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—'
const monthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
const nowKey = monthKey(new Date())

const COLORS = {
  dark:   '#2b2d42',
  yellow: '#eaca2d',
  green:  '#1a7a4a',
  red:    '#c0392b',
  blue:   '#3a6ea5',
  gray:   '#8d99ae',
  light:  '#edf2f4',
}

export default function Compras() {
  const [tab, setTab] = useState<Tab>('buyers')
  const [toast, setToast] = useState('')
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3000) }

  // ───── Shared state ─────
  const [buyers, setBuyers] = useState<Buyer[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [cashflow, setCashflow] = useState<CashflowPoint[]>([])
  const [cashflowSummary, setCashflowSummary] = useState({ overdueTotal: 0, pendingFutureTotal: 0 })
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const [b, p, s, u, c] = await Promise.all([
      fetch('/api/buyers').then(r => r.json()),
      fetch('/api/purchase-orders').then(r => r.json()),
      fetch('/api/suppliers').then(r => r.json()),
      fetch('/api/units').then(r => r.json()),
      fetch('/api/purchase-orders/cashflow?months=12').then(r => r.json()),
    ])
    setBuyers(b)
    setPurchases(p)
    setSuppliers(s)
    setUnits(u)
    setCashflow(c.series || [])
    setCashflowSummary({ overdueTotal: c.overdueTotal || 0, pendingFutureTotal: c.pendingFutureTotal || 0 })
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  return (
    <Shell>
      <div className="page-header">
        <h1 className="page-title">Controle de Compras</h1>
        <p className="page-subtitle">Compradores, lançamentos parcelados e comprometimento do caixa</p>
      </div>

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--brave-light)', marginBottom: 20 }}>
        {([
          ['buyers',    '👤 Compradores'],
          ['suppliers', '🏭 Fornecedores'],
          ['purchases', '📦 Lançamentos de Compra'],
          ['cashflow',  '📊 Fluxo Futuro'],
        ] as [Tab, string][]).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            style={{
              background: 'none',
              border: 'none',
              padding: '12px 18px',
              cursor: 'pointer',
              fontFamily: 'var(--font-sub)',
              fontWeight: 600,
              fontSize: 13,
              color: tab === k ? 'var(--brave-dark)' : 'var(--brave-gray)',
              borderBottom: `2px solid ${tab === k ? 'var(--brave-yellow)' : 'transparent'}`,
              marginBottom: -1,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--brave-gray)' }}>Carregando...</div>
      ) : (
        <>
          {tab === 'buyers'    && <BuyersTab    buyers={buyers} purchases={purchases} onChange={load} showToast={showToast} />}
          {tab === 'suppliers' && <SuppliersTab suppliers={suppliers} onChange={load} showToast={showToast} />}
          {tab === 'purchases' && <PurchasesTab buyers={buyers} suppliers={suppliers} units={units} purchases={purchases} onChange={load} showToast={showToast} />}
          {tab === 'cashflow'  && <CashflowTab  cashflow={cashflow} summary={cashflowSummary} />}
        </>
      )}

      {toast && <div className="toast">{toast}</div>}
    </Shell>
  )
}

// ──────────────────────────────────────────────────────────
//  Aba: Fornecedores
// ──────────────────────────────────────────────────────────
function SuppliersTab({ suppliers, onChange, showToast }: {
  suppliers: Supplier[]; onChange: () => void; showToast: (m: string) => void
}) {
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [name, setName] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [contact, setContact] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [terms, setTerms] = useState('30')
  const [notes, setNotes] = useState('')

  const openNew = () => {
    setEditing(null); setName(''); setCnpj(''); setContact(''); setEmail(''); setPhone(''); setTerms('30'); setNotes(''); setModal(true)
  }
  const openEdit = (s: Supplier) => {
    setEditing(s)
    setName(s.name)
    setCnpj(s.cnpj || ''); setContact(s.contactName || ''); setEmail(s.email || ''); setPhone(s.phone || '')
    setTerms(String(s.paymentTermDays ?? 30)); setNotes(s.notes || '')
    setModal(true)
  }

  const save = async () => {
    if (!name.trim()) return
    const url = editing ? `/api/suppliers/${editing.id}` : '/api/suppliers'
    const method = editing ? 'PUT' : 'POST'
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name, cnpj, contactName: contact, email, phone,
        paymentTermDays: parseInt(terms) || 30, notes,
      }),
    })
    const data = await res.json()
    if (!res.ok) { showToast(`Erro: ${data.error}`); return }
    setModal(false)
    onChange()
    showToast(editing ? '✓ Fornecedor atualizado' : '✓ Fornecedor cadastrado')
  }

  const remove = async (s: Supplier) => {
    if (!confirm(`Excluir fornecedor "${s.name}"?`)) return
    const res = await fetch(`/api/suppliers/${s.id}`, { method: 'DELETE' })
    const data = await res.json()
    if (!res.ok) { showToast(`Erro: ${data.error}`); return }
    onChange()
    showToast('✓ Fornecedor excluído')
  }

  // Spend by supplier (all-time, from purchaseOrders included in API response)
  const spendBySupplier = suppliers
    .map(s => ({
      name: s.name,
      total: (s.purchaseOrders || []).reduce((acc, o) => acc + o.totalAmount, 0),
      orders: (s.purchaseOrders || []).length,
    }))
    .filter(x => x.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 12)

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: 'var(--brave-gray)' }}>
          {suppliers.length} fornecedor{suppliers.length !== 1 ? 'es' : ''} cadastrado{suppliers.length !== 1 ? 's' : ''}
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ Novo Fornecedor</button>
      </div>

      {spendBySupplier.length > 0 && (
        <div className="card mb-6">
          <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
            Gasto Acumulado por Fornecedor (top 12)
          </div>
          <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 14 }}>
            Soma de todas as compras emitidas a cada fornecedor
          </div>
          <ResponsiveContainer width="100%" height={Math.max(220, spendBySupplier.length * 32 + 40)}>
            <BarChart data={spendBySupplier} layout="vertical" margin={{ left: 80 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.light} />
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={140} />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Bar dataKey="total" name="Total" fill={COLORS.dark} radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fornecedor</th>
                <th>CNPJ</th>
                <th>Contato</th>
                <th>Telefone</th>
                <th style={{ textAlign: 'right' }}>Prazo padrão (dias)</th>
                <th style={{ textAlign: 'right' }}># Compras</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {suppliers.length === 0 && (
                <tr><td colSpan={7} style={{ padding: 40, textAlign: 'center', color: 'var(--brave-gray)' }}>
                  Nenhum fornecedor cadastrado.
                </td></tr>
              )}
              {suppliers.map(s => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.name}</td>
                  <td style={{ fontSize: 12, color: 'var(--brave-gray)' }}>{s.cnpj || '—'}</td>
                  <td style={{ fontSize: 13 }}>
                    {s.contactName || '—'}
                    {s.email && <div style={{ fontSize: 11, color: 'var(--brave-gray)' }}>{s.email}</div>}
                  </td>
                  <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{s.phone || '—'}</td>
                  <td style={{ textAlign: 'right' }}>{s.paymentTermDays ?? 30}</td>
                  <td style={{ textAlign: 'right', fontSize: 12 }}>{s.purchaseOrders?.length ?? 0}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-sm" onClick={() => openEdit(s)}>✏️</button>
                    <button className="btn btn-sm btn-danger" onClick={() => remove(s)} style={{ marginLeft: 4 }}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, overflow: 'auto', padding: 20 }}>
          <div className="card" style={{ width: 500, padding: 24, maxHeight: '90vh', overflow: 'auto' }}>
            <h3 style={{ fontFamily: 'var(--font-sub)', marginBottom: 16 }}>
              {editing ? 'Editar' : 'Novo'} Fornecedor
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={{ fontSize: 12, color: 'var(--brave-gray)' }}>Nome / Razão Social *</label>
                <input className="form-input" style={{ width: '100%' }} value={name} onChange={e => setName(e.target.value)} autoFocus />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--brave-gray)' }}>CNPJ</label>
                <input className="form-input" style={{ width: '100%' }} value={cnpj} onChange={e => setCnpj(e.target.value)} placeholder="00.000.000/0000-00" />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--brave-gray)' }}>Prazo padrão (dias)</label>
                <input type="number" className="form-input" style={{ width: '100%' }} value={terms} onChange={e => setTerms(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--brave-gray)' }}>Contato</label>
                <input className="form-input" style={{ width: '100%' }} value={contact} onChange={e => setContact(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--brave-gray)' }}>Telefone</label>
                <input className="form-input" style={{ width: '100%' }} value={phone} onChange={e => setPhone(e.target.value)} />
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={{ fontSize: 12, color: 'var(--brave-gray)' }}>Email</label>
                <input className="form-input" style={{ width: '100%' }} value={email} onChange={e => setEmail(e.target.value)} />
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={{ fontSize: 12, color: 'var(--brave-gray)' }}>Observações</label>
                <textarea className="form-input" style={{ width: '100%', minHeight: 60 }} value={notes} onChange={e => setNotes(e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn" onClick={() => setModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={save} disabled={!name.trim()}>Salvar</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ──────────────────────────────────────────────────────────
//  Aba 1: Compradores
// ──────────────────────────────────────────────────────────
function BuyersTab({ buyers, purchases, onChange, showToast }: {
  buyers: Buyer[]; purchases: Purchase[]; onChange: () => void; showToast: (m: string) => void
}) {
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<Buyer | null>(null)
  const [name, setName] = useState('')
  const [budget, setBudget] = useState('')

  const openNew  = () => { setEditing(null); setName(''); setBudget(''); setModal(true) }
  const openEdit = (b: Buyer) => { setEditing(b); setName(b.name); setBudget(String(b.monthlyBudget)); setModal(true) }

  const save = async () => {
    if (!name.trim()) return
    const url = editing ? `/api/buyers/${editing.id}` : '/api/buyers'
    const method = editing ? 'PUT' : 'POST'
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, monthlyBudget: budget }),
    })
    const data = await res.json()
    if (!res.ok) { showToast(`Erro: ${data.error}`); return }
    setModal(false)
    onChange()
    showToast(editing ? '✓ Comprador atualizado' : '✓ Comprador cadastrado')
  }

  const remove = async (b: Buyer) => {
    if (!confirm(`Excluir comprador "${b.name}"?`)) return
    const res = await fetch(`/api/buyers/${b.id}`, { method: 'DELETE' })
    const data = await res.json()
    if (!res.ok) { showToast(`Erro: ${data.error}`); return }
    onChange()
    showToast('✓ Comprador excluído')
  }

  // Compute current-month usage per buyer
  const chartData = buyers.map(b => {
    const usedThisMonth = (b.purchases || [])
      .filter(p => `${p.year}-${String(p.month).padStart(2, '0')}` === nowKey)
      .reduce((s, p) => s + p.totalAmount, 0)
    const remaining = Math.max(0, b.monthlyBudget - usedThisMonth)
    const usagePct = b.monthlyBudget > 0 ? (usedThisMonth / b.monthlyBudget) * 100 : 0
    return {
      name: b.name,
      'Utilizado': usedThisMonth,
      'Disponível': remaining,
      usagePct,
      budget: b.monthlyBudget,
    }
  })

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: 'var(--brave-gray)' }}>
          {buyers.length} comprador{buyers.length !== 1 ? 'es' : ''} cadastrado{buyers.length !== 1 ? 's' : ''}
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ Novo Comprador</button>
      </div>

      <div className="card mb-6">
        <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
          Orçamento utilizado neste mês
        </div>
        <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 14 }}>
          Comparativo do utilizado vs. disponível em relação ao orçamento mensal de cada comprador
        </div>
        <ResponsiveContainer width="100%" height={Math.max(220, buyers.length * 38 + 40)}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 80 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.light} />
            <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} />
            <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={140} />
            <Tooltip formatter={(v: number) => fmt(v)} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="Utilizado"  stackId="x" fill={COLORS.red}    />
            <Bar dataKey="Disponível" stackId="x" fill={COLORS.green}  />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Comprador</th>
                <th style={{ textAlign: 'right' }}>Orçamento Mensal</th>
                <th style={{ textAlign: 'right' }}>Utilizado (mês atual)</th>
                <th style={{ textAlign: 'right' }}>Disponível</th>
                <th style={{ textAlign: 'right' }}>% do Limite</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {buyers.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center', color: 'var(--brave-gray)' }}>
                  Nenhum comprador cadastrado.
                </td></tr>
              )}
              {chartData.map((row, i) => {
                const b = buyers[i]
                return (
                  <tr key={b.id}>
                    <td style={{ fontWeight: 600 }}>{row.name}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(row.budget)}</td>
                    <td style={{ textAlign: 'right', color: COLORS.red }}>{fmt(row.Utilizado)}</td>
                    <td style={{ textAlign: 'right', color: COLORS.green }}>{fmt(row.Disponível)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600, color: row.usagePct > 100 ? COLORS.red : row.usagePct > 80 ? '#d35400' : COLORS.dark }}>
                      {row.usagePct.toFixed(0)}%
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-sm" onClick={() => openEdit(b)}>✏️</button>
                      <button className="btn btn-sm btn-danger" onClick={() => remove(b)} style={{ marginLeft: 4 }}>✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div className="card" style={{ width: 380, padding: 24 }}>
            <h3 style={{ fontFamily: 'var(--font-sub)', marginBottom: 16 }}>{editing ? 'Editar' : 'Novo'} Comprador</h3>
            <label style={{ fontSize: 12, color: 'var(--brave-gray)' }}>Nome</label>
            <input className="form-input" style={{ width: '100%', marginBottom: 12 }} value={name} onChange={e => setName(e.target.value)} autoFocus />
            <label style={{ fontSize: 12, color: 'var(--brave-gray)' }}>Orçamento Mensal (R$)</label>
            <input className="form-input" style={{ width: '100%', marginBottom: 16 }} type="number" step="0.01" value={budget} onChange={e => setBudget(e.target.value)} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={save} disabled={!name.trim()}>Salvar</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ──────────────────────────────────────────────────────────
//  Aba 2: Lançamentos de compra
// ──────────────────────────────────────────────────────────
function PurchasesTab({ buyers, suppliers, units, purchases, onChange, showToast }: {
  buyers: Buyer[]; suppliers: Supplier[]; units: Unit[]; purchases: Purchase[]; onChange: () => void; showToast: (m: string) => void
}) {
  const [modal, setModal] = useState(false)
  const [buyerId, setBuyerId] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [unitId, setUnitId] = useState('')
  const [description, setDescription] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [totalAmount, setTotalAmount] = useState('')
  const [parcels, setParcels] = useState<{ days: number; amount: string }[]>([{ days: 30, amount: '' }])

  const openNew = () => {
    setBuyerId(''); setSupplierId(''); setUnitId('')
    setDescription(''); setInvoiceNumber('')
    setPurchaseDate(new Date().toISOString().slice(0, 10))
    setTotalAmount('')
    setParcels([{ days: 30, amount: '' }])
    setModal(true)
  }

  // Distribute total evenly across parcels when total changes (unless user typed amounts)
  const totalParcels = useMemo(
    () => parcels.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0),
    [parcels]
  )

  const splitEvenly = () => {
    const t = parseFloat(totalAmount) || 0
    if (t <= 0 || parcels.length === 0) return
    const each = (t / parcels.length).toFixed(2)
    setParcels(prev => prev.map(p => ({ ...p, amount: each })))
  }

  const set303090 = () => {
    const t = parseFloat(totalAmount) || 0
    if (t <= 0) return
    const each = (t / 3).toFixed(2)
    setParcels([
      { days: 30, amount: each },
      { days: 60, amount: each },
      { days: 90, amount: each },
    ])
  }

  const addParcel  = () => setParcels(p => [...p, { days: (p[p.length - 1]?.days || 0) + 30, amount: '' }])
  const rmParcel   = (i: number) => setParcels(p => p.filter((_, k) => k !== i))
  const updParcel  = (i: number, k: 'days' | 'amount', v: string) =>
    setParcels(p => p.map((x, idx) => idx === i ? { ...x, [k]: k === 'days' ? parseInt(v) || 0 : v } : x))

  const save = async () => {
    if (!supplierId)  { showToast('Selecione o fornecedor'); return }
    if (!buyerId)     { showToast('Selecione o comprador');  return }
    const total = parseFloat(totalAmount) || 0
    if (total <= 0)   { showToast('Valor total inválido');   return }
    const sumParcels = parcels.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0)
    if (Math.abs(sumParcels - total) > 0.01) {
      showToast(`Soma das parcelas (${fmt(sumParcels)}) ≠ total (${fmt(total)})`)
      return
    }
    const base = new Date(purchaseDate)
    const installments = parcels.map(p => {
      const due = new Date(base)
      due.setDate(due.getDate() + p.days)
      return { dueDate: due.toISOString(), amount: parseFloat(p.amount) }
    })
    const res = await fetch('/api/purchase-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        supplierId, buyerId, unitId: unitId || null,
        description, invoiceNumber,
        expectedDate: purchaseDate,
        totalAmount: total,
        installments,
        status: 'CONFIRMED',
      }),
    })
    const data = await res.json()
    if (!res.ok) { showToast(`Erro: ${data.error}`); return }
    setModal(false)
    onChange()
    showToast('✓ Compra registrada')
  }

  const togglePay = async (purchaseId: number, installmentId: number, currentlyPaid: boolean) => {
    const res = await fetch(`/api/purchase-orders/${purchaseId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pay-installment', installmentId, paid: !currentlyPaid }),
    })
    if (res.ok) { onChange(); showToast(currentlyPaid ? '✓ Marcada como pendente' : '✓ Parcela paga') }
  }

  const remove = async (p: Purchase) => {
    if (!confirm(`Excluir compra de ${fmt(p.totalAmount)} (${p.supplier.name})?`)) return
    const res = await fetch(`/api/purchase-orders/${p.id}`, { method: 'DELETE' })
    if (res.ok) { onChange(); showToast('✓ Compra excluída') }
  }

  // Sort newest first
  const sorted = [...purchases].sort((a, b) => (b.expectedDate || '').localeCompare(a.expectedDate || ''))

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: 'var(--brave-gray)' }}>
          {purchases.length} compra{purchases.length !== 1 ? 's' : ''} registrada{purchases.length !== 1 ? 's' : ''}
        </div>
        <button className="btn btn-primary" onClick={openNew} disabled={buyers.length === 0 || suppliers.length === 0}>
          + Nova Compra
        </button>
      </div>

      {(buyers.length === 0 || suppliers.length === 0) && (
        <div className="card" style={{ marginBottom: 16, background: '#fef9e7', borderLeft: `3px solid ${COLORS.yellow}` }}>
          <div style={{ fontSize: 13 }}>
            Pra registrar compras, cadastre primeiro:
            {buyers.length === 0    && <div>• Pelo menos um <b>comprador</b> na aba Compradores</div>}
            {suppliers.length === 0 && <div>• Pelo menos um <b>fornecedor</b> na aba Fornecedores</div>}
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Comprador</th>
                <th>Fornecedor</th>
                <th>NF / Descrição</th>
                <th style={{ textAlign: 'right' }}>Valor</th>
                <th style={{ textAlign: 'right' }}>Restante Orçamento</th>
                <th>Parcelas</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 40, textAlign: 'center', color: 'var(--brave-gray)' }}>
                  Nenhuma compra registrada.
                </td></tr>
              )}
              {sorted.map(p => {
                const buyer = buyers.find(b => b.id === p.buyerId)
                const usedSameMonth = purchases
                  .filter(x => x.buyerId === p.buyerId && x.month === p.month && x.year === p.year)
                  .reduce((s, x) => s + x.totalAmount, 0)
                const remaining = buyer ? Math.max(0, buyer.monthlyBudget - usedSameMonth) : 0
                return (
                  <tr key={p.id}>
                    <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDate(p.expectedDate)}</td>
                    <td style={{ fontSize: 13 }}>{buyer?.name || '—'}</td>
                    <td style={{ fontSize: 13 }}>{p.supplier.name}</td>
                    <td>
                      <div style={{ fontSize: 13 }}>{p.invoiceNumber || '—'}</div>
                      {p.description && <div style={{ fontSize: 11, color: 'var(--brave-gray)' }}>{p.description}</div>}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(p.totalAmount)}</td>
                    <td style={{ textAlign: 'right', fontSize: 12, color: remaining > 0 ? COLORS.green : COLORS.red }}>
                      {buyer ? fmt(remaining) : '—'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {p.installments.map(ins => {
                          const paid = ins.status === 'PAID'
                          const isOverdue = !paid && ins.dueDate && new Date(ins.dueDate) < new Date()
                          return (
                            <button
                              key={ins.id}
                              onClick={() => togglePay(p.id, ins.id!, paid)}
                              style={{
                                fontSize: 11,
                                background: paid ? '#e8f6ef' : isOverdue ? '#fdecea' : '#eef0f5',
                                color:      paid ? COLORS.green : isOverdue ? COLORS.red : COLORS.dark,
                                border: 'none',
                                borderRadius: 4,
                                padding: '3px 8px',
                                cursor: 'pointer',
                                textAlign: 'left',
                              }}
                              title={paid ? 'Clique para desmarcar' : 'Clique para marcar como paga'}
                            >
                              {paid ? '✓' : isOverdue ? '⚠' : '○'} {fmtDate(ins.dueDate)} — {fmt(ins.amount)}
                            </button>
                          )
                        })}
                      </div>
                    </td>
                    <td><button className="btn btn-sm btn-danger" onClick={() => remove(p)}>✕</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, overflow: 'auto', padding: 20 }}>
          <div className="card" style={{ width: 560, padding: 24, maxHeight: '90vh', overflow: 'auto' }}>
            <h3 style={{ fontFamily: 'var(--font-sub)', marginBottom: 16 }}>Nova Compra</h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--brave-gray)' }}>Comprador</label>
                <select className="form-select" style={{ width: '100%' }} value={buyerId} onChange={e => setBuyerId(e.target.value)}>
                  <option value="">Selecione…</option>
                  {buyers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--brave-gray)' }}>Fornecedor</label>
                <select className="form-select" style={{ width: '100%' }} value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                  <option value="">Selecione…</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--brave-gray)' }}>Unidade</label>
                <select className="form-select" style={{ width: '100%' }} value={unitId} onChange={e => setUnitId(e.target.value)}>
                  <option value="">—</option>
                  {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--brave-gray)' }}>Data da Compra</label>
                <input type="date" className="form-input" style={{ width: '100%' }} value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--brave-gray)' }}>Nº NF</label>
                <input className="form-input" style={{ width: '100%' }} value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--brave-gray)' }}>Valor Total (R$)</label>
                <input type="number" step="0.01" className="form-input" style={{ width: '100%' }} value={totalAmount} onChange={e => setTotalAmount(e.target.value)} />
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={{ fontSize: 12, color: 'var(--brave-gray)' }}>Descrição</label>
              <input className="form-input" style={{ width: '100%' }} value={description} onChange={e => setDescription(e.target.value)} />
            </div>

            <div style={{ marginTop: 16, borderTop: '1px solid var(--brave-light)', paddingTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13 }}>Parcelas</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="btn btn-sm" onClick={set303090}>30/60/90</button>
                  <button type="button" className="btn btn-sm" onClick={splitEvenly}>Dividir igualmente</button>
                  <button type="button" className="btn btn-sm" onClick={addParcel}>+ Parcela</button>
                </div>
              </div>

              {parcels.map((p, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr auto', gap: 8, marginBottom: 6, alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input type="number" min="0" className="form-input" style={{ width: 60 }} value={p.days} onChange={e => updParcel(i, 'days', e.target.value)} />
                    <span style={{ fontSize: 11, color: 'var(--brave-gray)' }}>dias</span>
                  </div>
                  <input type="number" step="0.01" placeholder="Valor (R$)" className="form-input" value={p.amount} onChange={e => updParcel(i, 'amount', e.target.value)} />
                  <div style={{ fontSize: 11, color: 'var(--brave-gray)' }}>
                    Venc: {(() => {
                      const d = new Date(purchaseDate); d.setDate(d.getDate() + p.days)
                      return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' })
                    })()}
                  </div>
                  {parcels.length > 1 && (
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => rmParcel(i)}>✕</button>
                  )}
                </div>
              ))}

              <div style={{ fontSize: 12, color: Math.abs(totalParcels - (parseFloat(totalAmount) || 0)) > 0.01 ? COLORS.red : COLORS.green, marginTop: 6 }}>
                Soma das parcelas: {fmt(totalParcels)} {totalAmount && ` / ${fmt(parseFloat(totalAmount))}`}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button className="btn" onClick={() => setModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={save}>Salvar Compra</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ──────────────────────────────────────────────────────────
//  Aba 3: Fluxo Futuro
// ──────────────────────────────────────────────────────────
function CashflowTab({ cashflow, summary }: { cashflow: CashflowPoint[]; summary: { overdueTotal: number; pendingFutureTotal: number } }) {
  const totalSeries = cashflow.reduce((s, p) => s + p.total, 0)

  return (
    <>
      <div style={{ display: 'flex', gap: 20, fontSize: 13, color: 'var(--brave-gray)', marginBottom: 16 }}>
        <div>Total a pagar próximos 12 meses: <b style={{ color: 'var(--brave-dark)' }}>{fmt(totalSeries)}</b></div>
        {summary.overdueTotal > 0 && (
          <div>Vencidas em aberto: <b style={{ color: COLORS.red }}>{fmt(summary.overdueTotal)}</b></div>
        )}
        <div>Comprometido a vencer: <b style={{ color: 'var(--brave-dark)' }}>{fmt(summary.pendingFutureTotal)}</b></div>
      </div>

      <div className="card mb-6">
        <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
          Comprometimento de Caixa — próximos 12 meses
        </div>
        <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 14 }}>
          Empilhado por status: <b style={{ color: COLORS.green }}>pago</b> · <b style={{ color: COLORS.blue }}>a vencer</b> · <b style={{ color: COLORS.red }}>vencido em aberto</b>
        </div>
        <ResponsiveContainer width="100%" height={340}>
          <BarChart data={cashflow}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.light} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} />
            <Tooltip formatter={(v: number) => fmt(v)} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="paid"    name="Pago"    stackId="x" fill={COLORS.green} />
            <Bar dataKey="pending" name="A vencer" stackId="x" fill={COLORS.blue} />
            <Bar dataKey="overdue" name="Vencido"  stackId="x" fill={COLORS.red} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Mês</th>
                <th style={{ textAlign: 'right' }}>Pago</th>
                <th style={{ textAlign: 'right' }}>A vencer</th>
                <th style={{ textAlign: 'right' }}>Vencido</th>
                <th style={{ textAlign: 'right' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {cashflow.map(p => (
                <tr key={p.key}>
                  <td style={{ fontWeight: 600 }}>{p.label}</td>
                  <td style={{ textAlign: 'right', color: COLORS.green }}>{fmt(p.paid)}</td>
                  <td style={{ textAlign: 'right', color: COLORS.blue  }}>{fmt(p.pending)}</td>
                  <td style={{ textAlign: 'right', color: COLORS.red   }}>{fmt(p.overdue)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(p.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
