/**
 * Período coberto pelo ABC de Vendas — regra única da Reposição (giro diário) e
 * da Análise Comercial (cobertura em meses).
 *
 * Os exports do ABC do ERP são sempre ACUMULADOS NO ANO (01/01 → data da
 * extração), então o período vai de 01/01 do ano do último import até a data
 * desse import. A Análise Comercial usava 6 meses fixos: com o ABC de
 * 01/01 → 25/09/2026 (267 dias, 8,8 meses), toda cobertura saía ~32% menor —
 * 405 itens com status de giro errado, rupturas a mais e excesso a menos — e as
 * duas telas davam coberturas diferentes para o mesmo item.
 */
export interface PeriodoAbc {
  /** dias de 01/01 até o último import (limitado a 30–400) */
  dias: number
  /** o mesmo período em meses médios (365,25 ÷ 12 dias) */
  meses: number
  /** data do último import (AAAA-MM-DD), ou null sem base */
  ate: string | null
}

export function periodoAbc(itens: { updatedAt: Date }[]): PeriodoAbc {
  const ultimo = itens.reduce<Date | null>((m, s) => (m === null || s.updatedAt > m ? s.updatedAt : m), null)
  const ref = ultimo ?? new Date()
  const jan1 = Date.UTC(ref.getUTCFullYear(), 0, 1)
  const dias = Math.max(30, Math.min(400, Math.round((ref.getTime() - jan1) / 86400000)))
  return { dias, meses: dias / (365.25 / 12), ate: ultimo ? ultimo.toISOString().slice(0, 10) : null }
}
