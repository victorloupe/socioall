-- SócioAll — schema completo (consolida schema.sql + update_v2 a update_v5)
--
-- Este arquivo substitui a necessidade de rodar 5 scripts em sequência.
-- É seguro rodar tanto num projeto Supabase novo (do zero) quanto num projeto
-- que já tem parte do schema antigo aplicado — todo comando usa "if not exists"
-- ou "drop ... if exists" antes de recriar, então rodar de novo não quebra nada.
--
-- PASSO A PASSO:
--   1) Cole este arquivo inteiro no SQL Editor do Supabase e rode.
--   2) Vá em Storage (menu lateral do painel) e crie manualmente 2 buckets:
--        - "logos"        → marque como PÚBLICO
--        - "comprovantes" → deixe PRIVADO (não marque público)
--      Importante: crie os buckets pela tela do Storage, não por SQL. Criar
--      bucket via "insert into storage.buckets" pode deixá-lo com metadados
--      incompletos e causar erros como "the database schema is invalid or
--      incompatible" ao tentar fazer upload — a tela do Storage inicializa o
--      bucket corretamente nos bastidores.
--   3) Em Authentication > Providers > Email, desative "Confirm email".
--
-- Depois disso o app está 100% funcional: lançamentos, sócios, categorias,
-- relatórios, comprovantes, dados da empresa (com logo) e reset de senha entre
-- sócios (esse último também precisa da SUPABASE_SERVICE_ROLE_KEY na Vercel —
-- veja o README).

create extension if not exists "uuid-ossp";

-- ============================================================
-- TABELAS
-- ============================================================

create table if not exists empresas (
  id uuid primary key default uuid_generate_v4(),
  nome text not null,
  created_by uuid references auth.users(id) not null,
  created_at timestamptz default now(),
  site text,
  endereco text,
  logo_url text,
  cnpj text,
  telefone text,
  email_contato text
);

-- Garante as colunas mesmo se a tabela já existia de uma instalação antiga.
alter table empresas add column if not exists site text;
alter table empresas add column if not exists endereco text;
alter table empresas add column if not exists logo_url text;
alter table empresas add column if not exists cnpj text;
alter table empresas add column if not exists telefone text;
alter table empresas add column if not exists email_contato text;

create table if not exists socios (
  id uuid primary key default uuid_generate_v4(),
  empresa_id uuid references empresas(id) on delete cascade not null,
  user_id uuid references auth.users(id),
  nome text not null,
  email text,
  percentual numeric(5,2) not null default 0 check (percentual >= 0 and percentual <= 100),
  created_at timestamptz default now()
);

create table if not exists categorias (
  id uuid primary key default uuid_generate_v4(),
  empresa_id uuid references empresas(id) on delete cascade not null,
  nome text not null,
  tipo text not null check (tipo in ('receita', 'despesa')),
  created_at timestamptz default now()
);

create table if not exists lancamentos (
  id uuid primary key default uuid_generate_v4(),
  empresa_id uuid references empresas(id) on delete cascade not null,
  categoria_id uuid references categorias(id) on delete set null,
  socio_id uuid references socios(id) on delete set null,
  tipo text not null check (tipo in ('receita', 'despesa')),
  descricao text not null,
  valor numeric(12,2) not null check (valor > 0),
  data date not null default current_date,
  created_at timestamptz default now(),
  comprovante_path text
);

alter table lancamentos add column if not exists comprovante_path text;

-- Corrige a FK para ON DELETE SET NULL mesmo se a tabela já existia sem isso
-- (senão excluir uma categoria/sócio com lançamento vinculado falha).
alter table lancamentos drop constraint if exists lancamentos_categoria_id_fkey;
alter table lancamentos add constraint lancamentos_categoria_id_fkey
  foreign key (categoria_id) references categorias(id) on delete set null;

alter table lancamentos drop constraint if exists lancamentos_socio_id_fkey;
alter table lancamentos add constraint lancamentos_socio_id_fkey
  foreign key (socio_id) references socios(id) on delete set null;

-- Índices úteis
create index if not exists idx_socios_empresa on socios(empresa_id);
create index if not exists idx_lancamentos_empresa on lancamentos(empresa_id);
create index if not exists idx_lancamentos_data on lancamentos(data);

-- Categoria duplicada (mesmo nome + tipo, na mesma empresa) não é permitida.
create unique index if not exists categorias_unique_nome_tipo
  on categorias (empresa_id, lower(nome), tipo);

-- ============================================================
-- FUNÇÃO AUXILIAR DE RLS
-- ============================================================

-- Evita recursão infinita (loop de RLS no Postgres) ao consultar a tabela "socios".
-- Definida com SECURITY DEFINER para rodar com privilégios de bypass de RLS.
create or replace function get_user_empresas(v_user_id uuid)
returns table(empresa_id uuid)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  return query
  select s.empresa_id from socios s where s.user_id = v_user_id;
end;
$$;

grant execute on function get_user_empresas(uuid) to authenticated;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table empresas enable row level security;
alter table socios enable row level security;
alter table categorias enable row level security;
alter table lancamentos enable row level security;

drop policy if exists "empresas_select" on empresas;
create policy "empresas_select" on empresas for select
  using (id in (select * from get_user_empresas(auth.uid())) or created_by = auth.uid());

drop policy if exists "empresas_insert" on empresas;
create policy "empresas_insert" on empresas for insert
  with check (created_by = auth.uid());

-- Faltava no schema original: sem isso, ninguém conseguia editar os dados da empresa.
drop policy if exists "empresas_update" on empresas;
create policy "empresas_update" on empresas for update
  using (id in (select * from get_user_empresas(auth.uid())) or created_by = auth.uid());

drop policy if exists "socios_select" on socios;
create policy "socios_select" on socios for select
  using (empresa_id in (select * from get_user_empresas(auth.uid())));

drop policy if exists "socios_insert" on socios;
create policy "socios_insert" on socios for insert
  with check (empresa_id in (select id from empresas where created_by = auth.uid())
              or empresa_id in (select * from get_user_empresas(auth.uid())));

drop policy if exists "socios_update" on socios;
create policy "socios_update" on socios for update
  using (empresa_id in (select * from get_user_empresas(auth.uid())));

-- Um sócio não pode excluir a si mesmo (trava no banco, não só na interface).
drop policy if exists "socios_delete" on socios;
create policy "socios_delete" on socios for delete
  using (
    empresa_id in (select * from get_user_empresas(auth.uid()))
    and user_id is distinct from auth.uid()
  );

drop policy if exists "categorias_all" on categorias;
create policy "categorias_all" on categorias for all
  using (empresa_id in (select * from get_user_empresas(auth.uid())));

drop policy if exists "lancamentos_all" on lancamentos;
create policy "lancamentos_all" on lancamentos for all
  using (empresa_id in (select * from get_user_empresas(auth.uid())));

-- ============================================================
-- FUNÇÕES
-- ============================================================

-- Vincula automaticamente um sócio "convidado" (cadastrado só com nome+e-mail,
-- sem user_id) à conta certa assim que essa pessoa cria login com o mesmo e-mail.
create or replace function claim_socio_invite()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  select email into v_email from auth.users where id = auth.uid();
  if v_email is null then
    return;
  end if;

  update socios
  set user_id = auth.uid()
  where user_id is null
    and lower(email) = lower(v_email);
end;
$$;

grant execute on function claim_socio_invite() to authenticated;

-- Bloqueia a soma dos percentuais dos sócios de uma empresa passar de 100%.
create or replace function check_percentual_socios()
returns trigger
language plpgsql
as $$
declare
  v_total numeric;
begin
  select coalesce(sum(percentual), 0) into v_total
  from socios
  where empresa_id = new.empresa_id
    and id <> new.id;

  v_total := v_total + new.percentual;

  if v_total > 100.01 then
    raise exception 'A soma dos percentuais dos sócios não pode passar de 100%% (ficaria em %).', round(v_total, 1);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_check_percentual_socios on socios;
create trigger trg_check_percentual_socios
  before insert or update of percentual, empresa_id on socios
  for each row execute function check_percentual_socios();

-- Impede que o campo user_id/email de um sócio JÁ VINCULADO a um login seja
-- alterado por outro sócio da empresa (ex: via chamada direta à API REST do
-- Supabase). Antes disso, a policy "socios_update" só validava empresa_id,
-- então qualquer sócio podia reatribuir o login de outro sócio.
create or replace function protect_socio_vinculo()
returns trigger
language plpgsql
as $$
begin
  if old.user_id is not null and (
    new.user_id is distinct from old.user_id
    or new.email is distinct from old.email
  ) then
    raise exception 'Não é possível alterar o usuário/e-mail de um sócio que já possui login.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_socio_vinculo on socios;
create trigger trg_protect_socio_vinculo
  before update of user_id, email on socios
  for each row execute function protect_socio_vinculo();

-- Impede que created_by da empresa seja reatribuído via update direto
-- (a policy "empresas_update" só validava que o autor pertence à empresa,
-- não impedia trocar quem é o "created_by").
create or replace function protect_empresa_created_by()
returns trigger
language plpgsql
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'Não é possível alterar o criador da empresa.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_empresa_created_by on empresas;
create trigger trg_protect_empresa_created_by
  before update of created_by on empresas
  for each row execute function protect_empresa_created_by();

-- ============================================================
-- LOG DE AUDITORIA + RATE LIMIT DO RESET DE SENHA ENTRE SÓCIOS
-- ============================================================
-- Usada pela função serverless api/reset-senha-socio.js (via service role,
-- que ignora RLS) para registrar quem resetou a senha de quem, e para
-- impedir que um sócio fique resetando a senha de outro repetidamente.

create table if not exists reset_senha_logs (
  id uuid primary key default uuid_generate_v4(),
  empresa_id uuid references empresas(id) on delete cascade,
  caller_user_id uuid references auth.users(id),
  caller_socio_id uuid references socios(id) on delete set null,
  target_socio_id uuid references socios(id) on delete set null,
  created_at timestamptz default now()
);

alter table reset_senha_logs enable row level security;

-- Sócios da empresa podem ver o histórico de resets (transparência); só a
-- service role (backend) pode inserir, então não há policy de insert aqui.
drop policy if exists "reset_senha_logs_select" on reset_senha_logs;
create policy "reset_senha_logs_select" on reset_senha_logs for select
  using (empresa_id in (select * from get_user_empresas(auth.uid())));

create index if not exists idx_reset_senha_logs_caller
  on reset_senha_logs(caller_user_id, created_at);

-- ============================================================
-- STORAGE (policies) — crie os buckets "logos" e "comprovantes" pelo painel
-- (Storage > New bucket) ANTES ou DEPOIS de rodar isso; as policies abaixo só
-- fazem referência ao nome do bucket, não dependem da ordem.
-- ============================================================

drop policy if exists "comprovantes_select" on storage.objects;
create policy "comprovantes_select" on storage.objects for select
  using (
    bucket_id = 'comprovantes'
    and (storage.foldername(name))[1]::uuid in (select * from get_user_empresas(auth.uid()))
  );

drop policy if exists "comprovantes_insert" on storage.objects;
create policy "comprovantes_insert" on storage.objects for insert
  with check (
    bucket_id = 'comprovantes'
    and (storage.foldername(name))[1]::uuid in (select * from get_user_empresas(auth.uid()))
  );

drop policy if exists "comprovantes_delete" on storage.objects;
create policy "comprovantes_delete" on storage.objects for delete
  using (
    bucket_id = 'comprovantes'
    and (storage.foldername(name))[1]::uuid in (select * from get_user_empresas(auth.uid()))
  );

drop policy if exists "logos_select" on storage.objects;
create policy "logos_select" on storage.objects for select
  using (bucket_id = 'logos');

drop policy if exists "logos_insert" on storage.objects;
create policy "logos_insert" on storage.objects for insert
  with check (
    bucket_id = 'logos'
    and (storage.foldername(name))[1]::uuid in (select * from get_user_empresas(auth.uid()))
  );

drop policy if exists "logos_update" on storage.objects;
create policy "logos_update" on storage.objects for update
  using (
    bucket_id = 'logos'
    and (storage.foldername(name))[1]::uuid in (select * from get_user_empresas(auth.uid()))
  );

drop policy if exists "logos_delete" on storage.objects;
create policy "logos_delete" on storage.objects for delete
  using (
    bucket_id = 'logos'
    and (storage.foldername(name))[1]::uuid in (select * from get_user_empresas(auth.uid()))
  );

-- ============================================================
-- E-COMMERCE: LOJAS (taxas de marketplace), CALCULADORA DE PREÇO
-- E PEDIDOS (estrutura pronta para integração futura)
-- ============================================================

-- Lojas/marketplaces cadastrados pela empresa, com a taxa cobrada por venda.
-- taxa_percentual = comissão em % sobre o preço de venda.
-- taxa_fixa = custo fixo em R$ cobrado por venda (comum em Shopee/Mercado
-- Livre para produtos de menor valor). Ambas editáveis a qualquer momento,
-- pois os marketplaces mudam a política de taxas com frequência.
create table if not exists lojas_ecommerce (
  id uuid primary key default uuid_generate_v4(),
  empresa_id uuid references empresas(id) on delete cascade not null,
  nome text not null,
  taxa_percentual numeric(5,2) not null default 0 check (taxa_percentual >= 0 and taxa_percentual < 100),
  taxa_fixa numeric(10,2) not null default 0 check (taxa_fixa >= 0),
  link_referencia text,
  observacoes text,
  created_at timestamptz default now()
);

-- Guarda quando a taxa foi revisada pela última vez, para a calculadora
-- avisar quando uma loja está com a taxa há muito tempo sem revisão (os
-- marketplaces mudam a política de comissão com frequência).
alter table lojas_ecommerce add column if not exists updated_at timestamptz;
update lojas_ecommerce set updated_at = created_at where updated_at is null;
alter table lojas_ecommerce alter column updated_at set default now();

create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_lojas_ecommerce on lojas_ecommerce;
create trigger trg_touch_lojas_ecommerce
  before update on lojas_ecommerce
  for each row execute function touch_updated_at();

alter table lojas_ecommerce enable row level security;
grant select, insert, update, delete on lojas_ecommerce to authenticated;

drop policy if exists "lojas_ecommerce_all" on lojas_ecommerce;
create policy "lojas_ecommerce_all" on lojas_ecommerce for all
  using (empresa_id in (select * from get_user_empresas(auth.uid())))
  with check (empresa_id in (select * from get_user_empresas(auth.uid())));

create unique index if not exists lojas_ecommerce_unique_nome
  on lojas_ecommerce (empresa_id, lower(nome));

-- Histórico opcional de cálculos de preço de venda. Só existe uma linha aqui
-- quando o sócio explicitamente clica em "Salvar no histórico" — calcular
-- sozinho, sem salvar, não grava nada nesta tabela.
create table if not exists calculos_preco (
  id uuid primary key default uuid_generate_v4(),
  empresa_id uuid references empresas(id) on delete cascade not null,
  socio_id uuid references socios(id) on delete set null,
  loja_id uuid references lojas_ecommerce(id) on delete set null,
  nome_produto text not null,
  link_venda text,
  link_referencia text,
  preco_referencia numeric(12,2),
  custo_produto numeric(12,2) not null default 0,
  custo_embalagem numeric(12,2) not null default 1,
  custo_operacional numeric(12,2) not null default 0,
  lucro_desejado numeric(12,2) not null default 0,
  taxa_percentual_usada numeric(5,2) not null default 0,
  taxa_fixa_usada numeric(10,2) not null default 0,
  preco_venda numeric(12,2) not null default 0,
  created_at timestamptz default now()
);

alter table calculos_preco add column if not exists preco_referencia numeric(12,2);

alter table calculos_preco enable row level security;
grant select, insert, update, delete on calculos_preco to authenticated;

drop policy if exists "calculos_preco_all" on calculos_preco;
create policy "calculos_preco_all" on calculos_preco for all
  using (empresa_id in (select * from get_user_empresas(auth.uid())))
  with check (empresa_id in (select * from get_user_empresas(auth.uid())));

create index if not exists idx_calculos_preco_empresa on calculos_preco(empresa_id, created_at desc);

-- Placeholder para a futura integração de pedidos vindos dos marketplaces
-- (ainda sem nenhuma integração real — só a estrutura pronta).
create table if not exists pedidos_ecommerce (
  id uuid primary key default uuid_generate_v4(),
  empresa_id uuid references empresas(id) on delete cascade not null,
  loja_id uuid references lojas_ecommerce(id) on delete set null,
  numero_pedido text,
  nome_produto text,
  valor numeric(12,2),
  status text not null default 'pendente',
  created_at timestamptz default now(),
  lancamento_id uuid references lancamentos(id) on delete set null
);

alter table pedidos_ecommerce add column if not exists lancamento_id uuid references lancamentos(id) on delete set null;


alter table pedidos_ecommerce enable row level security;
grant select, insert, update, delete on pedidos_ecommerce to authenticated;

drop policy if exists "pedidos_ecommerce_all" on pedidos_ecommerce;
create policy "pedidos_ecommerce_all" on pedidos_ecommerce for all
  using (empresa_id in (select * from get_user_empresas(auth.uid())))
  with check (empresa_id in (select * from get_user_empresas(auth.uid())));

-- Cria as 3 lojas mais comuns já com uma taxa de referência preenchida
-- (pesquisado em jul/2026 — os marketplaces mudam taxa com frequência, então
-- trate isso como ponto de partida editável, não como valor definitivo).
-- Chamada pelo front-end na primeira vez que a empresa abre a calculadora.
create or replace function seed_lojas_padrao(p_empresa_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_empresa_id not in (select * from get_user_empresas(auth.uid())) then
    raise exception 'Você não pertence a essa empresa.';
  end if;

  insert into lojas_ecommerce (empresa_id, nome, taxa_percentual, taxa_fixa, observacoes)
  values
    (p_empresa_id, 'Shopee', 14, 20,
     'Taxa por faixa de preço (vendedor CNPJ): até R$79,99 = 20%+R$4; R$80–99,99 = 14%+R$16; R$100–199,99 = 14%+R$20; acima de R$200 = 14%+R$26. Ajuste conforme a faixa do seu produto.'),
    (p_empresa_id, 'TikTok Shop', 12, 6,
     'Taxa por faixa de preço: até R$49,99 = 16% (sem taxa fixa); a partir de R$50,00 = 12%+R$6,00. Valores já incluem 6% do programa de frete grátis. Ajuste conforme a sua conta.'),
    (p_empresa_id, 'Mercado Livre', 12, 6,
     'Anúncio Clássico: 10–14%. Premium: 15–19%. Produtos até R$79 pagam também custo fixo por unidade (~R$5,50–R$6,00+). Confira a taxa exata da categoria do seu produto no Seller Center.'),
    (p_empresa_id, 'Amazon', 15, 0,
     'Taxa de referência entre 8% e 15% conforme a categoria (pode chegar a 20% em algumas categorias específicas). Confira a categoria exata no Seller Central.')
  on conflict (empresa_id, lower(nome)) do nothing;
end;
$$;

grant execute on function seed_lojas_padrao(uuid) to authenticated;

-- ============================================================
-- LOG DE AUDITORIA GERAL (lançamentos e sócios)
-- ============================================================
-- Amplia o padrão já usado em reset_senha_logs para cobrir criação, edição e
-- exclusão de lançamentos e sócios — dá transparência entre os sócios sobre
-- quem mexeu no quê. Alimentada só por triggers (SECURITY DEFINER, mesmo
-- padrão de get_user_empresas/seed_lojas_padrao); não há policy de insert
-- porque ninguém deve conseguir gravar aqui diretamente pela API.

create table if not exists audit_logs (
  id uuid primary key default uuid_generate_v4(),
  empresa_id uuid references empresas(id) on delete cascade,
  tabela text not null,
  registro_id uuid,
  acao text not null check (acao in ('insert', 'update', 'delete')),
  socio_id uuid references socios(id) on delete set null,
  user_id uuid references auth.users(id),
  dados_antigos jsonb,
  dados_novos jsonb,
  created_at timestamptz default now()
);

alter table audit_logs enable row level security;
grant select on audit_logs to authenticated;

drop policy if exists "audit_logs_select" on audit_logs;
create policy "audit_logs_select" on audit_logs for select
  using (empresa_id in (select * from get_user_empresas(auth.uid())));

create index if not exists idx_audit_logs_empresa on audit_logs(empresa_id, created_at desc);

create or replace function log_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa_id uuid;
  v_socio_id uuid;
begin
  v_empresa_id := coalesce(new.empresa_id, old.empresa_id);
  select id into v_socio_id from socios where user_id = auth.uid() and empresa_id = v_empresa_id limit 1;

  insert into audit_logs (empresa_id, tabela, registro_id, acao, socio_id, user_id, dados_antigos, dados_novos)
  values (
    v_empresa_id,
    tg_table_name,
    coalesce(new.id, old.id),
    lower(tg_op),
    v_socio_id,
    auth.uid(),
    case when tg_op in ('update', 'delete') then to_jsonb(old) else null end,
    case when tg_op in ('insert', 'update') then to_jsonb(new) else null end
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_audit_lancamentos on lancamentos;
create trigger trg_audit_lancamentos
  after insert or update or delete on lancamentos
  for each row execute function log_audit_event();

drop trigger if exists trg_audit_socios on socios;
create trigger trg_audit_socios
  after insert or update or delete on socios
  for each row execute function log_audit_event();

-- ============================================================
-- MÚLTIPLOS COMPROVANTES POR LANÇAMENTO
-- ============================================================
-- Antes, cada lançamento só podia ter 1 comprovante (coluna
-- lancamentos.comprovante_path). Essa tabela permite vários por lançamento;
-- a coluna antiga é mantida (não é mais escrita por código novo) e seus
-- dados são migrados abaixo, para não perder anexos já enviados.

create table if not exists lancamento_comprovantes (
  id uuid primary key default uuid_generate_v4(),
  lancamento_id uuid references lancamentos(id) on delete cascade not null,
  empresa_id uuid references empresas(id) on delete cascade not null,
  path text not null,
  nome_arquivo text,
  created_at timestamptz default now()
);

alter table lancamento_comprovantes enable row level security;
grant select, insert, update, delete on lancamento_comprovantes to authenticated;

drop policy if exists "lancamento_comprovantes_all" on lancamento_comprovantes;
create policy "lancamento_comprovantes_all" on lancamento_comprovantes for all
  using (empresa_id in (select * from get_user_empresas(auth.uid())))
  with check (empresa_id in (select * from get_user_empresas(auth.uid())));

create index if not exists idx_lancamento_comprovantes_lancamento
  on lancamento_comprovantes(lancamento_id);

-- Migra os comprovantes únicos já existentes (idempotente: só insere o que
-- ainda não foi migrado, então rodar este script de novo não duplica nada).
insert into lancamento_comprovantes (lancamento_id, empresa_id, path)
select l.id, l.empresa_id, l.comprovante_path
from lancamentos l
where l.comprovante_path is not null
  and not exists (
    select 1 from lancamento_comprovantes lc
    where lc.lancamento_id = l.id and lc.path = l.comprovante_path
  );
