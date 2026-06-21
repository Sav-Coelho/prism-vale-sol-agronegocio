import { parseCashFlow } from '@/lib/cash-flow-parser'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Recebe um XLSX e devolve preview. Marca como `isStale` todos os
// títulos vencidos ou do próprio dia (vencimento <= hoje), que não entram
// na análise futura de fluxo.
//
// Não há mais checagem de duplicata aqui porque a importação substitui
// completamente o conteúdo da tabela (ver /api/cash-flow/save).
export async function POST(req: Request) {
  const fd = await req.formData()
  const file = fd.get('file') as File | null
  const filial = (fd.get('filial') as string | null)?.trim() || undefined
  if (!file) return NextResponse.json({ error: 'Arquivo não enviado' }, { status: 400 })
  if (!filial) return NextResponse.json({ error: 'Filial obrigatória' }, { status: 400 })

  const buf = await file.arrayBuffer()
  let result
  try {
    result = parseCashFlow(buf, filial)
  } catch (e) {
    return NextResponse.json({
      error: 'Falha ao ler XLSX: ' + (e instanceof Error ? e.message : String(e)),
    }, { status: 400 })
  }

  // Corte: vencimento estritamente FUTURO em relação ao dia atual.
  // Tudo com vencimento <= hoje (vencidos ou do próprio dia) fica fora.
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const isStale = (isoDueDate: string) => new Date(isoDueDate) <= today

  const rawItems = result.kind === 'receivable'
    ? (result.receivables ?? [])
    : (result.payables ?? [])

  const previewed = rawItems.map(i => ({ ...i, isStale: isStale(i.dueDate) }))
  const validCount = previewed.filter(i => !i.isStale).length
  const staleCount = previewed.length - validCount
  const validAmount = previewed
    .filter(i => !i.isStale)
    .reduce((s, i) => s + i.netAmount, 0)

  return NextResponse.json({
    kind: result.kind,
    total: previewed.length,
    totalAmount: result.totalAmount,
    validCount,
    validAmount,
    staleCount,
    items: previewed,
    errors: result.errors,
  })
}
