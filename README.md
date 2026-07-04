# SócioAll

Gestão de custos, despesas e lucros entre sócios — visível para todos.

Site estático: HTML + Bootstrap 5 + JavaScript puro + Supabase (auth e banco de dados). Sem build step, então roda direto no Vercel.

## 1. Configurar o Supabase

O projeto já está conectado a um Supabase real (`js/supabaseClient.js`). Para rodar do zero em outro projeto:

1. Crie um projeto em [supabase.com](https://supabase.com).
2. Vá em **SQL Editor** e rode **`sql/schema_completo.sql`** — um único script que já traz tudo (tabelas, RLS, correções de bugs, comprovantes, dados da empresa). É seguro rodar mesmo que seu projeto já tenha parte do schema aplicada: todo comando usa `if not exists`/`drop ... if exists`, então rodar de novo não duplica nem quebra nada.
3. Vá em **Storage** (menu lateral) e crie manualmente 2 buckets:
   - `logos` → marque como **público**
   - `comprovantes` → deixe **privado**

   **Crie os buckets pela tela do Storage, não por SQL.** Um `insert into storage.buckets` via SQL Editor pode deixar o bucket com metadados incompletos e causar erros como *"the database schema is invalid or incompatible"* na hora do upload — a tela do Storage inicializa o bucket corretamente nos bastidores.
4. Vá em **Project Settings > API** e copie:
   - `Project URL`
   - `anon public key` (ou `publishable key`, no formato mais novo)
5. Abra `js/supabaseClient.js` e substitua `SUPABASE_URL` e `SUPABASE_ANON_KEY`.
6. Em **Authentication > Providers > Email**, **desative "Confirm email"**. Isso é obrigatório: o login do SócioAll é por usuário (ex: `victorlourenco`), não por e-mail real — o app sintetiza um e-mail fake (`usuario@socioall.local`) só para o Supabase Auth aceitar, e nenhuma confirmação por e-mail pode chegar nesse domínio.

`sql/schema_completo.sql` já inclui tudo que estava nos scripts incrementais (`update_v2.sql` a `update_v5.sql`), que continuam no repositório só como histórico de cada mudança — não precisa mais rodar um por um.

### O que foi corrigido/adicionado (agora dentro do `schema_completo.sql`)

- Corrige a exclusão de categoria/sócio que já tem lançamento vinculado (antes falhava com erro de chave estrangeira; agora o lançamento fica sem categoria/sócio).
- Bloqueia no banco (não só na interface) um sócio excluir a si mesmo.
- Bloqueia a soma dos percentuais dos sócios de passar de 100%.
- Impede categorias duplicadas (mesmo nome + tipo).
- Colunas e policies para anexar comprovante a um lançamento (bucket `comprovantes`).
- `site`, `endereco`, `logo_url`, `cnpj`, `telefone`, `email_contato` na tabela `empresas`, e a policy de **update** que faltava (sem ela, ninguém conseguia editar os dados da empresa pela interface).
- Policies do bucket `logos` (logo da empresa).

Se depois de tudo isso você ainda ver o erro **"Bucket not found"** ao salvar a logo ou um comprovante, confira se os buckets `logos`/`comprovantes` foram mesmo criados pela tela do Storage (não por SQL) — veja o passo 3 acima.

### Reset de senha entre sócios

Como não há e-mail real, o reset de senha funciona assim: um sócio já logado pode redefinir a senha de outro sócio da mesma empresa, em **Sócios > ícone de chave**. Isso é feito por uma função serverless (`api/reset-senha-socio.js`) que usa a **Service Role Key** do Supabase — uma chave privilegiada que nunca pode ir para o front-end.

Para habilitar, configure na Vercel (**Project Settings > Environment Variables**):

- `SUPABASE_SERVICE_ROLE_KEY` — em Supabase, **Project Settings > API > service_role key**.
- `SUPABASE_URL` — opcional; se não configurar, a função usa a URL já fixada no código.

Sem essa variável configurada, o botão de resetar senha mostra um erro claro em vez de falhar silenciosamente.

### Dados da empresa (nome, site, endereço, logo)

Em **Configurações** (menu lateral), qualquer sócio pode editar o nome, site, endereço e logo da empresa. Esses dados aparecem no menu lateral de todas as telas internas — a tela de login continua com a marca do SócioAll, sem relação com a empresa cadastrada.

### Comprovantes em lançamentos

Ao criar ou editar um lançamento, dá para anexar um arquivo (imagem ou PDF) como comprovante. Ele fica no bucket privado `comprovantes`; o ícone de clipe na lista de lançamentos abre o arquivo por uma URL assinada temporária (válida por 60 segundos).

### Login por usuário, não por e-mail

Nas telas de login/cadastro, o campo pede um **usuário** (só letras, números, `.`, `-` ou `_`, sem espaços) em vez de e-mail. Por baixo, isso vira `usuario@socioall.local` para o Supabase. Consequência: não existe recuperação de senha por e-mail (não há e-mail real para enviar nada). Para resetar a senha de alguém, use **Sócios > ícone de chave** dentro do próprio app (veja "Reset de senha entre sócios" acima), ou, em último caso, **Authentication > Users** no painel do Supabase.

### Adicionando mais de um sócio com login (mesma empresa)

1. O primeiro sócio cria a conta normalmente em **Criar conta** (isso cria a empresa).
2. Já logado, vai em **Sócios > Adicionar sócio** e cadastra o nome, usuário e percentual do novo sócio (sem login ainda).
3. O novo sócio acessa a mesma tela e clica em **Criar conta**, usando **o mesmo usuário** cadastrado no passo 2. Ele cai automaticamente na empresa já existente, em vez de criar uma nova.

## 2. Testar localmente

Não precisa de servidor especial — qualquer servidor estático funciona:

```bash
npx serve .
```

Abra `http://localhost:3000` no navegador.

## 3. Subir para o GitHub

```bash
git init
git add .
git commit -m "SócioAll — versão inicial"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/socioall.git
git push -u origin main
```

## 4. Deploy no Vercel

1. Acesse [vercel.com](https://vercel.com) e clique em **Add New > Project**.
2. Importe o repositório do GitHub que você acabou de criar.
3. Framework preset: **Other**. Agora existe uma função serverless em `api/`, então a Vercel vai instalar `package.json` no build — isso é automático, não precisa configurar build command.
4. Em **Environment Variables**, adicione `SUPABASE_SERVICE_ROLE_KEY` (necessária para o reset de senha entre sócios — veja acima).
5. Clique em **Deploy**.

Pronto — a cada `git push` na branch `main`, o Vercel republica automaticamente.

## Estrutura do projeto

```
socioall-app/
├── index.html            # login / cadastro (por usuário)
├── dashboard.html        # resumo financeiro + divisão entre sócios
├── lancamentos.html      # receitas e despesas (criar, editar, excluir, comprovante)
├── socios.html           # sócios e percentuais (criar, editar, excluir, resetar senha)
├── categorias.html       # categorias de lançamento (criar, excluir)
├── relatorios.html       # extrato filtrável + exportação CSV (paginado)
├── empresa.html          # dados da empresa: nome, site, endereço, logo
├── css/style.css         # tokens de design (cores, tipografia, toasts, paginação)
├── js/
│   ├── supabaseClient.js # config do Supabase + helpers (auth, toast, confirm modal, loading)
│   ├── auth.js
│   ├── dashboard.js
│   ├── socios.js
│   ├── lancamentos.js
│   ├── categorias.js
│   ├── relatorios.js
│   └── empresa.js
├── api/
│   └── reset-senha-socio.js  # função serverless (Vercel) — reset de senha entre sócios
├── sql/
│   ├── schema.sql        # tabelas + RLS do Supabase (instalação nova)
│   ├── update_v2.sql     # migração incremental (policy de exclusão de sócios)
│   ├── update_v3.sql     # migração incremental (convite de sócio por e-mail)
│   └── update_v4.sql     # migração incremental (bugs de FK, comprovantes, empresa, etc.)
├── package.json          # dependência da função serverless (@supabase/supabase-js)
└── vercel.json
```

## Funcionalidades

- Login e cadastro por usuário (sem e-mail real)
- Convite de sócio: dá para adicionar um sócio antes dele ter conta; ao criar login com o mesmo usuário, ele entra direto na empresa certa
- Lançamentos (receitas/despesas): criar, editar, excluir, anexar **vários** comprovantes por lançamento, paginação
- Sócios: criar, editar, excluir (não é possível excluir o próprio registro, nem no banco), resetar senha de outro sócio
- Categorias: criar e excluir pela interface (sem duplicar nome + tipo)
- Relatórios com filtro por período/tipo, paginação e exportação em CSV e PDF (exporta tudo que bate com o filtro, não só a página visível)
- Dashboard com gráfico de receitas x despesas dos últimos 6 meses e divisão do lucro entre sócios
- Configurações da empresa: nome, site, endereço e logo — aparecem no menu lateral de todas as telas internas
- Percentual dos sócios não pode passar de 100% (bloqueado no banco)
- Log de auditoria (`audit_logs`) para criação/edição/exclusão de lançamentos e sócios, visível em Sócios > Histórico de alterações
- Notificações (toast) e confirmação em modal no lugar de `alert()`/`confirm()` do navegador
- Textos de usuário (nomes, descrições) são escapados antes de exibir, evitando XSS
- Headers de segurança (CSP, X-Frame-Options, HSTS, etc.) configurados em `vercel.json`
- Identidade visual baseada na logo (navy `#