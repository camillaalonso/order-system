# Arquitetura AWS — Sistema de Ordens de Investimento

Este documento descreve o desenho da arquitetura. O objetivo desde o começo foi suportar o volume alvo do produto sem retrabalho no primeiro pico: ~1.000 ordens/s sustentadas, ~50.000 usuários simultâneos e ~10.000 consultas de cotação/s.

Três coisas guiaram as escolhas:
- Operação que toca saldo é ACID, sempre.
- O sistema precisa continuar de pé mesmo se o provedor de cotações cair.
- Tudo tem que ser observável. Se eu não consigo investigar um incidente às 3 da manhã, o desenho está errado.

A arquitetura tem cinco partes: borda (Route 53, CloudFront, WAF, ALB), aplicação rodando em ECS Fargate, dados em Aurora PostgreSQL e Redis, mensageria em SQS FIFO e o pipeline de auditoria via EventBridge → Firehose → S3. Diagrama em `docs/architecture/order-system.svg`.

## Componentes

**Borda.** 
Route 53 resolve o domínio com health check. CloudFront distribui o frontend estático e termina TLS. WAF na frente do CloudFront filtra ataque comum (SQLi, XSS, IPs maliciosos via AWS Managed Rules) e faz rate limit por IP. O ALB distribui para as tasks ECS e valida JWT do Cognito antes do tráfego chegar na app.

**Rede.** 
VPC em 3 AZs. Subnet pública só com ALB e NAT Gateway. ECS, Aurora e Redis ficam todos em subnet privada, sem rota direta para a internet. para a falar com S3, ECR, Secrets Manager e CloudWatch Logs uso VPC Endpoint, evitando o NAT.

**Aplicação.** 
Cinco services no ECS Fargate:
- `orders-api`: recebe ordens via HTTP, valida idempotência e empurra para o  SQS FIFO.
- `quotes-api`: lê cotação do Redis (alvo de 10k req/s).
- `positions-api`: consulta saldo e histórico, sempre na Read Replica.
- `orders-worker`: o cara que importa. Consome SQS FIFO, executa a transação ACID no Aurora e publica evento de auditoria.
- `quotes-ingestor`: worker em loop que busca cotação no provedor externo e atualiza o Redis.

**Dados.** 
Aurora PostgreSQL Serverless v2 como Writer (Multi-AZ), uma Read Replica para as consultas de posição e relatório. ElastiCache Redis em cluster mode para o  cache de cotações com TTL curto.

**Mensageria.** 
SQS FIFO com `MessageGroupId=userId`, DLQ que captura mensagem que falha 3 vezes seguidas.

**Auditoria.** 
EventBridge recebe evento de mudança de estado de ordem. Kinesis Data Firehose agrega em Parquet e joga no S3 com Object Lock (7 anos, modo compliance). Athena para a consulta ad hoc.

**Plataforma.** 
CloudWatch (logs, métricas, alarmes) com SNS distribuindo alerta para o  PagerDuty, e-mail e Slack. X-Ray para a tracing. Secrets Manager para as credenciais (Aurora, API key do provedor) com rotação. KMS para a encryption at rest. GuardDuty + Security Hub + CloudTrail para a detecção e auditoria de API AWS.

**CI/CD.** 
GitHub Actions com OIDC (sem chave estática), publica imagem no ECR e CodeDeploy faz blue/green nas tasks com rollback automático em falha de health check.

## Decisões principais

### Compute: ECS Fargate
A primeira escolha foi não usar Lambda no caminho crítico. Lambda funciona bem para o  `orders-api`, mas `orders-worker` e `quotes-ingestor` rodam em loop e precisam de conexão persistente com Redis e Aurora. Para esse perfil Lambda fica caro e a latência de cold start atrapalha.
EKS ficou fora pois o que justifica o Kubernetes (scheduling avançado, service mesh, portabilidade entre clouds) não aparece em cinco services com o mesmo padrão de deploy. EC2 foi descartado pois precisaria montar a orquestração de container em cima e cuidar de AMI e patching, o Fargate já resolve.
Fargate cobra por segundo, integra nativamente com ECR, ALB e CodeDeploy, e usa o mesmo modelo de deploy para a HTTP e workers de fila.

### Mensageria: SQS FIFO
Considerei Kinesis Data Streams. Ganharia em throughput puro mas SQS FIFO já dá conta de 1k ordens/s, e operar Kinesis (shard, retenção, capacidade) é mais trabalhoso. 
SNS+SQS fanout não fazia sentido porque tem só um consumidor da ordem (`orders-worker`). EventBridge entra na auditoria, não no caminho crítico.
`MessageGroupId = userId`. Garante ordem estrita por usuário sem precisar implementar lock no banco nem na app. Resolve race condition que apareceria em outros designs.

### Banco: Aurora PostgreSQL
DynamoDB não cabe. Operação financeira tem transação multi-row com restrição (saldo, posição, histórico), e o modelo relacional é mais natural. Transactions do DynamoDB são limitadas e o modelo de dados teria que ser denormalizado de um jeito que dificulta evolução.
O Aurora é melhor pela replicação sub-segundo entre Writer e Reader e pelo failover Multi-AZ rápido. Aurora Serverless v2 sobre Aurora provisionado por causa do perfil de tráfego: tem pico previsível (abertura e fechamento de mercado).

### Cache: ElastiCache Redis
Cache em memória local (Caffeine, node-cache) está fora porque cada task do `quotes-api` teria seu próprio estado, e para 50k usuários simultâneos isso vira inconsistência feia. Memcached funcionaria mas o Redis tem cluster mode com sharding nativo e estruturas que provavelmente vou usar depois (sorted set, pub/sub para invalidação cross-cluster).


### Borda: ALB e não API Gateway
API Gateway é melhor para serverless de baixo volume com cobrança por request. A 1k req/s sustentadas aumenta muito o custo. ALB tem custo fixo + LCU e fica bem mais barato.

### Frontend: CloudFront + S3
Amplify Hosting é mais simples, o controle sobre regra de cache é menor. Em volume mais alto CloudFront direto sai melhor e dá controle sobre TTL.

## Escalabilidade
A borda escala sozinha. CloudFront serve do edge e o ALB cresce em LCU conforme o tráfego.
No ECS, cada service tem autoscaling por métrica diferente:
- `orders-api`, `quotes-api`, `positions-api`: CPU em alvo de 60% e contagem de requests por target (target tracking).
- `orders-worker`: profundidade da fila (`ApproximateNumberOfMessagesVisible`). Pico de ordens dispara task nova automaticamente.
- `quotes-ingestor`: número de provedores integrados, não carga. Tipicamente 2-3 tasks por provedor.
SQS é praticamente ilimitado. O limite efetivo é o `MessageGroupId`, que serializa por grupo. É suficiente para 50k usuários.
Aurora Writer escala vertical via Serverless v2 (0.5 a 128 ACUs). Read replica absorve consulta de posição. Se precisar de mais leitura, dá para colocar até 15 replicas no cluster.
Redis em cluster mode adiciona shard linearmente. Replicação dentro do shard cobre leitura.
- 
Três gargalos: O provedor de cotações é externo e tem rate limit; mitiga com cache agressivo (TTL 1-5s), reduzindo o tráfego saindo da AWS para uma fração mínima dos 10k req/s recebidos. O Aurora Writer é gargalo natural num sistema ACID, e o SQS na frente suaviza pico, mais ler de Reader desafoga. NAT Gateway tem limite de banda; em volume bem alto, considerar NAT por AZ e empurrar o que der para VPC Endpoint.

## Resiliência

### Provedor de cotações fora do ar
Esse é o cenário mais provável. O sistema continua operando:
- O `quotes-ingestor` falha ao buscar cotação. O Redis mantém o último valor com TTL curto. Depois do TTL, o dado expira.
- O `quotes-api` consulta Redis. Se tem valor, devolve. Se não tem (miss), tenta o provedor direto. Se o provedor também tá fora, devolve `503` em vez de inventar preço.
- O `orders-worker` consulta Redis a preço de mercado durante o processamento. Se Redis e provedor estão ambos fora, marca a ordem como `REJECTED` com motivo claro. Não fica em loop tentando.
É melhor rejeitar uma ordem com mensagem clara do que executar com preço incorreto.

### Worker fora
Se todas as tasks do `orders-worker` caem, mensagens ficam empilhadas no SQS. Alarme de `ApproximateAgeOfOldestMessage > 60s` dispara via SNS, e o autoscaling sobe task nova em poucos minutos. Nada é perdido.

### Aurora fora
Failover Multi-AZ promove standby a Writer em ~30s. Durante o failover, o `orders-worker` recebe erro de conexão e a mensagem volta para a fila pelo visibility timeout. Quando o banco volta, processa.

### Redis fora
`quotes-api` cai no fallback descrito acima. para o  `orders-worker`, sem cache nem provedor, a ordem volta para a fila e eventualmente para o DLQ depois dos retries.

### Mensagens venenosas
Mensagem que falha 3 vezes vai para o DLQ (redrive policy do SQS). Alarme em `ApproximateNumberOfMessagesVisible > 0` no DLQ dispara para o time imediatamente. Uma mensagem ruim não pode bloquear a fila inteira, então isolar na DLQ resolve.

### Multi-AZ
Tudo replicado em 3 AZs: Aurora, Redis, ECS distribuído, NAT por AZ na config ideal. Perda de uma AZ inteira não derruba operação.

## Evolução
- O que muda quando um segundo provedor de cotações for integrado?
Praticamente nada na infra. As únicas mudanças ficam no `quotes-ingestor` e em uma regra de leitura no `quotes-api`:
1. Sobe uma nova task do `quotes-ingestor` configurada para o provedor secundário. Cada ingestor é independente e isolado por config.
2. As chaves no Redis passam a incluir o provedor (`quote:ITUB4:b3`, `quote:ITUB4:bloomberg`) em vez de uma chave única por símbolo.
3. O `quotes-api` ganha uma regra de prioridade simples: lê do primário; se ausente ou stale, cai no secundário.
4. Um alerta dispara quando os dois provedores discordam acima de um threshold, para revisão manual.
`orders-worker`, Aurora, SQS, ALB e o resto do pipeline não mudam. A separação entre ingestão (escreve no Redis) e leitura (lê do Redis) é o que torna isso barato: trocar ou adicionar fonte de dados não toca o caminho crítico da ordem.

- O que muda quando um novo tipo de ativo for adicionado?
Também nada na infra. A tabela `assets` já tem o campo `asset_class` (equity, crypto, fixed_income, etc.), e o pipeline (ALB → `orders-api` → SQS → `orders-worker` → Aurora) trabalha com qualquer ordem no formato `{symbol, type, quantity, price}`. As mudanças ficam todas em código de domínio:
1. Inserir os ativos novos na tabela `assets` com a `asset_class` correta.
2. Implementar as regras de negócio específicas da nova classe (derivativo tem vencimento e margem, fundo tem cota diária e janela de resgate, renda fixa tem yield e indexador, etc.).
3. Apontar o `quotes-ingestor` para o feed do novo ativo se vier de fonte diferente do provedor já integrado.

Nenhum recurso AWS é provisionado, nenhum service é redeployado fora do ciclo normal, e não há mudança de schema além das colunas específicas da nova classe.

## Segurança

### Auth
Cognito User Pool gerencia cadastro, login e emite JWT. O ALB valida o token via integração nativa com Cognito (listener rule `authenticate-cognito`), bloqueando token inválido antes do backend. A app usa só a claim `sub` para identificar o usuário, sem revalidar.

### Rede
ALB aceita 443 da internet e fala só com ECS na porta da app. ECS fala só com Aurora (5432), Redis (6379) e endpoints AWS. Aurora e Redis aceitam só conexão do ECS via Security Group por camada, mais VPC Endpoint para serviço AWS evitando passar pela internet pública.

### Credenciais e criptografia
Senha do Aurora, API key do provedor e tokens internos ficam no Secrets Manager. Cada task tem IAM Role com permissão de ler só o secret específico do serviço. Encryption at rest via KMS em todo recurso com dado sensível: Aurora, S3 (frontend e auditoria), Redis, Secrets, Logs. TLS ponta a ponta para in-transit.

## Observabilidade

Logs estruturados em JSON para o CloudWatch Logs via `awslogs` driver no ECS. Cada log tem `requestId` e `orderId`, então dá para seguir uma ordem específica do `orders-api` até o `orders-worker`.

Alarmes mínimos:

| Métrica | Threshold | O que indica |
|---|---|---|
| `SQS.ApproximateAgeOfOldestMessage` | > 60s | Fila parada (worker caiu ou degradou) |
| `SQS.ApproximateNumberOfMessagesVisible` (DLQ) | > 0 | Ordens estão falhando |
| `ECS.RunningTaskCount` | < desired | Tasks caíram |
| `RDS.CPUUtilization` | > 80% por 5min | Banco sob pressão |
| `ALB.HTTPCode_5XX_Count` | > 1% | Erro de borda ou backend |
| `Custom.QuotesIngestorHeartbeat` | ausente por 30s | Cotação ficando stale |

Alertas vão para um SNS único e de lá para o PagerDuty (oncall), e-mail.
X-Ray instrumenta as tasks via SDK + sidecar. Cada request gera trace cobrindo ALB → app → Redis/Aurora/SQS.

### Investigando "ordens não estão sendo processadas"
Quando esse alerta toca:
1. DLQ tem mensagem? Se sim, lê uma para ver o erro.
2. Idade da mensagem mais antiga na fila principal cresceu? Worker está parado ou degradado.
3. Quantas tasks do `orders-worker` estão rodando? Caiu? Autoscaling não reagiu?
4. Logs do worker filtrando pelo `orderId` da DLQ ou pela última hora. Qual exception?
5. Métrica do Aurora: CPU, conexão ativa, deadlock, latência de query.
6. Redis e provedor: falha externa pode estar rejeitando ordem em massa.
7. Trace do X-Ray da última ordem que tentou processar. Onde gastou tempo?
8. Athena no `audit-archive`: quantas ordens viraram `REJECTED` na última hora? Tem padrão por usuário, ativo ou motivo?

### Auditoria
Toda mudança de estado de ordem é publicada como evento no EventBridge logo após commit no Aurora, fora da transação.
O Firehose agrega em batch (5 minutos ou 5MB) e escreve em Parquet particionado por data no S3 `audit-archive`. O bucket usa Object Lock em modo compliance, então nem o root da conta consegue apagar registro durante a retenção. Athena lê direto do Parquet para a investigação ad hoc e relatório regulatório. EventBridge no meio facilita adicionar consumidor depois (detecção de fraude, BI, analytics) sem mexer no `orders-worker`.

## Custos
Estimativa mensal aproximada para o  volume alvo, em us-east-1:

| Componente | Estimativa | Notas |
|---|---|---|
| ECS Fargate (15-25 tasks médias) | $1.500 — $3.000 | Maior componente, varia com autoscaling |
| Aurora Serverless v2 (Writer + 1 Reader) | $500 — $1.500 | 2-8 ACUs em média, picos no horário de mercado |
| ElastiCache Redis (cluster, 3 shards × 2 nodes) | $200 — $500 | cache.r7g.large por shard |
| ALB | $25 — $100 | Custo fixo + LCU |
| NAT Gateway | $50 — $200 | $0.045/h + $0.045/GB processado |
| SQS + EventBridge + Firehose | $100 — $300 | Volume de eventos |
| S3 (frontend + audit-archive) | $20 — $80 | Audit cresce com tempo, lifecycle para Glacier reduz |
| Athena | $5 — $50 | Por TB escaneado, baixo se query for rara |
| CloudWatch (Logs, Metrics, Alarms) | $200 — $500 | Logs detalhados são o pior |
| Cognito | ~$50 | 50k MAU dentro do tier de $0.0055/MAU |
| WAF | $20 — $50 | Custo fixo por web ACL + por request |
| CloudFront | $50 — $200 | Por GB transferido + por request |
| KMS, Secrets Manager, GuardDuty, Security Hub | $50 — $150 | Custo administrativo |
| **Total** | **~$2.800 — $6.700** | Ordem de grandeza, calibrar com observabilidade real |

Corte de custo: agressividade do autoscaling do ECS (não manter capacidade em horário ocioso), TTL do Redis (mais alto = menos chamada ao provedor) e retenção de log do CloudWatch (debug pode ir para S3 com lifecycle).

## Concorrência
Cenário clássico: João tem 100 unidades de ITUB4 e dispara duas ordens de venda de 80 simultaneamente.
1. As duas ordens entram pelo `orders-api` e vão para o  SQS FIFO com `MessageGroupId = "user-001"`.
2. SQS FIFO entrega mensagem do mesmo group ID em ordem estrita, e o consumo é serializado: uma única task processa o grupo de cada vez. Não existe paralelismo dentro do grupo.
3. O worker pega a primeira ordem, abre transação, valida saldo (100 disponíveis), debita 80, sobra 20, commita. Ordem `EXECUTED`.
4. Pega a segunda. Saldo 20, precisa de 80, rejeita. Ordem `REJECTED` com motivo "saldo insuficiente".

Funciona sem lock otimista no banco e sem coordenação extra na app. Idempotência vem de uma constraint única em `idempotencyKey`: ordem repetida cai na constraint e é rejeitada.
A limitação é que cada usuário fica capado em ~300 mensagens/s (limite do FIFO por grupo). para o  perfil do produto isso é confortável; considerei que não há envio de milhares de ordens por segundo no mesmo login.
Se o worker cai no meio da transação, a mensagem volta para a fila pelo visibility timeout. A operação é idempotente: a constraint protege de execução dupla, e a transação ACID garante atomicidade. Reprocessar é seguro.
