/**
 * Quais meses da base da DRE são REALIZADOS — regra única, usada pela DRE,
 * pelo Orçamento e pelo Controle de Compras.
 *
 * O import do CashFlow Analítico grava o que o arquivo trouxer. Um arquivo de
 * PROJEÇÃO traz títulos a receber e a pagar dos meses seguintes, e esses meses
 * aparecem na base com receita e despesa sem serem caixa realizado. Aconteceu
 * em 25/09/2026: o "1909s3112" entrou pelo import da DRE e set/26–fev/27
 * viraram projeção dentro da DRE — a tela somava −R$ 2,3 milhões de títulos
 * futuros ao lucro do período, e o limite de compras de outubro ia sair de
 * setembro-projeção.
 *
 * Um mês é FECHADO quando cumpre as duas condições:
 *   1. é anterior ao mês corrente (relógio do servidor, UTC);
 *   2. tem o razão inteiro: um mês realizado tem ~1.500 lançamentos aqui; um
 *      mês parcial ou de projeção, só os títulos já emitidos (90–830). O corte
 *      é 60% da mediana dos meses anteriores ao corrente.
 * Contar "tem receita" ou "tem despesa" não separa: a projeção tem as duas.
 */
import { prisma } from '@/lib/prisma'

export type StatusMes = 'fechado' | 'corrente' | 'incompleto' | 'futuro'

export const chaveMes = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`
/** 'AAAA-MM' do mês corrente no relógio do servidor (UTC) */
export const mesCorrente = (hoje: Date = new Date()) => chaveMes(hoje.getUTCFullYear(), hoje.getUTCMonth() + 1)

export interface ClassificacaoMeses {
  status: Record<string, StatusMes>
  /** meses fechados, em ordem */
  fechados: string[]
  /** lançamentos mínimos para o mês contar como fechado */
  corte: number
  /** lançamentos por mês, para a tela explicar o descarte */
  contagem: Record<string, number>
}

/** Classifica cada mês a partir do número de lançamentos que a base tem nele. */
export function classificarMeses(contagem: Map<string, number>, hoje: Date = new Date()): ClassificacaoMeses {
  const atual = mesCorrente(hoje)
  const meses = Array.from(contagem.keys()).sort()
  const anteriores = meses.filter(m => m < atual).map(m => contagem.get(m) ?? 0).sort((a, b) => a - b)
  const mediana = anteriores.length ? anteriores[Math.floor(anteriores.length / 2)] : 0
  const corte = mediana * 0.6
  const status: Record<string, StatusMes> = {}
  meses.forEach(m => {
    status[m] = m > atual ? 'futuro'
      : m === atual ? 'corrente'
      : (contagem.get(m) ?? 0) >= corte ? 'fechado' : 'incompleto'
  })
  const cont: Record<string, number> = {}
  meses.forEach(m => { cont[m] = contagem.get(m) ?? 0 })
  return { status, fechados: meses.filter(m => status[m] === 'fechado'), corte: Math.round(corte), contagem: cont }
}

/** Lê a densidade do DreEntry e classifica os meses. */
export async function classificarMesesDre(hoje: Date = new Date()): Promise<ClassificacaoMeses> {
  const rows = await prisma.dreEntry.groupBy({ by: ['year', 'month'], _count: { _all: true } })
  const contagem = new Map<string, number>()
  rows.forEach(r => contagem.set(chaveMes(r.year, r.month), r._count._all))
  return classificarMeses(contagem, hoje)
}
