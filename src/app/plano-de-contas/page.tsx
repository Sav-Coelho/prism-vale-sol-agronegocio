'use client'
import { useEffect, useState, useRef } from 'react'
import Shell from '@/components/Shell'

const TYPES = ['RECEITA', 'DEDUCAO', 'CUSTO', 'DESPESA', 'IMPOSTO', 'NEUTRO']

type DreGroupRow = {
  id: number
  name: string
  type: string
  section: string
  sortOrder: number
  protected: boolean
}

// UI-side mapping: section → human label and which DRE block it belongs to
const SECTION_OPTIONS: { value: string; label: string; type: string }[] = [
  { value: 'RECEITA_OP',    label: 'Receita Operacional',     type: 'RECEITA' },
  { value: 'DEDUCAO',       label: 'Dedução sobre a Venda',   type: 'DEDUCAO' },
  { value: 'CUSTO_VAR',     label: 'Custo Variável (CMV / Variável)', type: 'CUSTO' },
  { value: 'DESPESA_FIXA',  label: 'Despesa Fixa (Admin / Pessoal / Mkt / Financeira)', type: 'DESPESA' },
  { value: 'INVESTIMENTO',  label: 'Investimento',            type: 'DESPESA' },
  { value: 'RECEITA_NOP',   label: 'Receita Não Operacional', type: 'RECEITA' },
  { value: 'DESPESA_NOP',   label: 'Despesa Não Operacional', type: 'DESPESA' },
  { value: 'IMPOSTO_LUCRO', label: 'Imposto sobre o Lucro',   type: 'IMPOSTO' },
  { value: 'NEUTRO',        label: 'Neutro (não entra no DRE)', type: 'NEUTRO' },
]

const SECTION_LABEL = Object.fromEntries(SECTION_OPTIONS.map(o => [o.value, o.label]))

// Plano de Contas — Vale do Sol (classificação importada do XLSX)
const DEFAULTS = [
  // Receita Operacional (3.1) — XLSX não traz contas próprias de venda, adicionada uma genérica
  { code: '3.1.01', name: 'Vendas / Receita do Caixa', type: 'RECEITA', dreGroup: 'Receita Operacional' },

  // Deduções sobre a Venda (3.2)
  { code: '3.2.01', name: 'DIFAL', type: 'DEDUCAO', dreGroup: 'Deduções sobre a Venda' },
  { code: '3.2.02', name: 'DIFAL MG', type: 'DEDUCAO', dreGroup: 'Deduções sobre a Venda' },
  { code: '3.2.03', name: 'Impostos e Taxas', type: 'DEDUCAO', dreGroup: 'Deduções sobre a Venda' },
  { code: '3.2.04', name: 'DAI — Documento Arrecadação Importados', type: 'DEDUCAO', dreGroup: 'Deduções sobre a Venda' },
  { code: '3.2.05', name: 'Reembolso para Cliente', type: 'DEDUCAO', dreGroup: 'Deduções sobre a Venda' },

  // Custo do Produto/Serviço (4.1)
  { code: '4.1.01', name: 'Fornecedor Mercadorias', type: 'CUSTO', dreGroup: 'Custo do Produto/Serviço' },

  // Despesa Variável (4.2)
  { code: '4.2.01', name: 'Pedágio', type: 'CUSTO', dreGroup: 'Despesa Variável' },
  { code: '4.2.02', name: 'Despesas c/Embalagens', type: 'CUSTO', dreGroup: 'Despesa Variável' },
  { code: '4.2.03', name: 'Outras Despesas c/Vendas', type: 'CUSTO', dreGroup: 'Despesa Variável' },

  // Despesas Administrativas (5.1)
  { code: '5.1.01', name: 'Água', type: 'DESPESA', dreGroup: 'Despesas Administrativas' },
  { code: '5.1.02', name: 'Aluguel de Imóveis', type: 'DESPESA', dreGroup: 'Despesas Administrativas' },
  { code: '5.1.03', name: 'Aluguel de Veículos', type: 'DESPESA', dreGroup: 'Despesas Administrativas' },
  { code: '5.1.04', name: 'Conservação e Limpeza', type: 'DESPESA', dreGroup: 'Despesas Administrativas' },
  { code: '5.1.05', name: 'Consultorias', type: 'DESPESA', dreGroup: 'Despesas Administrativas' },
  { code: '5.1.06', name: 'Correios', type: 'DESPESA', dreGroup: 'Despesas Administrativas' },
  { code: '5.1.07', name: 'CRMV', type: 'DESPESA', dreGroup: 'Despesas Administrativas' },
  { code: '5.1.08', name: 'Energia Elétrica', type: 'DESPESA', dreGroup: 'Despesas Administrativas' },
  { code: '5.1.09', name: 'Frete', type: 'DESPESA', dreGroup: 'Despesas Administrativas' },
  { code: '5.1.10', name: 'Honorário Contábil', type: 'DESPESA', dreGroup: 'Despesas Administrativas' },
  { code: '5.1.11', name: 'Honorário Jurídico', type: 'DESPESA', dreGroup: 'Despesas Administrativas' },
  { code: '5.1.12', name: 'Informática e Acessórios', type: 'DESPESA', dreGroup: 'Despesas Administrativas' },
  { code: '5.1.13', name: 'Internet', type: 'DESPESA', dreGroup: 'Despesas Administrativas' },
  { code: '5.1.14', name: 'Manutenção e Conservação', type: 'DESPESA', dreGroup: 'Despesas Administrativas' },
  { code: '5.1.15', name: 'Material de Escritório', type: 'DESPESA', dreGroup: 'Despesas Administrativas' },
  { code: '5.1.16', name: 'Material de Uso e Consumo', type: 'DESPESA', dreGroup: 'Despesas Administrativas' },
  { code: '5.1.17', name: 'Outras Despesas', type: 'DESPESA', dreGroup: 'Despesas Administrativas' },
  { code: '5.1.18', name: 'Seguros', type: 'DESPESA', dreGroup: 'Despesas Administrativas' },
  { code: '5.1.19', name: 'Serv. Terc. Pessoa Física', type: 'DESPESA', dreGroup: 'Despesas Administrativas' },
  { code: '5.1.20', name: 'Serv. Terc. Pessoa Jurídica', type: 'DESPESA', dreGroup: 'Despesas Administrativas' },
  { code: '5.1.21', name: 'Sistema', type: 'DESPESA', dreGroup: 'Despesas Administrativas' },
  { code: '5.1.22', name: 'Telefone', type: 'DESPESA', dreGroup: 'Despesas Administrativas' },
  { code: '5.1.23', name: 'Viagens e Estadias', type: 'DESPESA', dreGroup: 'Despesas Administrativas' },
  { code: '5.1.24', name: 'Cartão Despesas Pré-pago', type: 'DESPESA', dreGroup: 'Despesas Administrativas' },

  // Despesas Financeiras (5.2)
  { code: '5.2.01', name: 'Tarifas Itaú', type: 'DESPESA', dreGroup: 'Despesas Financeiras' },
  { code: '5.2.02', name: 'Tarifas Safra', type: 'DESPESA', dreGroup: 'Despesas Financeiras' },
  { code: '5.2.03', name: 'Cartão de Crédito (Encargos)', type: 'DESPESA', dreGroup: 'Despesas Financeiras' },

  // Despesas com Pessoal (5.3)
  { code: '5.3.01', name: 'Folha de Pagamento', type: 'DESPESA', dreGroup: 'Despesas com Pessoal' },
  { code: '5.3.02', name: '13º Salário', type: 'DESPESA', dreGroup: 'Despesas com Pessoal' },
  { code: '5.3.03', name: 'Férias', type: 'DESPESA', dreGroup: 'Despesas com Pessoal' },
  { code: '5.3.04', name: 'Rescisão', type: 'DESPESA', dreGroup: 'Despesas com Pessoal' },
  { code: '5.3.05', name: 'FGTS', type: 'DESPESA', dreGroup: 'Despesas com Pessoal' },
  { code: '5.3.06', name: 'FGTS Ressarcível', type: 'DESPESA', dreGroup: 'Despesas com Pessoal' },
  { code: '5.3.07', name: 'DARF Previdenciário', type: 'DESPESA', dreGroup: 'Despesas com Pessoal' },
  { code: '5.3.08', name: 'Comissão', type: 'DESPESA', dreGroup: 'Despesas com Pessoal' },
  { code: '5.3.09', name: 'Vale Alimentação', type: 'DESPESA', dreGroup: 'Despesas com Pessoal' },
  { code: '5.3.10', name: 'Vale Transporte', type: 'DESPESA', dreGroup: 'Despesas com Pessoal' },
  { code: '5.3.11', name: 'Cesta Básica', type: 'DESPESA', dreGroup: 'Despesas com Pessoal' },
  { code: '5.3.12', name: 'Auxílio Academia', type: 'DESPESA', dreGroup: 'Despesas com Pessoal' },
  { code: '5.3.13', name: 'Plano de Saúde', type: 'DESPESA', dreGroup: 'Despesas com Pessoal' },
  { code: '5.3.14', name: 'Plano Odontológico', type: 'DESPESA', dreGroup: 'Despesas com Pessoal' },
  { code: '5.3.15', name: 'Seguro de Vida', type: 'DESPESA', dreGroup: 'Despesas com Pessoal' },
  { code: '5.3.16', name: 'Saúde Ocupacional (Via Med)', type: 'DESPESA', dreGroup: 'Despesas com Pessoal' },
  { code: '5.3.17', name: 'Clínica de Segurança do Trabalho', type: 'DESPESA', dreGroup: 'Despesas com Pessoal' },
  { code: '5.3.18', name: 'EPI', type: 'DESPESA', dreGroup: 'Despesas com Pessoal' },
  { code: '5.3.19', name: 'Uniforme', type: 'DESPESA', dreGroup: 'Despesas com Pessoal' },
  { code: '5.3.20', name: 'Cursos e Aperfeiçoamentos', type: 'DESPESA', dreGroup: 'Despesas com Pessoal' },
  { code: '5.3.21', name: 'Premiação Alelo', type: 'DESPESA', dreGroup: 'Despesas com Pessoal' },
  { code: '5.3.22', name: 'Outras Despesas com Folha de Pagto', type: 'DESPESA', dreGroup: 'Despesas com Pessoal' },

  // Despesas com Marketing (5.4)
  { code: '5.4.01', name: 'Propaganda e Publicidade', type: 'DESPESA', dreGroup: 'Despesas com Marketing' },
  { code: '5.4.02', name: 'Gráfica', type: 'DESPESA', dreGroup: 'Despesas com Marketing' },
  { code: '5.4.03', name: 'Patrocínio', type: 'DESPESA', dreGroup: 'Despesas com Marketing' },
  { code: '5.4.04', name: 'Brindes', type: 'DESPESA', dreGroup: 'Despesas com Marketing' },
  { code: '5.4.05', name: 'Despesas c/Eventos', type: 'DESPESA', dreGroup: 'Despesas com Marketing' },
  { code: '5.4.06', name: 'Consultorias Comerciais', type: 'DESPESA', dreGroup: 'Despesas com Marketing' },

  // Investimentos (6.1)
  { code: '6.1.01', name: 'Imobilizado', type: 'DESPESA', dreGroup: 'Investimentos' },
  { code: '6.1.02', name: 'Despesas Obra', type: 'DESPESA', dreGroup: 'Investimentos' },
  { code: '6.1.03', name: 'Compra de Veículos', type: 'DESPESA', dreGroup: 'Investimentos' },
  { code: '6.1.04', name: 'Máquinas e Equipamentos', type: 'DESPESA', dreGroup: 'Investimentos' },
  { code: '6.1.05', name: 'Móveis e Utensílios', type: 'DESPESA', dreGroup: 'Investimentos' },
  { code: '6.1.06', name: 'Patente da Marca', type: 'DESPESA', dreGroup: 'Investimentos' },

  // Receita Não Operacional (7.1)
  { code: '7.1.01', name: 'Juros Recebidos', type: 'RECEITA', dreGroup: 'Receita Não Operacional' },
  { code: '7.1.02', name: 'Adiantamento de Cliente', type: 'RECEITA', dreGroup: 'Receita Não Operacional' },
  { code: '7.1.03', name: 'Empréstimo de Cliente', type: 'RECEITA', dreGroup: 'Receita Não Operacional' },
  { code: '7.1.04', name: 'Entrada por Empréstimos', type: 'RECEITA', dreGroup: 'Receita Não Operacional' },
  { code: '7.1.05', name: 'Entrada por Devolução a Fornecedores', type: 'RECEITA', dreGroup: 'Receita Não Operacional' },
  { code: '7.1.06', name: 'Entrada de Cheque Devolvido', type: 'RECEITA', dreGroup: 'Receita Não Operacional' },
  { code: '7.1.07', name: 'Recebimento de Ch Devolvido', type: 'RECEITA', dreGroup: 'Receita Não Operacional' },
  { code: '7.1.08', name: 'Financiamento Funcionário (Crédito)', type: 'RECEITA', dreGroup: 'Receita Não Operacional' },

  // Despesas Não Operacionais (7.2)
  { code: '7.2.01', name: 'Lucros Distribuídos — Fabricio', type: 'DESPESA', dreGroup: 'Despesas Não Operacionais' },
  { code: '7.2.02', name: 'Lucros Distribuídos — Tatiana', type: 'DESPESA', dreGroup: 'Despesas Não Operacionais' },
  { code: '7.2.03', name: 'Adiantamento a Fornecedores', type: 'DESPESA', dreGroup: 'Despesas Não Operacionais' },
  { code: '7.2.04', name: 'Empréstimo a Fornecedores', type: 'DESPESA', dreGroup: 'Despesas Não Operacionais' },
  { code: '7.2.05', name: 'Pagamento de Empréstimo de Cliente', type: 'DESPESA', dreGroup: 'Despesas Não Operacionais' },
  { code: '7.2.06', name: 'Financiamento Funcionário (Débito)', type: 'DESPESA', dreGroup: 'Despesas Não Operacionais' },
  { code: '7.2.07', name: 'Saída p/Cobrança Ch Devolvido', type: 'DESPESA', dreGroup: 'Despesas Não Operacionais' },
  { code: '7.2.08', name: 'Retorno Cobrança Ch Devolvido', type: 'DESPESA', dreGroup: 'Despesas Não Operacionais' },

  // Transferência entre Contas (9.9) — não entra no DRE
  { code: '9.9.01', name: 'Transferência entre Contas', type: 'NEUTRO', dreGroup: 'Transferência entre Contas' },
  { code: '9.9.02', name: 'Transferência entre Lojas (Entrada)', type: 'NEUTRO', dreGroup: 'Transferência entre Contas' },
  { code: '9.9.03', name: 'Transferência entre Lojas (Saída)', type: 'NEUTRO', dreGroup: 'Transferência entre Contas' },
  { code: '9.9.04', name: 'Transferência Consignação Cartão', type: 'NEUTRO', dreGroup: 'Transferência entre Contas' },
  { code: '9.9.05', name: 'Transferência Numerário (Entrada)', type: 'NEUTRO', dreGroup: 'Transferência entre Contas' },
  { code: '9.9.06', name: 'Depósito C/C', type: 'NEUTRO', dreGroup: 'Transferência entre Contas' },
  { code: '9.9.07', name: 'Suprimento de Caixa', type: 'NEUTRO', dreGroup: 'Transferência entre Contas' },
  { code: '9.9.08', name: 'Saldo Anterior', type: 'NEUTRO', dreGroup: 'Transferência entre Contas' },
  { code: '9.9.09', name: 'Saldo Bloqueado', type: 'NEUTRO', dreGroup: 'Transferência entre Contas' },
]

export default function PlanoDeContas() {
  const [accounts, setAccounts] = useState<any[]>([])
  const [dreGroups, setDreGroups] = useState<DreGroupRow[]>([])
  const [form, setForm] = useState({ code: '', name: '', type: 'RECEITA', dreGroup: 'Receita Operacional' })
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const [seeding, setSeeding] = useState(false)
  const [importing, setImporting] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)

  // DreGroup modal state
  const [grpModal, setGrpModal] = useState(false)
  const [grpEditing, setGrpEditing] = useState<DreGroupRow | null>(null)
  const [grpName, setGrpName] = useState('')
  const [grpSection, setGrpSection] = useState('DESPESA_FIXA')

  const load = async () => {
    const [a, g] = await Promise.all([
      fetch('/api/accounts').then(r => r.json()),
      fetch('/api/dre-groups').then(r => r.json()),
    ])
    setAccounts(a)
    setDreGroups(g)
    // Reset the form to first valid group for the current type
    setForm(f => {
      const firstName = g.find((x: DreGroupRow) => x.type === f.type)?.name
      return firstName ? { ...f, dreGroup: firstName } : f
    })
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  // DreGroups available per Account type
  const groupsForType = (type: string) => dreGroups.filter(g => g.type === type)

  const save = async () => {
    const res = await fetch('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form)
    })
    if (res.ok) {
      setForm({ code: '', name: '', type: 'RECEITA', dreGroup: groupsForType('RECEITA')[0]?.name || '' })
      load()
      showToast('Conta criada com sucesso!')
    } else {
      const err = await res.json()
      showToast(err.error || 'Erro ao criar conta')
    }
  }

  // ── DreGroup CRUD ────────────────────────────────────────
  const openNewGroup = () => { setGrpEditing(null); setGrpName(''); setGrpSection('DESPESA_FIXA'); setGrpModal(true) }
  const openEditGroup = (g: DreGroupRow) => { setGrpEditing(g); setGrpName(g.name); setGrpSection(g.section); setGrpModal(true) }

  const saveGroup = async () => {
    if (!grpName.trim()) return
    const url = grpEditing ? `/api/dre-groups/${grpEditing.id}` : '/api/dre-groups'
    const method = grpEditing ? 'PUT' : 'POST'
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: grpName, section: grpSection }),
    })
    const data = await res.json()
    if (!res.ok) { showToast(`Erro: ${data.error}`); return }
    setGrpModal(false)
    await load()
    showToast(grpEditing ? '✓ Categoria atualizada' : '✓ Categoria criada')
  }

  const removeGroup = async (g: DreGroupRow) => {
    if (!confirm(`Excluir categoria "${g.name}"?`)) return
    const res = await fetch(`/api/dre-groups/${g.id}`, { method: 'DELETE' })
    const data = await res.json()
    if (!res.ok) { showToast(`Erro: ${data.error}`); return }
    await load()
    showToast('✓ Categoria removida')
  }

  const remove = async (id: number) => {
    if (!confirm('Remover esta conta?')) return
    await fetch(`/api/accounts/${id}`, { method: 'DELETE' })
    load()
    showToast('Conta removida')
  }

  const seedDefaults = async () => {
    setSeeding(true)
    await Promise.all(DEFAULTS.map(acc =>
      fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(acc)
      })
    ))
    await load()
    setSeeding(false)
    showToast(`Plano de contas carregado! ${DEFAULTS.length} contas criadas.`)
  }

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setImporting(true)
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/accounts/import', { method: 'POST', body: fd })
    const data = await res.json()
    if (res.ok) {
      await load()
      const parts = [`${data.imported} criadas`, `${data.updated} atualizadas`]
      if (data.errors?.length) parts.push(`${data.errors.length} erro(s)`)
      showToast(`✓ ${parts.join(', ')}`)
    } else {
      showToast(`Erro: ${data.error}`)
    }
    setImporting(false)
  }

  const grouped = TYPES.reduce((acc, t) => {
    acc[t] = accounts.filter(a => a.type === t)
    return acc
  }, {} as Record<string, any[]>)

  const typeBadge = (type: string) => {
    const map: Record<string, string> = {
      RECEITA: 'badge-receita', CUSTO: 'badge-custo',
      DESPESA: 'badge-despesa', DEDUCAO: 'badge-deducao', IMPOSTO: 'badge-imposto',
      NEUTRO: 'badge-neutro'
    }
    return map[type] || ''
  }

  return (
    <Shell>
      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">Plano de Contas</h1>
          <p className="page-subtitle">Configure as contas que alimentam o DRE</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            ref={importRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            onChange={handleImportFile}
          />
          <button
            className="btn btn-secondary"
            onClick={() => importRef.current?.click()}
            disabled={importing}
          >
            {importing ? 'Importando...' : '⬆ Importar Excel/CSV'}
          </button>
          {accounts.length === 0 && (
            <button className="btn btn-secondary" onClick={seedDefaults} disabled={seeding}>
              {seeding ? 'Carregando...' : '⚡ Carregar Padrão'}
            </button>
          )}
        </div>
      </div>

      {/* Categorias DRE editáveis */}
      <div className="card mb-6" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--brave-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13 }}>Categorias do DRE</div>
            <div style={{ fontSize: 11, color: 'var(--brave-gray)' }}>
              Subgrupos que aparecem na DRE — renomeie, crie ou exclua. Mudanças refletem nas contas vinculadas.
            </div>
          </div>
          <button className="btn btn-sm btn-primary" onClick={openNewGroup}>+ Nova Categoria</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Aparece na DRE como</th>
                <th>Tipo</th>
                <th style={{ textAlign: 'right' }}># Contas</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {dreGroups.map(g => {
                const count = accounts.filter(a => a.dreGroup === g.name).length
                return (
                  <tr key={g.id}>
                    <td style={{ fontWeight: 600 }}>
                      {g.name}
                      {g.protected && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--brave-gray)', background: '#f4f4f4', padding: '2px 6px', borderRadius: 3 }}>protegida</span>}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--brave-gray)' }}>{SECTION_LABEL[g.section] || g.section}</td>
                    <td><span className={`badge ${typeBadge(g.type)}`}>{g.type}</span></td>
                    <td style={{ textAlign: 'right', fontSize: 12 }}>{count}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-sm" onClick={() => openEditGroup(g)} disabled={g.protected}>✏️</button>
                      <button className="btn btn-sm btn-danger" onClick={() => removeGroup(g)} disabled={g.protected || count > 0} style={{ marginLeft: 4 }} title={count > 0 ? 'Mova as contas antes de excluir' : ''}>✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid-2 mb-6">
        <div className="card">
          <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, marginBottom: 20 }}>
            Nova Conta
          </div>
          <div className="form-group">
            <label className="form-label">Código</label>
            <input className="form-input" placeholder="ex: 3.1.01" value={form.code}
              onChange={e => setForm(f => ({ ...f, code: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Nome da Conta</label>
            <input className="form-input" placeholder="ex: Vendas Dinheiro / Pix" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Tipo</label>
            <select className="form-select" value={form.type}
              onChange={e => {
                const t = e.target.value
                const first = groupsForType(t)[0]?.name || ''
                setForm(f => ({ ...f, type: t, dreGroup: first }))
              }}>
              {TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Categoria do DRE</label>
            <select className="form-select" value={form.dreGroup}
              onChange={e => setForm(f => ({ ...f, dreGroup: e.target.value }))}>
              {groupsForType(form.type).map(g => <option key={g.id} value={g.name}>{g.name}</option>)}
              {groupsForType(form.type).length === 0 && <option value="">— nenhuma categoria deste tipo —</option>}
            </select>
          </div>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={save}>
            + Adicionar Conta
          </button>
        </div>

        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '20px 24px 12px', fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13 }}>
            Contas Cadastradas ({accounts.length})
          </div>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--brave-gray)' }}>Carregando...</div>
          ) : accounts.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--brave-gray)' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📋</div>
              Nenhuma conta cadastrada.<br />
              <span style={{ fontSize: 12 }}>Use "Carregar Padrão" ou "Importar Excel/CSV".</span>
            </div>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Nome</th>
                    <th>Grupo DRE</th>
                    <th>Tipo</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map(a => (
                    <tr key={a.id}>
                      <td style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 12 }}>{a.code}</td>
                      <td style={{ fontSize: 13 }}>{a.name}</td>
                      <td style={{ fontSize: 11, color: 'var(--brave-gray)' }}>{a.dreGroup}</td>
                      <td><span className={`badge ${typeBadge(a.type)}`}>{a.type}</span></td>
                      <td>
                        <button className="btn btn-danger btn-sm" onClick={() => remove(a.id)}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {accounts.length > 0 && (
        <div className="card">
          <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, marginBottom: 16 }}>
            Estrutura do Plano de Contas
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            {TYPES.map(t => (
              <div key={t} style={{ background: 'var(--brave-light)', borderRadius: 8, padding: '12px 16px' }}>
                <span className={`badge ${typeBadge(t)}`} style={{ marginBottom: 8, display: 'inline-block' }}>{t}</span>
                <div style={{ fontFamily: 'var(--font-title)', fontSize: 22, fontWeight: 700 }}>
                  {grouped[t].length}
                </div>
                <div style={{ fontSize: 11, color: 'var(--brave-gray)' }}>
                  {grouped[t].length === 1 ? 'conta' : 'contas'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {grpModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div className="card" style={{ width: 460, padding: 24 }}>
            <h3 style={{ fontFamily: 'var(--font-sub)', marginBottom: 16 }}>
              {grpEditing ? 'Editar' : 'Nova'} Categoria do DRE
            </h3>
            <label style={{ fontSize: 12, color: 'var(--brave-gray)' }}>Nome</label>
            <input className="form-input" style={{ width: '100%', marginBottom: 12 }} value={grpName} onChange={e => setGrpName(e.target.value)} autoFocus placeholder="ex: Despesas com Estoque" />
            <label style={{ fontSize: 12, color: 'var(--brave-gray)' }}>Onde aparece na DRE</label>
            <select className="form-select" style={{ width: '100%', marginBottom: 16 }} value={grpSection} onChange={e => setGrpSection(e.target.value)}>
              {SECTION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 16, padding: '8px 12px', background: 'var(--brave-light)', borderRadius: 4 }}>
              💡 O tipo (RECEITA/CUSTO/DESPESA/etc) é definido automaticamente pela seção escolhida. Renomear uma categoria atualiza todas as contas vinculadas em cascata.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setGrpModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={saveGroup} disabled={!grpName.trim()}>Salvar</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </Shell>
  )
}
