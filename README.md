# Frota — pagamentos quinzenais

Sistema de teste para cadastrar caminhões e fazendas, calcular o pagamento mensal em duas quinzenas, registrar descontos, transferir caminhões e gerar relatórios.

## Como usar

- Cadastre as fazendas e os caminhões com o valor mensal combinado.
- Use a Visão geral para acompanhar a frota e os valores do mês.
- Em Fechamentos, selecione o mês e a quinzena, confira os descontos e registre os pagamentos.
- O relatório permite filtrar por fazenda, placa, competência, quinzena e somente pagos. A impressão permite salvar em PDF.
- Um mês completo sem descontos soma o valor mensal cadastrado. Cada quinzena completa corresponde à metade, e períodos parciais são proporcionais aos dias daquela quinzena.

## Registros separados por navegador

Cada visitante começa sem caminhões, descontos ou pagamentos. As fazendas iniciais têm nomes genéricos e podem ser alteradas, removidas ou ampliadas.

Os registros ficam no armazenamento local do navegador de cada pessoa. Não há banco de dados compartilhado nem envio de pagamentos para um servidor. Navegadores, dispositivos e endereços de site diferentes mantêm registros diferentes. Use o backup nas configurações para guardar ou transportar seus dados.

Esta versão remove o armazenamento da antiga versão de teste (`frota-quinzenal-v1`) ao carregar. Os novos registros usam uma chave independente e permanecem salvos depois da atualização.

## Publicar com GitHub Pages

A pasta `docs` contém os arquivos estáticos prontos. Em **Settings → Pages**, selecione **Deploy from a branch**, a branch principal e a pasta **/docs**. Salve e aguarde a publicação.

Documentação: [Configurar a publicação do GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

## Desenvolvimento

O sistema usa HTML, CSS e JavaScript sem dependências de produção. O código de desenvolvimento fica em `dist`; a cópia de publicação fica em `docs`. Ao atualizar o sistema, mantenha essas pastas sincronizadas.

Com Node.js instalado, execute `npm test` para conferir os cálculos e os fluxos. Para testar no navegador com Python instalado, execute `python -m http.server 8000 --directory docs` e abra `http://localhost:8000`.

Esta cópia não contém os cadastros ou pagamentos do teste anterior, as planilhas originais, os arquivos de apoio da conversa nem credenciais.
