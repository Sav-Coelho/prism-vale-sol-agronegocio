# Módulo — Risco de Cliente (`/risco-cliente`)

> Análise bayesiana de inadimplência da carteira de clientes do **Vale Sol Agronegócio**.
> Cada cliente recebe um **score de crédito** (probabilidade de pagar) e uma **nota AA→D**,
> alimentados pelo histórico de títulos a receber importado do ERP.

- **Página:** [`src/app/risco-cliente/page.tsx`](../src/app/risco-cliente/page.tsx)
- **Motor de cálculo:** [`src/lib/credit.ts`](../src/lib/credit.ts)
- **Parser do XLSX:** [`src/lib/cash-flow-parser.ts`](../src/lib/cash-flow-parser.ts)
- **APIs:** `src/app/api/credit/*` e `src/app/api/clients/*`
- **Nav:** Shell → `◆ Risco de Cliente`

---

## 1. Para que serve

Responde a uma pergunta comercial: **"posso vender a prazo para este cliente?"**

Em vez de uma régua fixa (limite/serasa), o módulo trata **cada título** como um
experimento de Bernoulli — pagou ou deu calote — e mantém uma crença bayesiana
atualizada sobre a probabilidade do cliente pagar o **próximo** título. Quanto mais
histórico, mais estreito o intervalo de confiança e mais confiável a nota.

A tela entrega:

| Bloco | O que mostra |
|-------|--------------|
| **Visão Consolidada** | nº de clientes, carteira em aberto (R$), risco médio ponderado pela exposição |
| **Risco de Crédito Agregado** | série temporal de 12 meses do risco da carteira (ponderado + médio simples) |
| **Distribuição por Faixa** | quantos clientes em cada nota AA/A/B/C/D |
| **Aging da Carteira** | saldo em aberto por faixa de atraso (0–30 / 31–60 / 61–90 / >90 dias) |
| **Tabela detalhada** | um cliente por linha, ordenado por risco desc., com barra de IC 95% |

---

## 2. Modelo de dados

O módulo reaproveita dois modelos do `schema.prisma`:

### `Client`
```
id, code (ERP, @unique), name, email, phone, cpf, unitId, active, sales[]
```
`code` = **código do ERP**, chave estável de deduplicação entre imports.

### `Sale` — é aqui que mora cada título
```
id, clientId, externalId, description, amount, date, dueDate, paidDate,
paymentStatus, unitId, month, year
@@unique([clientId, externalId])
```

- **`externalId`** = `TITULO::PARCELA::VECTO::FILIAL` (montado no import). Inclui data de
  vencimento e filial porque o mesmo número de título pode se repetir entre filiais do
  mesmo cliente — colisão real observada nos relatórios.
- **`amount`** = **VLR LÍQUIDO** (principal + juros + multa − desconto) = o que o cliente
  efetivamente deve hoje, não o valor de face.
- **`paymentStatus`** — ciclo de vida do título:

```
        importado em atraso
             │
          OVERDUE ──────────────► PAID        (sumiu do relatório, ainda em dia)
             │  \                              → sucesso no score
             │   \────────────► DEFAULTED      (sumiu já em calote, >=90d, OU
             │                                   envelheceu >=90d ainda em aberto)
             │                                 → falha no score
          reabriu no ERP
             │
          volta pra OVERDUE
```

`PENDING` existe no enum mas hoje só é gerado por cadastro/venda manual; o import de
títulos a receber sempre cria como `OVERDUE`.

---

## 3. O score bayesiano (`credit.ts`)

### Prior
```
Beta(α₀ = 2, β₀ = 2)   →  ALPHA_PRIOR / BETA_PRIOR
```
Um cliente **sem histórico** parte de score = 2/4 = **50%** (neutro). O prior fraco
(2,2) faz poucos títulos já moverem a nota de forma perceptível.

### Classificação de cada título — `classifySale()`
```
PAID       → sucesso   (qualquer pagamento conta, mesmo atrasado)
DEFAULTED  → falha     (calote explícito)
OVERDUE e vencido há >= 90 dias  → falha    (OVERDUE_DAYS_FOR_DEFAULT = 90)
demais casos                     → PENDING  (não entra na verossimilhança)
```

> **Regra de negócio embutida:** os dados vêm de *relatórios de inadimplência*, então
> todo título que aparece já está vencido. Se depois some do relatório, o cliente
> **pagou** — por isso `PAID` conta como sucesso mesmo tendo sido pago com atraso. O que
> separa sucesso de falha é o **tempo**: quitar antes dos 90 dias é sucesso; deixar
> passar de 90 (ou dar calote explícito) é falha.

### Posterior e score — `scoreClient()`
```
α = α₀ + pagos           β = β₀ + inadimplentes           n = α + β
score = E[p_pagar] = α / n
risk  = 1 − score
```

Intervalo de confiança ~95% pelo desvio-padrão da Beta (aproximação normal, rápida o
suficiente para rodar por request):
```
Var = αβ / ( n² (n+1) )
sd  = √Var
IC  = [ max(0, score − 1.96·sd) ,  min(1, score + 1.96·sd) ]
```
`observations = pagos + inadimplentes` — dita a largura do IC (mais observações → barra
mais estreita na tabela).

---

## 4. Notas AA → D e a regra do saldo em aberto

Faixas de **risco** (`risk = 1 − score`):

| Nota | Faixa de risco | Cor |
|------|----------------|-----|
| **AA** | < 20 % | verde |
| **A**  | 20–40 % | verde-oliva |
| **B**  | 40–60 % | dourado |
| **C**  | 60–80 % | âmbar |
| **D**  | ≥ 80 % | vermelho |

### ▼ Rebaixamento por saldo em aberto
Regra de negócio dura (`gradeOf()` em `page.tsx`):

> **Cliente com qualquer saldo em aberto NUNCA recebe AA ou A.** Se o score bayesiano o
> colocaria em AA/A mas `openBalance > 0`, a nota é rebaixada para no máximo **B** e
> marcada com **▼** na tabela.

Isso impede que um cliente com ótimo histórico, mas com um título vencido *agora*,
apareça como "risco mínimo". O score continua íntegro; só a **nota exibida** cai.

---

## 5. Risco agregado da carteira (série temporal)

`aggregateMonthlyRisk(clients, monthsBack=12)` produz um ponto por mês:

Para cada **fim de mês** da janela:
1. Filtra só as vendas observadas **até** aquele fim de mês (`sale.date <= snapshot`) —
   **sem lookahead**, o passado não enxerga o futuro.
2. Recalcula o score de cada cliente **com o refDate daquele mês** (um título que só
   viraria calote em julho ainda é PENDING em maio).
3. Calcula a **exposição** = soma dos títulos que estavam *abertos* naquele snapshot
   (`sem paidDate` ou `paidDate > snapshot`).
4. Agrega:
```
weightedRisk = Σ(exposiçãoᵢ · riscoᵢ) / Σ exposiçãoᵢ     ← linha cheia (azul)
meanRisk     = média simples do risco dos clientes com exposição  ← linha tracejada
```

A linha **ponderada** é a métrica que importa: R$ 100k de risco alto pesam mais que
R$ 1k. A **média simples** serve de contraponto (mostra se o risco está concentrado em
poucos clientes grandes ou espalhado).

`GET /api/credit/aggregate-risk?months=12` (aceita 1–36 meses).

---

## 6. Aging da carteira

Calculado em `GET /api/credit` por título em aberto, usando `dueDate` (fallback `date`):
```
0–30 dias   |  31–60 dias  |  61–90 dias  |  > 90 dias
```
Um título só entra no aging se estiver **aberto**: `classifySale === PENDING` ou
(`OVERDUE` sem `paidDate`). A soma bate com a "Carteira em aberto" da Visão Consolidada.

---

## 7. Importação de títulos a receber (o coração do módulo)

Botão **⬆ Importar contas a receber (XLSX)** → `POST /api/credit/import`.

### Arquivo esperado
`RELATORIO DE TITULOS A RECEBER` do ERP (24 colunas, detectado pelo header **VECTO + EMISSÃO**):
```
VECTO · EMISSÃO · CÓDIGO · RAZÃO SOCIAL · CNPJ/CPF · TÍTULO · PARCELA · PORTADOR ·
TIPO COBRANÇA · VENDEDOR · NOME VENDEDOR · NOME FAZENDA · FONE · VLR TÍTULO · DESCTO ·
JUROS · MULTA · VLR LÍQUIDO · DA · NSU · COMPLEMENTO · OBSERVAÇÃO · FILIAL · ANOTAÇÕES
```
O parser é resistente a reordenação de colunas (indexa pelo nome normalizado) e
converte datas seriais do Excel e valores `1.234,56` → número.

### Reconciliação cross-snapshot
O import **não** é um "append": ele compara o XLSX (foto atual do ERP) com o estado no
banco e reconcilia. Para cada título, pela chave `(clientId, externalId)`:

| Situação | Ação | Efeito no score |
|----------|------|-----------------|
| No XLSX **e** no DB | mantém `OVERDUE` (o classifier promove p/ DEFAULTED com a idade) | — |
| No DB, **sumiu** do XLSX, ainda dentro de 90d | `PAID` (`paidDate = hoje`) | **sucesso** |
| No DB, **sumiu** do XLSX, já em calote (≥90d ou já `DEFAULTED`) | `DEFAULTED` (`paidDate = hoje`) | **falha** |
| Só no XLSX (novo) | cria como `OVERDUE` | passa a contar quando vencer 90d |
| Era `PAID`/`DEFAULTED` e **voltou** no XLSX | reverte p/ `OVERDUE` (reabriu no ERP) | — |

**Por que calote resolvido tarde vira `DEFAULTED` e não `PAID`:** marcar um título com
90+ dias de atraso como "pago limpo" apagaria o histórico ruim do cliente. Ele fica
`DEFAULTED` (falha permanente) mas com `paidDate` — sai do saldo em aberto sem virar
sucesso.

### Proteção contra snapshot fora de ordem
Se alguém importa um relatório **mais antigo** que o estado atual, títulos ainda não
emitidos "sumiriam" e seriam marcados como pagos por engano. O import detecta isso
comparando `max(VECTO)` do XLSX com o `max(dueDate)` dos títulos **ainda em aberto** no
DB. Se o XLSX for mais antigo (`snapshotAntigo = true`):
- **nenhum** título é marcado como pago/calote;
- só os títulos genuinamente novos são adicionados;
- a UI mostra o aviso ⚠ com as duas datas.

Títulos já resolvidos em import anterior (`paidDate` preenchido) **nunca** são
reprocessados — reescrever o `paidDate` corromperia a série histórica de risco.

### Retorno do endpoint
```jsonc
{
  "titulosPagos": 0,            // sumiram em dia → PAID
  "titulosCaloteResolvido": 0,  // sumiram já em calote → DEFAULTED
  "titulosNovos": 0,            // criados como OVERDUE
  "titulosMantidos": 0,         // interseção que continua devendo
  "titulosRevertidos": 0,       // PAID/DEFAULTED que reabriram
  "valoresCorrigidos": 0,       // amount ajustado pelo ERP entre snapshots
  "clientesCriados": 0,
  "snapshotAntigo": false,      // true = XLSX anterior ao estado atual
  "maxDueDateXlsx": "…", "maxDueDateDb": "…"
}
```

Execução em **batches** (não em transação longa) para caber no limite serverless da
Vercel — `maxDuration = 60s`. Clientes com `code` entram via `createMany({skipDuplicates})`;
os raros sem `code` são resolvidos por CNPJ/CPF ou nome.

---

## 8. APIs do módulo

| Método · Rota | Função |
|---------------|--------|
| `GET /api/credit` | uma linha por cliente: score, IC, contagens pagos/calote/pendente, `openBalance`, aging |
| `GET /api/credit/aggregate-risk?months=12` | série temporal do risco ponderado (1–36 meses) |
| `POST /api/credit/import` | importa/reconcilia o XLSX de títulos a receber |
| `POST /api/credit/reset` | **destrutivo** — apaga todas as Sales e Clients (exige body `{"confirm":"APAGAR TUDO"}`) |
| `GET/POST /api/clients` · `PUT/DELETE /api/clients/[id]` | CRUD manual de cliente (usado pelo modal + Novo Cliente) |

Todas as rotas de leitura usam `dynamic = 'force-dynamic'` / `revalidate = 0` — o score
é sempre recalculado on-the-fly, nunca cacheado.

---

## 9. Anatomia da página (`page.tsx`)

- Estado principal: `rows` (`CreditRow[]` de `/api/credit`) + `risk` (`RiskPoint[]` de
  `aggregate-risk`), carregados em paralelo no `load()`.
- **Cálculos derivados (`useMemo`)**: `portfolio` (consolidado), `distribution` (contagem
  por nota, já aplicando o rebaixamento ▼), `agingTotals`.
- **Gráficos Recharts**: `LineChart` com `ReferenceArea` pintando as bandas AA→D ao fundo;
  dois `BarChart` (distribuição + aging).
- **Tabela**: barra horizontal por cliente desenhando o **IC 95%** (faixa translúcida) e o
  **score** (traço sólido) sobre o eixo 0–100%.
- **Modal** de cadastro/edição de cliente e **toast** de feedback.
- Paleta local `C` (navy/yellow/gold/green/red/amber) — não usa as classes de marca do
  `globals.css` além de `.card`, `.btn`, `.badge`, `.table-wrap`, `.form-*`.

---

## 10. Casos-limite e cuidados ao mexer

- **Cliente sem histórico** → score 50 %, nota B, IC largo (0 observações). Esperado.
- **Renegociação de VECTO no ERP** muda o `externalId` → o título antigo "some" e é
  marcado `PAID`/`DEFAULTED`; o novo entra como `OVERDUE`. Aceitável: renegociar quita o
  original.
- **Nunca** reprocessar títulos com `paidDate` já preenchido — a série histórica de risco
  depende de `paidDate` congelado.
- O rebaixamento ▼ é **só de exibição** (`gradeOf`), não altera `score`/`risk` no banco
  nem a série agregada.
- Restrição de build da Vercel: **sem `for...of` em `Map`/`Set` nem spread de `Set`** — o
  import usa `Array.from(...).forEach(...)` por isso.
- `POST /api/credit/reset` é irreversível e apaga **também os Clients** — não é um "limpar
  títulos", é um wipe total do módulo.
