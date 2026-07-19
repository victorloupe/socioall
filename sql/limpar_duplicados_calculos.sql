-- =====================================================================
-- Limpeza de duplicados na tabela calculos_preco
-- Mantém apenas o registro MAIS RECENTE de cada combinação
-- produto (ignorando maiúsculas/espaços) + loja + empresa.
-- Rodar no SQL Editor do Supabase.
-- =====================================================================

-- 1) (Opcional) Conferir antes o que será removido:
-- select c.id, c.nome_produto, c.loja_id, c.created_at
-- from calculos_preco c
-- where exists (
--   select 1 from calculos_preco d
--   where d.empresa_id = c.empresa_id
--     and lower(trim(d.nome_produto)) = lower(trim(c.nome_produto))
--     and d.loja_id is not distinct from c.loja_id
--     and (d.created_at > c.created_at or (d.created_at = c.created_at and d.id > c.id))
-- )
-- order by c.nome_produto, c.created_at;

-- 2) Remover os duplicados (mantém o mais recente):
delete from calculos_preco c
using calculos_preco d
where d.empresa_id = c.empresa_id
  and lower(trim(d.nome_produto)) = lower(trim(c.nome_produto))
  and d.loja_id is not distinct from c.loja_id
  and (d.created_at > c.created_at or (d.created_at = c.created_at and d.id > c.id));

-- 3) Índice único para o banco nunca mais aceitar duplicado
--    (produto + loja + empresa; cálculos "Manual" usam loja_id nulo,
--    tratado com o coalesce abaixo):
create unique index if not exists idx_calculos_preco_unico_produto_loja
  on calculos_preco (
    empresa_id,
    lower(trim(nome_produto)),
    coalesce(loja_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
