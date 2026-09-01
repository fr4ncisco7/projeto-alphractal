import { AreaSeries, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef } from "react";
import type { EventoBloco, PontoSerie } from "../types";
import "./ui.css";

/**
 * Gráfico de gas em tempo real.
 *
 * lightweight-charts em vez de uma biblioteca genérica: ele desenha em canvas e
 * foi feito para séries financeiras com streaming, então atualizar o último
 * ponto a cada bloco não re-renderiza a série inteira. Com SVG, milhares de
 * pontos e uma atualização a cada 12 s pesariam.
 *
 * O histórico vem do /gas/recente; os pontos novos vêm do /stream. O componente
 * junta os dois: `update()` do lightweight-charts substitui o ponto se o
 * timestamp for igual ao último, e adiciona se for maior -- que é exatamente o
 * comportamento desejado, já que vários blocos caem no mesmo minuto.
 */

type Props = {
  historico: PontoSerie[];
  ultimoBloco: EventoBloco | null;
};

export function GraficoAoVivo({ historico, ultimoBloco }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const grafico = useRef<IChartApi | null>(null);
  const serie = useRef<ISeriesApi<"Area"> | null>(null);

  /** Minuto do último ponto desenhado, para agregar os blocos que chegam. */
  const ultimoMinuto = useRef<number>(0);

  // Criação do gráfico: uma vez só. Recriar a cada render perderia o zoom e o
  // deslocamento que o usuário tiver feito.
  useEffect(() => {
    if (!container.current) return;

    const chart = createChart(container.current, {
      layout: {
        background: { color: "transparent" },
        textColor: "#8698b0",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(150, 185, 235, 0.06)" },
        horzLines: { color: "rgba(150, 185, 235, 0.06)" },
      },
      rightPriceScale: { borderColor: "rgba(150, 185, 235, 0.14)" },
      timeScale: {
        borderColor: "rgba(150, 185, 235, 0.14)",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: { mode: 1 },
      height: 320,
    });

    const area = chart.addSeries(AreaSeries, {
      lineColor: "#2f7cf6",
      topColor: "rgba(47, 124, 246, 0.28)",
      bottomColor: "rgba(47, 124, 246, 0.02)",
      lineWidth: 2,
      priceFormat: {
        type: "price",
        // Gas hoje vive na casa dos centésimos de gwei; 4 casas é o mínimo
        // para o eixo não virar uma coluna de zeros iguais.
        precision: 4,
        minMove: 0.0001,
      },
    });

    grafico.current = chart;
    serie.current = area;

    // O gráfico não conhece o tamanho do painel: sem observar o redimensionamento
    // ele fica com a largura do primeiro render e estoura ou sobra.
    const observador = new ResizeObserver(([entrada]) => {
      chart.applyOptions({ width: entrada.contentRect.width });
    });
    observador.observe(container.current);

    return () => {
      observador.disconnect();
      chart.remove();
      grafico.current = null;
      serie.current = null;
    };
  }, []);

  // Histórico: substitui a série inteira quando chega ou muda.
  useEffect(() => {
    if (!serie.current || historico.length === 0) return;

    const pontos = historico.map((p) => ({
      time: (Math.floor(new Date(p.momento).getTime() / 1000)) as UTCTimestamp,
      value: p.media_gwei,
    }));

    serie.current.setData(pontos);
    ultimoMinuto.current = pontos[pontos.length - 1].time as number;
    grafico.current?.timeScale().fitContent();
  }, [historico]);

  // Bloco novo do stream: atualiza o ponto do minuto corrente.
  useEffect(() => {
    if (!serie.current || !ultimoBloco) return;

    // Alinha ao minuto, para casar com os baldes do /gas/recente.
    const minuto = Math.floor(new Date(ultimoBloco.momento).getTime() / 60000) * 60;
    if (minuto < ultimoMinuto.current) return;   // bloco atrasado: ignora

    serie.current.update({
      time: minuto as UTCTimestamp,
      value: ultimoBloco.preco_gwei,
    });
    ultimoMinuto.current = minuto;
  }, [ultimoBloco]);

  return <div className="grafico" ref={container} />;
}
