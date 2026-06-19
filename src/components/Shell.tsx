'use client'
import { usePathname, useRouter } from 'next/navigation'

const COMPANY_NAME = 'Vale Sol Agronegócio'

const NAV = [
  { href: '/fluxo-de-caixa', icon: '◈', label: 'Fluxo de Caixa' },
  { href: '/risco-cliente',  icon: '◆', label: 'Risco de Cliente' },
]

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()

  return (
    <>
      <header className="topbar">
        <div className="topbar-brand">
          Arken
        </div>
        <div className="topbar-company">
          {COMPANY_NAME}
        </div>
        <div className="topbar-meta">
          <span className="topbar-badge">v2.0</span>
        </div>
      </header>

      <div className="layout">
        <aside className="sidenav">
          <div className="sidenav-section">Módulos</div>
          {NAV.map(n => {
            const active = pathname.startsWith(n.href)
            return (
              <a
                key={n.href}
                className={`sidenav-link ${active ? 'active' : ''}`}
                onClick={(e) => { e.preventDefault(); router.push(n.href) }}
                href={n.href}
              >
                <span className="sidenav-icon">{n.icon}</span>
                {n.label}
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
