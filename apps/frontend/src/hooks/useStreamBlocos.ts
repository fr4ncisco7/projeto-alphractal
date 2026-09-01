import { useEffect, useRef, useState } from "react";
import { urlDaApi, usingMockBackend } from "../lib/api";
import { endpoints } from "../lib/endpoints";
import { precoSimuladoEm } from "../lib/mockBackend";
import type { EventoBloco } from "../types";

/**
 * Assina o `/stream` do backend e entrega cada bloco novo.
 *
 * Usa `EventSource`, e não WebSocket, porque o tráfego é unidirecional: o
 * servidor manda, o painel escuta. De quebra, o EventSource reconecta sozinho
 * quando a conexão cai -- com WebSocket a reconexão seria código nosso.
 *
 * A conexão é UMA por aba, e o backend mantém UMA assinatura com o nó Ethereum
 * para todos os clientes. É por isso que a ligação com o nó mora no backend: se
 * cada navegador conectasse direto, seriam N assinaturas na mesma chave de RPC
 * (estourando o rate limit), e a chave ficaria exposta no código do frontend.
 *
 * Sem `VITE_API_URL` não há backend para ouvir, então simulamos um bloco a cada
 * 12 s -- o mesmo ritmo da rede. Assim a interface pode ser demonstrada sem
 * Docker, com o gráfico se movendo de verdade.
 */
export function useStreamBlocos() {
  const [ultimo, setUltimo] = useState<EventoBloco | null>(null);
  // Inicializado a partir do modo: no mock a 'conexão' existe desde o primeiro
  // render, então não há por que abrir com false e corrigir dentro do efeito --
  // isso dispararia um render em cascata e é o que o lint aponta.
  const [conectado, setConectado] = useState(usingMockBackend);
  const [recebidos, setRecebidos] = useState(0);

  // O bloco simulado precisa avançar; guardado em ref para não recriar o
  // intervalo a cada emissão.
  const proximoBloco = useRef(25_880_000);

  useEffect(() => {
    if (usingMockBackend) {
      const timer = setInterval(() => {
        const agora = new Date();
        const preco = precoSimuladoEm(agora);
        proximoBloco.current += 1;
        setUltimo({
          momento: agora.toISOString(),
          block_number: proximoBloco.current,
          preco_gwei: preco,
          base_fee_gwei: preco * 0.82,
          gas_used_ratio: 0.3 + Math.random() * 0.4,
        });
        setRecebidos((n) => n + 1);
      }, 12_000);
      return () => {
        clearInterval(timer);
        setConectado(false);
      };
    }

    const fonte = new EventSource(urlDaApi(endpoints.stream));

    fonte.onopen = () => setConectado(true);

    fonte.onmessage = (evento) => {
      try {
        setUltimo(JSON.parse(evento.data) as EventoBloco);
        setRecebidos((n) => n + 1);
      } catch {
        // Linha malformada não deve derrubar a assinatura: o próximo bloco
        // chega em ~12 s de qualquer forma.
      }
    };

    // O EventSource já tenta reconectar sozinho; só refletimos o estado para a
    // interface poder avisar que a conexão caiu.
    fonte.onerror = () => setConectado(false);

    return () => fonte.close();
  }, []);

  return { ultimo, conectado, recebidos };
}
