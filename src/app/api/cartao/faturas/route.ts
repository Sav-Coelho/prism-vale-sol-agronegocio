/**
 * Grava uma fatura de cartão lida no navegador (PDF → texto ou OCR → lib/cartao-parser).
 * Só entra fatura que confere: a soma dos itens tem de bater com o total menos a sobra da
 * fatura anterior. A mesma fatura (mesmo arquivo) não entra duas vezes.
 */
import { prisma } from '@/lib/prisma'
import { guard } from '@/lib/auth-node'
import { chaveEstabelecimento, conferir } from '@/lib/cartao-parser'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

interface ItemIn { data?: string; dataCompra?: string | null; descricao?: string; parcela?: string | null; portador?: string | null; valor?: number }

export async function POST(req: Request) {
  const g = await guard(['gerencial']); if (!g.ok) return g.res
  const b = await req.json().catch(() => null) as null | {
    banco?: string; nome?: string | null; final?: string; titular?: string | null; vencimento?: string; total?: number
    saldoAnterior?: number; leitura?: string; arquivo?: string; hash?: string; itens?: ItemIn[]
  }
  if (!b) return NextResponse.json({ error: 'Requisição inválida.' }, { status: 400 })
  const banco = String(b.banco ?? '').toUpperCase().trim()
  const final = String(b.final ?? '').replace(/\D/g, '')
  const venc = /^\d{4}-\d{2}-\d{2}$/.test(String(b.vencimento ?? '')) ? new Date(b.vencimento + 'T00:00:00Z') : null
  const total = Number(b.total)
  const itens = (b.itens ?? []).filter(i => i && i.descricao && Number.isFinite(Number(i.valor)))
  if (!banco || final.length !== 4) return NextResponse.json({ error: 'Informe o banco e os 4 últimos dígitos do cartão.' }, { status: 400 })
  if (!venc || isNaN(venc.getTime())) return NextResponse.json({ error: 'Vencimento inválido.' }, { status: 400 })
  if (!Number.isFinite(total)) return NextResponse.json({ error: 'Total da fatura inválido.' }, { status: 400 })
  if (!itens.length) return NextResponse.json({ error: 'A fatura não tem itens.' }, { status: 400 })
  if (!b.hash || !/^[0-9a-f]{64}$/.test(b.hash)) return NextResponse.json({ error: 'Assinatura do arquivo ausente.' }, { status: 400 })
  const saldoAnterior = Number(b.saldoAnterior) || 0
  const c = conferir({ itens: itens.map(i => ({ valor: Number(i.valor) })) as never, total, saldoAnterior })
  if (!c.ok) return NextResponse.json({ error: `A soma dos itens (R$ ${c.soma.toFixed(2)}) não bate com o total da fatura (R$ ${(c.esperado ?? 0).toFixed(2)}). Corrija antes de salvar.` }, { status: 400 })

  const ja = await prisma.cartaoFatura.findUnique({ where: { hash: b.hash }, include: { cartao: true } })
  if (ja) return NextResponse.json({ error: `Esta fatura já foi enviada (${ja.cartao.banco} ${ja.cartao.final}, vencimento ${ja.vencimento.toISOString().slice(0, 10).split('-').reverse().join('/')}).`, id: ja.id }, { status: 409 })
  const mesma = await prisma.cartaoFatura.findFirst({ where: { vencimento: venc, cartao: { banco, final } } })
  if (mesma) return NextResponse.json({ error: `Já existe uma fatura do ${banco} final ${final} com vencimento ${String(b.vencimento).split('-').reverse().join('/')}. Apague a anterior antes de enviar de novo.`, id: mesma.id }, { status: 409 })

  const regras = new Map((await prisma.cartaoRegra.findMany()).map(r => [r.padrao, r.caminho]))
  const cartao = await prisma.cartao.upsert({
    where: { banco_final: { banco, final } },
    create: { banco, final, nome: b.nome ?? null, titular: b.titular ?? null },
    update: { ...(b.nome ? { nome: b.nome } : {}), ...(b.titular ? { titular: b.titular } : {}) },
  })
  const fatura = await prisma.cartaoFatura.create({
    data: {
      cartaoId: cartao.id, vencimento: venc, total, saldoAnterior, arquivo: String(b.arquivo ?? 'fatura.pdf').slice(0, 200), hash: b.hash,
      leitura: ['TEXTO', 'OCR', 'MANUAL'].includes(String(b.leitura)) ? String(b.leitura) : 'MANUAL', createdBy: g.user.login,
      itens: {
        create: itens.map((i, k) => ({
          ordem: k + 1, descricao: String(i.descricao).slice(0, 200), parcela: i.parcela ?? null, portador: i.portador ?? null,
          valor: Math.round(Number(i.valor) * 100) / 100,
          dataCompra: i.dataCompra && /^\d{4}-\d{2}-\d{2}$/.test(i.dataCompra) ? new Date(i.dataCompra + 'T00:00:00Z') : null,
          sugestao: regras.get(chaveEstabelecimento(String(i.descricao))) ?? null,
        })),
      },
    },
  })
  return NextResponse.json({ id: fatura.id })
}
