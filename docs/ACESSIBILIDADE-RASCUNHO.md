<!-- RASCUNHO: não publicar. Revisar com o advogado (LBI) junto do #125. -->

# Declaração de Acessibilidade — fotos.lucafchala.com

O site **fotos.lucafchala.com** é um portfólio de fotografia mantido por seu autor. Esta declaração descreve, de forma direta, o que já foi feito em acessibilidade, o que ainda falta e como falar conosco.

## Compromisso

Buscamos atender aos critérios de acessibilidade da **WCAG 2.1, nível AA**, com base na Lei Brasileira de Inclusão (LBI). Não temos certificação de acessibilidade nem auditoria externa concluída — o que segue abaixo são medidas implementadas no próprio desenvolvimento.

## O que já está implementado

- **Contraste de texto:** medido nos tokens de cor do projeto, com alvo no nível AA (WCAG 2.1).
- **Alvos de toque:** botões e controles com área de pelo menos **44 px**.
- **Movimento:** o site respeita a preferência **`prefers-reduced-motion`** do sistema.
- **Teclado:** navegação por teclado e **foco visível** nas páginas públicas e no visualizador de fotos.
- **Nome acessível:** os botões das páginas públicas têm nome acessível (não dependem só do ícone).
- **Sem JavaScript:** as páginas da parte pública funcionam sem JavaScript.

## Limitações conhecidas

- **Fotos sem texto alternativo individual.** As imagens ainda não têm descrição própria (`alt`) por foto; isso é uma limitação conhecida e está na lista de correções.
- **Cobertura automatizada parcial (axe-core).** Os roteiros de navegador rodam o axe-core (regras WCAG 2.0/2.1 A e AA, contraste incluído) na grade e no visualizador da galeria, na página do projeto com carrossel e lightbox e no painel (login, lista de eventos e Métricas), nos temas claro e escuro. O axe encontra só uma parte dos problemas de WCAG: telas e estados que o roteiro não abre (por exemplo formulários de pedido de remoção, menus e erros), ordem de leitura e clareza do texto não são cobertos.
- **Sem teste com leitor de tela real** até o momento. Os contrastes e os tamanhos de alvo também têm teste automatizado no repositório; o restante não passou por auditoria humana.

Não publicamos percentuais de conformidade nem prazos de correção que ainda não possam ser cumpridos. Preferimos listar o que falta a sugerir algo que não foi verificado.

## Como relatar um problema

Se você encontrar uma barreira de acessibilidade, escreva para **privacidade@lucafchala.com**, descrevendo a página, o que tentou fazer e a tecnologia assistiva usada (se houver). Respondemos o quanto antes.

---

*Rascunho para revisão jurídica junto do advogado responsável, à luz da Lei Brasileira de Inclusão (LBI) — não publicar antes dessa revisão.*
