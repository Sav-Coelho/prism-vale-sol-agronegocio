import { prisma } from '@/lib/prisma'
import type { ParsedReceivable, ParsedPayable, Kind } from '@/lib/cash-flow-parser'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Wipe-and-replace: ao subir uma nova planilha, TODOS os registros do mesmo
// tipo (receivable ou payable) são apagados e os novos são inseridos. Isso
// garante que títulos cancelados/excluídos no ERP entre importações
// desapareçam também aqui — evita inconsistência entre as duas bases.
//
// O servidor ignora qualquer item com dueDate <= hoje (vencido ou do mesmo
// dia) — esses não entram em análise.
export async function POST(req: Request) {
  const body = await req.json() as
    | { kind: 'receivable'; filial: string; items: ParsedReceivable[] }
    | { kind: 'payable';    filial: string; items: ParsedPayable[] }

  const kind: Kind = body.kind
  if (kind !== 'receivable' && kind !== 'payable') {
    return NextResponse.json({ error: 'kind inválido' }, { status: 400 })
  }
  if (!body.filial?.trim()) {
    return NextResponse.json({ error: 'Filial obrigatória' }, { status: 400 })
  }
  if (!Array.isArray(body.items)) {
    return NextResponse.json({ error: 'items inválido' }, { status: 400 })
  }
  const filial = body.filial.trim()

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const isStale = (isoDueDate: string) => new Date(isoDueDate) <= today

  if (kind === 'receivable') {
    const valid = (body.items as ParsedReceivable[]).filter(i => !isStale(i.dueDate))
    const data = valid.map(i => ({
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
      filial,                              // força a filial do payload (não do item)
      observation: i.observation,
    }))
    // Wipe-and-replace POR FILIAL — não apaga dados de outras unidades.
    const result = await prisma.$transaction(async tx => {
      const del = await tx.receivable.deleteMany({ where: { filial } })
      const ins = await tx.receivable.createMany({ data, skipDuplicates: true })
      return { deleted: del.count, inserted: ins.count }
    })
    return NextResponse.json({
      filial,
      deleted: result.deleted,
      imported: result.inserted,
      staleIgnored: body.items.length - valid.length,
    })
  }

  const valid = (body.items as ParsedPayable[]).filter(i => !isStale(i.dueDate))
  const data = valid.map(i => ({
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
    filial,                              // força a filial do payload (não do item)
    operacao: i.operacao,
    observation: i.observation,
  }))
  const result = await prisma.$transaction(async tx => {
    const del = await tx.payable.deleteMany({ where: { filial } })
    const ins = await tx.payable.createMany({ data, skipDuplicates: true })
    return { deleted: del.count, inserted: ins.count }
  })
  return NextResponse.json({
    filial,
    deleted: result.deleted,
    imported: result.inserted,
    staleIgnored: body.items.length - valid.length,
  })
}
