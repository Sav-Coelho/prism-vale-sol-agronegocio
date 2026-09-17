'use client'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'

const COMPANY_NAME = 'Vale Sol Agronegócio'
const LS_KEY = 'arken.sidenav.collapsed'

// `roles` limita quem vê o item no menu. A checagem de verdade é do middleware
// (src/middleware.ts) — aqui é só para não mostrar porta que não abre.
const NAV = [
  { href: '/dre',                icon: '▤', label: 'DRE Gerencial',       roles: ['gerencial'] },
  { href: '/fluxo-de-caixa',     icon: '◈', label: 'Fluxo de Caixa',      roles: ['gerencial'] },
  { href: '/controle-compras',   icon: '🛒', label: 'Controle de Compras', roles: ['gerencial'] },
  { href: '/risco-cliente',      icon: '◆', label: 'Risco de Cliente',    roles: ['gerencial'] },
  { href: '/analise-comercial',  icon: '⌬', label: 'Análise Comercial',   roles: ['gerencial'] },
  { href: '/demanda-cliente',    icon: '◉', label: 'Demanda por Cliente', roles: ['gerencial', 'comercial'] },
]

interface SessionUser { id: number; login: string; name: string; role: string }

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [collapsed, setCollapsed] = useState(false)
  const [user, setUser] = useState<SessionUser | null>(null)

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.ok ? r.json() : { user: null })
      .then(d => setUser(d.user))
      .catch(() => {})
  }, [])

  const sair = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  // Antes de saber o papel, mostra só o que todo mundo pode ver — evita
  // piscar módulos gerenciais na tela do vendedor.
  const visiveis = NAV.filter(n => n.roles.indexOf(user?.role ?? 'comercial') >= 0)

  // Carrega preferência ao montar (evita flicker de hidratação esperando o efeito)
  useEffect(() => {
    if (typeof window === 'undefined') return
    setCollapsed(window.localStorage.getItem(LS_KEY) === '1')
  }, [])

  const toggle = () => {
    setCollapsed(c => {
      const next = !c
      try { window.localStorage.setItem(LS_KEY, next ? '1' : '0') } catch {}
      return next
    })
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-brand">Arken</div>
        <div className="topbar-company">{COMPANY_NAME}</div>
        <div className="topbar-meta">
          <span className="topbar-badge">v2.0</span>
          {user && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, marginLeft: 4 }}>
              <span style={{ textAlign: 'right', lineHeight: 1.25 }}>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#fff' }}>{user.name}</span>
                <span style={{
                  display: 'block', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase',
                  color: user.role === 'gerencial' ? '#f5c518' : 'rgba(255,255,255,0.5)', fontWeight: 600,
                }}>
                  {user.role === 'gerencial' ? 'Gerencial' : 'Comercial'}
                </span>
              </span>
              <button
                type="button"
                onClick={sair}
                title="Sair"
                style={{
                  background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.18)',
                  color: 'rgba(255,255,255,0.85)', borderRadius: 6, cursor: 'pointer',
                  fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
                  padding: '6px 11px', fontFamily: 'inherit',
                }}
              >
                Sair
              </button>
            </span>
          )}
        </div>
      </header>

      <div className={`layout${collapsed ? ' layout-collapsed' : ''}`}>
        <aside className="sidenav">
          <button
            type="button"
            onClick={toggle}
            className="sidenav-toggle"
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
            title={collapsed ? 'Expandir menu' : 'Recolher menu'}
          >
            <span className="sidenav-toggle-icon">{collapsed ? '›' : '‹'}</span>
            {!collapsed && <span>Recolher menu</span>}
          </button>
          {!collapsed && <div className="sidenav-section">Módulos</div>}
          {visiveis.map(n => {
            const active = pathname.startsWith(n.href)
            return (
              <a
                key={n.href}
                className={`sidenav-link ${active ? 'active' : ''}`}
                onClick={(e) => { e.preventDefault(); router.push(n.href) }}
                href={n.href}
                title={collapsed ? n.label : undefined}
              >
                <span className="sidenav-icon">{n.icon}</span>
                <span className="sidenav-label">{n.label}</span>
              </a>
            )
          })}

        </aside>

        <main className="page">
          {children}
          <footer style={{
            marginTop: 64,
            paddingTop: 24,
            borderTop: '1px solid var(--arken-line)',
            textAlign: 'center',
            fontSize: 11,
            color: 'var(--arken-text-muted)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            fontWeight: 500,
          }}>
            Desenvolvido por Delfos Research LTDA
          </footer>
        </main>
      </div>
    </>
  )
}
