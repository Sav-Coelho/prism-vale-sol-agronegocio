/**
 * Baixa automática de pedido manual no import do CashFlow Analítico (projeção): o pedido vira 'Faturado' quando
 * CADA parcela verificável acha o seu boleto de mercadoria do mesmo fornecedor — vencimento a até ±10 dias e valor a
 * até ±3% da parcela — e cada boleto serve a uma parcela só. Pedidos em ordem de data; os já faturados reservam os
 * seus boletos primeiro, para o boleto de um pedido antigo não faturar um novo do mesmo fornecedor.
 * Parcela verificável = vence até o último boleto conhecido (depois disso o ERP ainda não emitiu nada).
 *
 * Até 05/11/2026 bastava a soma dos boletos do fornecedor nos meses das parcelas chegar a 85% do pedido: com
 * fornecedor grande (Ourofino, Zoetis, Mouragro, Virbac) qualquer pedido novo virava Faturado — 24 das 38 baixas de
 * 16/10 e 05/11 não tinham nenhuma parcela casada com boleto (decisão do Sávio: reabrir e corrigir a regra).
 */
import { grupoFornecedor } from '@/lib/matriz-fornecedores'

export interface PedidoBaixa { id: number; fornecedor: string | null; dataPedido: Date; valor: number; datas: unknown; status: string }
export interface BoletoBaixa { fornecedor: string; dueDate: Date; valor: number; operacao?: string | null }

const DIA = 86_400_000
export const TOLERANCIA_BAIXA = { dias: 10, valor: 0.03 }

/** ids dos pedidos ainda não faturados que passam a 'Faturado' */
export function pedidosParaFaturar(pedidos: PedidoBaixa[], boletos: BoletoBaixa[]): number[] {
  const validos = boletos.filter(b => !String(b.operacao ?? '').toUpperCase().includes('IMOBILIZADO'))
  if (!validos.length) return []
  const horizonte = validos.reduce((m, b) => Math.max(m, b.dueDate.getTime()), 0)
  const porForn = new Map<string, Array<{ i: number; t: number; v: number }>>()
  validos.forEach((b, i) => {
    const k = grupoFornecedor(b.fornecedor).chave
    const lista = porForn.get(k) ?? []
    lista.push({ i, t: b.dueDate.getTime(), v: b.valor })
    porForn.set(k, lista)
  })
  const usados = new Set<number>()
  const parcelas = (p: PedidoBaixa) => {
    const ts = Array.isArray(p.datas) ? (p.datas as unknown[]).map(d => Date.parse(String(d).slice(0, 10) + 'T00:00:00Z')).filter(t => !isNaN(t)) : []
    return ts.map(t => ({ t, v: p.valor / ts.length }))
  }
  // casa todas as parcelas verificáveis de um pedido; só reserva os boletos se todas acharem o seu
  const casa = (p: PedidoBaixa): boolean => {
    if (!p.fornecedor) return false
    const pool = porForn.get(grupoFornecedor(p.fornecedor).chave) ?? []
    const verificaveis = parcelas(p).filter(x => x.t <= horizonte)
    if (!verificaveis.length) return false
    const pegos: number[] = []
    const todas = verificaveis.every(x => {
      // valor mais próximo primeiro (as parcelas de uma nota têm valor certo; a data é que varia), depois a data
      const cand = pool
        .filter(b => !usados.has(b.i) && pegos.indexOf(b.i) < 0 && Math.abs(b.t - x.t) <= TOLERANCIA_BAIXA.dias * DIA && Math.abs(b.v - x.v) <= TOLERANCIA_BAIXA.valor * x.v)
        .sort((a, b) => Math.abs(a.v - x.v) - Math.abs(b.v - x.v) || Math.abs(a.t - x.t) - Math.abs(b.t - x.t))
      if (!cand.length) return false
      pegos.push(cand[0].i)
      return true
    })
    if (todas) pegos.forEach(i => usados.add(i))
    return todas
  }
  const ordem = (a: PedidoBaixa, b: PedidoBaixa) => a.dataPedido.getTime() - b.dataPedido.getTime() || a.id - b.id
  pedidos.filter(p => p.status === 'Faturado').sort(ordem).forEach(p => { casa(p) })
  return pedidos.filter(p => p.status !== 'Faturado').sort(ordem).filter(casa).map(p => p.id)
}
