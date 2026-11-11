/**
 * Fluxo de Caixa › Cartões — faturas enviadas, situação de cada uma na DRE e o plano de
 * contas para a classificação. Só o perfil gerencial.
 */
import { prisma } from '@/lib/prisma'
import { guard } from '@/lib/auth-node'
import { carregarConciliacao, linhaJson, planoDeContas, unidadeDaFilial } from '@/lib/cartao-dre'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const ym = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`

export async function GET() {
  const g = await guard(['gerencial']); if (!g.ok) return g.res
  const [{ faturas, resultados }, contas, cartoes, meses] = await Promise.all([
    carregarConciliacao(), planoDeContas(), prisma.cartao.findMany({ orderBy: [{ banco: 'asc' }, { final: 'asc' }] }),
    prisma.caixaLancamento.groupBy({ by: ['year', 'month'], _count: { _all: true } }),
  ])
  const caixaMeses = meses.map(m => `${m.year}-${String(m.month).padStart(2, '0')}`).sort()
  return NextResponse.json({
    cartoes: cartoes.map(c => ({ ...c, unidade: unidadeDaFilial(c.filial) })),
    contas,
    caixaMeses,
    faturas: faturas.map(f => {
      const r = resultados.find(x => x.faturaId === f.id)
      const mesVenc = ym(f.vencimento)
      return {
        id: f.id, arquivo: f.arquivo, leitura: f.leitura, createdAt: f.createdAt, createdBy: f.createdBy,
        cartao: { id: f.cartao.id, banco: f.cartao.banco, final: f.cartao.final, nome: f.cartao.nome, titular: f.cartao.titular, filial: f.cartao.filial },
        vencimento: f.vencimento.toISOString().slice(0, 10), total: f.total, saldoAnterior: f.saldoAnterior,
        nItens: f.itens.length, nClassificados: f.itens.filter(i => i.caminho).length,
        valorClassificado: r?.classificado ?? 0, aplicado: r?.aplicado ?? 0, erro: r?.erro ?? null,
        pagamento: r ? { ...r.pagamento, linhasTotal: r.pagamento.linhasTotal.map(linhaJson) } : null,
        caixaImportado: caixaMeses.includes(mesVenc),
      }
    }),
  })
}
