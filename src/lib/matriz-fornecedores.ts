/**
 * Matriz de Fornecedores — a matriz de Kraljic quantificada (Montgomery, Ogden e
 * Boehmke, 2018, J. Purch. Supply Manag.), adaptada à Vale Sol e com as correções
 * da leitura crítica de 07/10/2026:
 *
 *   · IMPORTÂNCIA (eixo vertical) = participação do fornecedor no gasto com
 *     mercadoria PAGO nos últimos 12 meses fechados da DRE. É dado, não opinião.
 *     O corte é em unidade real: a "curva A de fornecedores", os que somam 80%
 *     do gasto (o paper usava 0,5 numa escala que jogava quase tudo num quadrante).
 *   · RISCO DE ABASTECIMENTO (eixo horizontal) = avaliação do comprador em 4
 *     perguntas fechadas (v2, 16/10/2026) — substituto aceito pelo cliente, outro
 *     canal para a mesma marca, condições impostas e falhas recentes —, nota
 *     0–100, corte em 50; nenhuma resposta sozinha chega ao corte. Qualquer
 *     fornecedor pode ser avaliado (fora da curva A: Gargalo × Não crítico) — a lista
 *     inclui os ativos do cadastro de Compras ainda sem pagamento na janela (gasto 0).
 *     Com o export laboratório × produto, entram rupturas e alternativas medidas.
 *   · TIPO (16/10/2026) = Laboratório, Distribuidor ou Outros, sugerido pelo nome e
 *     confirmado pelo comprador; filtra a tela. Quem não vende mercadoria (veículo,
 *     alarme, equipamento…) sai da lista, mas o pago a ele fica no total, que bate com a
 *     DRE — tirá-lo do total mexeria na curva A (a Halex está no limite dos 80%).
 *
 * O quadrante define a estratégia de compra de cada fornecedor. As regras que a
 * tela também usa ficam em lib/matriz-fornecedores-regras.
 */
import { prisma } from '@/lib/prisma'
import { classificarMesesDre } from '@/lib/dre-meses'
import {
  CORTE_RISCO, CURVA_A, TIPOS, acaoDe, quadranteDe, riscoDe,
  type LinhaMatriz, type ResultadoMatriz, type Tipo,
} from '@/lib/matriz-fornecedores-regras'

export { CAMPOS, PERGUNTAS, TIPOS } from '@/lib/matriz-fornecedores-regras'

const MESES_JANELA = 12
/** o CashFlow (DRE) corta o nome do fornecedor em 50 letras; abaixo disto, prefixo não basta para casar */
const MIN_PREFIXO = 30

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

// ── fora da lista: não vendem mercadoria, embora pagos na linha de compras da DRE ou com boleto
// "FORNECEDOR MERCADORIAS" no ERP — veículo (FCA, Great Wall), autopeça (G Store), alarme (Proteger),
// refrigeração e equipamento (J.C.M. e Elements, COMPRA IMOBILIZADO no ERP). FCA, Proteger, J.C.M. e
// Elements confirmados com o cliente em 07/2026; acrescentar aqui quando surgir outro.
const NAO_MERCADORIA = /^(FCA FIAT|GREAT WALL|G STORE AUTOMOTIVE|PROTEGER ELETRONICA|J C M NITEROI REFRIGERACAO|CENTRO DE TECNOLOGIA ELEMENTS)\b/

// ── tipo sugerido pelo nome, para o comprador conferir na tela ──
// Primeiro os fornecedores do gasto de jan–set/2026 cujo nome não diz o tipo ou diz outra coisa (a Zoetis
// fatura como "comércio e distribuição"; a Orga Log é a logística pela qual o laboratório fatura — Lucas,
// 07/2026); depois, as palavras do nome. Sem pista, Outros.
const TIPO_POR_NOME: Array<[RegExp, Tipo]> = [
  [/^(ZOETIS|MSD SAUDE ANIMAL|OUROFINO|UNIAO QUIMICA|VIRBAC|VETNIL|BOTUPHARMA|BIOGENESIS|LABORATORIOS CALBOS|LAVIZOO|VET SCIENCE|DECHRA|HALEX ISTAR|LABOVET|VANSIL|SYNTEC|BOEHRINGER|IBIRA|VETOQUINOL|BIMEDA|WINNER HORSE|ORGA LOG)\b/, 'LABORATORIO'],
  [/^(MOURAGRO|J A AGRONEGOCIOS|SEAHORSE|SEROPEC|ESPECIFARMA|VETMINAS|PECUARISTA D ?OESTE|VET AGRO|BASSO PANCOTTE|FASVITH)\b/, 'DISTRIBUIDOR'],
  [/^(ALISUL|DSM|BELGO|WEIZUR|MATTHEIS|DATAMARS|ALLFLEX|SISTEMAS DE IDENTIFICACAO|MINITUB|IMV|REPRODUX|WTA|EMBRIOLIFE|APARELHOS VETERINARIOS|SPECTRUN|NIPRO|POINT SUTURE|DENTAL CREMER|FONSECA PLASTIC|WOLF SEEDS|ADL|QUIMIWAY|TNB|MS FABRICANTE|TECELAGEM)\b/, 'OUTROS'],
  [/\b(DISTRIBUIDORA|DISTRIBUIDOR|DISTRIBUICAO|DISTRIB|DISTR|DIST|IMPORTADORA|REPRESENTACOES|AGROPECUARIA|AGROP|COMERCIO DE PRODUTOS (VETERINARIOS|AGROPECUARIOS)|PRODUTOS AGRO ?PECUARIOS?)\b/, 'DISTRIBUIDOR'],
  [/\b(LABORATORIOS?|FARMACEUTICA|PHARMA|INDUSTRIA VETERINARIA|SAUDE ANIMAL|ANIMAL HEALTH|PRODUTOS VETERINARIOS|PROD VET)\b/, 'LABORATORIO'],
]

export function tipoSugerido(nomes: string[]): Tipo {
  const ns = nomes.map(norm)
  for (let i = 0; i < TIPO_POR_NOME.length; i++) {
    const [re, tipo] = TIPO_POR_NOME[i]
    if (ns.some(n => re.test(n))) return tipo
  }
  return 'OUTROS'
}

/**
 * Tipo gravado → tipo atual. Da 1ª versão (até 16/10/2026): "Fabricante" vale como Laboratório
 * quando o nome também indica laboratório; nos outros casos (ração, nome de distribuidora) volta a
 * ser sugestão e a resposta antiga aparece na tela até o comprador escolher.
 */
function tipoGravado(gravado: string | null, sugerido: Tipo): { tipo: Tipo | null; tipoV1: string | null } {
  if (gravado == null) return { tipo: null, tipoV1: null }
  if ((TIPOS as readonly string[]).indexOf(gravado) >= 0) return { tipo: gravado as Tipo, tipoV1: null }
  if (gravado === 'OUTRO') return { tipo: 'OUTROS', tipoV1: null }
  if (gravado === 'FABRICANTE' && sugerido === 'LABORATORIO') return { tipo: 'LABORATORIO', tipoV1: null }
  return { tipo: null, tipoV1: gravado }
}

export async function calcularMatriz(hoje: Date = new Date()): Promise<ResultadoMatriz> {
  const vazio = (motivo: string): ResultadoMatriz => ({
    hasData: false, motivo, meses: [], gastoTotal: 0, gastoAnualizado: 0, nFornecedores: 0,
    curvaA: { n: 0, corte: 0 }, avaliados: { curvaA: 0, total: 0 }, pendentesV2: 0, foraDaLista: { n: 0, gasto: 0 }, corteRisco: CORTE_RISCO,
    resumo: { ALAVANCAGEM: { n: 0, gasto: 0 }, ESTRATEGICO: { n: 0, gasto: 0 }, GARGALO: { n: 0, gasto: 0 }, NAO_CRITICO: { n: 0, gasto: 0 }, SEM_AVALIACAO: { n: 0, gasto: 0 } },
    linhas: [],
  })

  const classif = await classificarMesesDre(hoje)
  const meses = classif.fechados.slice(-MESES_JANELA)
  if (!meses.length) return vazio('Sem mês fechado na DRE.')
  const inicioHoje = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()))
  const hojeStr = inicioHoje.toISOString().slice(0, 10)

  const [cmv, boletos, pedidos, avaliacoes, cadastro] = await Promise.all([
    prisma.dreEntry.groupBy({
      by: ['supplier'],
      where: { line: 'CMV', OR: meses.map(m => ({ year: Number(m.slice(0, 4)), month: Number(m.slice(5, 7)) })) },
      _sum: { amount: true },
    }),
    prisma.purchaseCommit.findMany({ where: { dueDate: { gte: inicioHoje } }, select: { fornecedor: true, valor: true, operacao: true } }),
    prisma.purchaseOrder.findMany({ where: { status: { not: 'Faturado' }, fornecedor: { not: null } }, select: { fornecedor: true, valor: true, datas: true } }),
    prisma.fornecedorRisco.findMany(),
    prisma.fornecedor.findMany({ where: { ativo: true }, select: { nome: true } }),
  ])

  type Grupo = { chave: string; rotulo: string | null; nomes: Map<string, number>; gasto: number; aVencer: number; pedidos: number }
  const grupos = new Map<string, Grupo>()
  // Nome cortado: o CashFlow traz "IBIRA IND. E COM. DE PRODUTOS COSMETICOS E VETERIN"; boletos, pedidos
  // e o cadastro de Compras, o nome inteiro ("…VETERINARIOS LTDA"). Se uma chave começa pela outra, com
  // pelo menos MIN_PREFIXO letras, é o mesmo fornecedor — fica no grupo que já existe (o de maior chave).
  const resolver = (chave: string): string | null => {
    if (grupos.has(chave)) return chave
    let melhor: string | null = null
    Array.from(grupos.keys()).forEach(k => {
      const curta = k.length <= chave.length ? k : chave
      const longa = k.length <= chave.length ? chave : k
      if (curta.length >= MIN_PREFIXO && longa.indexOf(curta) === 0 && (melhor === null || k.length > melhor.length)) melhor = k
    })
    return melhor
  }
  const grupo = (nome: string): Grupo => {
    const g = grupoFornecedor(nome)
    const existente = resolver(g.chave)
    if (existente) {
      const o = grupos.get(existente) as Grupo
      if (existente === g.chave && !o.nomes.has(nome)) o.nomes.set(nome, 0)   // grafia nova do ERP; nome cortado não conta como cadastro
      return o
    }
    const o: Grupo = { chave: g.chave, rotulo: g.rotulo, nomes: new Map([[nome, 0]]), gasto: 0, aVencer: 0, pedidos: 0 }
    grupos.set(g.chave, o)
    return o
  }

  // quem não vende mercadoria não entra na lista; o que foi pago a ele na DRE fica no total
  const fora = new Set<string>()
  let gastoFora = 0
  const foraDaLista = (nome: string): boolean => {
    if (!NAO_MERCADORIA.test(norm(nome))) return false
    fora.add(grupoFornecedor(nome).chave)
    return true
  }

  cmv.forEach(r => {
    const v = r._sum.amount ?? 0
    if (!r.supplier || v === 0) return
    if (foraDaLista(r.supplier)) { gastoFora += v; return }
    const g = grupo(r.supplier)
    g.gasto += v
    g.nomes.set(r.supplier, (g.nomes.get(r.supplier) ?? 0) + v)
  })
  boletos.forEach(b => {
    if (norm(b.operacao ?? '').includes('IMOBILIZADO')) return       // mesma regra do Controle de Compras
    if (foraDaLista(b.fornecedor)) return
    grupo(b.fornecedor).aVencer += b.valor
  })
  pedidos.forEach(p => {
    if (foraDaLista(p.fornecedor as string)) return
    const ds = Array.isArray(p.datas) ? (p.datas as unknown[]).map(d => String(d).slice(0, 10)) : []
    const aVencer = ds.length ? (p.valor / ds.length) * ds.filter(d => d >= hojeStr).length : p.valor
    if (aVencer > 0) grupo(p.fornecedor as string).pedidos += aVencer
  })
  const aval = new Map(avaliacoes.map(a => [a.chave, a]))
  avaliacoes.forEach(a => {
    if (!grupos.has(a.chave) && !foraDaLista(a.nome)) grupos.set(a.chave, { chave: a.chave, rotulo: a.nome, nomes: new Map([[a.nome, 0]]), gasto: 0, aVencer: 0, pedidos: 0 })
  })
  // cadastro do Controle de Compras: fornecedor novo ou de compra recente, ainda sem pagamento na
  // janela, também pode ser avaliado. Quem já está na lista (inclusive com o nome cortado) não duplica.
  cadastro.forEach(f => {
    if (foraDaLista(f.nome)) return
    const g = grupoFornecedor(f.nome)
    if (!resolver(g.chave)) grupos.set(g.chave, { chave: g.chave, rotulo: g.rotulo ?? f.nome, nomes: new Map([[f.nome, 0]]), gasto: 0, aVencer: 0, pedidos: 0 })
  })

  const lista = Array.from(grupos.values()).sort((a, b) => b.gasto - a.gasto || b.aVencer - a.aVencer)
  const gastoTotal = lista.reduce((s, g) => s + g.gasto, 0) + gastoFora
  if (gastoTotal <= 0) return vazio('Sem compras de mercadoria nos meses fechados da DRE.')

  let acc = 0, corte = 0, nA = 0
  const linhas: LinhaMatriz[] = lista.map(g => {
    const participacao = g.gasto / gastoTotal
    const naCurvaA = g.gasto > 0 && acc < CURVA_A          // entra quem ainda não completou os 80%
    acc += participacao
    if (naCurvaA) { nA++; corte = participacao }
    const a = aval.get(g.chave)
    const resp = { substituto: a?.substituto ?? null, canal: a?.canal ?? null, condicoes: a?.condicoes ?? null, falhas: a?.falhas ?? null }
    const risco = riscoDe(resp)
    const quadrante = quadranteDe(naCurvaA, risco)
    const nomes = Array.from(g.nomes.entries()).sort((x, y) => y[1] - x[1]).map(([n]) => n)
    const sugerido = tipoSugerido([g.chave].concat(nomes))
    const { tipo, tipoV1 } = tipoGravado(a?.tipo ?? null, sugerido)
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
      tipo,
      tipoSugerido: sugerido,
      tipoV1,
      ...resp,
      alternativasV1: a?.alternativas ?? null,
      risco,
      quadrante,
      acao: acaoDe(quadrante, tipo ?? sugerido),
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
    pendentesV2: linhas.filter(l => l.alternativasV1 != null && l.risco == null).length,
    foraDaLista: { n: fora.size, gasto: gastoFora },
    corteRisco: CORTE_RISCO,
    resumo,
    linhas,
  }
}
