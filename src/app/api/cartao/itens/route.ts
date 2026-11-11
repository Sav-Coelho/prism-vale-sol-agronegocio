/**
 * Classifica itens de fatura de cartão numa conta do plano (ou devolve para "a classificar").
 * A DRE muda na hora: ela recalcula a troca a cada leitura (lib/cartao-dre). A conta escolhida
 * vira memória do estabelecimento e é sugerida nos próximos itens iguais.
 */
import { prisma } from '@/lib/prisma'
import { guard } from '@/lib/auth-node'
import { chaveEstabelecimento } from '@/lib/cartao-parser'
import { classificarSaida } from '@/lib/dre-cashflow-source'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function PATCH(req: Request) {
  const g = await guard(['gerencial']); if (!g.ok) return g.res
  const b = await req.json().catch(() => null) as null | { ids?: unknown; caminho?: unknown }
  const ids = Array.isArray(b?.ids) ? (b!.ids as unknown[]).map(Number).filter(n => Number.isInteger(n)) : []
  const caminho = b?.caminho == null || b.caminho === '' ? null : String(b.caminho).trim()
  if (!ids.length) return NextResponse.json({ error: 'Nenhum item selecionado.' }, { status: 400 })
  if (caminho) {
    const c = classificarSaida(caminho, '', 2026, 11)
    if (!c || c.kind !== 'EXP' || c.line === 'INTRAGRUPO') return NextResponse.json({ error: 'Essa conta não é de despesa — escolha outra do plano.' }, { status: 400 })
  }
  const itens = await prisma.cartaoItem.findMany({ where: { id: { in: ids } }, select: { id: true, descricao: true } })
  await prisma.cartaoItem.updateMany({
    where: { id: { in: itens.map(i => i.id) } },
    data: caminho ? { caminho, classificadoEm: new Date(), classificadoPor: g.user.login } : { caminho: null, classificadoEm: null, classificadoPor: null },
  })
  if (caminho) {
    // memória: estabelecimento → conta; e sugestão nos itens ainda sem conta do mesmo estabelecimento
    const padroes = Array.from(new Set(itens.map(i => chaveEstabelecimento(i.descricao)).filter(Boolean)))
    for (const padrao of padroes) {
      await prisma.cartaoRegra.upsert({ where: { padrao }, create: { padrao, caminho }, update: { caminho, usos: { increment: 1 } } })
    }
    const abertos = await prisma.cartaoItem.findMany({ where: { caminho: null }, select: { id: true, descricao: true } })
    const alvo = abertos.filter(i => padroes.includes(chaveEstabelecimento(i.descricao))).map(i => i.id)
    if (alvo.length) await prisma.cartaoItem.updateMany({ where: { id: { in: alvo } }, data: { sugestao: caminho } })
  }
  return NextResponse.json({ ok: true, itens: itens.length })
}
