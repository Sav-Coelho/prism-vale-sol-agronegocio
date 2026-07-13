/** Wipe total das entradas da DRE. Exige confirmação no body. */
import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { confirm?: string } | null
  if (body?.confirm !== 'APAGAR TUDO') {
    return NextResponse.json({ error: 'Confirmação obrigatória: { "confirm": "APAGAR TUDO" }' }, { status: 400 })
  }
  const del = await prisma.dreEntry.deleteMany({})
  return NextResponse.json({ deleted: del.count })
}
