# Alphractal — Front-end

Projeto React (Vite + TypeScript) com a tela de login e o app autenticado
(navegação lateral + páginas prontas para receber funcionalidades).

## Stack

- React 19 + TypeScript
- Vite 8
- React Router 7
- CSS puro com design tokens em `src/index.css` (sem framework de UI)
- Fontes: **Outfit** (display) e **Instrument Sans** (interface), via Google Fonts

## Rodando

```bash
npm install
npm run dev      # http://localhost:5173
```

Sem `VITE_API_URL` configurada, a aplicação usa o **backend simulado**
(`src/lib/mockBackend.ts`): qualquer e-mail ou telefone válido com senha de 6+
caracteres entra, e as páginas recebem dados de exemplo com latência real.

Outros scripts:

```bash
npm run build    # typecheck + build de produção em dist/
npm run preview  # serve o build
npm run lint     # oxlint
```

## Rotas

| Rota          | Tela          | Acesso        |
| ------------- | ------------- | ------------- |
| `/login`      | Login         | Só visitantes |
| `/`           | Tela Inicial  | Autenticado   |
| `/analise`    | Análise       | Autenticado   |
| `/predicoes`  | Predições     | Autenticado   |

Os guardas ficam em `src/routes/RouteGuards.tsx`. Enquanto a sessão salva é
validada, a `SplashScreen` é exibida; visitantes são enviados ao login com a rota
de origem em `location.state.from`, e voltam para ela após entrar.

## Estrutura

```
src/
  auth/
    AuthContext.ts      contexto e tipos da sessão
    AuthProvider.tsx    restaura sessão, signIn e signOut
    authService.ts      chamadas de /auth/*
    useAuth.ts          hook de consumo
  components/
    AppShell.tsx/.css   sidebar de navegação + área de conteúdo
    Backdrop.tsx/.css   fundo em camadas (variantes auth e app)
    Logo.tsx            marca da Alphractal (src/assets/favicon.svg)
    PageHeader.tsx      título e ações da página
    Panel.tsx           cartão de conteúdo (com modo placeholder)
    ResourceState.tsx   estados de carregando, erro e vazio
    SplashScreen.tsx    carregamento inicial da sessão
    ui.css              estilos das primitivas acima
  hooks/
    useResource.ts      busca um recurso da API (loading, error, reload)
  lib/
    api.ts              cliente HTTP, Bearer token e tratamento de 401
    endpoints.ts        todos os caminhos do backend
    errors.ts           ApiError
    mockBackend.ts      backend simulado para desenvolvimento
    session.ts          persistência do token
  pages/
    LoginPage.tsx/.css  tela de login
    HomePage.tsx        Tela Inicial
    AnalysisPage.tsx    Análise
    PredictionsPage.tsx Predições
    pages.css           estilos de métricas e listas
  routes/RouteGuards.tsx
  types.ts              contratos de dados
```

## Plugando o backend real

1. Copie `.env.example` para `.env` e preencha:

```env
VITE_API_URL=https://api.seudominio.com
```

2. Confira os caminhos em `src/lib/endpoints.ts` — é o único lugar que precisa
   mudar se a sua API usa outros nomes.
3. Ajuste os tipos em `src/types.ts` para o formato que a API devolve.

Feito isso, `mockBackend.ts` deixa de ser chamado e nenhuma tela precisa de
alteração.

### Contratos esperados

```
POST /auth/login   body: { identifier, password }
                   200:  { token, user: { id, name, email, plan } }
                   401:  { message: "E-mail ou senha incorretos." }

GET  /auth/me      200:  { id, name, email, plan }
POST /auth/logout  204

GET  /dashboard/overview  200: { updatedAt, metrics: [{ id, label, value, change, hint }] }
GET  /analysis/assets     200: { assets: [{ id, symbol, name, score, trend }] }
GET  /predictions/latest  200: { generatedAt, items: [{ id, asset, horizon, direction, confidence }] }
```

O campo `message` de respostas de erro é o que aparece na interface. Em qualquer
401 numa rota autenticada, o cliente limpa a sessão e devolve o usuário ao login.

### Autenticação

O token vai para o `localStorage` (`alphractal.token`) e é enviado como
`Authorization: Bearer <token>`. Se a sua API usa cookie de sessão, remova o
token de `src/lib/session.ts` e adicione `credentials: "include"` ao `fetch` de
`src/lib/api.ts`.

## Adicionando uma nova tela

1. Crie a página em `src/pages/`.
2. Registre a rota em `src/App.tsx`, dentro de `<Route element={<AppShell />}>`.
3. Adicione o item em `navigation`, no topo de `src/components/AppShell.tsx`.

Para buscar dados, use o hook e deixe os estados para o `ResourceState`:

```tsx
const recurso = useResource<MeuTipo>(endpoints.meuRecurso);

<ResourceState
  loading={recurso.loading}
  error={recurso.error}
  onRetry={recurso.reload}
>
  {/* conteúdo com recurso.data */}
</ResourceState>;
```

## Sobre o fundo

O fundo é composto por camadas independentes em `Backdrop.css`, todas decorativas
e fora da árvore de acessibilidade:

1. **Base** — gradientes radiais azuis sobre um degradê navy/preto.
2. **Aurora** — três manchas desfocadas com deriva lenta (`drift-a`, `drift-b`, `pulse`).
3. **Grão + vinheta** — ruído em `overlay` e escurecimento das bordas.

A variante `auth` acende o canto inferior esquerdo (tela de login) e a `app`
concentra o brilho à direita. Para calibrar a intensidade, ajuste a `opacity` de
`.backdrop__aurora` e os `rgba()` de `.backdrop__base`.

## Acessibilidade

- Labels visualmente ocultos, mas presentes para leitores de tela
- `aria-invalid` / `aria-describedby` ligando os campos ao feedback
- Foco visível (`:focus-visible`) em todos os controles
- Estados de carregamento anunciados via `aria-busy` e `aria-live`
- Animações respeitam `prefers-reduced-motion`
