# Como Rodar o Projeto

Guia completo para subir o Alphractal Fees Monitor localmente: o que cada peça faz,
como verificar que está funcionando, e o que fazer quando não está.

---

# 1. O que sobe

O projeto são **três serviços** orquestrados por `docker compose`. Eles conversam por
uma rede interna que o compose cria, onde cada serviço é alcançável pelo próprio nome.

| Serviço | Imagem | Porta no host | O que faz |
| --- | --- | --- | --- |
| `db` | `timescale/timescaledb:latest-pg16` | `5433` | Guarda um registro por bloco (~12s) e mantém as agregações de 1min e 1h |
| `solver-python` | build de `apps/solver` | `8000` | Estima o custo futuro do gas e resolve o MILP que distribui as transações |
| `backend-node` | build de `apps/backend-node` | `3000` | Ingere blocos do Ethereum, expõe a API e orquestra o solver |

O **frontend não sobe pelo compose** — está sendo feito em paralelo e roda fora, em dev.

## Por que a porta do banco é 5433

Dentro da rede do compose o Postgres continua na 5432 padrão. O `5433` é só o número
pelo qual **a sua máquina** o alcança. Isso existe porque muita gente tem um PostgreSQL
instalado nativamente ocupando a 5432, e o conflito impediria o container de subir.

Consequência prática: dentro dos containers a string de conexão usa `db:5432`; do seu
terminal, `localhost:5433`.

---

# 2. Pré-requisitos

- **Docker** com o plugin `compose` (v2). Confira com `docker compose version`
- Nada mais. Não é preciso ter Node, Python, scipy ou psql na máquina — tudo roda
  dentro dos containers, inclusive os testes

---

# 3. Subir

```bash
cp .env.example .env      # só na primeira vez
docker compose up --build
```

O `--build` só é necessário na primeira vez ou quando um `Dockerfile` /
`requirements.txt` / `package.json` mudar. Nos demais dias, `docker compose up` basta.

Deixe esse terminal aberto: é onde os logs aparecem. Para rodar em segundo plano use
`docker compose up -d` e acompanhe com `docker compose logs -f`.

## O que acontece nessa ordem

1. **O banco sobe primeiro.** Na *primeiríssima* vez, o volume está vazio e o Postgres
   executa tudo que estiver em `db/init/` — é assim que o schema é criado. Ele tem um
   `healthcheck` rodando `pg_isready` a cada 5s.
2. **O solver sobe em paralelo**, sem depender de ninguém.
3. **O backend espera o banco ficar `healthy`** (`depends_on: service_healthy`) e só
   então inicia. Sem isso ele tentaria conectar antes do banco aceitar conexão e
   morreria no boot.
4. Se `INGESTAO_ATIVA=true`, o backend **abre um WebSocket com o nó Ethereum** e passa
   a gravar um registro por bloco novo, a cada ~12 segundos.

## Configuração (`.env`)

| Variável | Para que serve |
| --- | --- |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Credenciais do banco. Usadas pelo container do Postgres na criação |
| `DATABASE_URL` | String de conexão que o backend usa. Aponta para `db:5432` (nome do serviço na rede interna) |
| `RPC_HTTP_URL` / `RPC_WS_URL` | O nó Ethereum. O padrão é um endpoint público sem chave |
| `INGESTAO_ATIVA` | `false` desliga a ingestão ao vivo. Útil para trabalhar sem consumir RPC |
| `UID` / `GID` | Seu usuário. Sem isso os containers rodam como root e criam arquivos que você não consegue apagar sem `sudo` |

---

# 4. O que cada serviço está fazendo

## `db` — TimescaleDB

Postgres com a extensão de séries temporais. Três coisas moram nele:

- **`bloco_gas`** — a *hypertable*. Um registro por bloco, com `base_fee`, os percentis
  de `priority_fee`, e a razão de congestionamento. O preço efetivo é uma coluna
  **gerada**, calculada pelo banco a partir das outras.
- **`gas_1min` e `gas_1h`** — *continuous aggregates*. São visões materializadas que o
  Timescale atualiza sozinho. O painel lê delas em vez de varrer milhões de blocos.
- **`serie_horaria(inicio, fim)`** — função que devolve a série horária **sem buracos**.
  Ela aplica `time_bucket_gapfill` + `interpolate`, então uma hora sem blocos vem
  preenchida por interpolação em vez de sumir. Isso importa porque o modelo sazonal do
  solver quebra com buraco.

## `solver-python` — FastAPI

Serviço **stateless**: não tem credencial de banco e não guarda estado. Recebe a série
no corpo do pedido e devolve o plano.

- `GET /health`
- `POST /optimize` — faz **as duas etapas numa chamada só**: estima o custo de cada
  hora futura (Holt-Winters + fator de dia da semana) e resolve o MILP que decide
  quantas transações executar em cada janela.

Você normalmente **não chama esse endpoint direto** — quem chama é o backend.

## `backend-node` — Express

- `GET /health` — estado do banco, da ingestão e do solver, numa resposta só
- `POST /otimizar` — lê a série do banco, chama o solver, devolve o plano
- **Ingestão ao vivo** — assina `newHeads` por WebSocket e grava cada bloco novo
- **Backfill** — comando separado, sob demanda, para preencher o passado

---

# 5. Verificar que está tudo de pé

```bash
curl -s localhost:3000/health
```

Resposta saudável:

```json
{
  "status": "ok",
  "blocos": 251101,
  "ultimo_bloco_em": "2026-08-30T18:30:27.842Z",
  "ingestao": "ativa",
  "solver": "ok"
}
```

Como ler cada campo:

| Campo | O que significa se estiver errado |
| --- | --- |
| `status: "degradado"` | O banco não respondeu. Veja `docker compose logs db` |
| `solver: "inalcancavel"` | O solver não respondeu em 2s. Veja `docker compose logs solver-python` |
| `blocos: 0` | Banco vazio — normal em instalação nova. Veja a seção 6 |
| `ingestao: "desligada"` | `INGESTAO_ATIVA=false` no `.env` |

Para checar os serviços individualmente:

```bash
curl -s localhost:8000/health                          # solver
docker compose exec db pg_isready -U alphractal        # banco
docker compose ps                                      # os três de pé?
```

---

# 6. Os dados — leia antes de rodar o seed

O otimizador precisa de **no mínimo 48h** de histórico horário (são dois ciclos da
sazonalidade de 24h, o mínimo para o modelo sazonal existir). Abaixo disso o
`/otimizar` responde **503**, e isso é o comportamento correto, não um defeito.

Você tem dois caminhos para conseguir esse histórico.

## Caminho A — dado real, do Ethereum

```bash
docker compose exec backend-node npm run backfill -- 24    # horas
```

> **Limite importante.** O endpoint RPC público, sem chave, só entrega **~3,4h** de
> histórico retroativo — além disso o nó recusa como "requisição de arquivo". Ou seja,
> **com o RPC padrão você nunca chega nas 48h por backfill.** As opções são configurar
> `RPC_HTTP_URL`/`RPC_WS_URL` com uma chave Alchemy ou Infura, ou deixar a ingestão ao
> vivo acumulando (~24h de histórico por dia rodando).

## Caminho B — dado sintético, para desenvolver hoje

Gera 5 semanas com sazonalidade de hora do dia, desconto de fim de semana e um buraco
proposital de 3h (para exercitar o gapfill).

> ⚠️ **O seed começa com `TRUNCATE bloco_gas`.** Ele **apaga todo o dado real** que
> você tiver capturado. E dado real de gas é irrecuperável: o RPC público só devolve as
> últimas 3,4h, então o que foi capturado ontem não volta.

Antes de rodar, se houver dado real que você quer manter:

```bash
docker compose exec -T db psql -U alphractal -d fees_monitor \
  -c "\copy (SELECT momento, block_number, base_fee_wei, priority_fee_p25_wei, priority_fee_p50_wei, priority_fee_p75_wei, gas_used_ratio, gas_used, gas_limit FROM bloco_gas ORDER BY momento) TO STDOUT WITH CSV" \
  > backup_blocos.csv
```

> Note o `SELECT` explícito. Um `\copy bloco_gas TO STDOUT` direto **não funciona** em
> hypertable: o Timescale devolve um aviso e um **arquivo vazio, sem erro** — um backup
> ingênuo dá falso positivo.

```bash
./scripts/semear.sh
```

O script faz as duas travas que o `.sql` sozinho não tem como fazer: pede confirmação se
houver dado a perder, e **desliga a ingestão ao vivo** antes de semear.

> **Por que isso importa.** As duas fontes produzem cerca de **300 blocos por hora cada**
> (um bloco a cada 12s). Depois de uma hora rodando lado a lado, o balde da hora corrente
> fica meio a meio, e seu preço médio vira uma média entre ~12 gwei do sintético e ~1,3 gwei
> do real. É justamente o balde mais recente o que mais pesa no Holt-Winters, então a
> previsão sai errada sem nada quebrar visivelmente. Medido: 4 blocos reais entre 204
> sintéticos após 45 segundos.

Para voltar a acumular dado real depois, comece de um banco limpo — não por cima do seed:

```bash
./scripts/reset-db.sh && docker compose up -d
```

Para restaurar o backup depois:

```bash
docker compose exec -T db psql -U alphractal -d fees_monitor \
  -c "TRUNCATE bloco_gas;" \
  -c "\copy bloco_gas (momento, block_number, base_fee_wei, priority_fee_p25_wei, priority_fee_p50_wei, priority_fee_p75_wei, gas_used_ratio, gas_used, gas_limit) FROM STDIN WITH CSV" \
  < backup_blocos.csv
```

---

# 7. Testar o otimizador

```bash
curl -s -X POST localhost:3000/otimizar \
  -H 'Content-Type: application/json' \
  -d '{"n_transacoes":50,"horas_ate_deadline":24,"gas_used":21000}'
```

Resposta real, com as 5 semanas do seed:

```
historico : 672h  2026-08-02T18:00 -> 2026-08-30T17:00
teto      : 15 transações por janela    janelas: 24
  janela  2h:  5 tx  a 11.383 gwei/gas
  janela  3h: 15 tx  a 10.643 gwei/gas
  janela  4h: 15 tx  a 10.099 gwei/gas
  janela  5h: 15 tx  a  9.715 gwei/gas
economia  : 22.75%   (contra executar as 50 agora)
```

## Como ler esse plano

- **Ele não concentra tudo na hora mais barata.** O `teto` de 15 (30% de 50) é uma
  proteção deliberada: se a previsão errar, ter posto tudo numa janela só dobraria o
  prejuízo. O teto foi calibrado por simulação Monte Carlo.
- **As janelas escolhidas são as da madrugada**, onde o modelo prevê gas mais barato.
- **`economia_pct` compara com executar tudo agora**, em t=0. É o comportamento mais
  realista de quem não pensa em *timing*.
- **`x` é inteiro.** É um MILP, não uma otimização contínua — não faz sentido executar
  2,7 transações.

## Parâmetros

| Campo | Obrigatório | Observação |
| --- | --- | --- |
| `n_transacoes` | sim | Inteiro ≥ 1 |
| `horas_ate_deadline` | sim | **Truncado para baixo**: 5,5h vira 5 janelas, nunca 6 — para jamais recomendar execução depois do prazo |
| `gas_used` | sim* | Inteiro ≥ 1 |
| `transacao` | sim* | Alternativa ao `gas_used`: `{"to": "0x..."}` e o backend estima via `eth_estimateGas` |
| `horas_historico` | não | Padrão 672 (4 semanas) |

\* Um dos dois é obrigatório.

## Os erros e o que significam

| Status | Quando | O que fazer |
| --- | --- | --- |
| `422` | Entrada inválida | A mensagem diz qual campo |
| `503` histórico insuficiente | Menos de 48h no banco | Seção 6 — o corpo traz um campo `como_resolver` |
| `503` solver inalcançável | Container do solver fora do ar | `docker compose logs solver-python` |

---

# 8. Testes automatizados

## Solver — 99 testes

Rodam dentro de um container, então não é preciso ter Python nem scipy instalados:

```bash
./scripts/testar-solver.sh              # suíte inteira, ~2s
./scripts/testar-solver.sh -k teto      # argumentos passam direto pro pytest
```

Cobrem o MILP comparado com força bruta, o estimador (inclusive um teste de regressão
para um bug que já custou 51% de precisão), a trava de dominância e o contrato HTTP.

## Backend Node — 42 testes

```bash
./scripts/testar-backend.sh             # 39 testes, ~0,5s, sem infraestrutura
./scripts/testar-backend.sh --db        # + 3 de integração, exige a stack de pé
./scripts/testar-backend.sh -t defasagem  # filtra pelo nome
```

Sem `--db` nada externo é tocado: banco, solver, nó RPC e cotação são substituídos.
Cobrem o barramento de eventos (o fan-out de uma assinatura para N conexões SSE), a
cotação (cache de 60 s, fallback Alchemy→CoinGecko, retenção do último valor) e a camada
HTTP (CORS, os 422 de validação, a trava de defasagem, os 503 de infraestrutura).

Com `--db` entram os testes que só dado real exercita — o principal sendo o invariante da
moda por histograma, que já devolveu um valor **acima do máximo do dia** numa versão
anterior. O script pergunta a porta ao compose em vez de assumir 5432: neste projeto o
banco é publicado em 5433, e bater na 5432 acerta um Postgres da sua máquina e falha com
"password authentication failed", que parece credencial errada e não é.

## Backtest do otimizador

```bash
./scripts/backtest.sh                                    # tabela completa
./scripts/backtest.sh --tetos 3 5 8 10 15 --horizontes 24  # varredura de teto
./scripts/backtest.sh --minimo-agregado -2.0             # trava de regressão (CI)
```

Roda sobre um corpus congelado em `apps/solver/tests/dados/mainnet_1h.csv` — não fala com
o banco. Resultado e leitura em [`backtest-otimizador.md`](backtest-otimizador.md).

## CI

`.github/workflows/ci.yml` roda os quatro em push para `main`/`develop` e em pull request:
solver, backtest com trava, backend (tsc + vitest + build) e frontend (tsc + build).

O `tsc --noEmit` é o passo que mais paga: `npm run dev` usa tsx, que **não** checa tipos,
então um erro de tipagem só aparecia quando alguém rodava o build à mão.

---

# 9. Comandos do dia a dia

```bash
docker compose up -d                    # sobe em segundo plano
docker compose logs -f backend-node     # acompanha um serviço
docker compose ps                       # o que está de pé
docker compose down                     # derruba (o dado do banco fica)
docker compose down -v                  # derruba E APAGA o banco
docker compose restart solver-python    # reinicia um serviço
```

## Quando mudar o schema

O Postgres só roda `db/init/` **quando o volume está vazio**. Editar o
`01_schema.sql` com o banco já criado não tem efeito nenhum. Para aplicar:

```bash
./scripts/reset-db.sh      # pede confirmação, destrói o volume e recria
```

Isso apaga todo o dado. É aceitável enquanto não houver dado que não dá para perder;
quando houver, o caminho é trocar por *migrations* versionadas.

## Quando mudar o código

- **`apps/backend-node/src/`** e **`apps/solver/`** são montados como volume: salvar o
  arquivo já recarrega o serviço. Não precisa rebuildar.
- **`Dockerfile`, `package.json`, `requirements.txt`** exigem
  `docker compose up --build`.

---
# 10. Problemas conhecidos

## Dois Docker instalados ao mesmo tempo

Este é de longe o mais destrutivo, porque produz **dois sintomas que parecem não ter relação nenhuma** e mandam você para o diagnóstico errado.

**Sintoma A — os containers não se enxergam.** As portas publicadas funcionam (`curl localhost:8000/health` responde), mas um container não alcança o outro. O `/health` do backend trava, ou retorna `solver: "inalcancavel"`.

**Sintoma B — o Docker não consegue parar os próprios containers.** `docker stop`, `docker rm -f` e `docker compose up` falham com `cannot stop container: ... permission denied`, mesmo com o daemon rodando e mesmo depois de reiniciar a máquina.

**Causa.** Duas instalações do Docker rodando simultaneamente: uma por snap (`snap.docker.dockerd.service`) e outra por apt (`docker.service`). A do snap roda confinada por AppArmor e, nesse estado, não consegue nem sinalizar os processos dos containers nem instalar as regras de iptables das bridges que o compose cria.

### Por que o sintoma A engana

A pista que parece contraditória — porta publicada funciona, container↔container não — tem explicação exata, e entendê-la evita perder horas culpando o firewall:

- **Container ↔ container** é tráfego *roteado*. Passa pela chain `FORWARD` do iptables, onde a política padrão do Docker é `DROP`. O Docker deveria adicionar regras de `ACCEPT` para cada bridge que cria; confinado, ele não adiciona. O pacote não casa com nada e morre.
- **Porta publicada** não passa por ali. Com `EnableUserlandProxy` ligado, quem atende é o `docker-proxy`, um processo no host: a conexão é local, nunca é roteada, e a `FORWARD` nem entra na história.

Ou seja, `-P FORWARD DROP` **é o comportamento normal do Docker** — não é o ufw. O defeito é a ausência das regras da bridge, não a política.

### Diagnóstico

O host normalmente não deixa você ler as regras sem `sudo`, mas um container privilegiado resolve:

```bash
docker run --rm --net=host --privileged alpine sh -c \
  'apk add --no-cache iptables >/dev/null 2>&1; iptables -S DOCKER-FORWARD; iptables -S DOCKER-CT'
```

Compare com a bridge do projeto — `docker network ls` mostra o ID, e o nome da interface é `br-` mais os 12 primeiros caracteres dele. O contraste é direto:

```
QUEBRADO — só docker0, a bridge do projeto não aparece
  -A DOCKER-FORWARD -i docker0 -j ACCEPT
  -A DOCKER-CT      -o docker0 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT

SAUDÁVEL — a bridge do projeto tem as mesmas regras
  -A DOCKER-FORWARD -i docker0          -j ACCEPT
  -A DOCKER-FORWARD -i br-413a4274c6de  -j ACCEPT
  -A DOCKER-CT      -o docker0          -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
  -A DOCKER-CT      -o br-413a4274c6de  -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
```

Se as regras mencionam **só `docker0`** e nunca a bridge `br-*`, é isto.

Para confirmar pela outra ponta, procure as negações do AppArmor:

```bash
docker run --rm --privileged alpine sh -c 'dmesg | grep -i "apparmor.*DENIED" | tail -5'
```

A linha que fecha o caso tem esta cara — repare no `peer`:

```
apparmor="DENIED" operation="signal" profile="docker-default"
comm="dockerd" signal=kill peer="snap.docker.dockerd"
```

E para ver as duas instalações lado a lado:

```bash
snap list | grep docker
systemctl list-units --type=service --all | grep -i docker
docker info --format '{{.ServerVersion}} | {{.DockerRootDir}}'
```

Um cliente e um servidor com **versões diferentes** (`docker version`) é o indício mais barato de que há duas instalações.

### Correção

```bash
sudo snap stop docker --disable
```

Depois disso o socket precisa ser recriado — veja o problema seguinte, que aparece imediatamente.

> **Os dois daemons têm armazenamentos separados.** O snap guarda tudo em `/var/snap/docker/common/var-lib-docker`; o do apt, em `/var/lib/docker`. Ao trocar, o daemon que assume começa **vazio**: as imagens são reconstruídas e os volumes existentes somem da vista (continuam em disco, no caminho do snap). Para este projeto isso custa alguns minutos de build e um `db/seed` — nada insubstituível, mas faça backup antes se houver dado real capturado (seção 06).

## O socket some depois de desligar o snap

**Sintoma.** `docker` responde `dial unix /var/run/docker.sock: connect: no such file or directory`, embora `systemctl is-active docker` diga `active` e o log do daemon diga `API listen on /run/docker.sock`.

**Causa.** O `docker.service` sobe com `-H fd://`, ou seja, quem cria o arquivo do socket é a unit `docker.socket`, não o daemon. Ao ser desligado, o snap apaga `/run/docker.sock` — e o `docker.socket` continua marcado como `active (listening)`, segurando um descritor que já não tem caminho no sistema de arquivos. Reiniciar só o `docker.service` não recria nada.

**Correção.** Parar os dois juntos e subir de novo:

```bash
sudo systemctl stop docker.socket docker.service
sudo systemctl start docker.socket
sudo systemctl start docker.service
ls -la /run/docker.sock
```

> **Não encadeie com `&&`.** Um `systemctl stop` de unit já parada retorna código de erro, e o `&&` cancela o resto **sem imprimir nada** — o terminal volta limpo e parece que funcionou. Use linhas separadas, ou `;`, e termine com o `ls` para ver o resultado com os próprios olhos.

### Verificar que resolveu

```bash
docker network create teste-rede
docker run -d --name alvo --network teste-rede alpine sh -c 'nc -lk -p 9000 -e echo PONG'
docker run --rm --network teste-rede alpine sh -c 'nc -z -w 3 alvo 9000 && echo OK || echo QUEBRADO'
docker rm -f alvo && docker network rm teste-rede
```

O `docker rm -f` no fim testa o sintoma B de graça: se ele funcionar, os dois problemas se foram.

## Porta 5433 já em uso

Outro Postgres ocupando. Mude o lado esquerdo do mapeamento em `docker-compose.yml`
(`"5434:5432"`) — o lado direito é interno e não deve mudar.

## `__pycache__` ou `node_modules` como root

Faltou `UID`/`GID` no `.env`. Descubra os seus com `id -u && id -g`, ponha no arquivo e
suba de novo.
