-- Custos padrão de embalagem e de operação (calculadora de preços).
--
-- Rode este script se o seu banco já existe e você não quer rodar o
-- sql/schema_completo.sql inteiro de novo — ele já traz essas colunas.
-- É idempotente: rodar duas vezes não quebra nem apaga nada.
--
-- empresas.custo_embalagem_padrao / custo_operacional_padrao
--   Valores que a calculadora preenche sozinha em todo cálculo novo.
--   Continuam editáveis na hora do cálculo (o valor digitado ali vale só
--   para aquele cálculo; o padrão cadastrado não é alterado).
--
-- lojas_ecommerce.custo_embalagem_padrao / custo_operacional_padrao
--   Opcionais. Quando preenchidos, valem no lugar do padrão da empresa
--   naquela loja (ex: coparticipação de frete do Mercado Livre no custo
--   operacional). Em branco (null) = a loja herda o padrão da empresa.

alter table empresas add column if not exists custo_embalagem_padrao numeric(10,2) not null default 0.50;
alter table empresas add column if not exists custo_operacional_padrao numeric(10,2) not null default 0;

alter table lojas_ecommerce add column if not exists custo_embalagem_padrao numeric(10,2);
alter table lojas_ecommerce add column if not exists custo_operacional_padrao numeric(10,2);
