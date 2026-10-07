# Frota — pagamentos quinzenais

Sistema online para uma empresa controlar caminhões contratados, fazendas, faltas, oficina, fechamentos e pagamentos. Os registros ficam no PostgreSQL do Supabase e são compartilhados pela equipe. O GitHub Pages hospeda a interface.

**Acessar:** https://andersondanrlei33-blip.github.io/frota-quinzenal/

## Primeiro acesso e equipe

O envio de convites usa o Resend. Para ativá-lo no Supabase, verifique um domínio no Resend e cadastre os segredos RESEND_API_KEY e FLEET_EMAIL_FROM na função fleet-api. O remetente deve usar o domínio verificado, por exemplo Frota <nao-responda@seudominio.com.br>.

O proprietário recebe um link privado de ativação, válido por 72 horas e de uso único. Nesse link define nome da empresa, e-mail e senha com pelo menos 6 caracteres. Não há senha padrão nem cadastro público de empresas.

Em **Configurações → Equipe e acesso**, o administrador envia um convite para o e-mail do funcionário. A pessoa abre o link recebido, define sua própria senha e conclui o cadastro. Os convites valem por 72 horas. Se o remetente ainda não estiver configurado, a tela informa que o e-mail não foi enviado e deixa o link disponível para compartilhamento manual.

- **Administrador do grupo:** todas as fazendas, equipe, configurações, cadastros, fechamentos e solicitações.
- **Grupo — operador:** caminhões, descontos, transferências, fechamentos e solicitações de pagamento de todas as fazendas do grupo.
- **Transportadora — operador:** recebe as solicitações aprovadas e registra os pagamentos com comprovante obrigatório.
- **Somente consulta:** acompanha as informações disponíveis para seu lado do portal, grupo ou transportadora, sem alterações.

O administrador escolhe o perfil em **Configurações → Equipe e acesso** ao enviar o convite. Também pode mudar o perfil de um funcionário existente. O último administrador ativo do grupo permanece protegido contra inativação ou troca de perfil. O grupo tem acesso consolidado às suas quatro fazendas e pode filtrar uma fazenda. Há uma transportadora responsável por todos os pagamentos deste grupo.

## Solicitações e comprovantes

No cadastro da placa, o grupo pode informar **Pix** ou **transferência bancária**, com nome e CPF/CNPJ do titular. Essa parte pode ficar vazia ao cadastrar o caminhão. Antes de solicitar pagamento, cada placa precisa ter os dados da forma escolhida completos; a tela indica o que falta e permite abrir o cadastro para preencher. O servidor também confere os campos antes de criar as solicitações.

1. O grupo confere valores e descontos e fecha a quinzena em **Fechamentos**.
2. Clica em **Solicitar pagamentos**, para a fazenda selecionada ou todas. Pode solicitar uma placa individual pelos detalhes. Cada placa recebe uma solicitação com seu valor fechado e uma cópia dos dados de pagamento conferidos naquele momento.
3. O usuário da transportadora entra em **Solicitações**, onde vê somente as solicitações aprovadas e os dados necessários para pagar cada placa, com filtros de quinzena, fazenda, placa/motorista e situação.
4. Após realizar a transferência, registra a data e anexa o comprovante em **PDF, JPG ou PNG, até 10 MB**. Somente o acesso da transportadora pode registrar novos pagamentos. O grupo acompanha o resultado e consulta o comprovante.

Com a aba da transportadora visível, o painel confere novas solicitações a cada 15 segundos e atualiza a lista automaticamente. Ao voltar para a aba, confere imediatamente. Se um formulário ou detalhe estiver aberto, a atualização aguarda o fechamento da janela. CPF e CNPJ aparecem pontuados nos dados de pagamento.

## Recibo da transportadora antes do repasse

Em **Solicitações → Repasses da fazenda à transportadora**, o grupo cria uma solicitação por transferência prevista, escolhendo fazenda, quinzena fechada, valor e descrição do serviço. Um adiantamento pode ter valor diferente do total dos motoristas; é possível registrar várias transferências para a mesma fazenda e quinzena. A transportadora anexa o recibo assinado em PDF, JPG ou PNG (até 10 MB). O arquivo fica privado e visível aos usuários autorizados do grupo e da transportadora. Depois de conferi-lo, o grupo registra a data da transferência e uma referência opcional. O sistema preserva o histórico de solicitações canceladas e impede marcar o repasse como efetuado sem o recibo.

Esse recibo documenta a transferência **fazenda → transportadora**. Os comprovantes de pagamento **transportadora → motorista** continuam por placa, em um fluxo separado. O portal não assina nem gera o recibo; a transportadora envia o documento já assinado.

Os pagamentos continuam com os estados **Aberto, Fechado e Pago**. A solicitação permanece fechada, aguardando pagamento, até o registro com comprovante. O registro no portal não executa uma transferência bancária.

Solicitações pendentes precisam ser canceladas com motivo antes de reabrir seu fechamento. Confirme com a transportadora antes de cancelar. A solicitação cancelada continua no histórico. Correções de pagamento pela transportadora exigem motivo e preservam os registros e comprovantes anteriores. Pagamentos registrados antes deste portal permanecem no histórico; o administrador pode corrigir um registro anterior com motivo para solicitar novamente pelo fluxo atual.

Se os dados bancários de uma placa mudarem depois do envio, a solicitação já enviada mantém o destino original. O grupo deve cancelar a solicitação pendente e enviá-la novamente com os dados atualizados. Solicitações antigas sem dados de pagamento também exigem esse procedimento antes de registrar o pagamento.

Os comprovantes ficam em armazenamento privado do Supabase, com validação de tamanho e assinatura do formato no servidor. Para consultar um arquivo, a API confere a empresa e o vínculo com o histórico do pagamento e fornece um link com validade de um minuto. A transportadora não recebe cadastros e prévias do grupo, nem pode acessar diretamente esses registros pela Data API.

O administrador pode inativar ou reativar usuários. O último administrador ativo não pode ser inativado ou rebaixado. A sessão de acesso fica no armazenamento temporário da aba e é revalidada no servidor ao recarregar a página. O botão **Sair** apaga essa sessão; caminhões, descontos e pagamentos continuam somente no servidor.

## Cálculo e operação

As quinzenas são fixas: dias 1–15 e 16–último dia do mês. Uma quinzena completa paga metade do valor mensal; a segunda recebe o centavo de ajuste, quando necessário. O mês completo soma exatamente o valor mensal combinado, mesmo em fevereiro ou em meses de 31 dias.

Entrada, encerramento, falta e oficina são proporcionais aos dias efetivos de cada quinzena. Dias de entrada e de encerramento são incluídos. Transferências com data dividem os valores por fazenda. Os cálculos e validações são feitos no servidor.

Em **Lançar desconto**, escolha **Desconto por dias** ou **Desconto por valor (R$)**. Para valor, informe uma data, o valor em reais e o motivo obrigatório. O desconto entra uma única vez na quinzena dessa data, somado aos descontos por dias, sem reduzir os dias trabalhados. O total não pode exceder o saldo da placa na quinzena. Valor e motivo ficam preservados no fechamento e no relatório.

O fechamento preserva os valores e descontos considerados. Registrar pagamento altera o controle; não realiza transferência bancária. Caminhões cadastrados depois podem receber fechamento complementar. Relatórios permitem selecionar mês, quinzena, fazenda, placa e somente pagos, com paginação por fazenda para 40 caminhões.

Quando duas pessoas editam ao mesmo tempo, o servidor rejeita a gravação desatualizada e solicita atualizar os dados. Nenhuma falha de conexão é tratada como salvamento concluído. A interface consulta atualizações a cada minuto; o botão **Atualizar dados** também recarrega o banco.

## Dados e continuidade

O banco foi iniciado sem caminhões, descontos ou pagamentos de teste. Há quatro nomes provisórios de fazendas, que podem ser editados; mais fazendas podem ser cadastradas. Fazendas com histórico podem ser inativadas.

Use **Configurações → Baixar backup completo** para guardar cópias dos registros. Restauração substitui os registros da empresa e exige administrador. Esse arquivo cobre os registros da frota, inclusive os dados de pagamento cadastrados; contas e senhas são administradas pelo Supabase Auth.

O arquivo inclui o histórico de solicitações e as referências aos comprovantes, mas não os arquivos binários do armazenamento. A restauração deve preservar solicitações e pagamentos já existentes; novos pagamentos não podem ser criados pela importação. Os comprovantes permanecem no armazenamento privado e podem ser consultados pelo portal.

O projeto está no plano gratuito aprovado. Projetos gratuitos podem ser pausados por baixa atividade durante sete dias, e backups do banco não ficam disponíveis para download nesse plano. Consulte a [documentação de disponibilidade do Supabase](https://supabase.com/docs/guides/deployment/going-into-prod#availability) para definir o plano e a rotina de backup antes de depender do sistema na operação diária. Nenhum plano pago foi contratado.

Produção, cobrança por CT-e/nota fiscal e combustível pertencem às próximas etapas.

## Desenvolvimento

Requer Node.js 22 ou posterior. Não há dependências de terceiros na interface ou nos testes.

```sh
npm test
npm run build
```

- `frontend/`: interface e cliente autenticado; não grava registros no navegador e guarda somente os tokens da sessão no armazenamento temporário da aba.
- `server/`: comandos e validações financeiras, API, autenticação e funções Supabase.
- `supabase/migrations/`: estrutura, permissões e transações do banco.
- `docs/`: arquivos estáticos publicados pelo GitHub Pages, gerados pelo build.
- `tests/`: cálculo, relatórios, API, permissões, concorrência e interface conectada ao servidor.

As chaves públicas de conexão em `frontend/config.js` são identificadores de acesso público. As chaves administrativas são fornecidas somente pelo ambiente das Edge Functions. Nunca coloque senhas, tokens de ativação, chaves secretas ou arquivos de autenticação no repositório.

As migrações já aplicadas no projeto não devem ser reaplicadas manualmente. Mudanças no servidor exigem publicar também as duas Edge Functions; publicar somente `docs/` atualiza apenas a interface. A função `fleet-api` exige JWT válido; `fleet-access` verifica o convite secreto antes de permitir o primeiro acesso.
