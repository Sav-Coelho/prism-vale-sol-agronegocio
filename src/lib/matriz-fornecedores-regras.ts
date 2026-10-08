/**
 * Regras da Matriz de Fornecedores que a TELA também usa (sem acesso ao banco):
 * perguntas de risco, pesos, cortes, ações por quadrante e os tipos da resposta.
 * O cálculo com dados fica em lib/matriz-fornecedores.
 */
export type Quadrante = 'ALAVANCAGEM' | 'ESTRATEGICO' | 'GARGALO' | 'NAO_CRITICO' | 'SEM_AVALIACAO'
export type CampoRisco = 'alternativas' | 'condicoes' | 'falhas'

export const PERGUNTAS: Record<CampoRisco, { titulo: string; pergunta: string; peso: number; opcoes: { valor: number; rotulo: string }[] }> = {
  alternativas: {
    titulo: 'Alternativas',
    pergunta: 'Se este fornecedor falhar, consigo os mesmos produtos em outro?',
    peso: 0.5,
    opcoes: [{ valor: 0, rotulo: 'Sim, fácil' }, { valor: 33, rotulo: 'Sim, com esforço' }, { valor: 67, rotulo: 'Só em parte' }, { valor: 100, rotulo: 'Não, é exclusivo' }],
  },
  condicoes: {
    titulo: 'Condições impostas',
    pergunta: 'Ele impõe cota, pedido mínimo alto, exclusividade ou pagamento antecipado?',
    peso: 0.25,
    opcoes: [{ valor: 0, rotulo: 'Não' }, { valor: 50, rotulo: 'Às vezes' }, { valor: 100, rotulo: 'Sim, sempre' }],
  },
  falhas: {
    titulo: 'Falhas recentes',
    pergunta: 'Nos últimos 6 meses faltou produto dele ou a entrega atrasou?',
    peso: 0.25,
    opcoes: [{ valor: 0, rotulo: 'Não' }, { valor: 50, rotulo: 'Uma vez' }, { valor: 100, rotulo: 'Várias vezes' }],
  },
}
export const CAMPOS: CampoRisco[] = ['alternativas', 'condicoes', 'falhas']
export const TIPOS = ['FABRICANTE', 'DISTRIBUIDOR', 'OUTRO'] as const
export const TIPO_ROTULO: Record<string, string> = { FABRICANTE: 'Fabricante', DISTRIBUIDOR: 'Distribuidor', OUTRO: 'Outro' }
/** risco a partir do qual o fornecedor é de alto risco (0–100) */
export const CORTE_RISCO = 50
/** fração do gasto que define a curva A de fornecedores (alta importância) */
export const CURVA_A = 0.8

export const QUADRANTE: Record<Quadrante, { rotulo: string; resumo: string; acao: string }> = {
  ALAVANCAGEM: {
    rotulo: 'Alavancagem',
    resumo: 'Gasto alto, com alternativas',
    acao: 'Negociar forte: concentrar volume, cotar a cada trimestre, trocar volume por desconto, bonificação e prazo; usar a folga do limite para compra à vista com desconto.',
  },
  ESTRATEGICO: {
    rotulo: 'Estratégico',
    resumo: 'Gasto alto, poucas alternativas',
    acao: 'Parceria com plano anual: cota garantida na safra, prazo casado com a venda, meta de bônus por volume e previsão de compras combinada. Não trocar por preço.',
  },
  GARGALO: {
    rotulo: 'Gargalo',
    resumo: 'Gasto baixo, poucas alternativas',
    acao: 'Garantir abastecimento: estoque de segurança, segundo fornecedor homologado e pedido antecipado. Preço não é a prioridade.',
  },
  NAO_CRITICO: {
    rotulo: 'Não crítico',
    resumo: 'Gasto baixo, com alternativas',
    acao: 'Simplificar: concentrar em poucos fornecedores, padronizar itens e automatizar a reposição. Não gastar tempo de negociação.',
  },
  SEM_AVALIACAO: {
    rotulo: 'Sem avaliação',
    resumo: 'Falta avaliar o risco',
    acao: 'Responder as 3 perguntas de risco para posicionar na matriz.',
  },
}

export function riscoDe(r: { alternativas: number | null; condicoes: number | null; falhas: number | null }): number | null {
  if (r.alternativas == null || r.condicoes == null || r.falhas == null) return null
  return Math.round(PERGUNTAS.alternativas.peso * r.alternativas + PERGUNTAS.condicoes.peso * r.condicoes + PERGUNTAS.falhas.peso * r.falhas)
}

export function quadranteDe(curvaA: boolean, risco: number | null): Quadrante {
  if (risco == null) return 'SEM_AVALIACAO'
  if (curvaA) return risco >= CORTE_RISCO ? 'ESTRATEGICO' : 'ALAVANCAGEM'
  return risco >= CORTE_RISCO ? 'GARGALO' : 'NAO_CRITICO'
}

export function acaoDe(q: Quadrante, tipo: string | null): string {
  if (q === 'ALAVANCAGEM' && tipo === 'DISTRIBUIDOR') return QUADRANTE.ALAVANCAGEM.acao + ' Comparar com a compra direta do laboratório.'
  if (q === 'ESTRATEGICO' && tipo === 'DISTRIBUIDOR') return QUADRANTE.ESTRATEGICO.acao + ' Avaliar comprar direto do laboratório para garantir cota.'
  return QUADRANTE[q].acao
}

export interface LinhaMatriz {
  chave: string
  nome: string
  /** cadastros do ERP agrupados nesta linha */
  nomes: string[]
  /** pago nos meses da janela (R$) */
  gasto: number
  /** fração do gasto total */
  participacao: number
  acumulada: number
  curvaA: boolean
  /** boletos de mercadoria a vencer (sem imobilizado) */
  aVencer: number
  /** parcelas a vencer de pedidos ainda não faturados */
  pedidosAbertos: number
  tipo: string | null
  alternativas: number | null
  condicoes: number | null
  falhas: number | null
  /** 0–100; só com as 3 respostas */
  risco: number | null
  quadrante: Quadrante
  acao: string
  /** 1% do gasto anualizado (R$/ano) */
  valor1pct: number
  atualizadoEm: string | null
  atualizadoPor: string | null
}

export interface ResultadoMatriz {
  hasData: boolean
  motivo?: string
  meses: string[]
  gastoTotal: number
  gastoAnualizado: number
  nFornecedores: number
  curvaA: { n: number; corte: number }
  avaliados: { curvaA: number; total: number }
  corteRisco: number
  resumo: Record<Quadrante, { n: number; gasto: number }>
  linhas: LinhaMatriz[]
}
