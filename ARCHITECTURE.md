# Arquitetura AWS — Sistema de Ordens de Investimento

> Documento técnico do desenho de arquitetura para o sistema de ordens.

---

## Sumário

1. [Visão geral](#1-visão-geral)
2. [Decisões principais](#2-decisões-principais)
3. [Justificativa das escolhas](#3-justificativa-das-escolhas)
4. [Escalabilidade](#4-escalabilidade)
5. [Resiliência e tratamento de falhas](#5-resiliência-e-tratamento-de-falhas)
6. [Evolução do produto](#6-evolução-do-produto)
7. [Segurança](#7-segurança)
8. [Observabilidade](#8-observabilidade)
9. [Estimativa de custos](#9-estimativa-de-custos)
10. [Tratamento de concorrência](#10-tratamento-de-concorrência)

---

## 1. Visão geral

A arquitetura foi desenhada para suportar o volume alvo do produto desde o início (≈1.000 ordens/s sustentadas, ≈50.000 usuários simultâneos, ≈10.000 consultas de cotação/s) com foco em três princípios não-negociáveis para um sistema financeiro:

- **Integridade** — toda operação que toca o saldo do cliente roda dentro de transação ACID, com auditoria imutável.
- **Resiliência** — o sistema continua operando de forma segura mesmo quando o provedor externo de cotações está indisponível ou lento.
- **Observabilidade** — todo estado do sistema é mensurável e investigável, com alertas automatizados para os modos de falha conhecidos.

A arquitetura é dividida em camadas: borda (Route 53, CloudFront, WAF, ALB), aplicação (ECS Fargate com cinco services em subnet privada), dados (Aurora PostgreSQL e ElastiCache Redis), mensageria (SQS FIFO + DLQ), auditoria (EventBridge → Firehose → S3 → Athena) e plataforma transversal (CloudWatch, SNS, Secrets Manager, KMS, Cognito).

---

## 2. Decisões principais

| Camada | Escolha | Por quê |
|---|---|---|
| Compute | ECS Fargate | Tráfego sustentado (não picos esporádicos), inclui workers de fila de longa duração, sem necessidade de equipe de plataforma |
| Async de ordens | SQS FIFO + DLQ | Ordenação por usuário via `MessageGroupId=userId`, absorve picos sem bloquear o `orders-api` |
| Banco | Aurora PostgreSQL Serverless v2, Multi-AZ + 1 read replica | ACID inegociável em sistema financeiro |
| Cache de cotações | ElastiCache Redis (cluster mode) | Sub-milissegundo, absorve 10k req/s sem matar o provedor externo |
| Borda HTTP | Application Load Balancer | A 1k+ req/s sustentado, mais barato que API Gateway |
| Auth | Cognito User Pool | Não fazer auth caseira em sistema financeiro |
| Frontend | CloudFront + S3 (Next.js export) | CDN separada de origem, mais barato que Amplify Hosting em escala |
| Auditoria | EventBridge → Kinesis Firehose → S3 audit-archive (Parquet, Object Lock) → Athena | Compliance ~7 anos com pesquisa rápida sob demanda |
| CI/CD | GitHub Actions → ECR → CodeDeploy (blue/green) | OIDC sem chaves estáticas, rollback automático em falha de health check |

---

## 3. Justificativa das escolhas

### 3.1. Compute — por que ECS Fargate

**Alternativas consideradas:**

- **AWS Lambda** — ideal para o `orders-api` (tráfego HTTP) e parte do `quotes-api`. Descartado para o `orders-worker` e o `quotes-ingestor`, que rodam em loop e precisam de conexão persistente com Redis/Aurora — Lambda fica caro e ineficiente para essa carga.
- **EKS** — descartado pelo overhead operacional. O time não tem demanda de portabilidade entre clouds nem padrões avançados de orquestração que justifiquem manter um control plane Kubernetes.
- **EC2 com Auto Scaling Group** — descartado por exigir gestão de patches, AMIs e orquestração de containers manualmente.

Fargate equilibra: zero gestão de servidor, billing por segundo, integração nativa com ECR/CodeDeploy/ALB e suporta tanto serviços HTTP quanto workers de fila com o mesmo modelo de deploy.

### 3.2. Mensageria — por que SQS FIFO

**Alternativas consideradas:**

- **Kinesis Data Streams** — superior em throughput puro, mas SQS FIFO é suficiente para 1k ordens/s (limite de 3k msg/s por grupo e dezenas de milhares por fila com batching). SQS FIFO é mais simples de operar e barato.
- **SNS + SQS fanout** — adicionaria latência sem ganho real para esse caso, onde só temos um consumidor (`orders-worker`).
- **EventBridge** — usado para auditoria, não para o caminho crítico da ordem. EventBridge tem latência maior e não garante FIFO por chave.

A propriedade-chave é o `MessageGroupId = userId`: ordens do mesmo usuário são processadas em ordem estrita, evitando race conditions sem precisar de lock no banco.

### 3.3. Banco — por que Aurora PostgreSQL

**Alternativas consideradas:**

- **DynamoDB** — descartado. Operações financeiras precisam de transações multi-row com restrições (saldo, posição, histórico de ordens) e o modelo relacional cabe melhor. Transactions do DynamoDB são limitadas e o modelo de dados forçaria denormalização.
- **RDS PostgreSQL tradicional** — funciona, mas Aurora oferece replicação mais rápida (sub-segundo entre Writer e Reader), failover Multi-AZ em ~30s e Serverless v2 escala vertical sem janela de manutenção.

Aurora Serverless v2 foi escolhido sobre Aurora provisionado por escalar automaticamente conforme a carga e cobrar por ACU consumida — combina bem com o perfil de tráfego financeiro, que tem picos diários previsíveis (abertura/fechamento de mercado).

### 3.4. Cache — por que ElastiCache Redis

**Alternativas consideradas:**

- **DAX** — exclusivo para DynamoDB, não se aplica.
- **Cache em memória local na app (Caffeine, node-cache)** — descartado por inviabilizar consistência entre as N tasks do `quotes-api`. Cada task teria seu próprio cache desatualizado.
- **Memcached** — viável, mas Redis tem estruturas mais ricas (sorted sets, pub/sub para invalidação cross-cluster) e suporte nativo a cluster mode com sharding.

### 3.5. Borda — por que ALB e não API Gateway

API Gateway brilha em arquitetura serverless com baixo volume e cobrança por request. A 1.000+ req/s sustentadas, o custo do API Gateway escala linearmente e ultrapassa em muito o ALB, que tem custo fixo + LCU (Load Balancer Capacity Units). Para HTTP convencional com integração ao ECS, ALB é a escolha econômica e tecnicamente equivalente.

### 3.6. Frontend — por que CloudFront + S3 e não Amplify Hosting

Amplify Hosting é mais simples (faz build e deploy automaticamente), mas tem menos controle sobre regras de cache, custo escala mais rápido em volume e a integração com WAF/Shield é menos flexível. Em 50k usuários simultâneos, CloudFront + S3 self-managed é mais barato e dá controle fino sobre TTL, invalidações e regras de borda.

---

## 4. Escalabilidade

### 4.1. Por camada

**Borda (Route 53 / CloudFront / WAF / ALB):** todos escalam horizontalmente sem intervenção. CloudFront serve assets estáticos do edge, reduzindo carga na origem. ALB escala automaticamente conforme LCUs aumentam.

**Aplicação (ECS Fargate):** cada service tem **Auto Scaling** configurado por métricas relevantes:

- `orders-api`, `quotes-api`, `positions-api`: escalam por CPU (alvo 60%) e por contagem de requests/target via target tracking.
- `orders-worker`: escala por **profundidade da fila** (`ApproximateNumberOfMessagesVisible` no SQS) — métrica customizada via CloudWatch. Picos de ordens disparam novas tasks automaticamente.
- `quotes-ingestor`: escala por número de provedores integrados (não por carga), tipicamente 2-3 tasks por provedor.

**Mensageria (SQS):** capacidade praticamente ilimitada. O limite prático é o `MessageGroupId` — cada grupo (usuário) processa sequencialmente. Como temos 50k usuários, o paralelismo efetivo é alto.

**Banco (Aurora):** Writer escala vertical via Serverless v2 (de 0.5 a 128 ACUs). Read replica absorve consultas de posição. Em caso de carga ainda maior, é possível adicionar até 15 read replicas no cluster.

**Cache (Redis):** cluster mode com sharding. Adicionar shards aumenta throughput linearmente. Replicação dentro de cada shard garante read scalability.

### 4.2. Gargalos identificados

1. **Provedor externo de cotações** — limite externo, fora do nosso controle. Mitigamos com cache agressivo no Redis (TTL 1-5s), reduzindo o tráfego saindo da AWS para uma fração mínima dos 10k req/s recebidos.
2. **Aurora Writer** — gargalo natural em sistema financeiro com requisito ACID. Mitigamos com fila SQS na frente (suaviza picos) e separação read/write (consultas de posição vão para Reader).
3. **NAT Gateway** — único ponto de saída para o provedor externo. Em volume muito alto, considerar NAT Gateway por AZ ou substituir parte do tráfego por VPC Endpoints (para serviços AWS).

---

## 5. Resiliência e tratamento de falhas

### 5.1. Provedor de cotações indisponível ou lento

O sistema é desenhado para **continuar operando mesmo com o provedor offline**:

- O `quotes-ingestor` falha ao buscar cotações nova → o Redis mantém o último valor com TTL curto (5s). Após o TTL, os dados expiram.
- O `quotes-api` consulta Redis. Se o valor existe, devolve normalmente. Se expirou (Redis miss), aplica **circuit breaker**: tenta buscar do provedor diretamente. Se o provedor também falha, retorna `503 Service Unavailable` em vez de inventar preço.
- O `orders-worker` consulta o Redis para obter preço de mercado durante o processamento. Em caso de falha do Redis E do provedor, a ordem é marcada como `REJECTED` com motivo claro, não fica em loop tentando.

**Princípio:** preferimos **rejeitar uma ordem com mensagem clara** a executá-la com preço incorreto. Em sistema financeiro, errar para mais é tão grave quanto errar para menos.

### 5.2. Worker indisponível

Se todas as tasks do `orders-worker` caem, as mensagens permanecem na fila SQS. CloudWatch Alarm dispara em `ApproximateAgeOfOldestMessage > 60s`, notificando via SNS. ECS Service Auto Scaling reage em poucos minutos subindo novas tasks. Nenhuma ordem é perdida.

### 5.3. Aurora Writer indisponível

Failover Multi-AZ promove uma standby para Writer em ~30 segundos. Durante o failover, o `orders-worker` recebe erro de conexão e retorna a mensagem para a fila (visibility timeout). Após o failover, processa normalmente.

### 5.4. Redis indisponível

`quotes-api` aplica fallback descrito em 5.1. Para o `orders-worker`, que precisa de preço para processar a ordem, se o Redis cai, ele tenta o provedor diretamente. Se o provedor também falha, a ordem volta para a fila ou vai para DLQ após retries.

### 5.5. Mensagens venenosas — Dead Letter Queue

Mensagens que falham 3 vezes consecutivas no `orders-worker` (bug, dado corrompido, erro persistente) são automaticamente movidas para a DLQ pela política de redrive do SQS. Um CloudWatch Alarm em `ApproximateNumberOfMessagesVisible > 0` na DLQ dispara notificação SNS imediata para o time on-call investigar.

**Princípio:** uma mensagem ruim não pode bloquear a fila inteira. Isolamos o problema na DLQ + alarme automático.

### 5.6. Multi-AZ por padrão

Toda a infraestrutura é replicada em 3 Availability Zones (Aurora, Redis, ECS tasks distribuídas, NAT Gateway por AZ na configuração ideal). A perda de uma AZ inteira não impacta operação.

---

## 6. Evolução do produto

### 6.1. Múltiplos provedores de cotações

Adicionar um segundo provedor não exige mudanças no `quotes-api` nem no `orders-worker`. A arquitetura suporta:

1. Subir uma nova task do `quotes-ingestor` configurada para o segundo provedor.
2. Cada ingestor escreve no Redis com chave que inclui o provedor (`quote:ITUB4:b3`, `quote:ITUB4:bloomberg`).
3. O `quotes-api` aplica regra de prioridade: lê do provedor primário; se ausente ou stale, fallback para o secundário.
4. Quando dois provedores discordam significativamente, dispara alerta para investigação manual.

A separação clara entre **ingestão** e **leitura** via Redis permite essa evolução sem refatoração do caminho crítico.

### 6.2. Novos tipos de ativo

O modelo de dados do banco usa um campo `asset_class` (equity, crypto, fixed_income, etc.) e regras de negócio aplicadas por classe. Adicionar um novo tipo de ativo requer:

1. Inserir os ativos novos na tabela `assets` com o `asset_class` apropriado.
2. Implementar regras específicas no domínio (ex: derivativos têm vencimento, fundos têm cota diária) — código novo, sem mudança em infraestrutura.
3. Configurar o `quotes-ingestor` para o feed do novo ativo, se vier de fonte diferente.

A arquitetura é **agnóstica ao tipo de ativo** — todo o pipeline (ALB → API → fila → worker → banco) já suporta qualquer ordem que se encaixe no modelo `{symbol, type, quantity, price}`.

---

## 7. Segurança

### 7.1. Autenticação e autorização

Login do usuário é gerenciado pelo Cognito User Pool, que devolve um JWT. O ALB valida o JWT em cada requisição autenticada via integração nativa com Cognito (listener rule `authenticate-cognito`), bloqueando tokens inválidos antes que cheguem na aplicação. O backend usa a claim `sub` do JWT para identificar o usuário, sem precisar validar token novamente.

### 7.2. Rede

- **VPC com 3 Availability Zones**, subnets públicas (ALB, NAT Gateway) e privadas (ECS, Aurora, Redis).
- **Security Groups por camada**: ALB aceita tráfego da internet (porta 443) e fala apenas com o ECS na porta da app; ECS fala apenas com Aurora (5432), Redis (6379), e endpoints AWS; Aurora e Redis aceitam apenas conexões do ECS.
- **VPC Endpoints** para S3, ECR, Secrets Manager e CloudWatch Logs — tráfego não passa pela internet pública.

### 7.3. Credenciais e criptografia

Credenciais sensíveis (senha do Aurora, API key do provedor de cotações, tokens internos) são armazenadas no Secrets Manager. Cada ECS Task tem IAM Role com permissão de leitura apenas pro secret específico daquele serviço (least privilege). Encryption at rest é feito por KMS em todos os recursos com dados sensíveis: Aurora, S3 (frontend e auditoria), Redis, Secrets Manager e CloudWatch Logs. Encryption in transit é TLS ponta a ponta.

### 7.4. Filtragem de tráfego

WAF na frente do CloudFront filtra ataques comuns (SQL injection, XSS, IPs maliciosos via AWS Managed Rules, rate limiting por IP). CloudFront fornece proteção DDoS L3/L4 via AWS Shield Standard incluído.

### 7.5. Detecção de ameaças

- **GuardDuty** habilitado na conta — detecta atividade anômala (acesso de IPs suspeitos, comunicação com C&C servers, comportamento atípico de IAM).
- **Security Hub** consolida findings de GuardDuty, Inspector e checks de compliance (CIS, AWS Foundational Best Practices).
- **CloudTrail** registra todas as chamadas de API AWS — trilha de auditoria para investigação forense.

---

## 8. Observabilidade

### 8.1. Logs

Toda a infraestrutura envia logs estruturados em JSON para CloudWatch Logs via `awslogs` driver no ECS. Cada log inclui correlação por `requestId` e `orderId`, permitindo seguir uma ordem específica do `orders-api` até o `orders-worker`.

### 8.2. Métricas e alarmes

Alarmes mínimos configurados no CloudWatch:

| Métrica | Threshold | O que indica |
|---|---|---|
| `SQS.ApproximateAgeOfOldestMessage` | > 60s | Fila parada (worker caiu ou está lento) |
| `SQS.ApproximateNumberOfMessagesVisible` (DLQ) | > 0 | Ordens estão falhando |
| `ECS.RunningTaskCount` | < desired | Tasks caíram |
| `RDS.CPUUtilization` | > 80% por 5min | Banco sob pressão |
| `ALB.HTTPCode_5XX_Count` | > 1% das requests | Erros de borda ou backend |
| `Custom.QuotesIngestorHeartbeat` | ausente por 30s | Cotações ficando stale |

Alarmes notificam um tópico SNS único, que distribui para PagerDuty (oncall), e-mail e Slack.

### 8.3. Tracing distribuído

X-Ray instrumenta todas as tasks ECS via SDK + sidecar. Cada request gera um trace com spans cobrindo: ALB → app → Redis/Aurora/SQS. Permite identificar latência em cada camada e propagar contexto entre serviços.

### 8.4. Investigação do alerta "ordens não estão sendo processadas"

Sequência típica de investigação:

1. **Profundidade da DLQ** — se há mensagens, ler conteúdo de uma para ver o erro original.
2. **Idade da mensagem mais antiga na fila principal** — se cresceu, worker está parado ou degradado.
3. **Contagem de tasks do `orders-worker`** — caiu? autoscaling não reagiu?
4. **Logs do worker** filtrados pelo `orderId` da DLQ ou pela última hora — qual exception?
5. **Métricas do Aurora** — CPU, conexões ativas, deadlocks, latência de query.
6. **Métricas do Redis e do provedor** — falha externa pode estar causando rejeição em massa.
7. **Trace X-Ray** da última ordem que tentou processar — onde gastou tempo?
8. **Athena no S3 audit-archive** — quantas ordens foram para `REJECTED` na última hora? Padrão por usuário, ativo, motivo?

### 8.5. Auditoria

Toda mudança de estado de uma ordem é publicada como evento no EventBridge (`audit-bus`) imediatamente após o commit no Aurora — fora da transação de banco, pra não acoplar a publicação à integridade financeira. O EventBridge roteia o evento pro Kinesis Data Firehose, que agrega em batches (5 minutos ou 5MB) e escreve em formato Parquet particionado por data no S3 `audit-archive`. O bucket usa Object Lock no modo compliance, garantindo imutabilidade WORM (Write Once Read Many) — nem o root da conta consegue deletar registros durante o período de retenção. Consultas ad hoc pra investigação de incidentes, relatórios regulatórios e auditoria são executadas via Athena, que roda SQL diretamente sobre os arquivos Parquet sem precisar de cluster provisionado. O desacoplamento via EventBridge permite adicionar novos consumidores no futuro (detecção de fraude, BI, analytics) sem alterar o `orders-worker`.

---

## 9. Estimativa de custos

Estimativa mensal aproximada para o volume alvo (~1k ordens/s, 50k usuários simultâneos), região us-east-1:

| Componente | Custo estimado/mês | Notas |
|---|---|---|
| ECS Fargate (15-25 tasks médias) | $1.500 — $3.000 | Maior componente; varia com auto-scaling |
| Aurora Serverless v2 (Writer + 1 Reader) | $500 — $1.500 | 2-8 ACUs em média; picos em horário de mercado |
| ElastiCache Redis (cluster, 3 shards × 2 nodes) | $200 — $500 | cache.r7g.large por shard |
| ALB | $25 — $100 | Custo fixo + LCU |
| NAT Gateway | $50 — $200 | $0.045/h + $0.045/GB processado |
| SQS + EventBridge + Firehose | $100 — $300 | Volume de eventos |
| S3 (frontend + audit-archive) | $20 — $80 | Audit cresce ao longo do tempo; lifecycle pra Glacier reduz custo |
| Athena | $5 — $50 | Pago por query (TB escaneado); muito baixo se queries são raras |
| CloudWatch (Logs + Metrics + Alarms) | $200 — $500 | Logs detalhados são o maior componente |
| Cognito | ~$50 | 50k MAU dentro do tier de $0.0055/MAU |
| WAF | $20 — $50 | Custo fixo por web ACL + por request |
| CloudFront | $50 — $200 | Por GB transferido + por request |
| KMS, Secrets Manager, GuardDuty, Security Hub | $50 — $150 | Custo administrativo |
| **Total estimado** | **~$2.800 — $6.700** | Ordem de grandeza, ajustar com observabilidade real |

Os principais alavancas de redução de custo são: agressividade do auto-scaling do ECS (não manter sobreprovisionamento em horário ocioso), TTL do cache Redis (mais alto = menos chamadas ao provedor) e retenção de logs do CloudWatch (logs de debug podem ser exportados para S3 + lifecycle).

---

## 10. Tratamento de concorrência

**Cenário:** João tem 100 unidades de ITUB4. Envia duas ordens de venda de 80 unidades cada simultaneamente.

**O que acontece nesta arquitetura:**

1. As duas ordens entram pelo `orders-api` e são publicadas no SQS FIFO com `MessageGroupId = "user-001"`.
2. SQS FIFO garante que mensagens com o mesmo group ID são entregues em ordem estrita e processadas por **uma única task de cada vez**. Não há paralelismo dentro do grupo.
3. O `orders-worker` recebe a primeira ordem, abre transação no Aurora, valida saldo (100 disponíveis), debita 80 (sobram 20), commita. Marca a ordem como `EXECUTED`.
4. O `orders-worker` recebe a segunda ordem, abre transação, valida saldo (20 disponíveis), constata que é insuficiente (precisa 80), rejeita. Marca a ordem como `REJECTED` com motivo "saldo insuficiente".

**Trade-offs:**

- ✅ Consistência forte por usuário, sem locks otimistas no banco. Simples de raciocinar.
- ✅ Idempotência garantida via constraint única em `idempotencyKey` — se a mesma ordem chega duas vezes, segunda é rejeitada.
- ⚠️ Throughput por usuário é limitado a aproximadamente 300 mensagens/segundo (limite do FIFO por grupo). Como o produto não espera um único usuário enviando milhares de ordens/segundo, é aceitável.
- ⚠️ Se o `orders-worker` cai durante a transação, a mensagem volta para a fila e é reprocessada. A operação é idempotente: a constraint de `idempotencyKey` evita dupla execução, e a transação ACID garante que só um estado vence (todo ou nada).

---

> Documento elaborado como parte do desafio técnico. O diagrama AWS correspondente está em `order-system.drawio` (com versões `order-system.svg` e `order-system.png` renderizadas pra visualização).
