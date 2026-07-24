/** Pedidos de compra: listagem e criação. */
import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  const pedidos = await prisma.purchaseOrder.findMany({ orderBy: { dataPedido: 'desc' } })
  return NextResponse.json({ pedidos })
}

export async function POST(req: Request) {
  const b = await req.json()
  if (!b.comprador || !b.dataPedido || !(b.valor > 0)) {
    return NextResponse.json({ error: 'Comprador, data e valor são obrigatórios' }, { status: 400 })
  }
  // datas explícitas de pagamento ("YYYY-MM-DD"[]) — a fonte da verdade das parcelas
  const datas: string[] = Array.isArray(b.datas)
    ? b.datas.filter((x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x))
    : []
  if (!datas.length) {
    return NextResponse.json({ error: 'Informe a(s) data(s) de pagamento' }, { status: 400 })
  }
  const pedido = await prisma.purchaseOrder.create({
    data: {
      comprador: String(b.comprador),
      fornecedor: b.fornecedor || null,
      dataPedido: new Date(b.dataPedido),
      valor: Number(b.valor),
      parcelas: datas.length,
      datas,
      status: b.status || 'Pendente',
      observacao: b.observacao || null,
    },
  })
  return NextResponse.json({ pedido })
}
