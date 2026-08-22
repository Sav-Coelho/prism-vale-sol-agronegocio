# CONTEXTO — Referência técnica completa (Arken · Vale Sol Agronegócio)

Sistema de gestão corporativa do **Vale Sol Agronegócio** — grupo varejista
agropecuário/veterinário. Marcas/empresas: **VS** (Vale do Sol) e **MM** (Multimundo).
Nome do produto na UI: **Arken**.

- **Dono/dev:** Savio (savio@braveeducacao.com.br)
- **Repositório:** `github.com/Sav-Coelho/prism-vale-sol-agronegocio` (branch `main`)
- **Deploy:** Vercel (hobby) — auto-deploy a cada push
- **Banco:** PostgreSQL na Neon, região `sa-east-1`, free tier
- **Sem autenticação, um único operador.** Sem integração ao vivo com o ERP — tudo entra por
  upload de **XLSX exportado do ERP**.

> Documentos irmãos: [README.md](README.md) (visão geral), [CLAUDE.md](CLAUDE.md) (guia para
> Claude Code), [docs/RISCO_CLIENTE.md](docs/RISCO_CLIENTE.md) (deep-dive do risco de cliente).

---

## Stack

| Camada | Tech |
|--------|------|
| Frontend | Next.js 14 (App Router) + React 18 + TypeScript strict |
| Backend | API Routes serverless (mesmo projeto) |
| ORM | Prisma 5 |
| DB | PostgreSQL — Neon free tier |
| Gráficos | Recharts |
| Planilhas | `xlsx` (SheetJS) |
| Deploy | Vercel — `prisma generate && prisma db push --accept-data-loss && next build` |

Dependências de produção: `@prisma/client`, `next`, `react`, `react-dom`, `recharts`, `xlsx`.
`next.config.js` marca `@prisma/client`/`prisma`/`pdf-parse` como externals e faz alias de
`canvas → false` (o `pdf-parse` tenta requerer `canvas`).

Env vars:
```
DATABASE_URL=   # Neon — connection pooling (runtime)
DIRECT_URL=     # Neon — direta (prisma db push no build)
```

`src/lib/prisma.ts` exporta **apenas o singleton do PrismaClient — não há seed**. Dados de
referência são criados sob demanda (ex.: `/api/compras/config` cria compradores/categorias
default na primeira leitura).

---

## Estrutura de arquivos

```
prism-vale-sol-agronegocio/
├── prisma/schema.prisma            # 17 modelos
├── docs/RISCO_CLIENTE.md           # deep-dive do módulo de crédito
├── src/
│   ├── app/
│   │   ├── layout.tsx              # <title> "Arken · Vale Sol Agronegócio", fontes Inter + DM Serif
│   │   ├── page.tsx                # redirect → /risco-cliente
│   │   ├── globals.css             # design system (sem lib de UI)
│   │   ├── icon.svg                # favicon
│   │   ├── dre/page.tsx            # DRE Gerencial (caixa)
│   │   ├── fluxo-de-caixa/page.tsx # razão de caixa (árvore)
│   │   ├── controle-compras/page.tsx
│   │   ├── risco-cliente/page.tsx
│   │   ├── analise-comercial/page.tsx
│   │   ├── demanda-cliente/page.tsx
│   │   └── api/
│   │       ├── credit/{route,aggregate-risk,import,reset}     # Risco de Cliente
│   │       ├── clients/{route,[id]}  · sales/{route,[id]}     # cadastro/CRUD
│   │       ├── units/{route,[id]}
│   │       ├── dre/{route,import,reset}                       # DRE Gerencial
│   │       ├── cashflow-analitico/{route,import}              # Fluxo de Caixa
│   │       ├── cash-flow/{parse,save,series,daily,...}        # (legado, série diária)
│   │       ├── commercial/{analytics,prices,stock,sales-abc}  # Análise Comercial
│   │       ├── compras/{analytics,config,pedidos,pedidos/[id],import-pagamentos,reposicao}
│   │       └── demanda/{route,import}                         # Demanda por Cliente
│   ├── components/
│   │   ├── Shell.tsx               # sidebar colapsável (localStorage) + topbar
│   │   ├── CommercialUploader.tsx  # uploader dos 3 XLSX comerciais
│   │   └── CashflowAnalitico.tsx   # árvore do fluxo de caixa
│   └── lib/
│       ├── prisma.ts               # singleton (sem seed)
│       ├── credit.ts               # scoring bayesiano + risco agregado
│       ├── cash-flow-parser.ts     # parser TÍTULOS A RECEBER / PAGAMENTOS A EFETUAR
│       ├── cashflow-analitico-parser.ts   # parser do razão de caixa
│       ├── dre-cashflow-source.ts  # CashFlow Analítico → linhas da DRE (fonte única)
│       ├── dre-parser.ts           # parsers de pagamentos/recebidos (legado de caixa)
│       ├── dre-expense-parser.ts   # relatório de despesas do contador (árvore)
│       ├── dre-classifier.ts       # heurística fornecedor/OBS → linha da DRE + LINE_LABEL
│       ├── commercial-parser.ts    # preço / ABC estoque / ABC vendas
│       ├── demanda-parser.ts       # relatório COMERCIAL (folhas com DATA)
│       └── compras.ts              # parcelas dos pedidos + helpers de mês
```

---

## Schema do banco (`prisma/schema.prisma`)

17 modelos. Dinheiro sempre `Float`. Único encadeamento de FK: `Client → Sale → Unit`.

### Módulo Crédito (Risco de Cliente)

**Unit** — `id`, `name @unique`, `active`, `clients[]`, `sales[]`.

**Client** — `id`, `code String? @unique` (código do ERP, chave estável de deduplicação),
`name`, `email?`, `phone?`, `cpf?`, `unitId?`, `active`, `createdAt`, `sales[]`.

**Sale** — um título a receber por linha:
```
clientId, externalId?  (TITULO::PARCELA::VECTO::FILIAL — dedup entre imports)
description, amount (= VLR LÍQUIDO devido), date, dueDate?, paidDate?
paymentStatus  (PENDING | PAID | OVERDUE | DEFAULTED, default PENDING)
unitId?, month, year, createdAt
@@unique([clientId, externalId]) · @@index([externalId]) · @@index([paymentStatus])
```

### Módulo DRE

**DreEntry** — um evento de caixa classificado, agregável:
```
unit    (unidade canônica: "VS - TRÊS RIOS", "MM - RIO BONITO", …)
kind    (RECEITA | DEDUCAO | JUROS | EXP | DESPESA)
line    (chave da linha: CMV, ADM, PESSOAL, LOG, COM, IMPOSTOS, FIN, INVEST,
         SOCIO, NAOOP, DIFCAIXA, INTRAGRUPO, PROLABORE…)
sub     (subconta / detalhamento)  ·  supplier?, supplierCode?  (drill-down)
year, month, amount, importedAt
```

### Módulo Fluxo de Caixa

**CashflowEntry** — razão de caixa agregado (visão à parte da DRE):
```
filial, tipo (E | S), c1, c2?..c6?  (classificação contábil de 6 níveis)
year, month, amount (assinado: E +, S −, VALOR original), n (qtde agregada), importedAt
@@index([tipo]) · @@index([filial]) · @@index([year, month])
```

### Módulo Análise Comercial (chave = código do produto)

**ProductPrice** — `code @id`, `description`, `retailPrice`, `updatedAt`.
**StockItem** — `code @id`, `description`, `qty`, `unitCost`, `totalValue`, `updatedAt`.
**SalesAbcItem** — `code @id`, `description`, `qtySold`, `totalValue`, `avgUnit`,
`abcClass` (A/B/C), `updatedAt`.

### Módulo Controle de Compras

**Comprador** — `id`, `nome @unique`, `limite`, `setor?`, `ativo`.
**PurchaseOrder** — pedido manual: `comprador`, `fornecedor?`, `categoria?`, `dataPedido`,
`valor`, `parcelas`, `datas Json?` (datas ISO explícitas das parcelas — fonte da verdade),
`primeiraDias`/`intervaloDias` (fallback de pedidos antigos), `status`, `observacao?`.
**PurchaseCommit** — boletos a pagar do ERP (comprometido real; wipe-and-replace):
`fornecedor`, `titulo?`, `parcela?`, `dueDate`, `valor` (VLR LÍQUIDO), `operacao?`
(COMPRA DE MERCADORIA / IMOBILIZADO / ENTREGA FUTURA), `tipoDocto?`, `filial?`.
**Fornecedor** — `nome @unique`, `ativo`. **PurchaseCategoria** — `nome @unique`.
**PurchaseSetting** — `key @id`, `value` (ex.: `metaCmvPct`).

### Módulo Demanda por Cliente

**DemandEntry** — `vendedor?`, `clienteCode`, `cliente`, `produtoCode?`, `produto`, `year`,
`month`, `qtd`, `valor`. `@@index([clienteCode])` · `@@index([year, month])`.

### Brutos de import (ERP)

**Receivable** / **Payable** — dump completo dos relatórios de títulos do ERP (`fitid`
determinístico `@unique`, todas as colunas: vendedor, fazenda, portador, filial, juros,
multa, netAmount…). O fluxo de crédito ativo usa `Sale`; o de compras usa `PurchaseCommit`.
Ficam como base bruta/auditoria.

### Unidades canônicas
`VS - RIO BONITO`, `VS - TRÊS RIOS`, `VS - QUATIS`, `VS - APERIBÉ`, `MM - RIO BONITO`,
`MM - 7 LAGOAS`, `MM - APERIBÉ`. Os parsers normalizam qualquer rótulo de filial (robusto
contra acento/encoding corrompido) para esses nomes via `canonicalizeUnit` / mapas `UNIT`.

---

## Módulos — detalhamento técnico

### DRE Gerencial (`/dre`)

DRE **em regime de caixa**, colunas mensais, consolidado + por unidade. Hierarquia:
linha → subconta → fornecedor. Cada linha traz `total` (todos os meses) e `byMonth`.

**Import (`POST /api/dre/import`)** — detecta o arquivo e escolhe a rota:

1. **CashFlow Analítico** (`isCashflowAnaliticoFile`) → **fonte única**. `buildDreFromCashflow`
   (`dre-cashflow-source.ts`) classifica cada lançamento (E/S) numa linha da DRE e
   **apaga+reinsere a `DreEntry` inteira** (transação, chunks de 3000). Depurações embutidas:
   - Veículo **FCA Fiat**: principal → INVEST, juros → FIN.
   - **Multmunde** (grupo) pago como fornecedor de mercadorias → INTRAGRUPO (fora do resultado, memo).
   - **Depósito C/C / Transferência entre lojas** → descartado.
   - **Reembolso a cliente**: entradas abatem saídas dentro de DEDUCAO (líquido); se o
     recebido supera o pago no mês, o excedente vai para NAOOP e a Dedução nunca fica negativa.
   - **Orga Log** → CMV (laboratório fatura pela logística). **Juros recebidos** → linha JUROS
     (abatida das Financeiras no `GET /api/dre`).
2. **Relatório de Despesas classificado** do contador (`isClassifiedExpense`, coluna
   CLASSIFICAÇÃO) → `parseExpenseReport` (árvore por indentação; cada aba = uma loja;
   CONSOLIDADO ignorado). Substitui despesas (`kind EXP/DESPESA`). Filtra período (até jun/2026).
3. **Pagamentos / Recebidos brutos** (`parseDre`) — legado de caixa. Pagamentos: `classifyExpense`
   mapeia fornecedor/OBS → (linha, subconta). Recebidos: exige `unit`, gera RECEITA/DEDUCAO/JUROS.

**`classifyExpense` (`dre-classifier.ts`)** — OBS tem prioridade sobre fornecedor; overrides por
código do ERP (`CODE_SUB`); Multmunde por CNPJ base `08322910` → INTRAGRUPO; Eccard/Fabrício →
PROLABORE; listas de palavras-chave por linha (CMV/IMP/FIN/LOG/ADM); regra do cliente: **PJ não
identificado → CMV**, **PF não identificada → PESSOAL**.

**`GET /api/dre`** — monta, por escopo (CONSOLIDADO + cada unidade), a demonstração estruturada:
```
Receita Operacional Bruta − Deduções = Receita Líquida
− CMV = Margem de Contribuição
− ADM − Pessoal − Logística − Comercial = Lucro Operacional
− Impostos = EBITDA
− Financeiras (líquidas de juros recebidos) − Sócio − Investimentos + Não-Operacional = Lucro Líquido Gerencial
memo: Diferença de Caixa, Movimentações Intragrupo (Multmunde)
```
Cada grupo traz `byMonth`, `total` e fornecedores ordenados (drill-down). `POST /api/dre/reset`
limpa a base.

### Fluxo de Caixa (`/fluxo-de-caixa`)

Razão de caixa da contabilidade, **totalmente à parte da DRE**. `POST
/api/cashflow-analitico/import` valida (`isCashflowAnalitico`: FILIAL+TIPO+CLASSIF_CONTABIL) e
**wipe-and-replace** de `CashflowEntry` (lotes de 2000). `GET /api/cashflow-analitico` serve,
por escopo (CONSOLIDADO + cada filial), duas árvores (entradas E / saídas S) de classificação
contábil de 6 níveis com `byMonth`+`total`, mais comparativo por filial. Colunas do XLSX:
FILIAL, DATA, HISTORICO, TIPO (E/S), CLASSIF_CONTABIL(1..6), VALOR. Componente
`CashflowAnalitico.tsx`. (As rotas `cash-flow/*` são de um desenho anterior de série diária.)

### Controle de Compras (`/controle-compras`)

Orçamento vs. comprometido. `GET /api/compras/analytics`:
- **Limite mensal** = `metaCmvPct × Receita Líquida` puxada da DRE (`DreEntry` RECEITA−DEDUCAO).
  Modo `3m` (média dos 3 meses anteriores, se existem) → `1m` (mês anterior) → `fallback`
  (último mês disponível, sinalizado). `metaCmvPct` default 0,70 (`PurchaseSetting`).
- **Projeção mês × categoria** = boletos do ERP (`PurchaseCommit`, **imobilizado excluído** —
  não consome limite de compras) + parcelas dos pedidos manuais (`installments()`).
- Resumo por comprador (limite × comprado no mês × saldo × status 🔴/⚠️/✅).

**`installments()` (`compras.ts`)** — parcelas por **datas explícitas** (`o.datas`) quando
existem; senão `primeiraDias` + `k·intervaloDias` (pedidos antigos). Valor rateado igualmente.

`POST /api/compras/import-pagamentos` importa "Pagamentos a Efetuar" → `PurchaseCommit`
(wipe-and-replace, reusa o parser de payables). CRUD de pedidos em `/api/compras/pedidos`
(+`[id]`); compradores/categorias/parâmetros em `/api/compras/config`. `GET
/api/compras/reposicao?dias=30&base=208` sugere quantidade de compra por giro (giro diário =
qtdVendida/baseDias; cobertura = estoque/giroDia), priorizando rupturas da curva A.

### Risco de Cliente (`/risco-cliente`)

Scoring bayesiano `Beta(2,2)`, notas AA→D, rebaixamento por saldo em aberto, import
incremental cross-snapshot dos títulos a receber, risco agregado ponderado pela exposição.
**Tratado em detalhe em [docs/RISCO_CLIENTE.md](docs/RISCO_CLIENTE.md)** (não repetir aqui).
APIs: `GET /api/credit`, `GET /api/credit/aggregate-risk?months=12`, `POST /api/credit/import`,
`POST /api/credit/reset` (`{"confirm":"APAGAR TUDO"}`).

### Análise Comercial (`/analise-comercial`)

Cruza 3 bases por código de produto. Imports (cada um wipe-and-replace):
`/api/commercial/prices` (PREÇO DE VENDA: CÓDIGO|DESCRIÇÃO|PR.VAREJO), `/api/commercial/stock`
(ABC DE ESTOQUE, aba CONSOLIDADO: CÓDIGO|DESCRIÇÃO|QTDE|CUSTO|VALOR TOTAL), `/api/commercial/sales-abc`
(ABC DE VENDAS, aba CONSOLIDADO: CODIGO|PRODUTO|QUANTIDADE|VLR TOTAL|MÉDIA/UN|CLASSE).

`GET /api/commercial/analytics` devolve numa chamada:
- **marginRows** — margem bruta `(preço−custo)/preço` (só itens com preço e custo > 0).
- **abcRows** — ordenado por receita, com `sharePct` e `cumulativePct`.
- **turnoverRows** — giro `qtSold/qtStock`, cobertura em meses (período de 6m), status
  `stockout` (vendeu e zerou) / `rupture` (<1 mês) / `low` / `healthy` / `excess`.
- **masterRows** — uma linha por SKU cruzando margem × ABC × giro.
- **summary** — contagens (margem excelente/detratora, rupturas, excessos, stockouts críticos
  da curva A e seu valor).

Uploader: `CommercialUploader.tsx`.

### Demanda por Cliente (`/demanda-cliente`)

Do relatório COMERCIAL (Vendedor › Cliente › Produto › Data). **Só linhas-folha com DATA** são
vendas reais (os níveis acima são subtotais e duplicariam). `parseDemanda` agrega por
(cliente × produto × ano/mês); extrai `(código)` do rótulo.

`POST /api/demanda/import` — **substituição por período**: apaga só os (ano, mês) do payload
(mantém 2025 e atualiza só 2026, p.ex.). Aceita multipart (arquivos pequenos, parse no
servidor) ou JSON em lotes (arquivos grandes parseados no cliente; `resetMonths` no 1º lote).

`GET /api/demanda`:
- Visão geral com `?vendedor=&years=&months=` — 1 ano = visão simples; 2 anos = comparativo
  ano-a-ano na janela comparável (meses do filtro, ou Jan..último mês cheio).
- Ranking de clientes: ABC (por participação acumulada 80/95), `status`
  Novo/Sumiu/Em queda/Crescendo/Estável, YoY, **margem vendida real** (custo do ABC de estoque).
- Ranking de vendedores: total, YoY, clientes ativos/perdidos/novos, margem.
- `?cliente=CODE` — detalhe por produto, quedas recentes e quedas ano-a-ano.

---

## Convenções de parsing XLSX

Todos os parsers (`src/lib/*-parser.ts`, `dre-cashflow-source.ts`):
- **Detectam o tipo pelo cabeçalho**, nunca pelo nome do arquivo. Ex.: `VECTO+EMISSÃO` =
  a receber, `VENCTO+ENTRADA` = a pagar, `FILIAL+TIPO+CLASSIF_CONTABIL` = cashflow analítico,
  `VENDEDOR+CLIENTE+PRODUTO+DATA` = demanda, coluna `CLASSIFICAÇÃO` = despesa do contador.
- Normalizam cabeçalho com `normalize('NFD')…toUpperCase().trim()` e indexam por nome (resistente
  a reordenação de colunas).
- Convertem número BR `1.234,56` e **datas seriais do Excel** (`(serial − 25569) × 86400s`).
- Estratégias de escrita: **wipe-and-replace** (comercial, fluxo, DRE-cashflow, compras-boletos),
  **reconciliação incremental cross-snapshot** (crédito), **substituição por período** (demanda).

---

## Decisões técnicas

### TypeScript / Vercel
O target do compilador **não suporta `for...of` em `Map`/`Set` nem spread de `Set`**. Sempre
`Array.from()`:
```typescript
// ❌ quebra no build            // ✅ correto
for (const [k,v] of map) {}      Array.from(map.entries()).forEach(([k,v]) => {})
const a = [...set]               const a = Array.from(set)
```

### Migrations / seed
`prisma db push --accept-data-loss` (schema-first, sem migrations versionadas). **Sem seed
global** — `prisma.ts` é só o singleton; defaults criados sob demanda em `/api/compras/config`.

### Limites serverless
Imports pesados declaram `export const maxDuration = 60` e inserem em lotes (2000–3000 linhas).
Rotas de leitura usam `dynamic = 'force-dynamic'` / `revalidate = 0` — nada é cacheado; os
cálculos (score, DRE, analytics) rodam a cada request.

### Separação DRE × Fluxo de Caixa
São visões independentes da mesma contabilidade. `CashflowEntry` (fluxo) **nunca** entra em
`DreEntry` (resultado) e vice-versa. Só o Controle de Compras lê a Receita Líquida da DRE para
calcular o limite.

---

## Identidade visual

- Fontes: **Inter** (`--font-sans`) + **DM Serif Display** (`--font-serif`, números grandes das
  métricas). App title: **"Arken · Vale Sol Agronegócio"**.
- Sem biblioteca de UI — CSS inline + classes em `globals.css`: `.card`, `.card-accent-yellow`,
  `.btn`/`.btn-primary`/`.btn-danger`/`.btn-sm`, `.badge`, `.form-input`, `.form-select`,
  `.table-wrap`, `.toast`, `.page-header`, `.page-title`, `.page-eyebrow`, `.page-subtitle`,
  `.empty-state`, `.metric-card`, `.grid-2`, `.grid-3`.
- Várias páginas mantêm uma paleta local `C` inline (navy `#0a2540`, yellow `#f5c518`, gold,
  green, red, amber).
- `Shell.tsx`: sidebar colapsável (preferência em `localStorage` `arken.sidenav.collapsed`) +
  topbar. Favicon: `src/app/icon.svg`.

---

## Comandos de desenvolvimento

```bash
npm run dev          # servidor local em http://localhost:3000
npm run build        # build de produção (prisma generate + db push + next build)
npm run db:studio    # Prisma Studio (editor visual do banco)
git push             # Vercel auto-deploya (branch main)
```
