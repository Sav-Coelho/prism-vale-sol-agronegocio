/**
 * Regras da Matriz de Fornecedores que a TELA também usa (sem acesso ao banco):
 * perguntas de risco, pesos, cortes, ações por quadrante e os tipos da resposta.
 * O cálculo com dados fica em lib/matriz-fornecedores.
 *
 * Perguntas — versão 2 (16/10/2026). A versão 1 perguntava "Se este fornecedor
 * falhar, consigo os mesmos produtos em outro?" e valia 50% da nota. O comprador
 * respondeu pela exclusividade de MARCA (só a Zoetis faz Zoetis): 13 de 19 marcaram
 * "exclusivo", e só essa resposta já levava ao corte — 15 de 19 caíram em
 * Estratégico. A v2 separa o que a exclusividade misturava: o cliente aceita outra
 * marca? existe outro caminho de compra para a mesma marca? E nenhuma resposta
 * sozinha chega ao corte (a maior pesa 35 de 100).
 */
export type Quadrante = 'ALAVANCAGEM' | 'ESTRATEGICO' | 'GARGALO' | 'NAO_CRITICO' | 'SEM_AVALIACAO'
export type CampoRisco = 'substituto' | 'canal' | 'condicoes' | 'falhas'

export interface Pergunta { titulo: string; pergunta: string; ajuda: string; peso: number; opcoes: { valor: number; rotulo: string }[] }
export const PERGUNTAS: Record<CampoRisco, Pergunta> = {
  substituto: {
    titulo: 'Substituto aceito',
    pergunta: 'Se faltar produto deste fornecedor, quanto do que você compra dele o cliente aceita trocar por outra marca?',
    ajuda: 'Pense no balcão, não no catálogo: exclusividade de marca não conta. Vacina de protocolo costuma ser "quase nada"; vermífugo, mineral, vitamina, arame e descartável costumam ter equivalente.',
    peso: 0.35,
    opcoes: [{ valor: 0, rotulo: 'Quase tudo' }, { valor: 33, rotulo: 'Mais da metade' }, { valor: 67, rotulo: 'Menos da metade' }, { valor: 100, rotulo: 'Quase nada (exige a marca)' }],
  },
  canal: {
    titulo: 'Outro canal',
    pergunta: 'Consigo comprar os mesmos itens dele por outro caminho — distribuidor, outro representante ou outra loja do grupo?',
    ajuda: 'Vale a mesma marca comprada de outro jeito. Para distribuidor: outro distribuidor ou o próprio laboratório.',
    peso: 0.25,
    opcoes: [{ valor: 0, rotulo: 'Sim, sem perder preço ou prazo' }, { valor: 50, rotulo: 'Sim, pagando mais ou esperando' }, { valor: 100, rotulo: 'Não, só com ele' }],
  },
  condicoes: {
    titulo: 'Condições impostas',
    pergunta: 'Ele impõe cota, pedido mínimo alto, venda casada ou pagamento antecipado?',
    ajuda: 'Condição que ele exige para vender, não a negociação normal de preço e prazo.',
    peso: 0.20,
    opcoes: [{ valor: 0, rotulo: 'Não' }, { valor: 50, rotulo: 'Às vezes' }, { valor: 100, rotulo: 'Sim, sempre' }],
  },
  falhas: {
    titulo: 'Falhas recentes',
    pergunta: 'Nos últimos 6 meses faltou produto dele ou a entrega atrasou?',
    ajuda: 'Conte as vezes em que a falta ou o atraso atrapalhou a venda.',
    peso: 0.20,
    opcoes: [{ valor: 0, rotulo: 'Não' }, { valor: 50, rotulo: 'Uma vez' }, { valor: 100, rotulo: 'Várias vezes' }],
  },
}
export const CAMPOS: CampoRisco[] = ['substituto', 'canal', 'condicoes', 'falhas']
export const VERSAO_PERGUNTAS = 2
/** resposta da v1 à pergunta de alternativas — só aparece na tela como referência */
export const ALTERNATIVAS_V1: Record<number, string> = { 0: 'Sim, fácil', 33: 'Sim, com esforço', 67: 'Só em parte', 100: 'Não, é exclusivo' }
/**
 * Tipo do fornecedor (16/10/2026). Vem sugerido pelo nome (lib/matriz-fornecedores) e o
 * comprador confirma ou corrige; não entra na nota de risco, serve para filtrar a tela e
 * ajustar a ação. Até 16/10 era Fabricante / Distribuidor / Outro.
 */
export const TIPOS = ['LABORATORIO', 'DISTRIBUIDOR', 'OUTROS'] as const
export type Tipo = typeof TIPOS[number]
export const TIPO_ROTULO: Record<Tipo, string> = { LABORATORIO: 'Laboratório', DISTRIBUIDOR: 'Distribuidor', OUTROS: 'Outros' }
export const TIPO_AJUDA: Record<Tipo, string> = {
  LABORATORIO: 'fabricante de medicamento, vacina ou suplemento veterinário',
  DISTRIBUIDOR: 'revenda de produtos de vários fabricantes',
  OUTROS: 'ração, arame, ferradura, identificação animal, reprodução, equipamento, material médico, sementes e embalagens',
}
/** tipo gravado na 1ª versão que não virou tipo novo — só aparece na tela como referência */
export const TIPO_V1_ROTULO: Record<string, string> = { FABRICANTE: 'Fabricante', DISTRIBUIDOR: 'Distribuidor', OUTRO: 'Outro' }
/** o que vale para filtro e ação: o tipo confirmado ou, sem ele, o sugerido */
export const tipoDe = (l: { tipo: Tipo | null; tipoSugerido: Tipo }): Tipo => l.tipo ?? l.tipoSugerido
/** risco a partir do qual o fornecedor é de alto risco (0–100) */
export const CORTE_RISCO = 50
/** fração do gasto que define a curva A de fornecedores (alta importância) */
export const CURVA_A = 0.8
/** alerta de concentração: com pelo menos N avaliados na curva A, se esta fração ou mais cair em Estratégico… */
export const ALERTA_MIN_AVALIADOS = 8
export const ALERTA_FRACAO = 0.6
/** …ou se esta fração ou mais marcar "quase nada" em substituto (o padrão de resposta da v1) */
export const ALERTA_FRACAO_MARCA = 0.5

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
    acao: 'Responder as 4 perguntas de risco para posicionar na matriz.',
  },
}

export type Respostas = Record<CampoRisco, number | null>
export function riscoDe(r: Respostas): number | null {
  for (let i = 0; i < CAMPOS.length; i++) if (r[CAMPOS[i]] == null) return null
  let s = 0
  for (let i = 0; i < CAMPOS.length; i++) s += PERGUNTAS[CAMPOS[i]].peso * (r[CAMPOS[i]] as number)
  return Math.round(s)
}

export function quadranteDe(curvaA: boolean, risco: number | null): Quadrante {
  if (risco == null) return 'SEM_AVALIACAO'
  if (curvaA) return risco >= CORTE_RISCO ? 'ESTRATEGICO' : 'ALAVANCAGEM'
  return risco >= CORTE_RISCO ? 'GARGALO' : 'NAO_CRITICO'
}

/** tipo: o que vale para a linha (tipoDe) */
export function acaoDe(q: Quadrante, tipo: Tipo | null): string {
  if (q === 'ALAVANCAGEM' && tipo === 'DISTRIBUIDOR') return QUADRANTE.ALAVANCAGEM.acao + ' Comparar com a compra direta do laboratório.'
  if (q === 'ESTRATEGICO' && tipo === 'DISTRIBUIDOR') return QUADRANTE.ESTRATEGICO.acao + ' Avaliar comprar direto do laboratório para garantir cota.'
  return QUADRANTE[q].acao
}

export interface LinhaMatriz extends Respostas {
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
  /** tipo confirmado pelo comprador; null = vale o sugerido */
  tipo: Tipo | null
  /** tipo sugerido pelo nome, para o comprador conferir */
  tipoSugerido: Tipo
  /** tipo da 1ª versão que não deu para converter (ex.: "Fabricante" em nome de distribuidora) */
  tipoV1: string | null
  /** resposta da v1 à pergunta de alternativas (não entra na nota) */
  alternativasV1: number | null
  /** 0–100; só com as 4 respostas */
  risco: number | null
  quadrante: Quadrante
  acao: string
  /** 1% do gasto anualizado (R$/ano) */
  valor1pct: number
  atualizadoEm: string | null
  atualizadoPor: string | null
}

/**
 * Resposta suspeita, na curva A com pelo menos ALERTA_MIN_AVALIADOS avaliados:
 * ALERTA_FRACAO ou mais em Estratégico (o que a v1 produziu: 15 de 19), ou
 * ALERTA_FRACAO_MARCA ou mais com "quase nada" em substituto (o padrão de resposta
 * da v1: 13 de 19 "exclusivo"). A tela avisa para o comprador conferir.
 */
export function alertaConcentracao(linhas: LinhaMatriz[]): { avaliados: number; estrategicos: number; marcaExigida: number; travados: number } | null {
  const av = linhas.filter(l => l.curvaA && l.risco != null)
  if (av.length < ALERTA_MIN_AVALIADOS) return null
  const est = av.filter(l => l.quadrante === 'ESTRATEGICO').length
  const marca = av.filter(l => l.substituto === 100).length
  if (est / av.length < ALERTA_FRACAO && marca / av.length < ALERTA_FRACAO_MARCA) return null
  return { avaliados: av.length, estrategicos: est, marcaExigida: marca, travados: av.filter(l => l.substituto === 100 && l.canal === 100).length }
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
  /** avaliados na v1 que ainda não responderam as perguntas novas */
  pendentesV2: number
  /** contrapartes que não vendem mercadoria: fora da lista; o pago a elas fica no gastoTotal, que bate com a DRE */
  foraDaLista: { n: number; gasto: number }
  corteRisco: number
  resumo: Record<Quadrante, { n: number; gasto: number }>
  linhas: LinhaMatriz[]
}
