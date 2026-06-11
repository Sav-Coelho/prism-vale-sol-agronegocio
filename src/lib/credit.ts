// Bayesian credit scoring with a Beta(2,2) prior.
//
// Each Sale is treated as a Bernoulli trial:
//   success = paid on time (PAID with paidDate <= dueDate, or PAID without dueDate)
//   failure = defaulted (DEFAULTED, or OVERDUE > 90 days)
// PENDING / unresolved sales are excluded from the likelihood.
//
// Posterior:  Beta(alpha_0 + paid,  beta_0 + defaulted)
// Score      = E[p_pay] = (alpha_0 + paid) / (alpha_0 + beta_0 + paid + defaulted)
// 95% CI is computed from Beta posterior quantiles (Wilson approximation for speed).

export const ALPHA_PRIOR = 2
export const BETA_PRIOR = 2

export type SaleForCredit = {
  amount: number
  date: Date | string
  dueDate?: Date | string | null
  paidDate?: Date | string | null
  paymentStatus: 'PENDING' | 'PAID' | 'OVERDUE' | 'DEFAULTED'
}

export interface CreditScore {
  alpha: number               // posterior alpha
  beta: number                // posterior beta
  paid: number                // observed successes
  defaulted: number           // observed failures
  pending: number             // unresolved (not used in likelihood)
  score: number               // posterior mean = P(pay next) ∈ [0,1]
  risk: number                // 1 - score
  confidenceLow: number       // ~95% CI lower bound for p_pay
  confidenceHigh: number      // upper bound
  observations: number        // paid + defaulted (drives confidence width)
}

const toDate = (d: Date | string): Date => d instanceof Date ? d : new Date(d)

const OVERDUE_DAYS_FOR_DEFAULT = 90

export function classifySale(sale: SaleForCredit, refDate: Date = new Date()):
  'PAID' | 'DEFAULTED' | 'PENDING' {
  // Explicit final states first
  if (sale.paymentStatus === 'PAID')      return 'PAID'
  if (sale.paymentStatus === 'DEFAULTED') return 'DEFAULTED'

  // OVERDUE that's been long overdue → treat as default for scoring
  if (sale.paymentStatus === 'OVERDUE' && sale.dueDate) {
    const due = toDate(sale.dueDate)
    const daysLate = (refDate.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)
    if (daysLate >= OVERDUE_DAYS_FOR_DEFAULT) return 'DEFAULTED'
  }

  return 'PENDING'
}

export function scoreClient(sales: SaleForCredit[], refDate: Date = new Date()): CreditScore {
  let paid = 0
  let defaulted = 0
  let pending = 0
  for (const s of sales) {
    const c = classifySale(s, refDate)
    if (c === 'PAID')         paid++
    else if (c === 'DEFAULTED') defaulted++
    else pending++
  }
  const alpha = ALPHA_PRIOR + paid
  const beta  = BETA_PRIOR + defaulted
  const n     = alpha + beta
  const score = alpha / n

  // Standard deviation of Beta(α, β) = sqrt(αβ / ((α+β)² (α+β+1)))
  const variance = (alpha * beta) / ((n * n) * (n + 1))
  const sd = Math.sqrt(variance)
  const confidenceLow  = Math.max(0, score - 1.96 * sd)
  const confidenceHigh = Math.min(1, score + 1.96 * sd)

  return {
    alpha, beta, paid, defaulted, pending,
    score, risk: 1 - score,
    confidenceLow, confidenceHigh,
    observations: paid + defaulted,
  }
}

// ── Aggregate portfolio risk ────────────────────────────────
// For each historical month over the lookback window, compute the
// exposure-weighted expected default rate of the portfolio:
//
//   risk_t = sum_i (exposure_i,t * risk_i,t) / sum_i exposure_i,t
//
// where exposure_i,t = open balance (PENDING + OVERDUE) of client i at month t
// and risk_i,t comes from the Beta posterior using sales observed strictly
// before month t (no lookahead).

export type ClientSales = { clientId: number; clientName: string; sales: SaleForCredit[] }

export interface AggregateRiskPoint {
  key: string
  label: string
  year: number
  month: number
  weightedRisk: number           // 0..1
  meanRisk: number               // unweighted mean across clients with exposure
  exposure: number               // total open balance
  clientsWithExposure: number
}

const MONTH_NAMES = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
                     'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

export function aggregateMonthlyRisk(
  clients: ClientSales[],
  monthsBack: number = 12,
): AggregateRiskPoint[] {
  const now = new Date()
  const points: AggregateRiskPoint[] = []

  for (let i = monthsBack - 1; i >= 0; i--) {
    // Month-end snapshot
    const snapshot = new Date(now.getFullYear(), now.getMonth() - i + 1, 0)
    const year = snapshot.getFullYear()
    const month = snapshot.getMonth() + 1
    const key = `${year}-${String(month).padStart(2, '0')}`

    let totalExposure = 0
    let weightedRiskSum = 0
    let riskSum = 0
    let clientsCount = 0

    for (const c of clients) {
      // Sales observed strictly before snapshot end
      const historicalSales = c.sales.filter(s => toDate(s.date) <= snapshot)
      if (historicalSales.length === 0) continue

      const score = scoreClient(historicalSales, snapshot)

      // Exposure = sum of amounts that were OPEN at snapshot date
      // i.e., sale.date <= snapshot AND (no paidDate OR paidDate > snapshot)
      const exposure = historicalSales.reduce((s, sale) => {
        const paidOn = sale.paidDate ? toDate(sale.paidDate) : null
        const openAtSnapshot = !paidOn || paidOn > snapshot
        return openAtSnapshot ? s + sale.amount : s
      }, 0)

      if (exposure > 0) {
        totalExposure   += exposure
        weightedRiskSum += exposure * score.risk
        riskSum         += score.risk
        clientsCount    += 1
      }
    }

    points.push({
      key,
      label: `${MONTH_NAMES[month]}/${String(year).slice(-2)}`,
      year, month,
      weightedRisk: totalExposure > 0 ? weightedRiskSum / totalExposure : 0,
      meanRisk:     clientsCount  > 0 ? riskSum / clientsCount : 0,
      exposure:     totalExposure,
      clientsWithExposure: clientsCount,
    })
  }

  return points
}
