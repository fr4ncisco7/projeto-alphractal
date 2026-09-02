/**
 * Contratos da API do Fees Monitor.
 *
 * Os campos vêm em snake_case porque são o contrato de rede do backend, não
 * código nosso -- renomear aqui criaria duas verdades para o mesmo dado. Os
 * preços chegam sempre em **gwei**: o banco guarda wei (unidade do protocolo),
 * e a conversão é feita em SQL para o número já chegar pronto.
 */

// --- estado do sistema -----------------------------------------------------

export type Saude = {
  status: "ok" | "degradado";
  blocos: number;
  ultimo_bloco_em: string | null;
  /** Minutos desde o último bloco gravado. Sobe quando a ingestão para. */
  defasagem_minutos: number | null;
  ingestao: "ativa" | "desligada";
  solver: "ok" | "inalcancavel";
  assinantes_sse: number;
};

// --- séries ----------------------------------------------------------------

export type PontoSerie = {
  momento: string;
  media_gwei: number;
  mediana_gwei: number;
  minimo_gwei: number;
  maximo_gwei: number;
  base_fee_media_gwei: number;
  /** 0 a 1. Quanto do gas_limit do bloco foi de fato usado. */
  gas_used_ratio_medio: number;
  blocos: number;
};

export type SerieRecente = {
  minutos: number;
  pontos: number;
  serie: PontoSerie[];
};

export type SerieCalendario = {
  dias: number;
  pontos: number;
  serie: PontoSerie[];
};

// --- estatísticas do dia ---------------------------------------------------

export type EstatisticasDia = {
  desde: string;
  blocos: number;
  media_gwei: number | null;
  mediana_gwei: number | null;
  /**
   * Faixa de preço mais recorrente do dia.
   *
   * Preço de gas é contínuo, então a moda no sentido estrito não existe: quase
   * todo bloco tem um valor distinto. O backend agrupa em 40 faixas entre o
   * mínimo e o máximo do dia e devolve o centro da mais populosa.
   */
  moda_gwei: number | null;
  minimo_gwei: number | null;
  maximo_gwei: number | null;
  congestionamento_medio: number | null;

  /** Cotação usada na conversão. `null` quando nenhuma fonte respondeu. */
  usd_por_eth: number | null;
  cotacao_em: string | null;
  /** Gas de uma transferência simples de ETH: 21.000. */
  gas_referencia: number;
  /**
   * Quanto custa UMA transferência simples ao preço mediano do dia.
   *
   * gwei é preço por unidade de gas, não um valor -- para virar dinheiro é
   * preciso multiplicar pelo gas consumido. Este campo já faz isso, usando a
   * transação de referência.
   */
  custo_referencia_usd: number | null;
};

export type Cotacao = {
  usd_por_eth: number;
  fonte: string;
  em: string;
};

// --- evento do stream (SSE) ------------------------------------------------

export type EventoBloco = {
  momento: string;
  block_number: number;
  preco_gwei: number;
  base_fee_gwei: number;
  gas_used_ratio: number;
};

// --- otimizador ------------------------------------------------------------

export type PedidoOtimizacao = {
  n_transacoes: number;
  /** Truncado para baixo em janelas de 1h: 5,5h vira 5 janelas, nunca 6. */
  horas_ate_deadline: number;
  /** Informe este OU `transacao`. */
  gas_used?: number;
  /** Alternativa ao gas_used: o backend estima via eth_estimateGas. */
  transacao?: { to: string; from?: string; data?: string; value?: string };
  horas_historico?: number;
};

export type JanelaPlano = {
  /** 0 = a hora corrente. */
  janela: number;
  /** Quantas transações executar nesta janela. Inteiro: é um MILP. */
  x: number;
  custo_i_gwei: number;
  custo_janela_gwei: number;
};

export type Otimizacao = {
  plano: JanelaPlano[];
  custo_total_gwei: number;
  /** Custo de executar tudo agora -- a comparação que gera a economia. */
  custo_baseline_t0_gwei: number;
  /**
   * Pode ser NEGATIVA, e isso não é erro: quando a hora atual já é a mais
   * barata prevista, o teto de risco obriga a espalhar para janelas piores.
   * É o modelo dizendo "execute agora".
   */
  economia_pct: number;
  teto_por_janela: number;
  n_janelas: number;
  /** Presente quando o histórico está abaixo das 672h recomendadas. */
  aviso: string | null;
  historico_horas: number;
  historico_de: string;
  historico_ate: string;

  /** Conversão para dólar. `null` quando a cotação não pôde ser obtida. */
  usd_por_eth: number | null;
  custo_total_usd: number | null;
  custo_baseline_t0_usd: number | null;
  /** Negativo quando executar agora já era o melhor. Ver `economia_pct`. */
  economia_usd: number | null;
};
