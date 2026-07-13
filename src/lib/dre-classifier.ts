/**
 * Classificador de despesas da DRE Gerencial (Vale Sol / Multimundo).
 * Cada pagamento é mapeado para (linha da DRE, subconta) a partir do código do
 * fornecedor, da razão social e do campo OBS. Regras validadas com o cliente:
 *  - Fornecedores de produto (labs/distribuidores) → CMV
 *  - PJ não identificado → CMV (Outros Fornecedores)
 *  - Pessoa física não identificada → Despesas com Pessoal
 *  - Fabrício (sócio proprietário) e família Eccard → Pró-Labore
 *  - Multmunde (grupo) → CMV (Intragrupo)
 */

export const DRE_LINES = [
  'CMV','ADM','PESSOAL','LOG','COM','IMPOSTOS','FIN','PROLABORE','SOCIO','INTRAGRUPO',
] as const
export type DreLine = typeof DRE_LINES[number]

export const LINE_LABEL: Record<DreLine, string> = {
  CMV: 'Custos Variáveis Operacionais',
  ADM: 'Despesas Administrativas',
  PESSOAL: 'Despesas com Pessoal',
  LOG: 'Despesas Logísticas',
  COM: 'Despesas Comerciais',
  IMPOSTOS: 'Impostos',
  FIN: 'Despesas Financeiras',
  PROLABORE: 'Pró-Labore',
  SOCIO: 'Despesas de Sócio',
  INTRAGRUPO: 'Movimentações Intragrupo (Multmunde)',
}

// CNPJ base da Multmunde (empresa do grupo). Pagamentos a ela são transferência
// intragrupo — NÃO entram no CMV nem no resultado, ficam como memo.
const MULTMUNDE_CNPJ_BASE = '08322910'

const norm = (s: unknown) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()

// Overrides por CÓDIGO do ERP → [linha, subconta]
const CODE_SUB: Record<string, [DreLine, string]> = {
  '102676': ['FIN', 'Cartão de Crédito (Itaucard)'],
  '103053': ['FIN', 'Adquirente / Meios de Pagamento (NAIP)'],
  '102906': ['FIN', 'Adquirente / Meios de Pagamento (Galax Pay)'],
  '101020': ['FIN', 'Consórcios'],
  '102499': ['FIN', 'Consórcios'],
  '100982': ['FIN', 'Seguros / Consórcio (Prudential)'],
  '100089': ['IMPOSTOS', 'ICMS / Estadual (DARJ)'],
  '100058': ['IMPOSTOS', 'Federais (DARF / IR)'],
  '100080': ['IMPOSTOS', 'Federais (Receita Federal)'],
  '80': ['IMPOSTOS', 'IPVA / Estadual'],
  '101076': ['IMPOSTOS', 'Municipais'],
  '300049': ['IMPOSTOS', 'Municipais'],
  '93': ['PESSOAL', 'Encargos (FGTS/INSS)'],
  '102390': ['PESSOAL', 'Benefícios (Plano de Saúde)'],
  '101655': ['PESSOAL', 'Benefícios (Vale Alimentação)'],
  '102604': ['LOG', 'Armazenagem (Orga Log)'],
  '100086': ['LOG', 'Veículos (Localiza)'],
  '102540': ['LOG', 'Veículos (Fiat)'],
  '100043': ['LOG', 'Pedágio (Sem Parar)'],
  '100003': ['ADM', 'Energia Elétrica'],
  '200002': ['ADM', 'Energia Elétrica'],
  '100054': ['ADM', 'Contabilidade e Gestão'],
  '100090': ['ADM', 'Contabilidade e Gestão'],
  '100057': ['ADM', 'Contabilidade e Gestão'],
  '343': ['ADM', 'Serviços Administrativos'],
  '146': ['ADM', 'Serviços Administrativos'],
  '101523': ['PROLABORE', 'Família Eccard'],
  '101524': ['PROLABORE', 'Família Eccard'],
  '100555': ['PROLABORE', 'Fabrício (sócio proprietário)'],
  '309': ['INTRAGRUPO', 'Transferências Multmunde'],
  '310': ['INTRAGRUPO', 'Transferências Multmunde'],
}

const CMV_KW = ['VET','VETERINAR','FARMAC','AGRONEG','AGROPEC','SAUDE ANIMAL','LABORATORI','NUTRIC','ZOOTEC','PECUAR','PRODUTOS AGRO','QUIMICA','SANIMAL','BIOGENESIS','ZOETIS','OUROFINO','OURO FINO','MERCK','MSD','VIRBAC','DECHRA','BOTUPHARMA','VETNIL','BOEHRINGER','UNIAO QUIMICA','LAVIZOO','CALBOS','HALEX','VANSIL','ABASE','ALFA VET','DSM','SYNTEC','WINNER HORSE','SPEEDVET','EMBRIOLIFE','VETMINAS','PARAGRO','IMV DO BRASIL','LABOVET','MINITUB','NMR VET','INDUBRAS','TNB','SOGAMAX','FAREX','VETOQUINOL','BIMEDA','REPRODUX','CLIVAPEC','SEROPEC','ESPECIFARMA','WEIZUR','MOURAGRO','DIANAGRO','J.A AGRONEG','JA AGRONEG','BELGO','ARAMES','ARAAMES','SEAHORSE','ALISUL','VET SCIENCE','JP INDUSTRIA','LOG VET','WH COMERCIAL','APARELHOS VETERINARIOS','HOPPNER','SISTEMAS DE IDENTIFICACAO','IBIRA','FONSECA PLASTIC','WATANABE','SPECTRUN','PECUARISTA','BASSO','CASA CARDAO','FARMA']
const IMP_KW = ['DARJ','DARF','RECEITA FEDERAL','SEFAZ','PREFEITURA','MUNICIPIO','IPVA','IPTU','ISS','SIMPLES NACIONAL','FGTS','GPS','INSS','TRIBUT']
const FIN_KW = ['BANCO','ITAUCARD','INSTITUICAO DE PAGAMENTO','CONSORCIO','CONSÓRCIO','GALAX PAY','FINANCEIRA','CREDITO','TARIFA']
const LOG_KW = ['ARMAZENAGEM','RENT A CAR','LOCALIZA','TRANSPORT','LOGISTIC','SEM PARAR','FIAT','AUTOMOVEIS','FRETE','PEDAGIO','LOG ']
const ADM_KW = ['ENEL','LIGHT','ENERGIA','ELETRICIDADE','GESTAO EMPRESARIAL','CONTABEIS','CONTABIL','SEGURO','TELEFON','CLARO','VIVO','AGUA','SANEAMENTO','SOFTWARE','SISTEMA','MONITORAMENTO','VERISURE','ADM. PART','ADMINISTRAD','CONSULTORIA','PRUDENTIAL','SUL AMERICA']

function bySupplier(cod: string, rz: string, doc: string): [DreLine, string] {
  const digits = String(doc || '').replace(/\D/g, '')
  // Multmunde (grupo) por CNPJ base — precede tudo, mas NÃO pega "IPTU MULTMUNDE" (sem CNPJ)
  if (digits.slice(0, 8) === MULTMUNDE_CNPJ_BASE) return ['INTRAGRUPO', 'Transferências Multmunde']
  if (CODE_SUB[cod]) return CODE_SUB[cod]
  const R = norm(rz)
  const hasCNPJ = digits.length === 14
  if (R.includes('ECCARD')) return ['PROLABORE', 'Família Eccard']
  if (R.includes('FABRICIO')) return ['PROLABORE', 'Fabrício (sócio proprietário)']
  for (const k of IMP_KW) if (R.includes(k)) return ['IMPOSTOS', /DARF|RECEITA|FGTS|INSS/.test(R) ? 'Federais (DARF / IR)' : 'Municipais / Estaduais']
  for (const k of LOG_KW) if (R.includes(k)) return ['LOG', /FIAT|LOCALIZA|AUTOMOVEIS|RENT A CAR/.test(R) ? 'Veículos' : /SEM PARAR|PEDAGIO/.test(R) ? 'Pedágio' : 'Frete / Transporte']
  for (const k of FIN_KW) if (R.includes(k)) return ['FIN', R.includes('ITAUCARD') ? 'Cartão de Crédito (Itaucard)' : /CONSORCIO|CONSÓRCIO/.test(R) ? 'Consórcios' : 'Tarifas e Meios de Pagamento']
  for (const k of CMV_KW) if (R.includes(k)) return ['CMV', 'Compras de Produtos (Indústria/Distribuidores)']
  for (const k of ADM_KW) if (R.includes(k)) return ['ADM', /ENEL|LIGHT|ENERGIA|ELETRIC/.test(R) ? 'Energia Elétrica' : /CONTAB|GESTAO/.test(R) ? 'Contabilidade e Gestão' : /SEGURO|PRUDENTIAL|SUL AMERICA/.test(R) ? 'Seguros' : /ALARME|MONITOR|VERISURE|SOFTWARE|SISTEMA/.test(R) ? 'Segurança e Sistemas' : 'Outras Administrativas']
  // Regra do cliente: PJ não identificado → CMV (outros fornecedores); PF → pessoal
  if (hasCNPJ) return ['CMV', 'Outros Fornecedores (PJ)']
  return ['PESSOAL', 'Salários / Funcionários / Terceirizados']
}

function byObs(obs: string): [DreLine, string] | null {
  const O = norm(obs)
  if (!O) return null
  if (/PEDAGIO/.test(O)) return ['LOG', 'Pedágio']
  if (/COMBUSTIVEL|GASOLINA|DIESEL/.test(O)) return ['LOG', 'Combustível']
  if (/FRETE|ESTACIONAMENTO/.test(O)) return ['LOG', 'Frete / Transporte']
  if (/BRINDE|MARKETING|PROPAGANDA|PATROCINIO|EVENTO|FEIRA/.test(O)) return ['COM', 'Brindes e Marketing']
  if (/ALIMENTACAO/.test(O)) return ['SOCIO', 'Alimentação']
  if (/HOSPEDAGEM|VIAGEM/.test(O)) return ['SOCIO', 'Hospedagem / Viagem']
  if (/CARTAO (FABRICIO|MARCELO|FERNANDA|TATIANA|PEDRO)/.test(O)) return ['SOCIO', 'Cartão pessoal']
  if (/CARRO DE|ALUGUEL DE ALEX/.test(O)) return ['SOCIO', 'Veículo / Aluguel pessoal']
  if (/FAXINA/.test(O)) return ['PESSOAL', 'Serviços Terceirizados / Faxina']
  if (/VALE TRANSPORTE|VALE-TRANSPORTE/.test(O)) return ['PESSOAL', 'Benefícios (Vale Transporte)']
  if (/SALARIO|ADIANTAMENTO/.test(O)) return ['PESSOAL', 'Salários / Funcionários / Terceirizados']
  if (/ALARME|WPP|WHATSAPP/.test(O)) return ['ADM', 'Segurança e Sistemas']
  if (/ALUGUEL/.test(O)) return ['ADM', 'Aluguéis e Ocupação']
  if (/LUZ|AGUA|INTERNET|TELEFONE/.test(O)) return ['ADM', 'Outras Administrativas']
  return null
}

/** Classifica um pagamento. OBS tem prioridade sobre o fornecedor. */
export function classifyExpense(cod: string, rz: string, doc: string, obs?: string): [DreLine, string] {
  const fromObs = byObs(obs || '')
  if (fromObs) return fromObs
  return bySupplier(cod, rz, doc)
}
