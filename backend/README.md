# Sistema de Ordens de Investimento — Backend

API de ordens de investimento construída em Node.js + TypeScript, com processamento assíncrono via worker e Postgres como fila de tarefas (sem Redis/RabbitMQ). Este README descreve o estado atual do backend, decisões de arquitetura e como executar localmente.

> Documento da **Parte 1** do desafio. A documentação da Parte 2 (arquitetura AWS) está em [`../ARCHITECTURE.md`](../ARCHITECTURE.md). O frontend Angular consumindo esta API está em [`../frontend/`](../frontend/).

---

## Estado atual

| Funcionalidade do desafio (Parte 1)                | Status     |
|----------------------------------------------------|------------|
| Listar ativos disponíveis com cotação atual        | Pronto     |
| Consultar posição do usuário em cada ativo         | Pronto     |
| Criar uma ordem de compra ou venda                 | Pronto     |
| Processamento assíncrono PENDING → EXECUTED        | Pronto     |
| Cenário de concorrência (validado em teste manual) | Pronto     |
| Listar ordens do usuário                           | Pronto     |
| Detalhar uma ordem específica                      | Pronto     |
| Cancelar uma ordem pendente                        | Pronto     |
| Status FAILED + retry transiente + circuit breaker | Pronto     |
| Testes automatizados de integração                 | Pronto (49 testes)|

A entrega foi construída em **vertical slices**: cada slice cobre uma funcionalidade ponta-a-ponta (rota → use case → repositório → DB). Itens fora do escopo do desafio mas mapeados como evolução estão em [Evoluções mapeadas](#evoluções-mapeadas).

---

## Stack

- **Node.js 22** + **TypeScript** (ESM, `--env-file` nativo, sem dotenv)
- **Fastify 5** (HTTP)
- **Prisma 6** + **PostgreSQL 16** (Docker)
- **Zod 4** (validação de input e env)
- **Pino** (logs estruturados)
- **tsx** (dev runtime + watch)

---

## Como executar

### Pré-requisitos

- Node.js 22 ou superior
- Docker + Docker Compose
- (Em outro terminal) o **quotation-service** do desafio rodando em `http://localhost:3001`

```bash
# Em uma pasta separada — código já fornecido pelo desafio
cd ../case-eng-dist/quotation-service
npm install
npm start
```

### Subir o backend

```bash
cd backend
cp .env.example .env   # ajuste se necessário; valores default funcionam pro setup local
npm install
docker compose up -d   # sobe Postgres na porta 5432
npx prisma migrate deploy
npx prisma db seed     # popula assets, user de teste e posições iniciais
npm run dev            # API em http://localhost:3000
```

Em **outro terminal**, suba o worker (responsável por executar ordens PENDING):

```bash
cd backend
npm run worker
```

O worker faz polling no Postgres (`SELECT FOR UPDATE SKIP LOCKED`) e processa ordens pendentes uma a uma.

### Variáveis de ambiente

| Variável                    | Default                                  | Descrição                                |
|-----------------------------|------------------------------------------|------------------------------------------|
| `PORT`                      | `3000`                                   | Porta HTTP                               |
| `DATABASE_URL`              | `postgresql://orders:orders@localhost:5432/orders` | Connection string Postgres     |
| `QUOTATION_SERVICE_URL`     | `http://localhost:3001`                  | Base URL do serviço de cotações          |
| `WORKER_POLL_INTERVAL_MS`   | `500`                                    | Intervalo do polling do worker quando fila vazia |
| `QUOTATION_TIMEOUT_MS`      | `1500`                                   | Timeout pra cada chamada ao quotation-service    |
| `QUOTATION_RETRY_ATTEMPTS`  | `3`                                      | Tentativas no `RetryingQuotationClient` (inclui a primeira) |
| `QUOTATION_RETRY_BASE_MS`   | `100`                                    | Base do backoff exponencial entre retries        |
| `QUOTATION_BREAKER_THRESHOLD` | `5`                                    | Falhas consecutivas pra abrir o breaker          |
| `QUOTATION_BREAKER_OPEN_MS` | `10000`                                  | Quanto tempo o breaker fica aberto antes de half-open |
| `LOG_LEVEL`                 | `info`                                   | `fatal\|error\|warn\|info\|debug\|trace` |

### Autenticação

Por enquanto a auth é **fake**: o middleware `requireAuth` espera um header `x-user-id` em toda rota de ordens/posições. O usuário do seed é `user-001`. Substituir por JWT está mapeado como evolução (ver [Evoluções mapeadas](#evoluções-mapeadas)).

### Testes automatizados (integração)

```bash
npm test            # roda toda a suíte uma vez
npm run test:watch  # modo watch
```

A suíte são **49 testes de integração** (Vitest) que sobem `buildServer()` em memória via `fastify.inject()` e batem em um banco Postgres dedicado de teste (`orders_test`, criado automaticamente no mesmo container). Não há mocks de repositório — toda persistência é real. O `QuotationClient` é injetado por stub (`StubQuotationClient`) para os testes serem determinísticos. Os testes rodam em série (`singleFork: true`) com `TRUNCATE` antes de cada teste.

Áreas cobertas: criação de ordem (happy/erros/auth/zod), concorrência (cenário João/ITUB4 + 10 BUYs paralelos + saldo parcial), worker (claim+execute, médias ponderadas, FOR UPDATE SKIP LOCKED com 2 workers), cancelamento (libera reserva, race com worker via mesmo lock), listagem com filtro e isolamento por usuário.

---

## Endpoints

| Método | Rota                  | Descrição                                                                                |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| GET    | `/health`             | Healthcheck                                                                              |
| GET    | `/assets`             | Lista ativos com cotação atual (consulta quotation-service; cai pra `referencePrice` em falha) |
| GET    | `/positions`          | Posições do usuário autenticado                                                          |
| POST   | `/orders`             | Cria ordem (resposta imediata com status `PENDING`; worker executa assincronamente)      |
| GET    | `/orders`             | Lista ordens do usuário (mais recentes primeiro). Filtro opcional `?status=PENDING\|EXECUTED\|FAILED\|CANCELED` |
| GET    | `/orders/:id`         | Detalha uma ordem; 404 se não existe ou pertence a outro usuário                         |
| DELETE | `/orders/:id`         | Cancela ordem PENDING e devolve a reserva; 422 se a ordem não está PENDING               |

### Exemplo: criar ordem

```bash
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -H "x-user-id: user-001" \
  -d '{"symbol":"ITUB4","side":"BUY","quantity":1}'
```

Resposta (201):

```json
{
  "data": {
    "id": "...",
    "userId": "user-001",
    "symbol": "ITUB4",
    "side": "BUY",
    "quantity": 1,
    "price": 32.7,
    "totalAmount": 32.7,
    "status": "PENDING",
    "createdAt": "...",
    "executedAt": null
  }
}
```

Status passa para `EXECUTED` quando o worker processar (em geral em milissegundos no ambiente local).

### Códigos de erro

| HTTP | `error`                  | Quando                                                                |
|------|--------------------------|------------------------------------------------------------------------|
| 400  | `invalid_request`        | Falha de validação Zod                                                 |
| 401  | `unauthorized`           | Header `x-user-id` ausente                                             |
| 404  | `asset_not_found`        | Símbolo não existe na tabela `assets`                                  |
| 404  | `order_not_found`        | Ordem inexistente, ou pertence a outro usuário (não vaza existência)   |
| 422  | `insufficient_cash`      | BUY sem saldo de caixa suficiente para reservar                        |
| 422  | `insufficient_asset`     | SELL sem quantidade suficiente para reservar                           |
| 422  | `order_not_cancelable`   | Cancelamento de ordem que já não está PENDING (EXECUTED/FAILED/CANCELED) |

---

## Estrutura do código

```
backend/
  prisma/
    schema.prisma           Modelos: Asset, User, Position, Order
    seed.ts                 Reseta estado transacional + popula seed do desafio
    migrations/
  src/
    main.ts                 Entrypoint da API HTTP
    worker.ts               Entrypoint do worker assíncrono
    lib/
      env.ts                Validação de env via Zod
      logger.ts             Pino
    http/
      server.ts             Composição de dependências (DI manual) + registro de rotas
      middleware/auth.ts    requireAuth (header x-user-id)
      routes/               assets, positions, orders
    application/            Camada de regras (sem nenhum import de Prisma)
      assets/               ListAssetsWithQuote + AssetRepository (interface)
      positions/            ListPositions + PositionRepository (interface)
      orders/               CreateOrder, ExecuteOrder, ListOrders, GetOrder, CancelOrder
                            + OrderRepository (interface)
      users/                UserRepository (interface)
      transaction/          TransactionRunner (abstração de prisma.$transaction)
    infra/
      db/                   Implementações Prisma das interfaces
      quotation/            HttpQuotationClient + interface QuotationClient
```

A camada `application/` **não importa Prisma**. A única dependência de Prisma na Application é o tipo `Prisma.TransactionClient` usado como parâmetro opaco — a abstração `TransactionRunner` empacota o `prisma.$transaction` para que use cases não conheçam o ORM.

---

## Decisões de arquitetura

### Vertical slices, hexagonal leve

Cada feature foi construída atravessando rota → use case → repositório → DB de uma vez, em vez de subir todas as camadas em paralelo. A camada `application/` define interfaces; `infra/` implementa. O server faz injeção de dependências manual (`http/server.ts`) — sem container de DI, sem decorators.

### Ciclo de vida da ordem com reserva de saldo

O fluxo segue o ciclo de vida descrito no enunciado (PENDENTE → EXECUTADA / REJEITADA), mas usa um padrão de **reserva** para isolar a fase síncrona da assíncrona:

```
POST /orders                        worker
  ┌────────────────────┐              ┌──────────────────────────┐
  │ valida asset       │              │ claim PENDING (lock)     │
  │ cota preço         │              │ consome reserva          │
  │ RESERVA saldo/qty  │ ──── DB ───▶ │ atualiza posição/cash    │
  │ cria order PENDING │              │ marca EXECUTED           │
  │ responde 201       │              └──────────────────────────┘
  └────────────────────┘
```

- **BUY**: o `POST` move `cashBalance → reservedCash` atomicamente (`UPDATE ... WHERE cashBalance >= amount`) e cria a order PENDING. A ausência de saldo retorna **422 imediatamente** — o cliente sabe na hora da criação.
- **SELL**: o `POST` move `quantity → reservedQuantity` atomicamente. Saldo insuficiente do ativo retorna 422 na hora.
- O **worker** consome a reserva e aplica o efeito definitivo (atualiza posição com média ponderada / credita cash).

A reserva tem três benefícios:
1. **Resposta imediata** — o cliente não espera o quotation-service e nem o worker.
2. **Visibilidade do saldo comprometido** — `reservedCash` separa "dinheiro disponível" de "dinheiro pendente em ordem".
3. **Concorrência tratada na origem** — o cenário do enunciado (duas SELLs sobre o mesmo saldo) falha na criação, não silenciosamente no worker.

### Worker assíncrono via Postgres como fila

O worker (`src/worker.ts`) faz polling com:

```sql
SELECT id FROM orders
WHERE status = 'PENDING'
ORDER BY "createdAt"
LIMIT 1
FOR UPDATE SKIP LOCKED
```

- `FOR UPDATE` trava a row da order escolhida até o commit.
- `SKIP LOCKED` faz workers concorrentes pegarem ordens **diferentes** sem se bloquear — escala horizontalmente sem coordenação externa.
- Não exige Redis, RabbitMQ ou SQS. Tudo persiste numa única fonte de verdade (o Postgres).

A execução acontece dentro da mesma transação que segura o lock. Erros transientes deixam a ordem `PENDING` para retry; após `MAX_EXECUTION_ATTEMPTS` tentativas, ela vai pra `FAILED` (ver [Tratamento de falhas no quotation-service](#tratamento-de-falhas-no-quotation-service)).

### Cancelamento sem race com worker

`DELETE /orders/:id` precisa coexistir com o worker, que pode estar processando a ordem no exato momento. O `CancelOrder` resolve isso da seguinte forma:

1. Abre uma transação e roda `SELECT id FROM orders WHERE id = $1 AND "userId" = $2 FOR UPDATE` — sem `SKIP LOCKED`.
2. Se a row não existe ou pertence a outro usuário, responde **404** uniformemente (não vaza existência).
3. Se outra transação (worker) está com a row travada, o `FOR UPDATE` **espera**. Quando o worker commitar com `EXECUTED`, o cancel re-lê (READ COMMITTED), vê o status novo, e responde **422 `order_not_cancelable`**.
4. Se o cancel chegou primeiro, ele segura o lock; o worker no próximo `claimNextPendingOrder` faz `SKIP LOCKED` e vai pra próxima ordem. Cancel commita com `CANCELED` e libera a reserva (`releaseReservedCash` ou `releaseReservedQuantity`).

Não há coordenação adicional — o lock de linha do Postgres + `READ COMMITTED` + `SKIP LOCKED` no worker resolvem todos os interleavings possíveis.

---

## Tratamento de concorrência

> Cenário do enunciado: *João tem 100 unidades de ITUB4. No mesmo instante, ele envia duas ordens de venda de 80 unidades cada.*

### O que deveria acontecer

Apenas uma das vendas pode prosseguir. Vender 160 quando há 100 viola a regra de saldo. O cliente da segunda chamada precisa receber uma resposta clara que indique a falha.

### O que esta implementação faz

A reserva de quantidade é feita via `UPDATE` atômico com guard:

```sql
UPDATE positions
SET quantity = quantity - 80,
    "reservedQuantity" = "reservedQuantity" + 80
WHERE "userId" = $1 AND symbol = 'ITUB4' AND quantity >= 80
```

O Postgres serializa os dois `UPDATE` na mesma row via lock de linha. Sob `READ COMMITTED` (default), a segunda transação re-avalia a cláusula `WHERE` após o commit da primeira:

1. **Tx A** acquire lock, vê `quantity = 100`, atualiza para `quantity = 20`, commit.
2. **Tx B** acquire lock, re-avalia `WHERE quantity >= 80`, vê `quantity = 20`, **não atualiza nenhuma row**.
3. `updateMany` retorna `count = 0` para Tx B → `CreateOrder` lança `InsufficientAssetError` → handler responde **HTTP 422 `insufficient_asset`**.

Validado em `test-slice4-concurrency.sh` (Teste B): a segunda SELL recebe 422 e nem sequer cria uma order no banco. A primeira segue como `PENDING`, é processada pelo worker, e o estado final é `quantity = 20`, `cashBalance` acrescido do total da venda executada.

### Trade-offs

- **Não usei `SERIALIZABLE`** porque não é necessário: o caso é resolvido por lock de linha + guard na cláusula `WHERE`, sem incorrer no custo de retries de serialization failure.
- **Reserva no `POST`, não na execução**. O preço da execução fica fixado no momento da criação. Isso simplifica o worker (não precisa re-cotar) ao custo de não capturar variação de preço entre criação e execução. Para um sistema real, eu re-cotaria no worker e usaria a reserva apenas como ceiling. Mantive a versão simples para esta entrega — re-cotação está na slice 7.
- **Sem `attempts`/dead-letter ainda**. Se a execução falha por bug (ex: invariant `consumeReservedCash`), a order fica eternamente `PENDING` até intervenção manual. A slice 7 introduz contagem de tentativas e movimentação para `REJEITADA`.

---

## Tratamento de falhas no quotation-service

O serviço de cotações é instável por design (20% falha, 5% timeout 10s, latência 50–2000ms, ±5% no preço).

### O que está implementado

- **Fallback para `referencePrice`**: o cliente HTTP (`HttpQuotationClient`) loga warning e retorna `null` quando o quotation-service falha. O use case `ListAssetsWithQuote` e o `CreateOrder` interpretam `null` como "use o `referencePrice` do banco".
- **Timeout explícito** no `HttpQuotationClient` (`QUOTATION_TIMEOUT_MS`, default 1500ms). Aborta requests que passariam dos timeouts simulados de 10s do quotation-service.
- **Retry com backoff exponencial** (`RetryingQuotationClient`): 3 tentativas (configurável) com delays 100ms→200ms→400ms. Engatado entre `HttpQuotationClient` (mais interno) e `CircuitBreakingQuotationClient`.
- **Circuit breaker** (`CircuitBreakingQuotationClient`): abre depois de 5 falhas consecutivas, fica aberto 10s, depois half-open testa 1 chamada — se sucesso fecha, se falha re-abre. Enquanto aberto, `getQuote` retorna `null` sem chamar o upstream.
- **Composição em decorators**: `Circuit(Retry(Http))`. Cada camada implementa `QuotationClient`. Composta em `infra/quotation/buildQuotationClient.ts`.
- **Re-cotação no worker**: `ExecuteOrder` cota o ativo no momento da execução. Se quotation falha (ou breaker aberto), cai para o preço gravado na criação da ordem.
- **Tolerância a slippage de 5%**:
  - **BUY**: rejeita se `quoted > agreed * 1.05`. Se `quoted < agreed`, executa ao preço cotado e devolve a diferença para `cashBalance`. Se `agreed < quoted ≤ 1.05 × agreed`, executa ao preço gravado (limit-order: cliente nunca paga mais que pediu).
  - **SELL**: rejeita se `quoted < agreed * 0.95`. Caso contrário, executa ao preço cotado (cliente recebe o preço real de mercado).
- **Status `FAILED` + caminho de rejeição**:
  - Quando o slippage ultrapassa o tolerável, `ExecuteOrder` lança `OrderRejectedError`. O worker captura, marca a ordem `FAILED` com `failureReason` e libera a reserva (cash ou quantity) atomicamente.
  - Erros transientes (qualquer `Error` que não seja `OrderRejectedError`) deixam a ordem `PENDING` para retry. O worker mantém um contador `Order.attempts` em coluna persistente. Após `MAX_EXECUTION_ATTEMPTS` (default 3) tentativas malsucedidas, a ordem vai para `FAILED` com a última mensagem de erro como reason.
  - O contador `attempts` é incrementado em uma transação separada para sobreviver ao rollback da transação principal (que falhou).

### O que ainda fica como follow-up

- **Sem dead-letter queue dedicada** — uma ordem `FAILED` não vai pra fila de inspeção; o operador precisa consultar pela tabela direto. Em produção real, exporiamos um endpoint admin `GET /orders?status=FAILED` ou enviaríamos pra um sistema externo (DataDog, Sentry).
- **Sem alerta automático** se a taxa de `FAILED` subir. Métricas + alerta em Grafana seriam o próximo passo.
- **Breaker é por-instância** (estado em memória do processo do worker). Em multi-worker, cada um tem seu próprio breaker — não há coordenação. Para a escala do desafio é aceitável; em produção real, breaker compartilhado via Redis ou similar.

---

## Premissas assumidas

- **Auth é fake** (`x-user-id` no header). O foco da entrega foi modelagem, persistência e concorrência. JWT real está mapeado como evolução.
- **Apenas um usuário** (`user-001`) no seed. Multi-usuário funcionaria sem alteração de código — basta criar mais linhas.
- **Decimal serializado como `number`** nos endpoints. Para o desafio é suficiente; em produção financeira eu manteria string e usaria uma lib decimal no cliente para evitar artefatos de float64.
- **`Decimal(18,8)` para quantidades**, `Decimal(18,4)` para preços, `Decimal(18,2)` para cash. Cobre cripto fracionária e fiat com precisão suficiente.
- **Worker single-instance localmente**. O design (`SKIP LOCKED`) suporta múltiplas réplicas, mas não foi exercitado nesta entrega.

---

## Evoluções mapeadas

Itens fora do escopo do desafio que ficam como follow-up natural:

| Tema | Escopo |
|---|---|
| Auth real | `POST /auth/login` com JWT; `requireAuth` valida assinatura ao invés de ler header |
| Observabilidade | Métricas Prometheus + alerta em taxa de `FAILED` subindo (ver seção [Tratamento de falhas](#tratamento-de-falhas-no-quotation-service)) |
| Breaker compartilhado | Estado do circuit breaker em Redis para coerência entre múltiplos workers |

---

## Sugestões ao fornecedor de cotações

Se eu pudesse pedir melhorias ao serviço de cotações para facilitar a integração:

1. **Bulk endpoint** — `GET /quotations?symbols=ITUB4,USDC,BTC` em uma única chamada. Hoje, listar a tela de ativos exige N chamadas paralelas; sob falhas de 20%, isso quase garante pelo menos uma falha por listagem. Bulk permite uma resposta parcial coerente em uma única chamada e reduz a área de superfície a falhas.
2. **Cache hint via `Cache-Control` / `ETag`** — preço de ativo não muda a cada ms. Permitir cache controlado pelo provedor (ex: max-age=2s) reduziria carga em 5x facilmente sem perda perceptível de precisão.
3. **Stream de preços (WebSocket ou SSE)** — para a tela de ativos do frontend ficar reativa sem polling, e para o worker re-cotar sem fazer call HTTP por ordem.
4. **SLA explícito de timeout no header** — se o serviço sabe que vai demorar mais que X, retornar 503 imediatamente em vez de manter a conexão aberta. Hoje os timeouts de 10s "queimam" 10 segundos do meu lado por chamada — um fail-fast me deixa cair no fallback antes.
5. **Status de saúde por símbolo** — `GET /health` é binário. Em sistemas reais, alguns símbolos podem estar degradados sem afetar outros. Um endpoint `GET /health/symbols` ajudaria a degradar parcialmente em vez de tudo-ou-nada.
6. **Idempotency keys nas chamadas** — não estritamente necessário para `GET`, mas seria útil em endpoints futuros (ex: registro de execução). Em sistemas financeiros é prática padrão. 