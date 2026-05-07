# Backend — Sistema de Ordens

API + worker assíncrono em Node 22, TypeScript, Fastify 5, Prisma 6 e Postgres 16. Documentação da Parte 2 em [`../ARCHITECTURE.md`](../ARCHITECTURE.md). Frontend em [`../frontend/`](../frontend/).

## Como executar
Pré-requisitos: Node 22, Docker, e o quotation-service rodando em `:3001` (instruções em [`../README.md`](../README.md)).

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

Auth é fake nesta entrega: header `x-user-id` em toda rota autenticada (`user-001` no seed). JWT está mapeado como evolução. Variáveis adicionais (timeouts, retries, breaker, polling do worker) em `.env.example`.

### Testes
49 testes de integração em `tests/integration/`, rodando contra um Postgres real (banco `orders_test` criado automaticamente). O `QuotationClient` é injetado como stub para ser determinístico; o resto é real, sem mock de repositório.

O que está coberto: criação de ordem (happy path BUY/SELL, validação Zod, auth ausente, asset inexistente, saldo insuficiente), o cenário de concorrência do enunciado (João/ITUB4 com 2 SELLs paralelas, 10 BUYs simultâneos, BUYs onde só 5 cabem no saldo), execução do worker (claim+execute, média ponderada em compras subsequentes, dois workers competindo pelo `SKIP LOCKED`), slippage e falha (BUY rejeitada por preço acima do tolerável, retry transiente até `FAILED`, devolução de reserva), cancelamento (libera reserva, race com worker em cima da mesma row), listagem (filtro por status, isolamento entre usuários, ordenação) e os decorators do quotation client (retry, breaker abrindo/fechando/half-open, timeout).

### Logs
Pino com saída JSON estruturada. `info` para o caminho feliz (worker subindo, ordem executada), `warn` para falha esperada e tratada (quotation-service caiu, ordem rejeitada por slippage, retry transiente), `error` para erro inesperado e `fatal` para crash do worker. Cada log carrega contexto estruturado (`orderId`, `symbol`, `attempt`, `userId`, `breakerState`), o que facilita filtrar por ordem específica ou por componente. Child loggers separam logs por componente (`HttpQuotationClient`, `worker`, etc.). Em dev, `LOG_LEVEL=debug` mostra os retries do quotation client e os ticks do worker.

## Decisões e trade-offs

### Reserva de saldo no `POST`
Em vez de validar saldo só na hora de executar, o `POST /orders` move atomicamente `cashBalance → reservedCash` (BUY) ou `quantity → reservedQuantity` (SELL) na mesma transação que cria a ordem. O cliente recebe `422` na hora se faltar saldo, em vez de uma ordem `PENDING` que vai falhar depois.
O custo é que cancel/falha precisa lembrar de devolver a reserva. Coberto em `orders.cancel.test.ts` e `slippage-and-fail.test.ts`.

### Postgres como fila (sem Redis/RabbitMQ/SQS)
O worker faz polling com `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1`. Workers concorrentes pegam ordens diferentes sem se bloquear, sem coordenação externa. Uma fonte da verdade só (o banco), menos infra para operar.
A contrapartida é latência mínima de `WORKER_POLL_INTERVAL_MS` (default 500ms) quando a fila tá vazia, e o throughput é limitado pelo banco. Para a escala do desafio é mais que suficiente. Para produção real (10k ordens/s), trocaria por SQS FIFO (descrito no `ARCHITECTURE.md`).

### Camada `application/` não conhece Prisma
Use cases dependem de interfaces (`OrderRepository`, `PositionRepository`, `QuotationClient`, `TransactionRunner`). Implementações Prisma vivem em `infra/db/`. Dá para trocar o ORM sem refatorar regra de negócio, e os testes injetam um `StubQuotationClient` em vez de mockar HTTP.

### Cancelamento concorrente com worker
`DELETE /orders/:id` faz `SELECT ... FOR UPDATE` (sem `SKIP LOCKED`). Se o worker já estava processando, o cancel espera; quando o worker commita `EXECUTED`, o cancel re-lê e responde `422 order_not_cancelable`. Se o cancel chegou primeiro, o worker pula a row no próximo `SKIP LOCKED`. Não precisa de coordenação adicional, o lock de linha + READ COMMITTED resolvem todos os interleavings.

### O que prioritizei e o que ficou de fora
Foco da entrega foi modelagem do ciclo de vida da ordem (PENDING → EXECUTED/FAILED/CANCELED), persistência consistente, concorrência tratada na origem (cenário João) e resiliência ao quotation-service (timeout + retry + breaker + slippage). Tudo coberto por teste de integração contra banco real.
Ficou de fora: JWT real (auth fake por header foi suficiente para exercitar o resto), multi-usuário no seed (o código suporta N usuários, só não exercitei manualmente), múltiplas réplicas do worker (o design suporta via `SKIP LOCKED`, rodei só uma localmente), métricas e DLQ dedicada (`FAILED` fica na tabela, sem Prometheus nem alerta automático), e polish visual no frontend.

Com mais tempo:
1. **Re-cotação como fonte primária** em vez de preço gravado na criação. Hoje o preço acordado é fixado no `POST` e o worker compara com slippage. Em produção real, eu trataria o preço gravado só como teto/piso e usaria o cotado como fonte de verdade.
2. **Breaker com estado compartilhado** (Redis) para coerência entre workers. Hoje cada processo tem o seu.
3. **Outbox pattern** para publicar evento de mudança de estado da ordem (executada, cancelada, falhou) atomicamente com o commit. Daria notificação real-time para o frontend e auditoria desacoplada sem perder evento em crash entre commit e publish.
4. **Extrair o `QuotationClient` resiliente para biblioteca isolada.** O trio Circuit/Retry/Http tem reuso óbvio em outros provedores.

## Tratamento de concorrência
Cenário do enunciado: João tem 100 ITUB4 e envia duas SELLs de 80 simultaneamente. Uma vence, a outra precisa ser rejeitada na criação, não no worker. O cliente da segunda SELL precisa saber na hora; não pode virar `PENDING` e estourar depois deixando posição negativa.

A reserva roda como um `UPDATE` atômico com guard:

```sql
UPDATE positions
SET quantity = quantity - 80, "reservedQuantity" = "reservedQuantity" + 80
WHERE "userId" = $1 AND symbol = 'ITUB4' AND quantity >= 80
```

Postgres serializa os dois UPDATEs na mesma row via lock de linha. A Tx que pega o lock primeiro vê `quantity = 100`, atualiza para 20 e commita. A Tx B espera, re-avalia o `WHERE` (READ COMMITTED), vê 20, não atualiza nenhuma row, `updateMany` retorna 0, `CreateOrder` lança `InsufficientAssetError` e a API responde `422 insufficient_asset`. Coberto em `tests/integration/concurrency.test.ts`.

Observações sobre a escolha:
- Optei por READ COMMITTED + guard no `WHERE` em vez de SERIALIZABLE para não pagar retries de serialization failure. Limitação: se a regra envolver invariante em múltiplas rows (limite agregado por classe de ativo, por exemplo), aí SERIALIZABLE ou snapshot manual seria mais seguro.
- A serialização é por row, não por usuário. Duas ordens de ativos diferentes do mesmo usuário rodam em paralelo (rows distintas). Se o produto crescer para ter limite global por usuário precisa de coordenação adicional.

## Tratamento de falhas no quotation-service
O serviço falha 20% das vezes, tem 5% de timeout de 10s, e variação de ±5% no preço. Do ponto de vista do cliente, ele nunca recebe `5xx` por causa do quotation-service. Se a cotação tá fora na criação, a ordem é gravada com o preço de referência (cliente vê o preço que aceitou). Se tá fora na execução, o worker executa pelo preço gravado. Se variou mais que 5% entre criação e execução, a ordem vira `FAILED` com `failureReason` claro e o saldo separado é devolvido. O cliente consegue ver no `GET /orders/:id` exatamente o que aconteceu e tentar de novo.

As camadas estão combinadas em `infra/quotation/buildQuotationClient.ts` como decorators: `Circuit(Retry(Http))`.
- `HttpQuotationClient`: timeout explícito de 1500ms (configurável). Retorna `null` em falha em vez de propagar erro.
- `RetryingQuotationClient`: 3 tentativas com backoff exponencial (100ms → 200ms → 400ms).
- `CircuitBreakingQuotationClient`: abre depois de 5 falhas consecutivas, fica aberto 10s, half-open testa 1 chamada. Aberto = retorna `null` sem chamar o upstream.

Quando o cliente retorna `null`, o sistema cai num fallback em cada ponto de uso: listagem de ativos cai para o `referencePrice` da tabela `assets` (cliente vê preço de referência em vez de erro), criação de ordem grava o `referencePrice` como preço acordado, e o worker executa pelo preço gravado na criação.
O slippage tolerável é 5%. O worker re-cota no momento da execução (`ExecuteOrder`). BUY rejeita se `quoted > 1.05 × agreed`; se `quoted < agreed`, executa pelo `quoted` e devolve a diferença para o `cashBalance` (cliente nunca paga mais que pediu). SELL rejeita se `quoted < 0.95 × agreed`; senão executa pelo preço de mercado real.
Slippage acima do tolerável dispara `OrderRejectedError` e a ordem vira `FAILED` liberando a reserva, tudo na mesma transação. Erro transiente incrementa `Order.attempts` em transação separada (sobrevive ao rollback da principal); depois de `MAX_EXECUTION_ATTEMPTS` (default 3), vai para `FAILED` com a última mensagem como `failureReason`.
Regra geral: rejeitar com motivo claro é melhor do que executar com preço inconsistente.

Três coisas que ficaram fora conscientemente: não tem DLQ dedicada (`FAILED` fica na tabela; em produção exportaria para Sentry ou DataDog), não tem alerta automático em spike de `FAILED` (métrica Prometheus + alerta seria o próximo passo), e o breaker é estado em memória por processo (múltiplos workers = breakers independentes; para coerência cross-worker em produção, mover o estado para o Redis).

## Premissas
- Auth fake (`x-user-id`). Foco da entrega foi modelagem, persistência e concorrência.
- Um usuário no seed. Multi-usuário funciona sem mudança de código.
- Valores monetários como `number` no JSON. Em produção, manteria string + lib decimal no cliente para evitar float64.
- Precisões: `Decimal(18,8)` em quantidade (cripto fracionária), `Decimal(18,4)` em preço, `Decimal(18,2)` em cash.
- Worker single-instance no setup local. O design (`SKIP LOCKED`) suporta múltiplas réplicas, não foi exercitado.

## Sugestões ao fornecedor de cotações
1. Bulk endpoint (`GET /quotations?symbols=...`). Hoje listar ativos exige N chamadas paralelas, e com 20% de falha por chamada quase sempre uma cai. Bulk dá resposta parcial coerente em uma chamada só.
2. Cache hints (`Cache-Control` / `ETag`). Permitir cache de ~2s no cliente reduz carga em ~5× sem perda perceptível de precisão.
3. Stream de preços (WebSocket ou SSE). Frontend reativo sem polling, worker re-cota sem HTTP por ordem.
4. Fail-fast de timeout. Se o serviço já sabe que vai estourar, retornar `503` na hora em vez de segurar a conexão por 10s. Hoje cada timeout queima 10s do meu lado.
5. Health por símbolo (`GET /health/symbols`) em vez de tudo-ou-nada. Permite degradação parcial.
6. Idempotency keys. Não crítico em `GET`, mas seria bom padrão para endpoints futuros de execução.
