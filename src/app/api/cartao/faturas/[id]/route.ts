/**
 * Uma fatura de cartão: itens com a situação de cada um na DRE, o pagamento achado no
 * caixa e as linhas do caixa candidatas para o vínculo manual.
 */
import { prisma } from '@/lib/prisma'
import { guard } from '@/lib/auth-node'
import { carregarConciliacao, linhaJson } from '@/lib/cartao-dre'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0
const DIA = 86_400_000

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const g = await guard(['gerencial']); if (!g.ok) return g.res
  const id = Number(params.id)
  const { faturas, linhas, resultados } = await carregarConciliacao()
  const f = faturas.find(x => x.id === id)
  if (!f) return NextResponse.json({ error: 'Fatura não encontrada.' }, { status: 404 })
  const r = resultados.find(x => x.faturaId === id)
  // linhas que outras faturas já usam não podem ser vinculadas a esta
  const deOutras = new Set<string>()
  resultados.filter(x => x.faturaId !== id).forEach(x => {
    x.pagamento.linhasTotal.forEach(l => deOutras.add(l.chave))
    Object.values(x.itens).forEach(i => { if (i.chave) deOutras.add(i.chave) })
  })
  const minhas = new Set<string>([...(r?.pagamento.linhasTotal.map(l => l.chave) ?? []), ...Object.values(r?.itens ?? {}).map(i => i.chave).filter(Boolean) as string[]])
  const v = f.vencimento.getTime()
  const candidatos = linhas
    .filter(l => l.kind === 'EXP' && l.line !== 'INTRAGRUPO' && !deOutras.has(l.chave) && l.data.getTime() >= v - 10 * DIA && l.data.getTime() <= v + 15 * DIA)
    .sort((a, b) => a.data.getTime() - b.data.getTime() || b.valor - a.valor)
    .map(l => ({ ...linhaJson(l), usada: minhas.has(l.chave) }))
  return NextResponse.json({
    id: f.id, arquivo: f.arquivo, leitura: f.leitura,
    cartao: { id: f.cartao.id, banco: f.cartao.banco, final: f.cartao.final, nome: f.cartao.nome, titular: f.cartao.titular, filial: f.cartao.filial },
    vencimento: f.vencimento.toISOString().slice(0, 10), total: f.total, saldoAnterior: f.saldoAnterior,
    pagamento: r ? { ...r.pagamento, linhasTotal: r.pagamento.linhasTotal.map(linhaJson) } : null,
    classificado: r?.classificado ?? 0, aplicado: r?.aplicado ?? 0, erro: r?.erro ?? null,
    vinculosManuais: f.vinculos.filter(x => x.itemId == null).map(x => x.chave),
    itens: f.itens.sort((a, b) => a.ordem - b.ordem).map(i => ({
      id: i.id, ordem: i.ordem, data: i.dataCompra ? i.dataCompra.toISOString().slice(0, 10) : null, descricao: i.descricao,
      parcela: i.parcela, portador: i.portador, valor: i.valor, caminho: i.caminho, sugestao: i.sugestao,
      classificadoEm: i.classificadoEm, classificadoPor: i.classificadoPor,
      ...(r?.itens[i.id] ?? { estado: 'SEM_PAGAMENTO' }),
    })),
    candidatos,
  })
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const g = await guard(['gerencial']); if (!g.ok) return g.res
  const id = Number(params.id)
  const f = await prisma.cartaoFatura.findUnique({ where: { id } })
  if (!f) return NextResponse.json({ error: 'Fatura não encontrada.' }, { status: 404 })
  await prisma.cartaoFatura.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
