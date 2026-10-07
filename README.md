# Frota — pagamentos quinzenais

Sistema online para uma empresa controlar caminhões contratados, fazendas, faltas, oficina, fechamentos e pagamentos. Os registros ficam no PostgreSQL do Supabase e são compartilhados pela equipe. O GitHub Pages hospeda a interface.

**Acessar:** https://andersondanrlei33-blip.github.io/frota-quinzenal/

## Primeiro acesso e equipe

O proprietário recebe um link privado de ativação, válido por 72 horas e de uso único. Nesse link define nome da empresa, e-mail e senha com pelo menos 6 caracteres. Não há senha padrão nem cadastro público de empresas.

Em **Configurações → Equipe e acesso**, o administrador gera um link individual para o e-mail de cada funcionário e o entrega diretamente a ele. O funcionário define sua própria senha; quem já tem uma conta pode entrar com a senha existente. O sistema não envia esses links por e-mail.

- **Administrador:** controle completo, fazendas, equipe e restauração de backup.
- **Operador:** caminhões, descontos, transferências, fechamentos e registros de pagamento.
- **Somente consulta:** acesso às informações e relatórios.

O administrador pode inativar ou reativar usuários. O último administrador ativo não pode ser inativado ou rebaixado. A sessão fica somente na memória da página: ao recarregar ou fechar, o usuário entra novamente. Caminhões, descontos e pagamentos continuam no servidor.

## Cálculo e operação

As quinzenas são fixas: dias 1–15 e 16–último dia do mês. Uma quinzena completa paga metade do valor mensal; a segunda recebe o centavo de ajuste, quando necessário. O mês completo soma exatamente o valor mensal combinado, mesmo em fevereiro ou em meses de 31 dias.

Entrada, encerramento, falta e oficina são proporcionais aos dias efetivos de cada quinzena. Dias de entrada e de encerramento são incluídos. Transferências com data dividem os valores por fazenda. Os cálculos e validações são feitos no servidor.

Em **Lançar desconto**, escolha **Desconto por dias** ou **Desconto por valor (R$)**. Para valor, informe uma data, o valor em reais e o motivo obrigatório. O desconto entra uma única vez na quinzena dessa data, somado aos descontos por dias, sem reduzir os dias trabalhados. O total não pode exceder o saldo da placa na quinzena. Valor e motivo ficam preservados no fechamento e no relatório.

O fechamento preserva os valores e descontos considerados. Registrar pagamento altera o controle; não realiza transferência bancária. Caminhões cadastrados depois podem receber fechamento complementar. Relatórios permitem selecionar mês, quinzena, fazenda, placa e somente pagos, com paginação por fazenda para 40 caminhões.

Quando duas pessoas editam ao mesmo tempo, o servidor rejeita a gravação desatualizada e solicita atualizar os dados. Nenhuma falha de conexão é tratada como salvamento concluído. A interface consulta atualizações a cada minuto; o botão **Atualizar dados** também recarrega o banco.

## Dados e continuidade

O banco foi iniciado sem caminhões, descontos ou pagamentos de teste. Há quatro nomes provisórios de fazendas, que podem ser editados; mais fazendas podem ser cadastradas. Fazendas com histórico podem ser inativadas.

Use **Configurações → Baixar backup completo** para guardar cópias dos registros. Restauração substitui os registros da empresa e exige administrador. Esse arquivo cobre os registros da frota; contas e senhas são administradas pelo Supabase Auth.

O projeto está no plano gratuito aprovado. Projetos gratuitos podem ser pausados por baixa atividade durante sete dias, e backups do banco não ficam disponíveis para download nesse plano. Consulte a [documentação de disponibilidade do Supabase](https://supabase.com/docs/guides/deployment/going-into-prod#availability) para definir o plano e a rotina de backup antes de depender do sistema na operação diária. Nenhum plano pago foi contratado.

Produção, cobrança por CT-e/nota fiscal e combustível pertencem às próximas etapas.

## Desenvolvimento

Requer Node.js 22 ou posterior. Não há dependências de terceiros na interface ou nos testes.

```sh
npm test
npm run build
```

- `frontend/`: interface e cliente autenticado; não grava registros nem credenciais no armazenamento persistente do navegador.
- `server/`: comandos e validações financeiras, API, autenticação e funções Supabase.
- `supabase/migrations/`: estrutura, permissões e transações do banco.
- `docs/`: arquivos estáticos publicados pelo GitHub Pages, gerados pelo build.
- `tests/`: cálculo, relatórios, API, permissões, concorrência e interface conectada ao servidor.

As chaves públicas de conexão em `frontend/config.js` são identificadores de acesso público. As chaves administrativas são fornecidas somente pelo ambiente das Edge Functions. Nunca coloque senhas, tokens de ativação, chaves secretas ou arquivos de autenticação no repositório.

As migrações já aplicadas no projeto não devem ser reaplicadas manualmente. Mudanças no servidor exigem publicar também as duas Edge Functions; publicar somente `docs/` atualiza apenas a interface. A função `fleet-api` exige JWT válido; `fleet-access` verifica o convite secreto antes de permitir o primeiro acesso.
