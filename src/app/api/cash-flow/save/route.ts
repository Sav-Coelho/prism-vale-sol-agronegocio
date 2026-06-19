import { prisma } from '@/lib/prisma'
import type { ParsedReceivable, ParsedPayable, Kind } from '@/lib/cash-flow-parser'
import { NextResponse } from 'next/server'

// Recebe os itens já confirmados pelo usuário e insere com skipDuplicates
// (fitid unique). Não duplica mesmo se o usuário enviar a mesma linha 2x.
export async function POST(req: Request) {
  const body = await req.json() as
    | { kind: 'receivable'; items: ParsedReceivable[] }
    | { kind: 'payable';    items: ParsedPayable[] }

  const kind: Kind = body.kind
  if (kind !== 'receivable' && kind !== 'payable') {
    return NextResponse.json({ error: 'kind inválido' }, { status: 400 })
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ imported: 0, skipped: 0 })
  }

  if (kind === 'receivable') {
    const data = (body.items as ParsedReceivable[]).map(i => ({
      fitid: i.fitid,
      dueDate: new Date(i.dueDate),
      issueDate: i.issueDate ? new Date(i.issueDate) : null,
      customerCode: i.customerCode,
      customerName: i.customerName,
      customerDoc: i.customerDoc,
      titulo: i.titulo,
      parcela: i.parcela,
      portador: i.portador,
      tipoCobranca: i.tipoCobranca,
      sellerCode: i.sellerCode,
      sellerName: i.sellerName,
      farmName: i.farmName,
      phone: i.phone,
      amount: i.amount,
      discount: i.discount,
      interest: i.interest,
      fine: i.fine,
      netAmount: i.netAmount,
      filial: i.filial,
      observation: i.observation,
    }))
    const res = await prisma.receivable.createMany({ data, skipDuplicates: true })
    return NextResponse.json({ imported: res.count, skipped: data.length - res.count })
  }

  const data = (body.items as ParsedPayable[]).map(i => ({
    fitid: i.fitid,
    dueDate: new Date(i.dueDate),
    entryDate: i.entryDate ? new Date(i.entryDate) : null,
    supplierCode: i.supplierCode,
    supplierName: i.supplierName,
    supplierDoc: i.supplierDoc,
    titulo: i.titulo,
    parcela: i.parcela,
    amount: i.amount,
    discount: i.discount,
    interest: i.interest,
    fine: i.fine,
    netAmount: i.netAmount,
    portador: i.portador,
    chequeNumber: i.chequeNumber,
    tipoDocto: i.tipoDocto,
    filial: i.filial,
    operacao: i.operacao,
    observation: i.observation,
  }))
  const res = await prisma.payable.createMany({ data, skipDuplicates: true })
  return NextResponse.json({ imported: res.count, skipped: data.length - res.count })
}
