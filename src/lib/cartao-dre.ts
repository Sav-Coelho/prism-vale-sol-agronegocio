/**
 * Faturas de cartão: carrega do banco, concilia com o caixa realizado (lib/cartao-conciliacao)
 * e entrega a troca para a DRE e para a tela do Fluxo de Caixa › Cartões.
 */
import { prisma } from '@/lib/prisma'
import { classificarSaida, unitOf } from '@/lib/dre-cashflow-source'
import { LINE_LABEL } from '@/lib/dre-classifier'
import { conciliar, JANELA, type DeltaDre, type FaturaConc, type LinhaCaixa } from '@/lib/cartao-conciliacao'

const DIA = 86_400_000
const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()

export async function carregarConciliacao() {
  const faturas = await prisma.cartaoFatura.findMany({ include: { cartao: true, itens: true, vinculos: true }, orderBy: [{ vencimento: 'desc' }, { id: 'desc' }] })
  if (!faturas.length) return { faturas, linhas: [] as LinhaCaixa[], resultados: [] as ReturnType<typeof conciliar> }
  const ts = faturas.map(f => f.vencimento.getTime())
  const de = new Date(Math.min(...ts) - (JANELA.antes + 10) * DIA), ate = new Date(Math.max(...ts) + (JANELA.depois + 10) * DIA)
  const manuais = Array.from(new Set(faturas.flatMap(f => f.vinculos.map(v => v.chave))))
  const linhas = await prisma.caixaLancamento.findMany({
    where: { OR: [{ data: { gte: de, lte: ate } }, ...(manuais.length ? [{ chave: { in: manuais } }] : [])] },
  })
  const fc: FaturaConc[] = faturas.map(f => ({
    id: f.id, vencimento: f.vencimento, total: f.total, saldoAnterior: f.saldoAnterior,
    banco: f.cartao.banco, final: f.cartao.final, cartaoFilial: f.cartao.filial,
    itens: f.itens.map(i => ({ id: i.id, ordem: i.ordem, valor: i.valor, caminho: i.caminho, descricao: i.descricao })),
    vinculos: f.vinculos.map(v => ({ chave: v.chave, itemId: v.itemId })),
  }))
  return { faturas, linhas, resultados: conciliar(fc, linhas, classificarSaida) }
}

/**
 * Troca da DRE vinda das faturas de cartão: para cada item classificado, −valor no balde da
 * linha do caixa que pagou a fatura e +valor na conta escolhida. Soma zero em cada fatura.
 */
export async function ajustesCartaoDre(): Promise<DeltaDre[]> {
  const { resultados } = await carregarConciliacao()
  return resultados.flatMap(r => r.deltas)
}

/** Loja de uma conta do plano pelo 2º nível ("DESPESAS VALE DO SOL TRES RIOS" → VS - TRÊS RIOS) */
export function lojaDaConta(caminho: string): string | null {
  const n2 = norm(caminho.split(' › ')[1] ?? '')
  const lugar = /RIO BONITO|MATRIZ/.test(n2) ? 'RIO BONITO' : /TRES RIOS/.test(n2) ? 'TRÊS RIOS' : /QUATIS/.test(n2) ? 'QUATIS' : /APERIBE/.test(n2) ? 'APERIBÉ' : /SETE LAGOAS|7 LAGOAS/.test(n2) ? '7 LAGOAS' : null
  if (!lugar) return null
  if (/MULTMUNDE|MULTIMUNDO/.test(n2)) return `MM - ${lugar}`
  if (/VALE DO SOL/.test(n2)) return `VS - ${lugar}`
  return null
}

export interface ContaPlano { caminho: string; folha: string; loja: string | null; linha: string; linhaLabel: string; usos: number; recente: boolean }

/**
 * Plano de contas de SAÍDA que o financeiro usa (CashFlow Analítico realizado), com a linha
 * da DRE em que cada conta cai. "Recente" = usada de set/2026 em diante (plano destrinchado
 * por loja); as contas antigas, com "- LOJA n", ficam disponíveis mas fora da lista padrão.
 */
export async function planoDeContas(): Promise<ContaPlano[]> {
  const [todas, recentes, caixa] = await Promise.all([
    prisma.cashflowEntry.groupBy({ by: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'], where: { tipo: 'S' }, _sum: { n: true } }),
    prisma.cashflowEntry.groupBy({ by: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'], where: { tipo: 'S', OR: [{ year: { gt: 2026 } }, { year: 2026, month: { gte: 9 } }] }, _sum: { n: true } }),
    prisma.caixaLancamento.groupBy({ by: ['caminho'], _count: { _all: true } }),
  ])
  const chave = (r: { c1: string; c2: string | null; c3: string | null; c4: string | null; c5: string | null; c6: string | null }) =>
    [r.c1, r.c2, r.c3, r.c4, r.c5, r.c6].filter(Boolean).map(s => String(s).replace(/\s+/g, ' ').trim()).join(' › ')
  const recSet = new Set(recentes.map(r => norm(chave(r))))
  const mapa = new Map<string, { caminho: string; usos: number; recente: boolean }>()
  todas.forEach(r => { const c = chave(r); const k = norm(c); const o = mapa.get(k); if (o) o.usos += r._sum.n ?? 0; else mapa.set(k, { caminho: c, usos: r._sum.n ?? 0, recente: recSet.has(k) }) })
  caixa.forEach(r => { const k = norm(r.caminho); const o = mapa.get(k); if (o) { o.usos += r._count._all; o.recente = true } else mapa.set(k, { caminho: r.caminho, usos: r._count._all, recente: true }) })
  const out: ContaPlano[] = []
  mapa.forEach(o => {
    const c = classificarSaida(o.caminho, '', 2026, 11)
    if (!c || c.kind !== 'EXP' || c.line === 'INTRAGRUPO') return
    out.push({ caminho: o.caminho, folha: o.caminho.split(' › ').slice(-1)[0], loja: lojaDaConta(o.caminho), linha: c.line, linhaLabel: (LINE_LABEL as Record<string, string>)[c.line] ?? c.line, usos: o.usos, recente: o.recente })
  })
  return out.sort((a, b) => a.folha.localeCompare(b.folha, 'pt-BR') || (a.loja ?? '').localeCompare(b.loja ?? ''))
}

/** Linha do caixa para a tela */
export const linhaJson = (l: LinhaCaixa) => ({
  chave: l.chave, data: l.data.toISOString().slice(0, 10), filial: l.filial, historico: l.supplier, documento: l.documento,
  conta: l.caminho.split(' › ').slice(-1)[0], caminho: l.caminho, valor: l.valor, mes: `${l.year}-${String(l.month).padStart(2, '0')}`,
})

/** Unidade da DRE da filial em que o cartão é pago */
export const unidadeDaFilial = (filial: string | null) => (filial ? unitOf(filial) : null)
