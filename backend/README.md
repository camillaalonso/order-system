# Backend — Sistema de Ordens

API + worker assíncrono. **Node 22 + TypeScript, Fastify 5, Prisma 6, Postgres 16.**
Documentação da Parte 2 em [`../ARCHITECTURE.md`](../ARCHITECTURE.md). Frontend em [`../frontend/`](../frontend/).

---

## Como executar

Pré-requisitos: Node 22, Docker, e o quotation-service rodando em `:3001` (ver [`../README.md`](../README.md)).

```bash
cp .env.example .env
npm install
docker compose up -d              # Postgres em :5432
npx prisma migrate deploy
npx prisma db seed
npm run dev                       # API em :3000
npm run worker                    # em outro terminal
npm test                          # 49 testes de integração
```

Auth é fake nesta entrega: header `x-user-id` em todas as rotas autenticadas (`user-001` no seed). JWT está mapeado como evolução.

Variáveis adicionais (timeouts, retries, breaker, polling do worker) em `.env.example`.

### Testes

49 testes de integração em `tests/integration/`, rodando contra um Postgres real (banco `orders_test` criado automaticamente). `QuotationClient` é injetado como stub pra ser determinístico; o resto é real (sem mock de repositório). Áreas cobertas:

- **Criação de ordem:** happy paths BUY/SELL, validação Zod, auth ausente, asset inexistente, saldo insuficiente
- **Concorrência:** cenário João/ITUB4 (2 SELLs paralelas), 10 BUYs simultâneos, BUYs onde só 5 cabem no saldo
- **Worker:** claim+execute, média ponderada em compras subsequentes, dois workers competindo por `SKIP LOCKED`
- **Slippage e falha:** BUY rejeitada por preço acima do tolerável, retry transiente até `FAILED`, devolução de reserva ao falhar
- **Cancelamento:** libera reserva, race com worker em cima da mesma row
- **Listagem:** filtro por status, isolamento entre usuários, ordenação por `createdAt`
- **Quotation decorators:** retry, breaker abrindo/fechando/half-open, timeout

### Logs

Pino com saída JSON estruturada. Níveis: `info` pro caminho feliz (worker subindo, ordem executada), `warn` pra falha esperada e tratada (quotation-service caiu, ordem rejeitada por slippage, retry transiente), `error` pra erro inesperado, `fatal` pra crash do worker. Cada log carrega contexto estruturado (`orderId`, `symbol`, `attempt`, `userId`, `breakerState`) — facilita filtrar por ordem específica ou por componente. Child loggers separam logs por componente (`HttpQuotationClient`, `worker`, etc.). Em dev, rodar com `LOG_LEVEL=debug` mostra os retries do quotation client e ticks do worker.

---

## Decisões e trade-offs

### Reserva de saldo no `POST`

Em vez de validar saldo só na hora de executar, o `POST /orders` move atomicamente `cashBalance → reservedCash` (BUY) ou `quantity → reservedQuantity` (SELL) **na mesma transação** que cria a ordem. O cliente recebe `422` na hora se faltar saldo — não vira uma ordem `PENDING` que vai falhar depois.

Custo: cancel/falha precisa lembrar de devolver a reserva. Coberto por testes (`orders.cancel.test.ts`, `slippage-and-fail.test.ts`).

### Postgres como fila (sem Redis/RabbitMQ/SQS)

O worker faz polling com `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1`. Workers concorrentes pegam ordens diferentes sem se bloquear, sem precisar de coordenação externa. Uma fonte da verdade só (o banco), menos infra pra operar.

Trade-off: polling tem latência mínima de `WORKER_POLL_INTERVAL_MS` (default 500ms) quando a fila está vazia, e o throughput é limitado pelo banco. Pra escala do desafio é mais que suficiente; pra produção real (10k ordens/s), trocaria por SQS FIFO (ver `ARCHITECTURE.md`).

### Camada `application/` não conhece Prisma

Use cases dependem de interfaces (`OrderRepository`, `PositionRepository`, `QuotationClient`, `TransactionRunner`). Implementações Prisma vivem em `infra/db/`. Permite trocar o ORM sem refatorar regra de negócio, e os testes injetam um `StubQuotationClient` em vez de mockar HTTP.

### Cancelamento concorrente com worker

`DELETE /orders/:id` faz `SELECT ... FOR UPDATE` (sem `SKIP LOCKED`). Se o worker já estava processando, o cancel espera; quando o worker commita `EXECUTED`, o cancel re-lê e responde `422 order_not_cancelable`. Se o cancel chegou primeiro, o worker pula a row no próximo `SKIP LOCKED`. Sem coordenação adicional — o lock de linha + READ COMMITTED resolvem todos os interleavings.

### O que prioritizei

Modelagem do ciclo de vida da ordem (PENDING → EXECUTED/FAILED/CANCELED), persistência consistente, concorrência tratada na origem (cenário João), e resiliência ao quotation-service (timeout + retry + breaker + slippage). Tudo coberto por testes de integração contra banco real.

### O que ficou de fora

- **JWT real** — auth fake (`x-user-id`) por header foi suficiente pra exercitar o resto.
- **Multi-usuário no seed** — só `user-001`. O código suporta N usuários, não exercitei em testes manuais.
- **Worker em múltiplas réplicas** — design suporta (`SKIP LOCKED`), mas rodei só uma instância localmente.
- **Métricas e DLQ dedicada** — `FAILED` fica na tabela; sem Prometheus, sem alerta automático.
- **Frontend rico** — Angular cobre as 4 telas pedidas, sem polish visual nem WebSocket pra status em tempo real.

### O que faria diferente com mais tempo

- **Re-cotação como fonte primária** em vez de preço gravado na criação. Hoje o preço acordado é fixado no `POST` e o worker compara com slippage. Em produção real, eu trataria o preço gravado só como teto/piso e usaria o preço cotado como fonte de verdade.
- **Breaker com estado compartilhado** (Redis) pra coerência entre workers — hoje cada processo tem o seu.
- **Outbox pattern** pra publicar eventos de mudança de estado da ordem (executada, cancelada, falhou) de forma atômica com o commit. Permitiria notificação real-time pro frontend e auditoria desacoplada sem perder eventos em crash entre commit e publish.
- **Extrair o `QuotationClient` resiliente pra biblioteca isolada** — o trio Circuit/Retry/Http tem reuso óbvio em outros provedores externos.

---

## Tratamento de concorrência

> Cenário do enunciado: João tem 100 ITUB4, envia duas SELLs de 80 simultaneamente.

**O que deveria acontecer:** uma vence, a outra é rejeitada na criação (não no worker). O cliente da segunda SELL precisa saber na hora — não pode virar `PENDING` e estourar depois deixando posição negativa.

**O que faço:** a reserva roda como um `UPDATE` atômico com guard:

```sql
UPDATE positions
SET quantity = quantity - 80, "reservedQuantity" = "reservedQuantity" + 80
WHERE "userId" = $1 AND symbol = 'ITUB4' AND quantity >= 80
```

Postgres serializa os dois UPDATEs na mesma row via lock de linha. A Tx que pega o lock primeiro vê `quantity = 100`, atualiza pra 20 e commita. A Tx B espera, re-avalia o `WHERE` (READ COMMITTED), vê 20, **não atualiza nenhuma row** → `updateMany` retorna 0 → `CreateOrder` lança `InsufficientAssetError` → `422 insufficient_asset`. Coberto em `tests/integration/concurrency.test.ts`.

**Trade-offs:**

- **READ COMMITTED + guard no `WHERE`, em vez de SERIALIZABLE.** Não preciso pagar retries de serialization failure. Limitação: se a regra envolver invariantes em múltiplas rows (ex: limite agregado por classe de ativo), `SERIALIZABLE` ou snapshot manual seriam mais seguros.
- **Serialização por row, não por usuário.** Duas ordens de **ativos diferentes** do mesmo usuário rodam em paralelo (rows distintas). Se o produto crescer pra ter limites globais por usuário (alavancagem máxima, etc.), aí precisa de coordenação adicional.

---

## Tratamento de falhas no quotation-service

O serviço falha 20% das vezes, tem 5% de timeout de 10s, e variação de ±5% no preço.

**Do ponto de vista do cliente:** ele nunca recebe `5xx` por causa do quotation-service. Se a cotação está fora na criação, a ordem é gravada com o preço de referência (cliente vê o preço que ele aceitou). Se está fora na execução, o worker executa pelo preço gravado. Se variou mais que 5% entre a criação e a execução, a ordem vira `FAILED` com motivo claro (`failureReason`) e o saldo separado é devolvido — o cliente consegue ver no `GET /orders/:id` exatamente o que aconteceu e tentar de novo.

Camadas combinadas em `infra/quotation/buildQuotationClient.ts` como decorators: `Circuit(Retry(Http))`.

| Camada | Comportamento |
|---|---|
| `HttpQuotationClient` | Timeout explícito de 1500ms (configurável). Retorna `null` em falha em vez de propagar erro. |
| `RetryingQuotationClient` | 3 tentativas com backoff exponencial (100ms→200ms→400ms). |
| `CircuitBreakingQuotationClient` | Abre depois de 5 falhas consecutivas, fica aberto 10s, half-open testa 1 chamada. Aberto = retorna `null` sem chamar o upstream. |

Quando o cliente retorna `null`:

- **Listagem de ativos:** cai pro `referencePrice` da tabela `assets`. Cliente vê preço de referência em vez de erro.
- **Criação de ordem:** o `POST` grava o `referencePrice` como preço acordado da ordem.
- **Worker (re-cotação):** se a re-cotação falha, executa pelo preço gravado na criação.

**Slippage tolerável de 5%.** O worker re-cota no momento da execução (`ExecuteOrder`):

- BUY: rejeita se `quoted > 1.05 × agreed`. Se `quoted < agreed`, executa pelo `quoted` e devolve a diferença pra `cashBalance` (cliente nunca paga mais que pediu).
- SELL: rejeita se `quoted < 0.95 × agreed`. Caso contrário, executa pelo preço de mercado real.

**Status `FAILED`.** Slippage acima do tolerável → `OrderRejectedError` → ordem vira `FAILED` e libera reserva, tudo na mesma transação. Erros transientes incrementam `Order.attempts` em transação separada (sobrevive ao rollback da principal); após `MAX_EXECUTION_ATTEMPTS` (default 3), vai pra `FAILED` com a última mensagem como `failureReason`.

**Princípio:** preferir rejeitar com motivo claro a executar com preço inconsistente.

**Follow-ups conscientes:**

- Sem DLQ dedicada — `FAILED` fica na tabela; em produção, exportaria pra Sentry/DataDog.
- Sem alerta automático em spike de `FAILED` — métrica Prometheus + alerta seria o próximo passo.
- Breaker é estado em memória por processo. Múltiplos workers = breakers independentes. Pra coerência cross-worker em produção, mover o estado pro Redis.

---

## Premissas assumidas

- Auth fake (`x-user-id`). Foco da entrega foi modelagem, persistência e concorrência.
- Um usuário no seed. Multi-usuário funciona sem mudança de código.
- Valores monetários serializados como `number` no JSON. Em produção, manteria string + lib decimal no cliente pra evitar float64.
- Precisões: `Decimal(18,8)` em quantidade (cripto fracionária), `Decimal(18,4)` em preço, `Decimal(18,2)` em cash.
- Worker single-instance no setup local. O design (`SKIP LOCKED`) suporta múltiplas réplicas; não foi exercitado.

---

## Sugestões ao fornecedor de cotações

1. **Bulk endpoint** — `GET /quotations?symbols=...`. Hoje listar ativos exige N chamadas paralelas, e com 20% de falha por chamada quase sempre uma falha. Bulk dá resposta parcial coerente em uma chamada só.
2. **Cache hints (`Cache-Control` / `ETag`)** — permitir cache de ~2s no cliente reduz carga em ~5× sem perda perceptível de precisão.
3. **Stream de preços (WebSocket/SSE)** — frontend reativo sem polling; worker re-cota sem HTTP por ordem.
4. **Fail-fast de timeout** — se o serviço sabe que vai estourar, retornar `503` na hora em vez de segurar a conexão por 10s. Isso "queima" 10s do meu lado por chamada hoje.
5. **Health por símbolo** — `GET /health/symbols` em vez de tudo-ou-nada. Permite degradar parcial.
6. **Idempotency keys** — não crítico em `GET`, mas padrão em endpoints futuros de execução.
