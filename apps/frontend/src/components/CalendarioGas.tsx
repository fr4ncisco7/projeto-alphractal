import * as echarts from "echarts/core";
import { HeatmapChart } from "echarts/charts";
import { GridComponent, TooltipComponent, VisualMapComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useMemo, useRef } from "react";
import { gwei, usd } from "../lib/formato";
import type { PontoSerie } from "../types";
import "./ui.css";

/**
 * Heatmap dia × hora do custo de gas.
 *
 * ECharts, e não lightweight-charts, porque heatmap de calendário simplesmente
 * não existe no segundo -- ele é especializado em séries temporais financeiras.
 * São duas bibliotecas de gráfico no projeto por essa razão, não por
 * inconsistência.
 *
 * O import é modular (`echarts/core` + só os módulos usados) em vez de
 * `import * as echarts from "echarts"`: o pacote completo passa de 1 MB, e aqui
 * usamos heatmap, grid, tooltip e visualMap.
 */

echarts.use([HeatmapChart, GridComponent, TooltipComponent, VisualMapComponent, CanvasRenderer]);

type Props = {
  serie: PontoSerie[];
  /** Cotação para exibir em dólar. `null` mantém a escala em gwei. */
  usdPorEth?: number | null;
  /** Gas da transação de referência, para gwei virar dinheiro. */
  gasReferencia?: number;
};

export function CalendarioGas({ serie, usdPorEth = null, gasReferencia = 21_000 }: Props) {
  /**
   * Converter os VALORES, e não só o texto do tooltip.
   *
   * A conversão gwei -> dólar é uma multiplicação por constante, então a escala
   * de cor sai idêntica -- as mesmas células ficam nas mesmas cores. A vantagem
   * é que a legenda e o tooltip passam a falar em dinheiro sem nenhum código de
   * formatação especial no meio do gráfico.
   *
   * Sem cotação, tudo permanece em gwei: melhor uma unidade técnica que um
   * campo vazio.
   */
  const emDolar = usdPorEth !== null && Number.isFinite(usdPorEth);
  const converter = (g: number) => (emDolar ? (g * gasReferencia / 1e9) * (usdPorEth as number) : g);
  const formatar = (v: number) => (emDolar ? usd(v) : `${gwei(v)} gwei`);

  const container = useRef<HTMLDivElement>(null);
  const grafico = useRef<echarts.ECharts | null>(null);

  const { dados, dias, minimo, maximo, teto } = useMemo(() => {
    // Mapa "dia -> índice", preservando a ordem cronológica de chegada.
    const ordemDias: string[] = [];
    const pontos: [number, number, number][] = [];
    const valores: number[] = [];

    for (const p of serie) {
      const data = new Date(p.momento);
      const rotulo = data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
      let y = ordemDias.indexOf(rotulo);
      if (y === -1) {
        ordemDias.push(rotulo);
        y = ordemDias.length - 1;
      }
      const valor = converter(p.media_gwei);
      pontos.push([data.getHours(), y, valor]);
      valores.push(valor);
    }

    /**
     * A escala de cor é cortada nos percentis 5 e 95, não no mínimo e no
     * máximo absolutos.
     *
     * Gas tem cauda pesada: um único pico de congestionamento pode ser 10x a
     * mediana. Com escala linear entre mínimo e máximo, esse pico consome toda
     * a faixa de cor sozinho e as outras 160 células viram o mesmo tom escuro
     * -- o heatmap fica bonito e não informa nada. Cortando nos percentis, a
     * variação do dia a dia recupera a faixa de cor, e os valores acima do
     * corte ficam todos na cor do topo (o ECharts satura), o que é a leitura
     * correta: "isto foi caro".
     *
     * O valor exato de qualquer célula continua no tooltip.
     */
    const ordenados = [...valores].sort((a, b) => a - b);
    const percentil = (q: number) =>
      ordenados.length === 0 ? 0 : ordenados[Math.min(ordenados.length - 1, Math.floor(ordenados.length * q))];

    return {
      dados: pontos,
      dias: ordemDias,
      minimo: percentil(0.05),
      maximo: percentil(0.95),
      teto: ordenados.length ? ordenados[ordenados.length - 1] : 0,
    };
  }, [serie, emDolar, usdPorEth, gasReferencia]);

  useEffect(() => {
    if (!container.current) return;
    const instancia = echarts.init(container.current, undefined, { renderer: "canvas" });
    grafico.current = instancia;

    const observador = new ResizeObserver(() => instancia.resize());
    observador.observe(container.current);

    return () => {
      observador.disconnect();
      instancia.dispose();
      grafico.current = null;
    };
  }, []);

  useEffect(() => {
    if (!grafico.current || dados.length === 0) return;

    grafico.current.setOption({
      tooltip: {
        backgroundColor: "rgba(9, 16, 28, 0.94)",
        borderColor: "rgba(150, 185, 235, 0.2)",
        textStyle: { color: "#f4f8ff", fontSize: 12 },
        formatter: (p: { data: [number, number, number] }) =>
          `${dias[p.data[1]]} · ${String(p.data[0]).padStart(2, "0")}h<br/><b>${formatar(p.data[2])}</b>`,
      },
      grid: { left: 48, right: 16, top: 8, bottom: 56 },
      xAxis: {
        type: "category",
        data: Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0")),
        splitArea: { show: true },
        axisLine: { lineStyle: { color: "rgba(150, 185, 235, 0.2)" } },
        axisLabel: { color: "#8698b0", fontSize: 10 },
      },
      yAxis: {
        type: "category",
        data: dias,
        splitArea: { show: true },
        axisLine: { lineStyle: { color: "rgba(150, 185, 235, 0.2)" } },
        axisLabel: { color: "#8698b0", fontSize: 10 },
      },
      visualMap: {
        min: minimo,
        max: maximo,
        calculable: false,
        orient: "horizontal",
        left: "center",
        bottom: 8,
        textStyle: { color: "#8698b0", fontSize: 10 },
        // Barato -> caro. Azul é a cor do shell; o vermelho marca o pico sem
        // depender de o usuário ler o número.
        inRange: { color: ["#0b2f7a", "#2f7cf6", "#86c6ff", "#f5c86b", "#e2796c"] },
        formatter: (v: number) => formatar(v),
      },
      series: [{
        type: "heatmap",
        data: dados,
        // Sem rótulo dentro da célula: com 24 × 7 células o número não caberia,
        // e a cor já comunica. O valor exato fica no tooltip.
        label: { show: false },
        itemStyle: { borderColor: "rgba(6, 10, 18, 0.6)", borderWidth: 1 },
        emphasis: { itemStyle: { borderColor: "#f4f8ff", borderWidth: 1 } },
      }],
    });
  }, [dados, dias, minimo, maximo]);

  return (
    <>
      <div className="calendario" ref={container} />
      <p className="calendario__nota">
        {emDolar &&
          `Custo de uma transferência simples (${gasReferencia.toLocaleString("pt-BR")} de gas) em cada hora. `}
        {teto > maximo &&
          `Escala de cor cortada em ${formatar(maximo)} (percentil 95) para a variação do dia a dia ficar visível; o pico do período foi ${formatar(teto)}.`}
      </p>
    </>
  );
}
