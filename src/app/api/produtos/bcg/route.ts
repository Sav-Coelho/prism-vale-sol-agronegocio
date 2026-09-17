/**
 * Matriz BCG de produtos — o cálculo vive em `@/lib/bcg`, compartilhado com a
 * Demanda por Cliente e a Reposição por Giro para que todas as telas
 * classifiquem o mesmo produto do mesmo jeito.
 *
 *   ?janela=6 → compara apenas os últimos N meses fechados
 */
import { calcularBcg } from '@/lib/bcg'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(req: NextRequest) {
  const n = parseInt(req.nextUrl.searchParams.get('janela') ?? '', 10)
  const r = await calcularBcg(!isNaN(n) && n > 0 ? { janelaMeses: n } : undefined)
  // `porCodigo` só interessa às outras telas; aqui economiza payload
  const { porCodigo, ...resto } = r
  void porCodigo
  return NextResponse.json(resto)
}
