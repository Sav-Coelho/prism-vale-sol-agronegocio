'use client'
import { useRef, useState } from 'react'

/**
 * Card de upload compacto reutilizável.
 * Cada aba pode ter 1 ou mais — recebe o endpoint, mostra drag-and-drop e dispara o save (wipe-and-replace).
 */
export function CommercialUploader({
  title, description, endpoint, accept = '.xlsx,.xls',
  count, onDone,
}: {
  title: string
  description: string
  endpoint: string
  accept?: string
  count?: number      // quantos itens já no DB pra esse tipo
  onDone: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const [msg, setMsg] = useState('')

  const upload = async (file: File) => {
    setBusy(true); setMsg('Lendo planilha…')
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await fetch(endpoint, { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) { setMsg(`Erro: ${data.error}`); setBusy(false); return }
      setMsg(`✓ ${data.deleted} antigos removidos · ${data.inserted ?? data.imported ?? 0} importados`)
      onDone()
    } catch (e) {
      setMsg('Erro: ' + (e instanceof Error ? e.message : String(e)))
    }
    setBusy(false)
  }

  return (
    <div
      onClick={() => !busy && ref.current?.click()}
      onDragOver={e => { e.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) upload(f) }}
      style={{
        border: `2px dashed ${drag ? 'var(--arken-yellow)' : 'var(--arken-line)'}`,
        borderRadius: 4,
        padding: '20px 18px',
        cursor: busy ? 'wait' : 'pointer',
        background: drag ? 'rgba(245, 197, 24, 0.06)' : 'var(--arken-paper)',
        transition: 'all 200ms ease',
      }}
    >
      <input ref={ref} type="file" accept={accept} style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 26, color: 'var(--arken-navy)' }}>{busy ? '◌' : '⬆'}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-serif), serif', fontSize: 15, color: 'var(--arken-navy)', marginBottom: 2 }}>
            {title}
          </div>
          <div style={{ fontSize: 11, color: 'var(--arken-text-muted)' }}>
            {description}
          </div>
          {count !== undefined && (
            <div style={{ fontSize: 10, color: 'var(--arken-gold)', marginTop: 4, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              {count} itens cadastrados
            </div>
          )}
          {msg && (
            <div style={{ fontSize: 11, color: msg.startsWith('✓') ? 'var(--positive)' : msg.startsWith('Erro') ? 'var(--negative)' : 'var(--arken-text-muted)', marginTop: 4 }}>
              {msg}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
