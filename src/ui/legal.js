import { footerLegalLinksHTML, TERMS_VERSION, formatDatePT, fontPreconnectHTML } from '../utils.js';
import { LEGAL_DOCS } from '../content/legal-docs.js';

// Central de Transparência — hub que reúne privacidade, termos, segurança e
// documentação de conformidade, em vez de espalhar links jurídicos no rodapé.
//
// Página estática: nenhum valor vem de KV ou do visitante, então não há nada
// para escapar aqui. As interpolações vêm de constantes do próprio código.

const SITE_URL = 'https://fotos.lucafchala.com';
const UPDATED = '2026-08-16';

// Mesma lista que gera as rotas e o sitemap, pra não divergir. slice(1) tira
// a Política de Segurança, que já aparece em destaque nos documentos principais.
const GOVERNANCE_DOCS = LEGAL_DOCS.slice(1);

// Pra pesquisadores de segurança, crawlers e agentes automatizados acharem as
// políticas sem adivinhar onde estão.
const MACHINE_ENDPOINTS = [
  ['/.well-known/security.txt', 'Contato de segurança e chave PGP', 'RFC 9116'],
  ['/.well-known/gpc.json', 'Global Privacy Control — opt-out honrado por padrão', 'GPC'],
  ['/robots.txt', 'Regras de rastreamento e preferências de uso de conteúdo', 'RFC 9309'],
  ['/llms.txt', 'Política de uso por modelos de linguagem', 'llms.txt'],
  ['/sitemap.xml', 'Índice das páginas públicas', 'Sitemaps 0.9'],
];

function iconShield() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';
}
function iconScale() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3v18M7 21h10M5 7h14M5 7l-3 7h6zM19 7l3 7h-6z"/></svg>';
}
function iconLock() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/></svg>';
}
function iconTrash() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13"/></svg>';
}
function iconUser() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/></svg>';
}
function iconBug() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="8" y="7" width="8" height="13" rx="4"/><path d="M8 12H4M20 12h-4M8 17l-3 2M16 17l3 2M8 8L5 6M16 8l3-2M10 4l1 2M14 4l-1 2"/></svg>';
}
function iconArrow() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
}

export function legalHTML() {
  const updatedPT = formatDatePT(UPDATED);
  const termsPT = formatDatePT(TERMS_VERSION);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" type="image/svg+xml" href="/icon.svg">
  <link rel="apple-touch-icon" href="/icon.svg">
  <meta name="theme-color" content="#0a0a0a">
  <title>Central de Transparência · fotos</title>
  <meta name="description" content="Privacidade, termos de uso, segurança e conformidade com a LGPD — tudo o que fazemos com os dados, num só lugar.">
  <link rel="canonical" href="${SITE_URL}/legal">
  <meta property="og:type" content="website">
  <meta property="og:title" content="Central de Transparência · fotos">
  <meta property="og:description" content="Privacidade, termos, segurança e conformidade com a LGPD — num só lugar.">
  <meta property="og:url" content="${SITE_URL}/legal">
  ${fontPreconnectHTML()}
  <link href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,300;0,400;0,500;0,600;1,300&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{
      --bg-page:#0a0a0a; --text:#f0ebe5; --text-2:#b0a89e; --text-heading:#e0d8d0; --text-strong:#d0c8be;
      --text-muted:#999; --text-dim:#666; --text-dim-2:#555; --border-dim:#1e1e1e; --border-hair:#141414;
      --footer-link:#888; --accent:#c0a060; --accent-soft:rgba(192,160,96,.12);
      --card-bg:#111; --card-bg-hover:#161616; --card-border:#212121; --card-border-hover:#3a3a3a;
      --chip-bg:#141414; --chip-border:#242424; --chip-text:#8a8a8a;
      --ok-dot:#5aaa5a; --code-bg:#141414;
    }
    @media (prefers-color-scheme: light) {
      :root{
        --bg-page:#f0ece8; --text:#1a1715; --text-2:#4a4744; --text-heading:#2a2521; --text-strong:#332d28;
        --text-muted:#6b6460; --text-dim:#8a8480; --text-dim-2:#9a9490; --border-dim:#ddd9d4; --border-hair:#e5e1db;
        --footer-link:#6b6460; --accent:#8a6428; --accent-soft:rgba(138,100,40,.10);
        --card-bg:#fff; --card-bg-hover:#faf8f5; --card-border:#e2ded8; --card-border-hover:#c4bdb3;
        --chip-bg:#f6f3ef; --chip-border:#e2ded8; --chip-text:#6b6460;
        --ok-dot:#2e7d32; --code-bg:#f6f3ef;
      }
    }
    body{font-family:'Inter',sans-serif;background:var(--bg-page);color:var(--text);min-height:100vh;-webkit-font-smoothing:antialiased}
    :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    header{padding:1.25rem 1.5rem}
    .back{display:inline-flex;align-items:center;gap:.35rem;text-decoration:none;color:var(--text-dim-2);font-size:.8rem;letter-spacing:.04em;transition:color .2s}
    .back:hover{color:var(--text-2)}
    .back svg{width:14px;height:14px}
    main{max-width:860px;margin:0 auto;padding:1.5rem 1.5rem 6rem}
    a{color:var(--accent);text-decoration:none}
    a:hover{text-decoration:underline}

    /* Hero */
    .eyebrow{display:inline-flex;align-items:center;gap:.5rem;font-size:.68rem;letter-spacing:.18em;text-transform:uppercase;color:var(--text-dim);margin-bottom:1rem}
    .eyebrow .dot{width:6px;height:6px;border-radius:50%;background:var(--ok-dot);flex-shrink:0}
    h1{font-size:clamp(1.75rem,5vw,2.5rem);font-weight:600;letter-spacing:-.02em;line-height:1.15;margin-bottom:.9rem}
    .lead{font-size:1rem;line-height:1.7;color:var(--text-2);max-width:60ch}
    .meta{display:flex;gap:.6rem;flex-wrap:wrap;margin-top:1.5rem;padding-bottom:2.75rem;border-bottom:1px solid var(--border-hair)}
    .chip{display:inline-flex;align-items:center;gap:.4rem;padding:.3rem .7rem;border:1px solid var(--chip-border);background:var(--chip-bg);border-radius:100px;font-size:.72rem;color:var(--chip-text);letter-spacing:.02em}

    /* Seções */
    section{margin-top:3.25rem}
    h2{font-size:.72rem;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--text-dim);margin-bottom:.5rem}
    .section-lead{font-size:.88rem;line-height:1.65;color:var(--text-muted);margin-bottom:1.5rem;max-width:62ch}

    /* Cards */
    .grid{display:grid;gap:.75rem}
    .grid-3{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
    .grid-2{grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
    .card{display:flex;flex-direction:column;gap:.55rem;padding:1.15rem;border:1px solid var(--card-border);border-radius:12px;background:var(--card-bg);text-decoration:none;transition:border-color .2s,background .2s,transform .2s}
    a.card:hover{border-color:var(--card-border-hover);background:var(--card-bg-hover);text-decoration:none;transform:translateY(-1px)}
    .card-icon{width:32px;height:32px;border-radius:8px;background:var(--accent-soft);display:flex;align-items:center;justify-content:center;color:var(--accent);flex-shrink:0}
    .card-icon svg{width:16px;height:16px}
    .card-title{font-size:.92rem;font-weight:600;color:var(--text);letter-spacing:-.01em;display:flex;align-items:center;gap:.4rem}
    .card-title svg{width:13px;height:13px;color:var(--text-dim);opacity:0;transform:translateX(-3px);transition:opacity .2s,transform .2s}
    a.card:hover .card-title svg{opacity:1;transform:translateX(0)}
    .card-desc{font-size:.82rem;line-height:1.6;color:var(--text-muted)}
    .card-foot{margin-top:auto;padding-top:.35rem;font-size:.7rem;letter-spacing:.06em;color:var(--text-dim-2)}

    /* Tabela */
    .table-wrap{overflow-x:auto;border:1px solid var(--card-border);border-radius:12px;background:var(--card-bg)}
    table{width:100%;border-collapse:collapse;font-size:.82rem;min-width:560px}
    th{text-align:left;font-weight:600;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim);padding:.85rem 1rem;border-bottom:1px solid var(--card-border);white-space:nowrap}
    td{padding:.85rem 1rem;border-bottom:1px solid var(--border-hair);color:var(--text-2);line-height:1.5;vertical-align:top}
    tr:last-child td{border-bottom:0}
    td strong{color:var(--text-strong);font-weight:600}
    .td-term{white-space:nowrap;color:var(--text-muted)}

    /* Lista de garantias */
    .facts{display:grid;gap:.15rem;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}
    .fact{display:flex;gap:.7rem;padding:.7rem 0;align-items:flex-start}
    .fact-mark{width:16px;height:16px;flex-shrink:0;margin-top:.15rem;color:var(--ok-dot)}
    .fact-mark svg{width:16px;height:16px}
    .fact p{font-size:.85rem;line-height:1.6;color:var(--text-2)}
    .fact strong{color:var(--text-strong);font-weight:600}

    /* Endpoints */
    .endpoints{border:1px solid var(--card-border);border-radius:12px;overflow:hidden;background:var(--card-bg)}
    .endpoint{display:flex;align-items:center;gap:1rem;padding:.8rem 1rem;border-bottom:1px solid var(--border-hair);flex-wrap:wrap}
    .endpoint:last-child{border-bottom:0}
    .endpoint code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.78rem;color:var(--accent);background:var(--code-bg);padding:.2rem .5rem;border-radius:5px;white-space:nowrap}
    .endpoint .ep-desc{font-size:.8rem;color:var(--text-muted);flex:1;min-width:180px}
    .endpoint .ep-std{font-size:.68rem;letter-spacing:.06em;color:var(--text-dim-2);white-space:nowrap}

    /* Contatos */
    .contacts{display:grid;gap:.75rem;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
    .contact{padding:1.1rem;border:1px solid var(--card-border);border-radius:12px;background:var(--card-bg)}
    .contact-role{font-size:.68rem;letter-spacing:.12em;text-transform:uppercase;color:var(--text-dim);margin-bottom:.45rem}
    .contact a{font-size:.86rem;font-weight:500;word-break:break-word}
    .contact p{font-size:.78rem;color:var(--text-muted);line-height:1.55;margin-top:.4rem}

    .note{font-size:.8rem;color:var(--text-dim);line-height:1.65;border-left:2px solid var(--border-dim);padding-left:1rem;margin-top:1.25rem;max-width:64ch}

    footer{text-align:center;padding:2rem 1rem;border-top:1px solid var(--border-hair);display:flex;gap:1.5rem;justify-content:center;flex-wrap:wrap;margin-top:4rem}
    footer a{color:var(--footer-link);font-size:.8rem;text-decoration:none;letter-spacing:.12em;transition:color .2s}
    footer a:hover{color:var(--text-2)}
    .footer-actions-legal{display:flex;align-items:center;gap:1.25rem;flex-wrap:wrap;justify-content:center}
    .legal-link{display:inline-flex;align-items:center;gap:.4rem;color:var(--footer-link);font-size:.8rem;text-decoration:none;letter-spacing:.1em;transition:color .2s}
    .legal-link:hover{color:var(--text-2)}
    .footer-copyright{font-size:.75rem;color:var(--footer-link);letter-spacing:.03em;text-align:center;width:100%;margin-top:.5rem}

    @media (max-width:600px){
      main{padding:1rem 1.15rem 4rem}
      .card{padding:1rem}
      /* Empilha em vez de quebrar em degraus (o rótulo do padrão ficava
         órfão no meio da linha em telas estreitas). */
      .endpoint{flex-direction:column;align-items:flex-start;gap:.35rem;padding:.85rem 1rem}
      .endpoint .ep-desc{min-width:0}
    }
    @media (prefers-reduced-motion:reduce){
      *{transition:none!important;transform:none!important}
    }
  </style>
</head>
<body>
  <header>
    <a href="/" class="back">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
      Voltar
    </a>
  </header>

  <main>
    <p class="eyebrow"><span class="dot"></span>Transparência</p>
    <h1>Central de Transparência</h1>
    <p class="lead">Tudo o que este site faz com dados pessoais — o que coleta, por quê, por quanto tempo guarda e como protege — reunido num lugar só. Sem letra miúda e sem precisar procurar.</p>
    <div class="meta">
      <span class="chip">Atualizada em ${updatedPT}</span>
      <span class="chip">Termos de Uso · versão ${termsPT}</span>
      <span class="chip">Conforme a LGPD (Lei 13.709/2018)</span>
      <span class="chip">Código aberto e auditável</span>
    </div>

    <section>
      <h2>Ação rápida</h2>
      <p class="section-lead">Os três pedidos mais comuns. Todos gratuitos e sem precisar criar conta.</p>
      <div class="grid grid-3">
        <a class="card" href="/suporte?tema=remocao">
          <span class="card-icon">${iconTrash()}</span>
          <span class="card-title">Remover uma foto minha ${iconArrow()}</span>
          <span class="card-desc">Se você aparece numa foto e não quer mais que ela esteja publicada, é só pedir. Não pergunto o motivo.</span>
          <span class="card-foot">RESPOSTA EM ATÉ 15 DIAS</span>
        </a>
        <a class="card" href="mailto:privacidade@lucafchala.com">
          <span class="card-icon">${iconUser()}</span>
          <span class="card-title">Exercer meus direitos ${iconArrow()}</span>
          <span class="card-desc">Acesso, correção, portabilidade, eliminação, oposição — os direitos do art. 18 da LGPD.</span>
          <span class="card-foot">PRIVACIDADE@LUCAFCHALA.COM</span>
        </a>
        <a class="card" href="mailto:security@lucafchala.com">
          <span class="card-icon">${iconBug()}</span>
          <span class="card-title">Reportar vulnerabilidade ${iconArrow()}</span>
          <span class="card-desc">Encontrou uma falha? Há chave PGP e política de divulgação responsável publicadas.</span>
          <span class="card-foot">RESPOSTA EM ATÉ 5 DIAS ÚTEIS</span>
        </a>
      </div>
    </section>

    <section>
      <h2>Documentos principais</h2>
      <p class="section-lead">O que vale juridicamente entre você e este site.</p>
      <div class="grid grid-3">
        <a class="card" href="/privacidade">
          <span class="card-icon">${iconShield()}</span>
          <span class="card-title">Política de Privacidade ${iconArrow()}</span>
          <span class="card-desc">Quais dados são coletados, com que base legal, com quem são compartilhados e por quanto tempo ficam.</span>
          <span class="card-foot">ATUALIZADA EM ${updatedPT.toUpperCase()}</span>
        </a>
        <a class="card" href="/termos">
          <span class="card-icon">${iconScale()}</span>
          <span class="card-title">Termos de Uso ${iconArrow()}</span>
          <span class="card-desc">As regras de uso do site e o alcance exato da autorização de uso de imagem.</span>
          <span class="card-foot">VERSÃO ${TERMS_VERSION}</span>
        </a>
        <a class="card" href="/legal/politica-de-seguranca">
          <span class="card-icon">${iconLock()}</span>
          <span class="card-title">Política de Segurança ${iconArrow()}</span>
          <span class="card-desc">Escopo, canal de reporte, prazo de resposta e as limitações conhecidas — declaradas, não escondidas.</span>
          <span class="card-foot">RFC 9116 · PGP PUBLICADA</span>
        </a>
      </div>
    </section>

    <section>
      <h2>Seus dados, em resumo</h2>
      <p class="section-lead">A versão curta da política de privacidade. A completa está em <a href="/privacidade">/privacidade</a>.</p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Dado</th><th>Para quê</th><th>Quanto tempo</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Fotografias do evento</strong></td>
              <td>Entregar o material a quem participou e mostrar o trabalho.</td>
              <td class="td-term">Até você pedir a remoção</td>
            </tr>
            <tr>
              <td><strong>Registro do aceite</strong></td>
              <td>Comprovar quando a autorização de uso de imagem foi dada e sob qual texto exato.</td>
              <td class="td-term">5 anos</td>
            </tr>
            <tr>
              <td><strong>Pedido de remoção</strong></td>
              <td>Localizar a foto, atender ao pedido e avisar você do resultado.</td>
              <td class="td-term">6 meses após resolvido</td>
            </tr>
            <tr>
              <td><strong>Mensagem de suporte</strong></td>
              <td>Responder ao seu contato.</td>
              <td class="td-term">Não é armazenada</td>
            </tr>
            <tr>
              <td><strong>Contagem de acessos</strong></td>
              <td>Saber quais projetos são mais vistos.</td>
              <td class="td-term">Número agregado, sem identificar ninguém</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="note">Nada é vendido, nada alimenta publicidade e nenhuma decisão sobre você é tomada automaticamente. Os prazos acima não dependem de alguém lembrar de apagar: são executados por uma rotina diária, que por sua vez é monitorada — se ela parar, eu sou avisado.</p>
    </section>

    <section>
      <h2>Como o site protege isso</h2>
      <p class="section-lead">Medidas concretas, não promessas. Cada uma é verificável no código aberto.</p>
      <div class="facts">
        <div class="fact"><span class="fact-mark">${checkIcon()}</span><p><strong>O link das fotos não fica na página.</strong> Ele só é liberado pelo servidor depois da verificação anti-robô e do aceite dos Termos — e a liberação vale só para aquele projeto.</p></div>
        <div class="fact"><span class="fact-mark">${checkIcon()}</span><p><strong>Metadados são apagados.</strong> Se você envia uma foto pedindo remoção, o GPS e os dados do aparelho saem no servidor antes de qualquer coisa. Você pediu menos exposição, não mais.</p></div>
        <div class="fact"><span class="fact-mark">${checkIcon()}</span><p><strong>Coleta mínima.</strong> Mensagem de suporte não vai para banco nenhum, e a foto de um pedido de remoção nunca é armazenada.</p></div>
        <div class="fact"><span class="fact-mark">${checkIcon()}</span><p><strong>Conexão sempre cifrada</strong>, com política de segurança de conteúdo restritiva em todas as páginas.</p></div>
        <div class="fact"><span class="fact-mark">${checkIcon()}</span><p><strong>Painel protegido</strong> por senha derivada com PBKDF2, sessão curta, limite de tentativas e alerta por e-mail.</p></div>
        <div class="fact"><span class="fact-mark">${checkIcon()}</span><p><strong>Auditado automaticamente.</strong> Análise estática, verificação de dependências e uma suíte de testes dedicada à segurança rodam a cada mudança.</p></div>
      </div>
    </section>

    <section>
      <h2>Documentação de conformidade</h2>
      <p class="section-lead">Os documentos de governança que a LGPD prevê, publicados aqui na íntegra — cada um com página própria, sem precisar sair do site.</p>
      <div class="grid grid-2">
        ${GOVERNANCE_DOCS.map(d => `
        <a class="card" href="/legal/${d.slug}">
          <span class="card-title">${d.title} ${iconArrow()}</span>
          <span class="card-desc">${d.summary}</span>
          <span class="card-foot">${d.tag.toUpperCase()}</span>
        </a>`).join('')}
      </div>
      <p class="note">Cada documento reflete o que o sistema faz de fato — escrito a partir do próprio código, não de um modelo genérico — e é revisado a cada mudança relevante no tratamento de dados.</p>
    </section>

    <section>
      <h2>Endpoints legíveis por máquina</h2>
      <p class="section-lead">Para pesquisadores de segurança, crawlers e agentes automatizados descobrirem as políticas sem adivinhar.</p>
      <div class="endpoints">
        ${MACHINE_ENDPOINTS.map(([path, desc, std]) => `
        <div class="endpoint">
          <code><a href="${path}">${path}</a></code>
          <span class="ep-desc">${desc}</span>
          <span class="ep-std">${std}</span>
        </div>`).join('')}
      </div>
    </section>

    <section>
      <h2>Contatos</h2>
      <div class="contacts">
        <div class="contact">
          <p class="contact-role">Privacidade / Encarregado</p>
          <a href="mailto:privacidade@lucafchala.com">privacidade@lucafchala.com</a>
          <p>Direitos do titular, dúvidas sobre tratamento de dados e pedidos relativos a menores.</p>
        </div>
        <div class="contact">
          <p class="contact-role">Segurança</p>
          <a href="mailto:security@lucafchala.com">security@lucafchala.com</a>
          <p>Divulgação responsável de vulnerabilidades. Chave PGP em <a href="/.well-known/security.txt">security.txt</a>.</p>
        </div>
        <div class="contact">
          <p class="contact-role">Suporte</p>
          <a href="mailto:suporte@lucafchala.com">suporte@lucafchala.com</a>
          <p>Qualquer outro assunto. Também pelo <a href="https://wa.me/5511989211178" target="_blank" rel="noopener">WhatsApp</a> ou por <a href="/suporte">/suporte</a>.</p>
        </div>
      </div>
      <p class="note">Não concorda com uma resposta minha? Você pode reclamar à <a href="https://www.gov.br/anpd/" target="_blank" rel="noopener">Autoridade Nacional de Proteção de Dados (ANPD)</a> ou aos órgãos de defesa do consumidor. Se eu recusar um pedido, explico o motivo por escrito, com o fundamento legal.</p>
    </section>
  </main>

  <footer>
    <a href="/">fotos · lucafchala</a>
    ${footerLegalLinksHTML()}
  </footer>
</body>
</html>`;
}

function checkIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="20 6 9 17 4 12"/></svg>';
}
