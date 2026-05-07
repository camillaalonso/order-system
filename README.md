# Sistema de Ordens de Investimento

Solução do desafio técnico. O repo tem três pedaços: API de ordens em Node.js + TypeScript + Postgres, um frontend Angular que consome a API, e o desenho de arquitetura AWS para rodar isso em produção.

A parte 1 (código) fica em `backend/` e `frontend/`. A parte 2 (arquitetura) é o [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Estrutura
```
.
├── README.md                       # este arquivo
├── ARCHITECTURE.md                 # Parte 2 — desenho AWS, decisões, trade-offs
├── docs/architecture/              # diagrama (.drawio + .svg)
├── backend/                        # API + worker (Node 22, Fastify, Prisma, Postgres)
│   └── README.md                   # Parte 1 — detalhes técnicos, endpoints, premissas
├── frontend/                       # Angular 21 (telas de ativos, posições, ordens)
│   └── README.md
└── case-eng-dist/                  # material original do desafio
    ├── README.md                   # enunciado
    └── quotation-service/          # serviço de cotações (apenas consumido)
```

## Pré-requisitos
- Node.js 22+
- Docker + Docker Compose (Postgres local)

## Como rodar localmente
A ordem importa porque o backend depende do quotation-service e o frontend depende do backend.

**Terminal 1 — quotation service.**
Serviço fornecido pelo desafio, simula um fornecedor de cotações instável.

```bash
cd case-eng-dist/quotation-service
npm install
npm start                     # http://localhost:3001
```

**Terminal 2 — backend (API).**

```bash
cd backend
cp .env.example .env          # defaults funcionam para o setup local
npm install
docker compose up -d          # Postgres na porta 5432
npx prisma migrate deploy
npx prisma db seed            # ativos + user-001 + posições iniciais
npm run dev                   # API em http://localhost:3000
```

**Terminal 3 — worker.**
Processa as ordens `PENDING`.

```bash
cd backend
npm run worker
```

Detalhes (variáveis, endpoints, decisões) em [`backend/README.md`](./backend/README.md).

**Terminal 4 — frontend.**

```bash
cd frontend
npm install
npm start                     # http://localhost:4200
```

A auth no backend é fake nesta entrega (header `x-user-id`); o frontend já manda o header automaticamente via interceptor com `user-001`.

## Testes
```bash
cd backend
npm test                      # 49 testes de integração
```
