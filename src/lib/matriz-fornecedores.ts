/**
 * Matriz de Fornecedores — a matriz de Kraljic quantificada (Montgomery, Ogden e
 * Boehmke, 2018, J. Purch. Supply Manag.), adaptada à Vale Sol e com as correções
 * da leitura crítica de 07/10/2026:
 *
 *   · IMPORTÂNCIA (eixo vertical) = participação do fornecedor no gasto com
 *     mercadoria PAGO nos últimos 12 meses fechados da DRE. É dado, não opinião.
 *     O corte é em unidade real: a "curva A de fornecedores", os que somam 80%
 *     do gasto (o paper usava 0,5 numa escala que jogava quase tudo num quadrante).
 *   · RISCO DE ABASTECIMENTO (eixo horizontal) = avaliação do comprador em 3
 *     perguntas fechadas — alternativas, condições impostas e falhas recentes —,
 *     nota 0–100, corte em 50. Na versão 2, com o export laboratório × produto,
 *     entram rupturas e alternativas medidas.
 *
 * O quadrante define a estratégia de compra de cada fornecedor. As regras que a
 * tela também usa ficam em lib/matriz-fornecedores-regras.
 */
import { prisma } from '@/lib/prisma'
import { classificarMesesDre } from '@/lib/dre-meses'
import {
  CORTE_RISCO, CURVA_A, acaoDe, quadranteDe, riscoDe,
  type LinhaMatriz, type ResultadoMatriz,
} from '@/lib/matriz-fornecedores-regras'

export { CAMPOS, PERGUNTAS, TIPOS } from '@/lib/matriz-fornecedores-regras'

const MESES_JANELA = 12

// ── agrupamento de cadastros: o mesmo fornecedor aparece com mais de um nome no ERP ──
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
// casos achados no gasto de jan–set/2026 (UNIAO QUIMICA F. NACIONAL + UNIAO QUIMICA
// FARMACEUTICA NACIONAL S/A etc.); acrescentar aqui quando surgir outro
const APELIDOS: Array<[RegExp, string]> = [
  [/^UNIAO QUIMICA\b/, 'UNIÃO QUÍMICA'],
  [/^(OUROFINO|OURO FINO)\b/, 'OUROFINO'],
  [/^(MSD|MERCK SHARP)\b/, 'MSD SAÚDE ANIMAL'],
  [/^ALISUL ALIMENTOS\b/, 'ALISUL ALIMENTOS'],
  [/^BELGO BEKAERT\b/, 'BELGO BEKAERT'],
  [/^PECUARISTA D ?OESTE\b/, "PECUARISTA D'OESTE"],
  [/^WEIZUR\b/, 'WEIZUR'],
]
const SUFIXOS = /\b(LTDA|LIMITADA|S A|SA|EIRELI|EPP|ME|FILIAL \d+|FILIAL)\b/g

export function grupoFornecedor(nome: string): { chave: string; rotulo: string | null } {
  const n = norm(nome)
  const ap = APELIDOS.find(([re]) => re.test(n))
  if (ap) return { chave: norm(ap[1]), rotulo: ap[1] }
  const base = n.replace(SUFIXOS, ' ').replace(/\s+/g, ' ').trim()
  return { chave: base || n, rotulo: null }
}

export async function calcularMatriz(hoje: Date = new Date()): Promise<ResultadoMatriz> {
  const vazio = (motivo: string): ResultadoMatriz => ({
    hasData: false, motivo, meses: [], gastoTotal: 0, gastoAnualizado: 0, nFornecedores: 0,
    curvaA: { n: 0, corte: 0 }, avaliados: { curvaA: 0, total: 0 }, corteRisco: CORTE_RISCO,
    resumo: { ALAVANCAGEM: { n: 0, gasto: 0 }, ESTRATEGICO: { n: 0, gasto: 0 }, GARGALO: { n: 0, gasto: 0 }, NAO_CRITICO: { n: 0, gasto: 0 }, SEM_AVALIACAO: { n: 0, gasto: 0 } },
    linhas: [],
  })

  const classif = await classificarMesesDre(hoje)
  const meses = classif.fechados.slice(-MESES_JANELA)
  if (!meses.length) return vazio('Sem mês fechado na DRE.')
  const inicioHoje = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()))
  const hojeStr = inicioHoje.toISOString().slice(0, 10)

  const [cmv, boletos, pedidos, avaliacoes] = await Promise.all([
    prisma.dreEntry.groupBy({
      by: ['supplier'],
      where: { line: 'CMV', OR: meses.map(m => ({ year: Number(m.slice(0, 4)), month: Number(m.slice(5, 7)) })) },
      _sum: { amount: true },
    }),
    prisma.purchaseCommit.findMany({ where: { dueDate: { gte: inicioHoje } }, select: { fornecedor: true, valor: true, operacao: true } }),
    prisma.purchaseOrder.findMany({ where: { status: { not: 'Faturado' }, fornecedor: { not: null } }, select: { fornecedor: true, valor: true, datas: true } }),
    prisma.fornecedorRisco.findMany(),
  ])

  type Grupo = { chave: string; rotulo: string | null; nomes: Map<string, number>; gasto: number; aVencer: number; pedidos: number }
  const grupos = new Map<string, Grupo>()
  const grupo = (nome: string): Grupo => {
    const g = grupoFornecedor(nome)
    let o = grupos.get(g.chave)
    if (!o) { o = { chave: g.chave, rotulo: g.rotulo, nomes: new Map(), gasto: 0, aVencer: 0, pedidos: 0 }; grupos.set(g.chave, o) }
    if (!o.nomes.has(nome)) o.nomes.set(nome, 0)
    return o
  }

  cmv.forEach(r => {
    const v = r._sum.amount ?? 0
    if (!r.supplier || v === 0) return
    const g = grupo(r.supplier)
    g.gasto += v
    g.nomes.set(r.supplier, (g.nomes.get(r.supplier) ?? 0) + v)
  })
  boletos.forEach(b => {
    if (norm(b.operacao ?? '').includes('IMOBILIZADO')) return       // mesma regra do Controle de Compras
    grupo(b.fornecedor).aVencer += b.valor
  })
  pedidos.forEach(p => {
    const ds = Array.isArray(p.datas) ? (p.datas as unknown[]).map(d => String(d).slice(0, 10)) : []
    const aVencer = ds.length ? (p.valor / ds.length) * ds.filter(d => d >= hojeStr).length : p.valor
    if (aVencer > 0) grupo(p.fornecedor as string).pedidos += aVencer
  })
  const aval = new Map(avaliacoes.map(a => [a.chave, a]))
  avaliacoes.forEach(a => {
    if (!grupos.has(a.chave)) grupos.set(a.chave, { chave: a.chave, rotulo: a.nome, nomes: new Map([[a.nome, 0]]), gasto: 0, aVencer: 0, pedidos: 0 })
  })

  const lista = Array.from(grupos.values()).sort((a, b) => b.gasto - a.gasto || b.aVencer - a.aVencer)
  const gastoTotal = lista.reduce((s, g) => s + g.gasto, 0)
  if (gastoTotal <= 0) return vazio('Sem compras de mercadoria nos meses fechados da DRE.')

  let acc = 0, corte = 0, nA = 0
  const linhas: LinhaMatriz[] = lista.map(g => {
    const participacao = g.gasto / gastoTotal
    const naCurvaA = g.gasto > 0 && acc < CURVA_A          // entra quem ainda não completou os 80%
    acc += participacao
    if (naCurvaA) { nA++; corte = participacao }
    const a = aval.get(g.chave)
    const resp = { alternativas: a?.alternativas ?? null, condicoes: a?.condicoes ?? null, falhas: a?.falhas ?? null }
    const risco = riscoDe(resp)
    const quadrante = quadranteDe(naCurvaA, risco)
    const nomes = Array.from(g.nomes.entries()).sort((x, y) => y[1] - x[1]).map(([n]) => n)
    return {
      chave: g.chave,
      nome: g.rotulo ?? nomes[0] ?? g.chave,
      nomes,
      gasto: g.gasto,
      participacao,
      acumulada: acc,
      curvaA: naCurvaA,
      aVencer: g.aVencer,
      pedidosAbertos: g.pedidos,
      tipo: a?.tipo ?? null,
      ...resp,
      risco,
      quadrante,
      acao: acaoDe(quadrante, a?.tipo ?? null),
      valor1pct: g.gasto * (12 / meses.length) * 0.01,
      atualizadoEm: a?.updatedAt ? a.updatedAt.toISOString() : null,
      atualizadoPor: a?.updatedBy ?? null,
    }
  })

  const resumo = vazio('').resumo
  linhas.forEach(l => { resumo[l.quadrante].n++; resumo[l.quadrante].gasto += l.gasto })
  return {
    hasData: true,
    meses,
    gastoTotal,
    gastoAnualizado: gastoTotal * (12 / meses.length),
    nFornecedores: linhas.filter(l => l.gasto > 0).length,
    curvaA: { n: nA, corte },
    avaliados: { curvaA: linhas.filter(l => l.curvaA && l.risco != null).length, total: linhas.filter(l => l.risco != null).length },
    corteRisco: CORTE_RISCO,
    resumo,
    linhas,
  }
}
