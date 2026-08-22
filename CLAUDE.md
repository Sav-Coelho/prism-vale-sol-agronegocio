# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Arken** — corporate management system for **Vale Sol Agronegócio** (a veterinary/agro
retail group: brands **VS** = Vale do Sol and **MM** = Multimundo, 7 stores). Full-stack
Next.js 14 App Router, no auth, single operator (the client's controller). Every module is
fed by **XLSX reports exported from the client's ERP** — there is no live ERP integration;
the analyst uploads spreadsheets and the app parses, reconciles and analyzes them.

Root `/` redirects to `/risco-cliente`. Six modules (see `src/components/Shell.tsx` nav):

| Route | Module | Feeds from |
|-------|--------|-----------|
| `/dre` | DRE Gerencial (cash-basis P&L) | CashFlow Analítico XLSX (single source) |
| `/fluxo-de-caixa` | Fluxo de Caixa (cash ledger tree) | CashFlow Analítico XLSX |
| `/controle-compras` | Controle de Compras (purchase budget) | Pedidos manuais + "Pagamentos a Efetuar" XLSX |
| `/risco-cliente` | Risco de Cliente (credit scoring) | "Títulos a Receber" XLSX — see [docs/RISCO_CLIENTE.md](docs/RISCO_CLIENTE.md) |
| `/analise-comercial` | Análise Comercial (margin/ABC/turnover) | Preço, ABC de Estoque, ABC de Vendas XLSX |
| `/demanda-cliente` | Demanda por Cliente (per-client demand) | relatório COMERCIAL XLSX |

## Commands

```bash
npm run dev          # dev server at http://localhost:3000
npm run build        # production build (runs: prisma generate && prisma db push --accept-data-loss && next build)
npm run db:studio    # Prisma Studio (visual DB editor)
git push             # triggers Vercel auto-deploy (branch main)
```

No test suite. Type-check only via `npm run build`. Repo: `github.com/Sav-Coelho/prism-vale-sol-agronegocio`.

## Architecture

Pages and API routes in the same Next.js project. Deployed on Vercel (hobby), DB on Neon
PostgreSQL free tier (`sa-east-1`). Charts via **Recharts**. XLSX parsing via **`xlsx`**
(SheetJS). No UI library.

**Key env vars:**
- `DATABASE_URL` — Neon connection pooling URL (runtime)
- `DIRECT_URL` — Neon direct URL (used by `prisma db push` at build)

Schema is managed with `prisma db push` (no migration files). `prisma.ts` is a **plain
PrismaClient singleton — no seeds**. Reference data is created lazily where needed (e.g.
`/api/compras/config` seeds default buyers/categories on first read).

## Critical TypeScript Constraint

The Vercel build target does **not** support `for...of` on `Map`/`Set` or spread of `Set`.
Always use `Array.from()`:

```typescript
// ❌ breaks on Vercel build
const arr = [...set]
for (const [k, v] of map) { }

// ✅ correct
const arr = Array.from(set)
Array.from(map.entries()).forEach(([k, v]) => { })
```

## Data model (prisma/schema.prisma)

17 models, grouped by module. All numeric money is `Float`. No cross-module FKs except
`Client → Sale → Unit`.

**Credit / Risco de Cliente**
- `Unit` — business unit (`name` unique). `Client` — customer registry, `code` (ERP) unique
  = stable dedup key. `Sale` — one receivable title per row: `externalId`
  (`TITULO::PARCELA::VECTO::FILIAL`), `amount` (= VLR LÍQUIDO owed), `dueDate`, `paidDate`,
  `paymentStatus` (`PENDING`/`PAID`/`OVERDUE`/`DEFAULTED`), `@@unique([clientId, externalId])`.

**DRE (cash-basis P&L)**
- `DreEntry` — one classified cash event: `unit`, `kind` (`RECEITA`/`DEDUCAO`/`JUROS`/`EXP`),
  `line` (DRE line key: CMV, ADM, PESSOAL, LOG, COM, IMPOSTOS, FIN, INVEST, SOCIO, NAOOP,
  DIFCAIXA, INTRAGRUPO…), `sub` (subaccount), `supplier`, `year`, `month`, `amount`.

**Fluxo de Caixa (independent of DRE)**
- `CashflowEntry` — accounting cash ledger aggregated by `(filial, tipo E/S, c1..c6, month)`.
  `amount` signed (E +, S −). Never touches `DreEntry`.

**Análise Comercial** (all keyed by product `code`)
- `ProductPrice` (retail price), `StockItem` (qty, unitCost, totalValue), `SalesAbcItem`
  (qtySold, totalValue, avgUnit, abcClass A/B/C).

**Controle de Compras**
- `Comprador` (buyer + monthly limit), `PurchaseOrder` (manual order; `datas` JSON = explicit
  installment due-dates), `PurchaseCommit` (ERP boletos to pay — the "real committed" spend;
  wipe-and-replace), `Fornecedor`, `PurchaseCategoria`, `PurchaseSetting` (key/value, e.g.
  `metaCmvPct`).

**Demanda por Cliente**
- `DemandEntry` — `(cliente × produto × month)` aggregate from the COMERCIAL report.

**Also present but not central**: `Receivable`, `Payable` (raw ERP title imports; the active
credit flow uses `Sale`, and compras uses `PurchaseCommit`).

## Modules — internals

### DRE Gerencial (`/dre`)
Cash-basis managerial P&L, monthly columns, consolidated + per unit. **Single source** =
CashFlow Analítico XLSX. `POST /api/dre/import` detects the file type and rebuilds:
- **CashFlow Analítico** (`isCashflowAnaliticoFile`) → `buildDreFromCashflow` classifies every
  cash line into a DRE line and **wipes+replaces the entire `DreEntry` table**. This carries
  the client-specific "depurações" (FCA vehicle financing split principal→INVEST / juros→FIN;
  Multmunde intragroup excluded; inter-store transfers dropped; customer reimbursement netted
  in DEDUCAO, never negative; Orga Log = CMV; interest received on its own JUROS line).
- Legacy paths still handled: classified expense report (`parseExpenseReport`, contador's
  chart of accounts) and raw payment/receipt reports (`parseDre` + `classifyExpense` heuristic).
- `GET /api/dre` builds the structured statement (RECLIQ, MC, LUCROOP, EBITDA, LL) per scope
  with `byMonth` maps and supplier drill-down. Line labels in `src/lib/dre-classifier.ts`.

### Fluxo de Caixa (`/fluxo-de-caixa`)
Read-only view of the accounting cash ledger — **separate from the DRE**, never mixed.
`POST /api/cashflow-analitico/import` wipe-and-replaces `CashflowEntry`. `GET
/api/cashflow-analitico` serves a 6-level classification tree (entradas E / saídas S) with
monthly breakdown, per filial + CONSOLIDADO. (Legacy `cash-flow/*` routes exist from an
earlier daily-series design.)

### Controle de Compras (`/controle-compras`)
Purchase budget vs. committed spend. `GET /api/compras/analytics` projects, per month ×
category, the ERP boletos (`PurchaseCommit`, imobilizado excluded) plus manual order
installments (`installments()` in `src/lib/compras.ts` — explicit `datas` preferred, else
`primeiraDias`/`intervaloDias`). **Monthly limit = metaCmvPct × net revenue** pulled from the
DRE (avg of prior 3 months if available, else prior month, else latest — flagged). CRUD:
`/api/compras/pedidos`, `/api/compras/config`, import via `/api/compras/import-pagamentos`.
`/api/compras/reposicao` suggests restock qty by turnover (curve-A ruptures first).

### Risco de Cliente (`/risco-cliente`)
Bayesian default scoring, `Beta(2,2)` prior; `score = α/(α+β)`; open-balance clients capped
at grade B (▼). Full deep-dive: **[docs/RISCO_CLIENTE.md](docs/RISCO_CLIENTE.md)**.
`GET /api/credit`, `GET /api/credit/aggregate-risk`, `POST /api/credit/import`,
`POST /api/credit/reset`.

### Análise Comercial (`/analise-comercial`)
Cross-joins price × stock × sales by product `code`. `GET /api/commercial/analytics` returns
margin rows (`(price−cost)/price`), ABC with cumulative share, turnover (`qtySold/qtyStock`,
months-coverage over a 6-month period, status stockout/rupture/low/healthy/excess), and a
master table joining all three. Imports: `/api/commercial/{prices,stock,sales-abc}` (each
wipe-and-replace). Uploader UI in `src/components/CommercialUploader.tsx`.

### Demanda por Cliente (`/demanda-cliente`)
Per-client demand from the COMERCIAL report (only leaf rows with a DATA are real sales).
`GET /api/demanda` supports `?vendedor=&years=&months=` (1 year = simple view, 2 = YoY),
ranks clients (ABC, status Novo/Sumiu/Em queda/Crescendo, real margin via stock cost) and
sellers. `?cliente=CODE` = per-client detail. `POST /api/demanda/import` replaces **only the
(year, month) present in the payload**; accepts multipart (small) or JSON batches (large
files parsed client-side).

## XLSX import conventions

- Parsers detect the report by header (never by filename): e.g. `VECTO+EMISSÃO` = receivable,
  `VENCTO+ENTRADA` = payable, `FILIAL+TIPO+CLASSIF_CONTABIL` = cashflow analítico.
- Header matching is accent/case-insensitive (`normalize('NFD')…toUpperCase()`), resilient to
  column reordering (indexed by name).
- Brazilian number format `1.234,56` and Excel date serials are handled in each parser.
- Most imports are **wipe-and-replace** per scope; credit import is **incremental
  cross-snapshot reconciliation**; demanda is **replace-by-period**.
- Long imports set `export const maxDuration = 60` and insert in chunks (2000–3000 rows) to
  fit Vercel's serverless limits.

## UI patterns

No UI library — inline styles + classes from `globals.css` (`.card`, `.btn`, `.btn-primary`,
`.btn-danger`, `.btn-sm`, `.badge`, `.form-input`, `.form-select`, `.table-wrap`, `.toast`,
`.page-header`, `.page-title`, `.page-eyebrow`, `.empty-state`, `.metric-card`, `.grid-2`,
`.grid-3`, `.card-accent-yellow`). `Shell.tsx` = collapsible sidebar (state in localStorage)
+ topbar. Fonts: **Inter** (`--font-sans`) + **DM Serif Display** (`--font-serif`, used for
big metric numbers). App title: "Arken · Vale Sol Agronegócio". Favicon: `src/app/icon.svg`.
Many pages keep a local color palette `C` (navy/yellow/gold/green/red/amber) inline.
