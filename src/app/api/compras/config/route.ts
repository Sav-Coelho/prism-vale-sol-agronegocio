/**
 * Config do Controle de Compras: compradores, categorias, parâmetros (meta CMV)
 * e a receita de referência puxada da DRE (último mês fechado).
 * Cria defaults na primeira leitura. Mutações via POST { kind, op, data }.
 */
import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const DEFAULT_CATEGORIAS = [
  'Medicamento Veterinário', 'Vacinas / Biológicos', 'Nutrição / Suplementos',
  'Agropecuário / Insumos', 'Reprodução', 'Frete', 'Outros',
]
const DEFAULT_COMPRADORES = [
  { nome: 'Lucas', setor: 'Compras' },
  { nome: 'Felipe', setor: 'Comercial' },
  { nome: 'Fabrício', setor: 'Sócio' },
]

async function seedIfEmpty() {
  if (await prisma.purchaseCategoria.count() === 0)
    await prisma.purchaseCategoria.createMany({ data: DEFAULT_CATEGORIAS.map(nome => ({ nome })), skipDuplicates: true })
  if (await prisma.comprador.count() === 0)
    await prisma.comprador.createMany({ data: DEFAULT_COMPRADORES.map(c => ({ ...c, limite: 0, ativo: true })), skipDuplicates: true })
  if (await prisma.purchaseSetting.findUnique({ where: { key: 'metaCmvPct' } }) === null)
    await prisma.purchaseSetting.create({ data: { key: 'metaCmvPct', value: 0.70 } })
  // Pré-cadastro de fornecedores: se vazio, semeia com os credores reais dos boletos do ERP
  if (await prisma.fornecedor.count() === 0) {
    const boletos = await prisma.purchaseCommit.findMany({ select: { fornecedor: true }, distinct: ['fornecedor'] })
    if (boletos.length) {
      await prisma.fornecedor.createMany({
        data: boletos.map(b => ({ nome: b.fornecedor.trim() })).filter(f => f.nome),
        skipDuplicates: true,
      })
    }
  }
}

// Receita de referência do limite (regra automática do cliente):
//  · 3 meses anteriores completos na DRE → MÉDIA dos 3;
//  · senão, Rec. Líq. do mês anterior;
//  · senão, último mês disponível.
async function receitaRef(): Promise<{ ym: string | null; value: number; exato: boolean; modo: string }> {
  const rows = await prisma.dreEntry.findMany({ where: { line: { in: ['RECEITA', 'DEDUCAO'] } }, select: { line: true, year: true, month: true, amount: true } })
  if (!rows.length) return { ym: null, value: 0, exato: false, modo: 'fallback' }
  const byMonth = new Map<string, number>()
  rows.forEach(r => { const k = `${r.year}-${String(r.month).padStart(2, '0')}`; byMonth.set(k, (byMonth.get(k) ?? 0) + (r.line === 'RECEITA' ? r.amount : -r.amount)) })
  const now = new Date()
  const keyOf = (off: number) => { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - off, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` }
  const [p1, p2, p3] = [keyOf(1), keyOf(2), keyOf(3)]
  if (byMonth.has(p1) && byMonth.has(p2) && byMonth.has(p3)) {
    return { ym: `${p3}…${p1}`, value: ((byMonth.get(p1) ?? 0) + (byMonth.get(p2) ?? 0) + (byMonth.get(p3) ?? 0)) / 3, exato: true, modo: '3m' }
  }
  if (byMonth.has(p1)) return { ym: p1, value: byMonth.get(p1) ?? 0, exato: true, modo: '1m' }
  const latest = Array.from(byMonth.keys()).sort().pop()!
  return { ym: latest, value: byMonth.get(latest) ?? 0, exato: false, modo: 'fallback' }
}

export async function GET() {
  await seedIfEmpty()
  const [compradores, categorias, fornecedores, settings, rec] = await Promise.all([
    prisma.comprador.findMany({ orderBy: { nome: 'asc' } }),
    prisma.purchaseCategoria.findMany({ orderBy: { nome: 'asc' } }),
    prisma.fornecedor.findMany({ orderBy: { nome: 'asc' } }),
    prisma.purchaseSetting.findMany(),
    receitaRef(),
  ])
  const settingsMap: Record<string, number> = {}
  settings.forEach(s => settingsMap[s.key] = s.value)
  return NextResponse.json({ compradores, categorias: categorias.map(c => c.nome), fornecedores, settings: settingsMap, receitaRef: rec })
}

export async function POST(req: Request) {
  const { kind, op, data } = await req.json()
  try {
    if (kind === 'comprador') {
      if (op === 'delete') await prisma.comprador.delete({ where: { id: data.id } })
      else if (data.id) await prisma.comprador.update({ where: { id: data.id }, data: { nome: data.nome, limite: data.limite, setor: data.setor, ativo: data.ativo } })
      else await prisma.comprador.create({ data: { nome: data.nome, limite: data.limite ?? 0, setor: data.setor, ativo: data.ativo ?? true } })
    } else if (kind === 'categoria') {
      if (op === 'delete') await prisma.purchaseCategoria.deleteMany({ where: { nome: data.nome } })
      else await prisma.purchaseCategoria.create({ data: { nome: data.nome } })
    } else if (kind === 'fornecedor') {
      if (op === 'delete') await prisma.fornecedor.deleteMany({ where: { id: data.id } })
      else if (data.id) await prisma.fornecedor.update({ where: { id: data.id }, data: { nome: data.nome, ativo: data.ativo ?? true } })
      else await prisma.fornecedor.create({ data: { nome: String(data.nome).trim(), ativo: true } })
    } else if (kind === 'setting') {
      await prisma.purchaseSetting.upsert({ where: { key: data.key }, create: { key: data.key, value: data.value }, update: { value: data.value } })
    } else {
      return NextResponse.json({ error: 'kind inválido' }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'falha' }, { status: 400 })
  }
}
