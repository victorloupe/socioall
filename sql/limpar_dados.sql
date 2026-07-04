-- SócioAll — Script de Limpeza de Dados de Teste
--
-- Escolha uma das duas opções abaixo, copie o código correspondente e execute no SQL Editor do Supabase.

-- =====================================================================
-- OPÇÃO A: Limpeza Parcial (RECOMENDADA)
-- Mantém a empresa cadastrada e as contas dos sócios para que você não perca seu login,
-- mas limpa todos os lançamentos, comprovantes, pedidos, cálculos de precificação e logs.
-- =====================================================================

-- Desativa temporariamente os triggers de auditoria para evitar poluir o log de auditoria com exclusões em lote
alter table lancamentos disable trigger trg_audit_lancamentos;
alter table socios disable trigger trg_audit_socios;

-- Limpa comprovantes de lançamentos
truncate table lancamento_comprovantes restart identity cascade;

-- Limpa todos os lançamentos (receitas e despesas)
truncate table lancamentos restart identity cascade;

-- Limpa todas as categorias (você poderá criar suas categorias reais)
truncate table categorias restart identity cascade;

-- Limpa o histórico de cálculos de precificação
truncate table calculos_preco restart identity cascade;

-- Limpa os pedidos de e-commerce sincronizados para teste
truncate table pedidos_ecommerce restart identity cascade;

-- Limpa os logs de reset de senha e auditoria
truncate table reset_senha_logs restart identity cascade;
truncate table audit_logs restart identity cascade;

-- Reativa os triggers de auditoria
alter table lancamentos enable trigger trg_audit_lancamentos;
alter table socios enable trigger trg_audit_socios;


-- =====================================================================
-- OPÇÃO B: Limpeza Completa (Zerar tudo do zero)
-- Apaga absolutamente tudo do banco de dados: empresas, sócios, transações, etc.
-- Atenção: ao rodar isso, sua sessão atual vai cair e você precisará se cadastrar novamente.
-- =====================================================================
/*
-- Desativa os triggers
alter table lancamentos disable trigger trg_audit_lancamentos;
alter table socios disable trigger trg_audit_socios;

-- Limpa tabelas dependentes
truncate table lancamento_comprovantes restart identity cascade;
truncate table lancamentos restart identity cascade;
truncate table categorias restart identity cascade;
truncate table calculos_preco restart identity cascade;
truncate table pedidos_ecommerce restart identity cascade;
truncate table reset_senha_logs restart identity cascade;
truncate table audit_logs restart identity cascade;

-- Limpa os sócios e empresas
truncate table socios restart identity cascade;
truncate table empresas restart identity cascade;

-- Opcional: Se você quiser apagar também os usuários do Auth do Supabase (para se cadastrar com o mesmo username do zero),
-- execute as linhas abaixo (cuidado, isso apagará todos os cadastros no Supabase Auth):
-- truncate auth.users cascade;

-- Reativa os triggers
alter table lancamentos enable trigger trg_audit_lancamentos;
alter table socios enable trigger trg_audit_socios;
*/
