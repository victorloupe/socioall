-- Atualiza a loja "Amazon" já cadastrada para as regras de utilidades
-- domésticas (categoria Casa e Cozinha): comissão de 15%, sem tarifa por item
-- no Plano Profissional. A calculadora aplica sozinha a faixa de 8% nos itens
-- de até R$29,99 e o mínimo de R$1,00 por venda.
--
-- Só mexe em quem ainda está com o texto padrão antigo — se você já ajustou a
-- observação da sua loja, o registro fica como está.
update lojas_ecommerce
set taxa_percentual = 15,
    taxa_fixa = 0,
    observacoes = 'Comissão de Casa e Cozinha (utilidades domésticas): 15%, caindo para 8% em itens de até R$29,99, com mínimo de R$1,00 por venda. Plano Profissional: R$19,00/mês e nenhuma tarifa por item — rateie a mensalidade no custo operacional. Plano Individual: R$2,00 por item vendido — nesse caso preencha a taxa fixa com 2,00. O frete (DBA/FBA) é cobrado à parte, por peso e dimensão.'
where lower(nome) = 'amazon'
  and observacoes like 'Taxa de referência entre%';
