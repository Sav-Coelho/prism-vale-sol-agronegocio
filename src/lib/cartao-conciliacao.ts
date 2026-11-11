/**
 * Fatura de cartão × caixa realizado → troca na DRE. Parte PURA (sem banco).
 *
 * Regra que não pode quebrar (Sávio, 11/11/2026): NUNCA contar duas vezes. A fatura
 * já está no caixa — o ERP baixa o pagamento dela em alguma conta (o Safra entra
 * inteiro como "Brave / Consultorias"; o Itaú, em parte item a item). Por isso um item
 * classificado só entra na DRE TIRANDO o mesmo valor de uma linha do caixa que pagou a
 * fatura, no mesmo mês e na mesma loja. Em toda fatura: soma do que sai = soma do que
 * entra. O que não for classificado, ou não tiver pagamento achado, fica como está.
 *
 * Como o pagamento é achado (linhas de SAÍDA do caixa realizado, kind EXP, até 3 dias
 * antes e 7 depois do vencimento, nenhuma usada por duas faturas):
 *   1. vínculo manual feito pelo financeiro na tela, se houver;
 *   2. TOTAL: uma linha (ou até 4 do mesmo histórico ou do mesmo dia e filial) que
 *      some exatamente o total da fatura → os itens classificados consomem esse valor;
 *   3. ITENS: sem o total, cada item procura uma linha de MESMO valor na filial do
 *      cartão (a informada, ou a que mais casa), e o que sobrar ainda pode achar uma
 *      linha (ou soma de linhas) igual ao resto.
 * Um vínculo errado entre duas linhas de mesmo valor não cria nem some dinheiro: a
 * troca é sempre do mesmo valor.
 *
 * Vale de novembro/2026 em diante (CARTAO_DESDE): meses fechados não mudam.
 */

export const CARTAO_DESDE = { year: 2026, month: 11 }
const DIA = 86_400_000
export const JANELA = { antes: 3, depois: 7 }
const TOL = 0.005

export interface LinhaCaixa {
  chave: string; data: Date; filial: string; unit: string; kind: string; line: string; sub: string
  supplier: string | null; documento: string | null; caminho: string; valor: number; year: number; month: number
}
export interface ItemConc { id: number; ordem: number; valor: number; caminho: string | null; descricao: string }
export interface FaturaConc {
  id: number; vencimento: Date; total: number; saldoAnterior: number
  banco: string; final: string; cartaoFilial: string | null
  itens: ItemConc[]; vinculos: { chave: string; itemId: number | null }[]
}
export interface DeltaDre { unit: string; kind: string; line: string; sub: string; supplier: string | null; year: number; month: number; amount: number }
export type EstadoItem = 'NA_DRE' | 'A_CLASSIFICAR' | 'SEM_PAGAMENTO' | 'MES_FECHADO' | 'SEM_SALDO' | 'CONTA_INVALIDA'
export interface ResultadoConc {
  faturaId: number
  pagamento: {
    modo: 'TOTAL' | 'ITENS' | 'MISTO' | 'NAO_ENCONTRADO'
    manual: boolean
    filial: string | null
    linhasTotal: LinhaCaixa[]            // linhas que pagam o total (ou o resto)
    capacidade: number                   // soma dessas linhas
    itensCasados: number; valorCasado: number
    mes: string | null                   // AAAA-MM do pagamento
  }
  itens: Record<number, { estado: EstadoItem; chave?: string; mes?: string }>
  classificado: number                   // valor dos itens classificados
  aplicado: number                       // valor que já trocou de conta na DRE
  deltas: DeltaDre[]
  erro?: string
}

export type Classificador = (caminho: string, historico: string, year: number, month: number) => { kind: string; line: string; sub: string } | null

const mesDe = (l: { year: number; month: number }) => `${l.year}-${String(l.month).padStart(2, '0')}`
const aberto = (l: { year: number; month: number }) => l.year * 12 + l.month >= CARTAO_DESDE.year * 12 + CARTAO_DESDE.month
const r2 = (n: number) => Math.round(n * 100) / 100

/** subconjunto de até `max` linhas cuja soma é `alvo` (busca limitada, grupos pequenos) */
function somaExata(linhas: LinhaCaixa[], alvo: number, max = 4): LinhaCaixa[] | null {
  const xs = linhas.filter(l => l.valor <= alvo + TOL).sort((a, b) => b.valor - a.valor).slice(0, 24)
  const rec = (i: number, resto: number, escolha: LinhaCaixa[]): LinhaCaixa[] | null => {
    if (Math.abs(resto) <= TOL && escolha.length) return escolha
    if (escolha.length >= max || resto < -TOL) return null
    for (let j = i; j < xs.length; j++) {
      if (xs[j].valor > resto + TOL) continue
      const r = rec(j + 1, resto - xs[j].valor, [...escolha, xs[j]])
      if (r) return r
    }
    return null
  }
  return rec(0, alvo, [])
}

/** linha única ou soma de linhas do MESMO histórico, ou do mesmo dia e filial, igual ao alvo */
function acharTotal(cands: LinhaCaixa[], alvo: number, venc: number, filialPreferida: string | null): LinhaCaixa[] | null {
  if (alvo <= TOL) return null
  const perto = (l: LinhaCaixa) => Math.abs(l.data.getTime() - venc) + (filialPreferida && l.filial !== filialPreferida ? DIA * 30 : 0)
  const unica = cands.filter(l => Math.abs(l.valor - alvo) <= 0.01).sort((a, b) => perto(a) - perto(b))[0]
  if (unica) return [unica]
  const grupos = new Map<string, LinhaCaixa[]>()
  cands.forEach(l => {
    ;[`H|${l.filial}|${l.supplier ?? ''}`, `D|${l.filial}|${l.data.toISOString().slice(0, 10)}`].forEach(k => {
      const g = grupos.get(k) ?? []; g.push(l); grupos.set(k, g)
    })
  })
  const ordem = Array.from(grupos.values()).filter(g => g.length > 1)
    .sort((a, b) => Math.min(...a.map(perto)) - Math.min(...b.map(perto)))
  for (const g of ordem) { const r = somaExata(g, alvo); if (r) return r }
  return null
}

export function conciliar(faturas: FaturaConc[], linhas: LinhaCaixa[], classificar: Classificador): ResultadoConc[] {
  const porChave = new Map(linhas.map(l => [l.chave, l]))
  const usadas = new Set<string>()
  const out: ResultadoConc[] = []
  const ordem = faturas.slice().sort((a, b) => a.vencimento.getTime() - b.vencimento.getTime() || a.id - b.id)

  for (const f of ordem) {
    const venc = f.vencimento.getTime()
    const dentro = (l: LinhaCaixa) => l.data.getTime() >= venc - JANELA.antes * DIA && l.data.getTime() <= venc + JANELA.depois * DIA
    const elegivel = (l: LinhaCaixa) => l.kind === 'EXP' && l.line !== 'INTRAGRUPO' && !usadas.has(l.chave)
    const itens = f.itens.slice().sort((a, b) => a.ordem - b.ordem)
    const itemLink = new Map<number, LinhaCaixa>()
    let linhasTotal: LinhaCaixa[] = []
    let manual = false

    // 1. vínculos manuais (podem estar fora da janela)
    f.vinculos.forEach(v => {
      const l = porChave.get(v.chave); if (!l || !elegivel(l)) return
      manual = true; usadas.add(l.chave)
      if (v.itemId != null && itens.some(i => i.id === v.itemId)) itemLink.set(v.itemId, l)
      else linhasTotal.push(l)
    })

    const cands = () => linhas.filter(l => elegivel(l) && dentro(l))
    let filial = f.cartaoFilial

    if (!linhasTotal.length && !itemLink.size) {
      // 2. TOTAL: o valor pago (total da fatura); se a sobra anterior não foi paga, a soma dos itens
      const somaItens = r2(itens.reduce((s, i) => s + i.valor, 0))
      const achado = acharTotal(cands(), r2(f.total), venc, filial) ?? (Math.abs(f.saldoAnterior) > TOL ? acharTotal(cands(), somaItens, venc, filial) : null)
      if (achado) { linhasTotal = achado; achado.forEach(l => usadas.add(l.chave)) }
      else {
        // 3. ITENS: valor exato na filial do cartão (a informada ou a que mais casa)
        const positivos = itens.filter(i => i.valor > TOL).sort((a, b) => b.valor - a.valor || a.ordem - b.ordem)
        const tentar = (fil: string) => {
          const livres = cands().filter(l => l.filial === fil)
          const usadasAqui = new Set<string>(); const links = new Map<number, LinhaCaixa>()
          positivos.forEach(it => {
            const op = livres.filter(l => !usadasAqui.has(l.chave) && Math.abs(l.valor - it.valor) <= TOL)
              .sort((a, b) => (Number(!/CARTAO/i.test(a.caminho)) - Number(!/CARTAO/i.test(b.caminho))) || Math.abs(a.data.getTime() - venc) - Math.abs(b.data.getTime() - venc) || a.chave.localeCompare(b.chave))[0]
            if (op) { usadasAqui.add(op.chave); links.set(it.id, op) }
          })
          return links
        }
        if (!filial) {
          const filiais = Array.from(new Set(cands().map(l => l.filial)))
          const melhor = filiais.map(fl => ({ fl, n: tentar(fl).size })).sort((a, b) => b.n - a.n)[0]
          if (melhor && melhor.n >= 3) filial = melhor.fl
        }
        if (filial) {
          tentar(filial).forEach((l, id) => { itemLink.set(id, l); usadas.add(l.chave) })
          const resto = r2(itens.filter(i => !itemLink.has(i.id)).reduce((s, i) => s + i.valor, 0))
          const r = acharTotal(cands().filter(l => l.filial === filial), resto, venc, filial)
          if (r) { linhasTotal = r; r.forEach(l => usadas.add(l.chave)) }
        }
      }
    }

    const capacidade = r2(linhasTotal.reduce((s, l) => s + l.valor, 0))
    const valorCasado = r2(Array.from(itemLink.keys()).reduce((s, id) => s + (itens.find(i => i.id === id)?.valor ?? 0), 0))
    const modo: ResultadoConc['pagamento']['modo'] = linhasTotal.length && itemLink.size ? 'MISTO' : linhasTotal.length ? 'TOTAL' : itemLink.size ? 'ITENS' : 'NAO_ENCONTRADO'
    const mesPag = linhasTotal[0] ?? Array.from(itemLink.values())[0]
    const res: ResultadoConc = {
      faturaId: f.id,
      pagamento: { modo, manual, filial: filial ?? linhasTotal[0]?.filial ?? null, linhasTotal, capacidade, itensCasados: itemLink.size, valorCasado, mes: mesPag ? mesDe(mesPag) : null },
      itens: {}, classificado: 0, aplicado: 0, deltas: [],
    }

    const rotulo = (it: ItemConc) => `Cartão ${f.banco} ${f.final} · ${it.descricao}`
    const sai = (l: LinhaCaixa, v: number) => res.deltas.push({ unit: l.unit, kind: l.kind, line: l.line, sub: l.sub, supplier: l.supplier, year: l.year, month: l.month, amount: -v })
    const entra = (l: LinhaCaixa, it: ItemConc, c: { kind: string; line: string; sub: string }) =>
      res.deltas.push({ unit: l.unit, kind: c.kind, line: c.line, sub: c.sub, supplier: rotulo(it), year: l.year, month: l.month, amount: it.valor })

    // saldo de cada linha do total, consumido pelos itens classificados na ordem da fatura
    const saldo = linhasTotal.map(l => ({ l, resta: l.valor }))
    let restaTotal = capacidade

    // estornos primeiro: o crédito devolve valor ao pagamento e a compra estornada cabe nele
    // (na ordem da fatura a compra vem antes e ficava sem saldo, com o estorno aplicado sozinho)
    const sequencia = itens.slice().sort((a, b) => Number(a.valor >= 0) - Number(b.valor >= 0) || a.ordem - b.ordem)
    for (const it of sequencia) {
      const link = itemLink.get(it.id)
      const base = link ?? linhasTotal[0]
      if (!it.caminho) {
        res.itens[it.id] = { estado: base ? 'A_CLASSIFICAR' : 'SEM_PAGAMENTO', ...(link ? { chave: link.chave } : {}) }
        continue
      }
      res.classificado = r2(res.classificado + it.valor)
      if (!base) { res.itens[it.id] = { estado: 'SEM_PAGAMENTO' }; continue }
      if (!aberto(base)) { res.itens[it.id] = { estado: 'MES_FECHADO', mes: mesDe(base) }; continue }
      const c = classificar(it.caminho, it.descricao, base.year, base.month)
      if (!c || c.kind !== 'EXP' || c.line === 'INTRAGRUPO') { res.itens[it.id] = { estado: 'CONTA_INVALIDA' }; continue }
      if (link) {
        sai(link, it.valor); entra(link, it, c)
        res.itens[it.id] = { estado: 'NA_DRE', chave: link.chave, mes: mesDe(link) }
        res.aplicado = r2(res.aplicado + it.valor)
        continue
      }
      // pelo total: só se couber no que o caixa pagou
      if (it.valor > restaTotal + TOL) { res.itens[it.id] = { estado: 'SEM_SALDO' }; continue }
      if (it.valor >= 0) {
        let falta = it.valor
        for (const s of saldo) { if (falta <= TOL) break; const v = Math.min(s.resta, falta); if (v > TOL) { sai(s.l, r2(v)); s.resta = r2(s.resta - v); falta = r2(falta - v) } }
      } else {
        // estorno classificado: devolve à primeira linha o que sai da conta escolhida
        sai(saldo[0].l, it.valor); saldo[0].resta = r2(saldo[0].resta - it.valor)
      }
      entra(saldo[0].l, it, c)
      restaTotal = r2(restaTotal - it.valor)
      res.itens[it.id] = { estado: 'NA_DRE', mes: mesDe(saldo[0].l) }
      res.aplicado = r2(res.aplicado + it.valor)
    }

    // trava: em cada fatura o que sai é igual ao que entra
    const soma = res.deltas.reduce((s, d) => s + d.amount, 0)
    if (Math.abs(soma) > 0.01) { res.erro = `troca desequilibrada em R$ ${soma.toFixed(2)} — nada aplicado`; res.deltas = []; res.aplicado = 0 }
    out.push(res)
  }
  return out
}
