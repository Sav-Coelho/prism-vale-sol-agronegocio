import { prisma } from '@/lib/prisma'
import { parsePriceList } from '@/lib/commercial-parser'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// POST /api/commercial/prices  —  upload XLSX, wipe-and-replace global
export async function POST(req: Request) {
  const fd = await req.formData()
  const file = fd.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Arquivo não enviado' }, { status: 400 })

  const buf = await file.arrayBuffer()
  let items
  try { items = parsePriceList(buf) }
  catch (e) { return NextResponse.json({ error: 'Falha ao ler XLSX: ' + (e instanceof Error ? e.message : String(e)) }, { status: 400 }) }

  const result = await prisma.$transaction(async tx => {
    const del = await tx.productPrice.deleteMany({})
    const ins = await tx.productPrice.createMany({ data: items, skipDuplicates: true })
    return { deleted: del.count, inserted: ins.count }
  })
  return NextResponse.json({ ...result, total: items.length })
}

export async function GET() {
  const items = await prisma.productPrice.findMany({ orderBy: { code: 'asc' } })
  return NextResponse.json({ count: items.length, items })
}
