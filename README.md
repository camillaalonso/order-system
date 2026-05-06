# Sistema de Ordens de Investimento

Solução do desafio técnico — backend, frontend e diagrama de arquitetura AWS.

> **Parte 1 (código):** API de ordens em Node.js + TypeScript + Postgres, frontend Angular consumindo a API.
> **Parte 2 (arquitetura):** diagrama AWS + documentação em [`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## Estrutura do repositório

```
.
├── README.md                       # este arquivo (overview do repo)
├── ARCHITECTURE.md                 # Parte 2 — desenho AWS, decisões e trade-offs
├── docs/architecture/              # diagrama (.drawio + .svg)
├── backend/                        # API + worker (Node 22, Fastify, Prisma, Postgres)
│   └── README.md                   # Parte 1 — detalhes técnicos, decisões e endpoints
├── frontend/                       # Angular 21 (telas de ativos, posições, ordens)
│   └── README.md                   # como rodar o frontend
└── case-eng-dist/                  # material original do desafio
    ├── README.md                   # enunciado do desafio
    └── quotation-service/          # serviço de cotações (fornecido — apenas consumido)
```

A documentação principal de cada parte fica em arquivos próprios:

- **Backend / Parte 1:** [`backend/README.md`](./backend/README.md) (decisões, endpoints, tratamento de concorrência, falhas, premissas)
- **Frontend:** [`frontend/README.md`](./frontend/README.md)
- **Arquitetura / Parte 2:** [`ARCHITECTURE.md`](./ARCHITECTURE.md)

---

## Pré-requisitos

- Node.js **22+**
- Docker + Docker Compose (Postgres local)

---

## Como rodar localmente

A ordem importa: o backend depende do quotation-service, e o frontend depende do backend.

### 1. Quotation service (terminal 1)

Serviço fornecido pelo desafio, simula um fornecedor instável de cotações.

```bash
cd case-eng-dist/quotation-service
npm install
npm start                     # http://localhost:3001
```

### 2. Backend — API + worker (terminais 2 e 3)

```bash
cd backend
cp .env.example .env          # defaults funcionam pro setup local
npm install
docker compose up -d          # Postgres na porta 5432
npx prisma migrate deploy
npx prisma db seed            # ativos + user-001 + posições iniciais
npm run dev                   # API em http://localhost:3000
```

Em outro terminal, suba o worker (responsável por executar ordens `PENDING`):

```bash
cd backend
npm run worker
```

Detalhes completos (variáveis, endpoints, decisões de design) em [`backend/README.md`](./backend/README.md).

### 3. Frontend (terminal 4)

```bash
cd frontend
npm install
npm start                     # http://localhost:4200
```

A auth no backend é **fake** nesta entrega (header `x-user-id`); o frontend já manda o header automaticamente via interceptor (`user-001`).

### 4. Testes

```bash
cd backend
npm test                      # 49 testes de integração
```

---

## Sumário das entregas

| Entrega                          | Onde                                      |
|----------------------------------|-------------------------------------------|
| API de ordens (Node + TS)        | `backend/`                                |
| Worker assíncrono                | `backend/src/worker.ts`                   |
| Frontend Angular                 | `frontend/`                               |
| Testes de integração             | `backend/tests/integration/` (49 testes)  |
| Documentação Parte 1             | `backend/README.md`                       |
| Documentação Parte 2             | `ARCHITECTURE.md`                         |
| Diagrama AWS                     | `docs/architecture/order-system.svg`      |
