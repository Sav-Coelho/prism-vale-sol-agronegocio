/**
 * Wipe total do módulo de crédito: apaga TODAS as Sales e Clients.
 * Endpoint destrutivo — chamado só quando o usuário confirma o reset.
 */
import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request) {
  // Guarda contra chamadas acidentais: exige confirmação explícita no body
  const body = await req.json().catch(() => null) as { confirm?: string } | null
  if (body?.confirm !== 'APAGAR TUDO') {
    return NextResponse.json(
      { error: 'Confirmação obrigatória: envie { "confirm": "APAGAR TUDO" } no body' },
      { status: 400 },
    )
  }
  const salesDel   = await prisma.sale.deleteMany({})
  const clientsDel = await prisma.client.deleteMany({})
  return NextResponse.json({ salesDeleted: salesDel.count, clientsDeleted: clientsDel.count })
}
