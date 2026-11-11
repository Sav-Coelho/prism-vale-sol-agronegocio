/** Filial do CashFlow em que o cartão é pago (ajuda a achar o pagamento item a item). */
import { prisma } from '@/lib/prisma'
import { guard } from '@/lib/auth-node'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const g = await guard(['gerencial']); if (!g.ok) return g.res
  const b = await req.json().catch(() => null) as null | { filial?: unknown }
  const filial = b?.filial == null || b.filial === '' ? null : String(b.filial).trim()
  const c = await prisma.cartao.findUnique({ where: { id: Number(params.id) } })
  if (!c) return NextResponse.json({ error: 'Cartão não encontrado.' }, { status: 404 })
  await prisma.cartao.update({ where: { id: c.id }, data: { filial } })
  return NextResponse.json({ ok: true })
}
