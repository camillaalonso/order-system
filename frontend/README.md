# Frontend — Sistema de Ordens de Investimento

Frontend em **Angular 21** (standalone components, lazy routes) que consome a API do `backend/`.

Inclui as quatro telas pedidas pelo desafio:

| Rota          | Tela                                                                   |
|---------------|------------------------------------------------------------------------|
| `/assets`     | Lista de ativos com cotação atual + botão "Comprar/Vender"             |
| `/positions`  | Posições do usuário com saldo e preço médio por ativo                  |
| `/orders`     | Lista de ordens com filtro por status e botão de cancelamento          |
| modal         | Formulário de criação de ordem (chamado a partir da lista de ativos)   |

A rota raiz (`/`) redireciona para `/assets`.

---

## Pré-requisitos

- Node.js **22+**
- Backend rodando em `http://localhost:3000` (ver [`../backend/README.md`](../backend/README.md))

---

## Como rodar

```bash
npm install
npm start            # http://localhost:4200
```

Outros scripts úteis:

```bash
npm run build        # build de produção em dist/
npm test             # testes unitários (Vitest)
```

---

## Configuração

- **URL do backend:** definida em `src/app/api/api.service.ts` (`BASE_URL = 'http://localhost:3000'`). Em produção, viraria env-config via `environment.ts`.
- **Auth:** o backend está com auth fake (`x-user-id` no header). O frontend injeta esse header automaticamente via `auth.interceptor.ts` com `user-001`. Quando o backend ganhar JWT, o interceptor passa a ler o token do storage.

---

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
