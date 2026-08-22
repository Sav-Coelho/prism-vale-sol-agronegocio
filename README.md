# Arken — Vale Sol Agronegócio

Sistema de gestão corporativa do **Vale Sol Agronegócio**, um grupo varejista
agropecuário/veterinário (marcas **VS** — Vale do Sol — e **MM** — Multimundo, 7 lojas).

Reúne, num único painel, seis análises que hoje o cliente extrai de planilhas soltas do
ERP: DRE gerencial de caixa, fluxo de caixa, controle de compras, risco de crédito de
clientes, análise comercial (margem/curva ABC/giro) e demanda por cliente.

> **Não há integração ao vivo com o ERP.** Todo módulo é alimentado por **arquivos XLSX
> exportados do ERP** e enviados pela tela. O app parseia, reconcilia e analisa.

- **Deploy:** Vercel (hobby) — auto-deploy a cada `push` no branch `main`
- **Repositório:** `github.com/Sav-Coelho/prism-vale-sol-agronegocio`
- **Referência técnica completa:** [CONTEXTO_PRISM.md](CONTEXTO_PRISM.md) · guia para Claude Code: [CLAUDE.md](CLAUDE.md) · deep-dive do risco: [docs/RISCO_CLIENTE.md](docs/RISCO_CLIENTE.md)

---

## Stack

| Camada | Tech |
|--------|------|
| Frontend | Next.js 14 (App Router) + React 18 + TypeScript strict |
| Backend | API Routes serverless (mesmo projeto) |
| ORM | Prisma 5 (`prisma db push`, sem migrations versionadas) |
| Banco | PostgreSQL — Neon free tier (`sa-east-1`) |
| Gráficos | Recharts |
| Planilhas | `xlsx` (SheetJS) |
| Deploy | Vercel — build: `prisma generate && prisma db push --accept-data-loss && next build` |

Sem biblioteca de UI (CSS próprio) e **sem autenticação** — operado por uma pessoa (o
controller do cliente). Fontes: **Inter** + **DM Serif Display**.

### Variáveis de ambiente (Vercel / `.env`)
```
DATABASE_URL=   # Neon — URL com connection pooling (runtime)
DIRECT_URL=     # Neon — URL direta (usada pelo prisma db push no build)
```

---

## Módulos

A raiz `/` redireciona para `/risco-cliente`. Navegação em `src/components/Shell.tsx`.

### ▤ DRE Gerencial — `/dre`
DRE em **regime de caixa**, com colunas mensais, consolidado e por unidade. **Fonte única:**
o XLSX *CashFlow Analítico* da contabilidade — o import classifica cada evento de caixa numa
linha da DRE e **substitui a base inteira**. Carrega as "depurações" acordadas com o cliente
(financiamento de veículo FCA separando principal/juros, intragrupo Multmunde fora do
resultado, transferências entre lojas excluídas, reembolso a cliente líquido nas deduções
etc.). Estrutura: Receita Bruta → Deduções → Receita Líquida → CMV → Margem de Contribuição
→ despesas (ADM/Pessoal/Log/Comercial) → Lucro Operacional → Impostos → EBITDA → Financeiras
→ Sócio/CAPEX/Não-operacional → Lucro Líquido. Drill-down por subconta e fornecedor.

### ◈ Fluxo de Caixa — `/fluxo-de-caixa`
Visão do **razão de caixa** da contabilidade (mesmo XLSX CashFlow Analítico), como árvore de
classificação contábil de 6 níveis (entradas × saídas), por filial e consolidado, com quebra
mensal. É uma visão **à parte da DRE** — não entra em nenhum cálculo de resultado.

### 🛒 Controle de Compras — `/controle-compras`
Orçamento de compras vs. comprometido real. Projeta, por mês × categoria, os **boletos a
pagar do ERP** (`PurchaseCommit`, importados do relatório "Pagamentos a Efetuar") somados às
**parcelas dos pedidos manuais**. O **limite mensal** é automático: `meta %CMV × Receita
Líquida` (média dos 3 meses anteriores puxada da DRE). Inclui sugestão de reposição por giro,
priorizando rupturas da curva A.

### ◆ Risco de Cliente — `/risco-cliente`
Score de crédito **bayesiano** (`Beta(2,2)`) por cliente, alimentado pelo histórico de
títulos a receber. Cada título é um ensaio (pagou = sucesso, calote/≥90 dias vencido =
falha); a nota vai de **AA a D**. Regra dura: cliente com saldo em aberto nunca é A/AA (cai
para no máximo B, ▼). Traz série temporal do risco da carteira, aging e ranking.
**Documentação detalhada:** [docs/RISCO_CLIENTE.md](docs/RISCO_CLIENTE.md).

### ⌬ Análise Comercial — `/analise-comercial`
Cruza três relatórios (preço de venda × ABC de estoque × ABC de vendas) por código de
produto e entrega: **margem** bruta por SKU, **curva ABC** com participação acumulada e
**giro** de estoque (cobertura em meses, status ruptura/saudável/excesso), além de uma tabela
mestre unindo os três eixos.

### ◉ Demanda por Cliente — `/demanda-cliente`
A partir do relatório COMERCIAL (Vendedor › Cliente › Produto › Data), mostra o que cada
cliente compra e **deixou de comprar**. Filtros por vendedor/ano/mês, comparativo ano-a-ano,
ranking de clientes (ABC + status Novo/Sumiu/Em queda/Crescendo) e de vendedores, com margem
real (custo do ABC de estoque).

---

## Modelo de dados (resumo)

17 modelos no `prisma/schema.prisma`, por módulo:

- **Crédito:** `Unit`, `Client` (`code` do ERP = chave de dedup), `Sale` (um título a
  receber; `paymentStatus` PENDING/PAID/OVERDUE/DEFAULTED).
- **DRE:** `DreEntry` (evento de caixa classificado em linha/subconta/unidade/mês).
- **Fluxo de Caixa:** `CashflowEntry` (razão de caixa agregado por filial × tipo × 6 níveis).
- **Comercial:** `ProductPrice`, `StockItem`, `SalesAbcItem` (chave = código do produto).
- **Compras:** `Comprador`, `PurchaseOrder`, `PurchaseCommit`, `Fornecedor`,
  `PurchaseCategoria`, `PurchaseSetting`.
- **Demanda:** `DemandEntry`.
- **Brutos de import (ERP):** `Receivable`, `Payable`.

Detalhamento campo a campo em [CONTEXTO_PRISM.md](CONTEXTO_PRISM.md).

---

## Convenções de importação XLSX

- O tipo do relatório é detectado **pelo cabeçalho**, nunca pelo nome do arquivo.
- Cabeçalho comparado sem acento/caixa e resistente a reordenação de colunas.
- Formato brasileiro `1.234,56` e datas seriais do Excel tratados em cada parser.
- Estratégias: **wipe-and-replace** (comercial, fluxo, DRE, compras), **reconciliação
  incremental cross-snapshot** (crédito) e **substituição por período** (demanda).
- Imports longos usam `maxDuration = 60` e inserção em lotes para caber no limite serverless.

---

## Desenvolvimento

```bash
npm run dev          # servidor local em http://localhost:3000
npm run build        # build de produção (roda prisma generate + db push + next build)
npm run db:studio    # Prisma Studio (editor visual do banco)
git push             # Vercel auto-deploya (branch main)
```

Sem suíte de testes — a verificação de tipos é o próprio `npm run build`.

> **Restrição do build (Vercel):** o target do compilador não suporta `for...of` em
> `Map`/`Set` nem spread de `Set`. Sempre use `Array.from(...)`.
