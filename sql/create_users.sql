-- SócioAll — criar/consertar usuários de login diretamente via SQL
--
-- Use isso se a tela "Criar conta" não funcionar (ex: ficou uma conta travada
-- sem confirmação de e-mail). Mexe direto no schema interno do Auth do
-- Supabase (auth.users / auth.identities) — é um padrão comum para seed de
-- usuários, mas não é uma API oficialmente documentada pelo Supabase, então
-- pode variar um pouco conforme a versão do projeto. Se der erro de coluna
-- inexistente, use a alternativa: Authentication > Users > Add user
-- (marcando "Auto Confirm User") no painel do Supabase.
--
-- Se o usuário já existir, o script só reseta a senha e confirma a conta
-- (não duplica nem dá erro).
--
-- IMPORTANTE — edite a lista de usuários/senhas abaixo antes de rodar.
-- Nunca deixe senhas reais versionadas neste arquivo: qualquer pessoa com
-- acesso ao repositório (mesmo privado, mesmo só ao histórico do Git) veria
-- essas credenciais em texto puro. Se você já rodou este script antes com
-- senhas reais, troque-as agora (Sócios > ícone de chave, ou Authentication >
-- Users no painel do Supabase).

create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

do $$
declare
  r record;
  v_email text;
  v_user_id uuid;
begin
  for r in
    select * from (values
      -- Troque por usuário/senha reais antes de rodar; use senhas fortes
      -- (8+ caracteres, sem seguir o padrão "nome+números").
      ('trocar_usuario_1', 'TrocarSenha!123'),
      ('trocar_usuario_2', 'TrocarSenha!456')
    ) as t(username, password)
  loop
    v_email := lower(r.username) || '@socioall.local';

    select id into v_user_id from auth.users where lower(email) = v_email;

    if v_user_id is null then
      v_user_id := uuid_generate_v4();

      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at, confirmation_token, email_change,
        email_change_token_new, recovery_token
      ) values (
        '00000000-0000-0000-0000-000000000000',
        v_user_id, 'authenticated', 'authenticated', v_email,
        crypt(r.password, gen_salt('bf')),
        now(), '{"provider":"email","providers":["email"]}', '{}',
        now(), now(), '', '', '', ''
      );

      insert into auth.identities (
        id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
      ) values (
        uuid_generate_v4(), v_user_id,
        jsonb_build_object('sub', v_user_id::text, 'email', v_email),
        'email', v_user_id::text, now(), now(), now()
      );
    else
      -- já existe (ex: travado sem confirmar e-mail): reseta senha e confirma
      update auth.users
      set encrypted_password = crypt(r.password, gen_salt('bf')),
          email_confirmed_at = coalesce(email_confirmed_at, now()),
          updated_at = now()
      where id = v_user_id;
    end if;
  end loop;
end $$;
