/**
 * Orçamento — projeção da DRE. O modelo vive em `@/lib/orcamento`.
 *
 *   ?ancora=3        meses recentes que definem nível e coeficientes
 *   ?phi=0.85        amortecimento da tendência (1 = sem amortecer)
 *   ?horizonte=7     meses a projetar
 *   ?crescimento=1.2 substitui a tendência estimada, em % ao mês
 *   ?p.CMV=71.4      premissa da linha: % da receita (modo RECEITA) ou R$ (FIXO)
 *   ?m.CMV=FIXO      troca o modo da linha
 */
import { calcularOrcamento, PRIOR, type ModoLinha, type PremissaEntrada } from '@/lib/orcamento'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const num = (v: string | null) => {
  if (v == null || v.trim() === '') return undefined
  const n = Number(v.replace(',', '.'))
  return Number.isFinite(n) ? n : undefined
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams

  // premissas por linha: p.CMV = valor, m.CMV = modo.
  // A tela manda na unidade que o usuário vê — percentual em pontos (71,4) e
  // valor fixo em reais. A lib trabalha com fração, então converte aqui, pelo
  // modo EFETIVO da linha (o editado, ou o prior econômico).
  const modos: Record<string, ModoLinha> = {}
  const valores: Record<string, number> = {}
  q.forEach((valor, chave) => {
    const mm = chave.match(/^m\.(.+)$/)
    if (mm && (valor === 'RECEITA' || valor === 'FIXO')) modos[mm[1]] = valor as ModoLinha
  })
  q.forEach((valor, chave) => {
    const mv = chave.match(/^p\.(.+)$/)
    if (!mv) return
    const n = num(valor)
    if (n != null) valores[mv[1]] = n
  })
  const premissas: Record<string, PremissaEntrada> = {}
  const linhas = new Set([...Object.keys(modos), ...Object.keys(valores)])
  linhas.forEach(L => {
    const modo = modos[L] ?? PRIOR[L]
    const bruto = valores[L]
    premissas[L] = {
      ...(modos[L] ? { modo: modos[L] } : {}),
      ...(bruto != null ? { valor: modo === 'RECEITA' ? bruto / 100 : bruto } : {}),
    }
  })

  const cresc = num(q.get('crescimento'))
  const r = await calcularOrcamento({
    ancora: num(q.get('ancora')),
    phi: num(q.get('phi')),
    horizonte: num(q.get('horizonte')),
    crescimento: cresc != null ? cresc / 100 : null,
    premissas: Object.keys(premissas).length ? premissas : undefined,
  })
  return NextResponse.json(r)
}
