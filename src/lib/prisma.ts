import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({ log: ['error'] })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

// Default DRE group definitions — applied idempotently on cold start.
// The user can rename, add or remove groups via the UI (except protected ones).
const DEFAULT_DRE_GROUPS = [
  { name: 'Receita Operacional',       type: 'RECEITA', section: 'RECEITA_OP',    sortOrder:  1, protected: false },
  { name: 'Deduções sobre a Venda',    type: 'DEDUCAO', section: 'DEDUCAO',       sortOrder:  2, protected: false },
  { name: 'Custo do Produto/Serviço',  type: 'CUSTO',   section: 'CUSTO_VAR',     sortOrder:  3, protected: false },
  { name: 'Despesa Variável',          type: 'CUSTO',   section: 'CUSTO_VAR',     sortOrder:  4, protected: false },
  { name: 'Despesas Administrativas',  type: 'DESPESA', section: 'DESPESA_FIXA',  sortOrder:  5, protected: false },
  { name: 'Despesas Financeiras',      type: 'DESPESA', section: 'DESPESA_FIXA',  sortOrder:  6, protected: false },
  { name: 'Despesas com Pessoal',      type: 'DESPESA', section: 'DESPESA_FIXA',  sortOrder:  7, protected: false },
  { name: 'Despesas com Marketing',    type: 'DESPESA', section: 'DESPESA_FIXA',  sortOrder:  8, protected: false },
  { name: 'Investimentos',             type: 'DESPESA', section: 'INVESTIMENTO',  sortOrder:  9, protected: false },
  { name: 'Receita Não Operacional',   type: 'RECEITA', section: 'RECEITA_NOP',   sortOrder: 10, protected: false },
  { name: 'Despesas Não Operacionais', type: 'DESPESA', section: 'DESPESA_NOP',   sortOrder: 11, protected: false },
  { name: 'Impostos',                  type: 'IMPOSTO', section: 'IMPOSTO_LUCRO', sortOrder: 12, protected: false },
  { name: 'Transferência entre Contas',type: 'NEUTRO',  section: 'NEUTRO',        sortOrder: 99, protected: true  },
]

async function seedDefaults() {
  try {
    await prisma.account.upsert({
      where: { code: '9.9.01' },
      update: {},
      create: {
        code: '9.9.01',
        name: 'Transferência entre Contas',
        type: 'NEUTRO',
        dreGroup: 'Transferência entre Contas',
        active: true,
      },
    })
    for (const g of DEFAULT_DRE_GROUPS) {
      await prisma.dreGroup.upsert({
        where: { name: g.name },
        update: {},
        create: g,
      })
    }
  } catch {
    // non-fatal — table may not exist yet on first cold start before db push
  }
}

seedDefaults()
