'use client'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'

const COMPANY_NAME = 'Vale Sol Agronegócio'
const LS_KEY = 'arken.sidenav.collapsed'

const NAV = [
  { href: '/fluxo-de-caixa',     icon: '◈', label: 'Fluxo de Caixa' },
  { href: '/risco-cliente',      icon: '◆', label: 'Risco de Cliente' },
  { href: '/analise-comercial',  icon: '⌬', label: 'Análise Comercial' },
]

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [collapsed, setCollapsed] = useState(false)

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
        </div>
      </header>

      <div className={`layout${collapsed ? ' layout-collapsed' : ''}`}>
        <aside className="sidenav">
          {!collapsed && <div className="sidenav-section">Módulos</div>}
          {NAV.map(n => {
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

          <button
            type="button"
            onClick={toggle}
            className="sidenav-toggle"
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
            title={collapsed ? 'Expandir menu' : 'Recolher menu'}
          >
            <span className="sidenav-toggle-icon">{collapsed ? '›' : '‹'}</span>
            {!collapsed && <span>Recolher</span>}
          </button>
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
