# Frontend — Sistema de Ordens de Investimento

Frontend em Angular 21 (standalone components, lazy routes) consumindo a API do `backend/`.

Cobre as quatro telas pedidas pelo desafio:
- `/assets`: lista de ativos com cotação atual e botão de comprar/vender.
- `/positions`: posições do usuário com saldo e preço médio por ativo.
- `/orders`: lista de ordens com filtro por status e botão de cancelamento.
- Modal de criação de ordem, aberto a partir da lista de ativos.

A rota raiz (`/`) redireciona para `/assets`.

## Como rodar
Pré-requisito: Node 22+ e o backend rodando em `http://localhost:3000` (ver [`../backend/README.md`](../backend/README.md)).

```bash
npm install
npm start            # http://localhost:4200
```

Outros scripts: `npm run build` (build de produção em `dist/`) e `npm test` (unitários com Vitest).

## Configuração
A URL do backend está hardcoded em `src/app/api/api.service.ts` (`BASE_URL = 'http://localhost:3000'`). Em produção, viraria env-config via `environment.ts`.

A auth do backend é fake (`x-user-id` no header). O frontend injeta esse header automaticamente via `auth.interceptor.ts` com `user-001`. Quando o backend ganhar JWT, o interceptor passa a ler o token do storage.

## Estrutura
```
src/app/
  app.routes.ts                    rotas com lazy loading
  api/
    api.service.ts                 cliente HTTP (lista/cria/cancela)
    api.types.ts                   tipos compartilhados com o backend
    auth.interceptor.ts            injeta x-user-id em toda requisição
  assets/assets-page.component.ts
  positions/positions-page.component.ts
  orders/orders-page.component.ts
  orders/new-order-modal.component.ts
```
