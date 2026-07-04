# SócioAll — Análise do projeto e plano de melhorias

Data da análise: 2026-07-03

Auditoria feita por 3 agentes especializados (segurança/backend, código frontend, UX/acessibilidade), cobrindo todo o repositório: `js/`, `api/`, `sql/`, `css/`, HTMLs e configuração de deploy.

## Resumo executivo

O projeto está sólido para o estágio (MVP em produção): RLS bem aplicado no Supabase, escaping de HTML consistente (sem XSS armazenado encontrado), paginação real no servidor, toasts/modais substituindo `alert()`/`confirm()`, e boa separação da Service Role Key no backend. Os problemas encontrados são principalmente de **autorização refinada**, **duplicação de código** (sidebar repetida em 7 páginas) e **acessibilidade** (contraste, labels, aria). Nenhum problema crítico de exposição de dados foi encontrado.

## Prioridade 1 — Segurança (fazer antes de novas features)

1. **`socios_update` sem `with check`**: qualquer sócio pode editar `email`/`user_id`/percentual de qualquer outro sócio da empresa, incluindo sócios já vinculados a login. Adicionar `with check` bloqueando alteração de `user_id`/`email` quando `user_id is not null`.
2. **Rate limiting + log de auditoria no reset de senha** (`api/reset-senha-socio.js`): hoje qualquer sócio pode resetar a senha de outro repetidamente, sem limite nem registro de quem fez o quê.
3. **`empresas_update` sem `with check`**: nada impede reatribuir `created_by` via chamada direta à API REST do Supabase. Adicionar `with check` preservando o valor original (trigger, como já feito para percentual de sócios).
4. **Credenciais de exemplo em `sql/create_users.sql`** (`rafael123`, `victor123`): remover do repositório versionado ou marcar claramente como seed de dev descartável, com senhas aleatórias.
5. **Mensagens de erro verbosas em produção**: `friendlyErrorMessage()` e o erro 500 do endpoint de reset expõem nomes de tabelas/policies do Postgres ao usuário final. Restringir esse detalhe a modo debug; em produção, mensagem genérica + log no servidor.

## Prioridade 2 — Manutenibilidade do código

1. **Sidebar duplicada em 7 arquivos HTML** (~90 linhas idênticas cada): maior risco de inconsistência do projeto. Extrair para um partial carregado via `fetch()` + `innerHTML`, ou Web Component `<sa-sidebar>` — sem precisar de build step.
2. **Boilerplate de inicialização de página repetido 6x** (`requireAuth` + `getEmpresaContext` + `renderSidebarUser`): extrair `initAuthenticatedPage()` em um `common.js`.
3. **`supabaseClient.js` acumula 3 responsabilidades** (config do client, utilitários de UI, lógica de domínio): separar em `supabase-config.js`, `common.js`, `empresa-context.js`.
4. **Padrão "disable botão durante salvamento"** duplicado em 3 arquivos, inconsistente em `categorias.js` (não desabilita) — padronizar com um helper `withLoadingButton()`.
5. **`relatorios.js` recalcula o resumo sem paginação a cada troca de página** — recalcular só quando o filtro mudar, ou mover para agregação no banco.
6. **Bug de precedência**: `escapeHtml(x) || "—"` deveria ser `escapeHtml(x || "—")` (funciona hoje por acidente, é uma armadilha para manutenção futura). Em `lancamentos.js` e `relatorios.js`.
7. **`loadCategorias()` em `lancamentos.js` ignora erros silenciosamente** — alinhar com o tratamento já usado em `loadLancamentos()`.

## Prioridade 3 — Acessibilidade / UX

1. **Labels sem atributo `for`** em todos os formulários das 8 páginas — quebra leitores de tela. Correção simples e de alto impacto.
2. **Contraste do teal puro (`#0EA79A`) sobre fundo claro falha WCAG AA** (2.99:1, mínimo 4.5:1) — usar `--sa-teal-dark` para texto/ícones pequenos, reservar o teal puro para elementos grandes/decorativos.
3. **Toasts e alertas sem `aria-live`/`role="alert"`** — leitor de tela não anuncia sucesso/erro.
4. **Tabelas sem `.table-responsive`** em lançamentos/relatórios/sócios/categorias — risco real de quebra de layout em mobile.
5. **Botões só-com-ícone sem `aria-label`** (editar/excluir nas tabelas).
6. Itens menores: `autocomplete` em campos de senha, `aria-labelledby` no modal de confirmação, cores do gráfico do dashboard fora do design system.

## Pontos fortes (não mexer)

- RLS habilitado em todas as tabelas de negócio, sem policy `using(true)` indevida.
- Isolamento correto da Service Role Key (só no servidor, com erro claro se ausente).
- Escaping de HTML consistente em 100% dos pontos que usam `innerHTML` com dado do usuário — nenhum XSS armazenado encontrado.
- Paginação real via `.range()` + `count: exact`, embeds do PostgREST evitando N+1.
- Regras de negócio (percentual ≤ 100%, bloqueio de auto-exclusão) implementadas em duas camadas: banco (trigger/policy) e interface.
- UX de ações destrutivas consistente: confirmação em modal + toast em 100% dos casos de exclusão encontrados.

## Próximo passo sugerido

Como o usuário vai criar novas funcionalidades em seguida, recomendo fechar a Prioridade 1 (segurança) primeiro — são mudanças pequenas e isoladas (policies SQL + 1 arquivo serverless) que não interferem no roadmap de features. As Prioridades 2 e 3 podem ser feitas em paralelo ou intercaladas com as novas funções, já que não bloqueiam nada.
