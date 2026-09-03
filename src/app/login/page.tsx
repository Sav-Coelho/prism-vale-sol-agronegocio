'use client'
import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

// useSearchParams exige Suspense para a página não falhar na pré-renderização.
export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: '#071a2e' }} />}>
      <FormularioLogin />
    </Suspense>
  )
}

function FormularioLogin() {
  const router = useRouter()
  const params = useSearchParams()
  const [login, setLogin] = useState('')
  const [senha, setSenha] = useState('')
  const [verSenha, setVerSenha] = useState(false)
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro('')
    setCarregando(true)
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, senha }),
      })
      const d = await r.json()
      if (!r.ok) { setErro(d.error || 'Não foi possível entrar'); setCarregando(false); return }
      const next = params.get('next')
      router.push(next || d.redirect)
      router.refresh()
    } catch {
      setErro('Falha de conexão. Tente novamente.')
      setCarregando(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr)',
      background: 'linear-gradient(160deg, #0a2540 0%, #071a2e 55%, #05131f 100%)',
      position: 'relative',
      overflow: 'hidden',
      padding: 24,
      placeItems: 'center',
    }}>
      {/* halo de marca ao fundo */}
      <div aria-hidden style={{
        position: 'absolute', width: 620, height: 620, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(245,197,24,0.10) 0%, transparent 68%)',
        top: -180, right: -140, pointerEvents: 'none',
      }} />
      <div aria-hidden style={{
        position: 'absolute', width: 520, height: 520, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(47,90,140,0.30) 0%, transparent 70%)',
        bottom: -200, left: -160, pointerEvents: 'none',
      }} />

      <div style={{ width: '100%', maxWidth: 396, position: 'relative' }}>
        <div style={{ textAlign: 'center', marginBottom: 26 }}>
          <div style={{
            fontFamily: 'var(--font-serif), serif',
            fontSize: 40, color: '#fff', lineHeight: 1,
            display: 'inline-flex', alignItems: 'flex-start', gap: 3,
          }}>
            Arken
            <span style={{
              width: 7, height: 7, borderRadius: '50%', background: '#f5c518',
              marginTop: 26, boxShadow: '0 0 0 5px rgba(245,197,24,0.16)',
            }} />
          </div>
          <div style={{
            fontSize: 10.5, letterSpacing: '0.24em', textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.5)', marginTop: 12, fontWeight: 500,
          }}>
            Vale Sol Agronegócio
          </div>
        </div>

        <form onSubmit={entrar} style={{
          background: 'rgba(255,255,255,0.98)',
          borderRadius: 16,
          padding: '30px 30px 26px',
          boxShadow: '0 24px 60px rgba(0,0,0,0.34), 0 2px 8px rgba(0,0,0,0.16)',
          border: '1px solid rgba(255,255,255,0.14)',
        }}>
          <h1 style={{
            fontFamily: 'var(--font-serif), serif', fontSize: 21,
            color: '#0a2540', margin: '0 0 5px',
          }}>Entrar</h1>
          <p style={{ fontSize: 12.5, color: '#7d8aa0', margin: '0 0 24px' }}>
            Use o usuário e a senha fornecidos pela gestão.
          </p>

          <label className="form-label" htmlFor="login">Usuário</label>
          <input
            id="login"
            className="form-input"
            style={{ marginBottom: 16 }}
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="gerencial"
            value={login}
            onChange={e => setLogin(e.target.value)}
            required
            autoFocus
          />

          <label className="form-label" htmlFor="senha">Senha</label>
          <div style={{ position: 'relative', marginBottom: 20 }}>
            <input
              id="senha"
              className="form-input"
              style={{ paddingRight: 62 }}
              type={verSenha ? 'text' : 'password'}
              autoComplete="current-password"
              value={senha}
              onChange={e => setSenha(e.target.value)}
              required
            />
            <button
              type="button"
              onClick={() => setVerSenha(v => !v)}
              style={{
                position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em',
                color: '#7d8aa0', padding: '5px 8px', borderRadius: 8,
                fontFamily: 'inherit', textTransform: 'uppercase',
              }}
            >
              {verSenha ? 'Ocultar' : 'Ver'}
            </button>
          </div>

          {erro && (
            <div role="alert" style={{
              background: '#fdf0ee', border: '1px solid #eccac4', color: '#b3352a',
              borderRadius: 8, padding: '10px 13px', fontSize: 12.5, marginBottom: 16,
              display: 'flex', alignItems: 'center', gap: 9,
            }}>
              <span style={{
                flexShrink: 0, width: 16, height: 16, borderRadius: '50%',
                background: '#b3352a', color: '#fff', fontSize: 11, fontWeight: 700,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}>!</span>
              {erro}
            </div>
          )}

          <button
            className="btn btn-primary"
            style={{
              width: '100%', justifyContent: 'center', padding: '12px 0',
              fontSize: 14, fontWeight: 600, borderRadius: 9,
            }}
            disabled={carregando}
          >
            {carregando ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        <p style={{
          textAlign: 'center', fontSize: 10.5, color: 'rgba(255,255,255,0.34)',
          marginTop: 22, letterSpacing: '0.06em',
        }}>
          Acesso restrito · Brave Educação Empresarial
        </p>
      </div>
    </div>
  )
}
