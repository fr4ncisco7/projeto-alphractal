/**
 * Formatação compartilhada pelas telas.
 *
 * Gas em gwei varia por ordens de grandeza -- a mainnet passou de 0,06 gwei
 * numa madrugada calma a dezenas de gwei num pico de demanda. Um número fixo de
 * casas decimais falha nos dois extremos: "0,06" vira "0,1" e perde a
 * informação, enquanto "45,2340" polui a tela. Por isso a precisão é escolhida
 * a partir da magnitude do próprio valor.
 */

export function gwei(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return "—";
  // Zero não tem magnitude para a regra abaixo interpretar, e caía no ramo mais
  // preciso: "0,000000" em vez de "0,00".
  if (valor === 0) return "0,00";
  const casas = valor >= 100 ? 0 : valor >= 10 ? 1 : valor >= 1 ? 2 : valor >= 0.01 ? 4 : 6;
  return valor.toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

/**
 * Dólar, com precisão adaptativa pelo mesmo motivo do gwei.
 *
 * O custo de uma transferência simples hoje é US$ 0,0046 -- com duas casas
 * viraria "US$ 0,00" e a informação sumiria. Já o custo de um lote de 500
 * transações passa de US$ 20, onde seis casas seriam ruído. Abaixo de um
 * centavo mostramos mais casas; a partir daí, as duas de sempre.
 */
export function usd(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return "—";
  // Ver `gwei`: zero saía como "US$ 0,0000000". Aparecia de verdade na tela do
  // otimizador, na economia exatamente nula da trava de dominância.
  if (valor === 0) return usdFixo(0, 2);
  const abs = Math.abs(valor);
  const casas = abs >= 1 ? 2 : abs >= 0.01 ? 3 : abs >= 0.0001 ? 5 : 7;
  return valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

/**
 * Casas decimais para uma COLUNA de valores comparáveis.
 *
 * A precisão adaptativa de `usd()` é certa num cartão isolado e errada numa
 * lista: "US$ 0,017" ao lado de "US$ 0,00682" e "US$ 0,043" deixa a coluna
 * irregular e destrói a comparação visual, que é justamente para o que a lista
 * existe. Aqui a precisão sai do MENOR valor da coluna e vale para todos, para
 * as casas alinharem.
 */
export function casasParaColuna(valores: number[]): number {
  const positivos = valores.filter((v) => Number.isFinite(v) && v > 0);
  if (positivos.length === 0) return 2;
  const minimo = Math.min(...positivos);
  return minimo >= 1 ? 2 : minimo >= 0.01 ? 3 : minimo >= 0.0001 ? 4 : 6;
}

/** Dólar com casas fixas -- use com `casasParaColuna` em listas. */
export function usdFixo(valor: number | null | undefined, casas: number): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return "—";
  return valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

export function percentual(valor: number | null | undefined, casas = 1): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return "—";
  return `${valor.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
}

export function horaCurta(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function dataHora(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

/** "há 3 min" -- para deixar claro quando o dado está velho. */
export function desde(iso: string | null | undefined): string {
  if (!iso) return "—";
  const minutos = (Date.now() - new Date(iso).getTime()) / 60000;
  if (minutos < 1) return "agora";
  if (minutos < 60) return `há ${Math.round(minutos)} min`;
  const horas = minutos / 60;
  if (horas < 24) return `há ${Math.round(horas)} h`;
  return `há ${Math.round(horas / 24)} d`;
}
