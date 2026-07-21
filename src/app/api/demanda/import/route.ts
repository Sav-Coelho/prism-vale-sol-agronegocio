/** Import do relatório COMERCIAL → DemandEntry (wipe-and-replace). */
import { prisma } from '@/lib/prisma'
import { parseDemanda, isComercialDemanda } from '@/lib/demanda-parser'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

export async function POST(req: Request) {
  const fd = await req.formData()
  const file = fd.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Arquivo não enviado' }, { status: 400 })
  const buf = await file.arrayBuffer()
  if (!isComercialDemanda(buf)) {
    return NextResponse.json({ error: 'Formato não reconhecido (esperado COMERCIAL: VENDEDOR, CLIENTE, PRODUTO, DATA).' }, { status: 400 })
  }

  const { entries, clientes, produtos, leaves, total, months } = parseDemanda(buf)

  const del = await prisma.demandEntry.deleteMany({})
  let inserted = 0
  const CHUNK = 5000
  for (let i = 0; i < entries.length; i += CHUNK) {
    inserted += (await prisma.demandEntry.createMany({ data: entries.slice(i, i + CHUNK) })).count
  }

  return NextResponse.json({ kind: 'demanda', deleted: del.count, inserted, clientes, produtos, leaves, total, months })
}
