/**
 * Comparativo do portfólio entre as duas janelas de 12 meses que a CAGR usa —
 * a primeira e a última que a base sustenta. Serve o material de reunião:
 * onde o portfólio estava no começo da série × onde está hoje, com a tabela de
 * migração entre quadrantes.
 *
 * O eixo de crescimento é medido UMA vez (a base de 20 meses não comporta duas
 * medidas independentes); entre as fotos o que se move é a margem.
 */
import { compararJanelas } from '@/lib/bcg'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  return NextResponse.json(await compararJanelas())
}
