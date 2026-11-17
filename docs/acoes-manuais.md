# Ações manuais

O que precisa de uma pessoa (ou do Cowork, com o navegador dela) num painel:
Cloudflare, Google, GitHub Settings, AWS. Nenhum agente de código faz isso.
Cada item traz um prompt pronto para colar no Cowork. Senha e código de
verificação quem digita é você; nunca entram no prompt.

Quando um item for feito, mova para "Feito" com a data.

## Pendentes

### 1. Desligar o "JavaScript detections" da Cloudflare

**Por quê:** a Cloudflare injeta um script em toda página
(`/cdn-cgi/challenge-platform/…/main.js`). Num celular lento ele trava a
página de 0,3 a 1,1 s e derruba a nota de "Boas práticas" do Lighthouse para
81. Medido em [`revisao-2026-11-16.md`](./revisao-2026-11-16.md), achado V5.
É a issue #257. O Turnstile dos formulários não depende dele.

**Risco:** baixo. A única coisa que deixa de funcionar é uma regra de firewall
que use o campo `cf.bot_management.js_detection.passed`; o prompt confere se
existe alguma antes de desligar.

```text
Preciso que você faça uma mudança no painel da Cloudflare, no meu navegador.
Eu faço o login; você não digita senha nem código de verificação.

Contexto: meu site é servido pela Cloudflare em duas zonas, lucafchala.com e
entrenos2026.com. A Cloudflare injeta em toda página um script de detecção de
robôs ("JavaScript detections"), que deixa o site lento no celular. Quero
desligar esse script nas duas zonas, sem mexer em mais nada.

Passos, para CADA uma das duas zonas (lucafchala.com e depois
entrenos2026.com):

1. Abra dash.cloudflare.com e entre na zona.
2. Antes de desligar, confira se alguma regra usa o resultado do script:
   vá em Security > WAF (ou "Security rules") e olhe as regras
   personalizadas e as de limite de taxa. Procure, na expressão de cada
   regra, o texto "js_detection". Se alguma regra tiver esse texto, PARE,
   não desligue nada e me diga o nome da regra.
3. Se nenhuma regra usa, vá em Security > Bots (em painéis mais novos:
   Security > Settings, filtro "Bot traffic"). Abra a configuração
   ("Configure Bot Fight Mode", "Configure Super Bot Fight Mode" ou o lápis
   ao lado de "Bot Fight Mode").
4. Ache a opção "JavaScript detections" e desligue. Salve.
5. Não mude nenhuma outra opção. Em especial: não ligue o "Bot Fight Mode"
   (ele está desligado de propósito) e não mexa no Turnstile.

Os nomes dos menus mudam de tempos em tempos. Se não achar "JavaScript
detections" em nenhum desses lugares, use a busca do painel (tecla /) com
esse nome. Se a opção não existir no plano da zona, ou aparecer travada,
pare e me diga o que aparece na tela.

Como conferir, depois de uns 2 minutos, para cada endereço abaixo: abra a
página numa janela anônima, veja o código-fonte (Ctrl+U) e procure por
"challenge-platform".
  - https://fotos.lucafchala.com/
  - https://entrenos2026.com/
Tem de dar zero ocorrências nas duas. Antes da mudança dava uma.

Se der errado: se depois de 10 minutos o texto ainda aparecer, confira se
salvou na zona certa e me diga o que a tela mostra. Se algum formulário do
site (por exemplo https://fotos.lucafchala.com/suporte) parar de mostrar a
caixa de verificação, religue a opção e me avise.

No fim, me diga: o que mudou em cada zona, e o resultado da conferência em
cada endereço.
```

**Depois de feito:** rodar o Lighthouse de novo no início e numa galeria (as
condições estão no relatório) e anotar o TBT na issue #257.

## Feito

Nada ainda.
