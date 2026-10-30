// The page shell around a rendered documentation page: header, sidebar, table
// of contents, pager, footer and the search dialog. Every value interpolated
// here comes from website/docs/ (nav.json and the Markdown), and every one goes
// through `esc` -- the page body is the only pre-rendered HTML, and it comes out
// of react-markdown with raw HTML already refused.

export const SITE = 'https://monize.net';
const REPO = 'https://github.com/kenlasko/monize';

export function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const pageUrl = (slug) => `/docs/${slug === 'index' ? '' : slug}`;

const SEARCH_ICON =
  '<svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M13 13l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

const THEME_BOOT =
  '<script>(function(){try{var t=localStorage.getItem("mz-theme");if(!t){t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";}document.documentElement.setAttribute("data-theme",t);}catch(e){}})();</script>';

function sidebar(nav, current) {
  const groups = nav.map(
    ({ group, pages }) =>
      `<div class="dgroup"><p class="dgroup-t">${esc(group)}</p><ul>${pages
        .map(
          (p) =>
            `<li><a href="${pageUrl(p.slug)}"${p.slug === current ? ' aria-current="page"' : ''}>${esc(p.title)}</a></li>`,
        )
        .join('')}</ul></div>`,
  );
  const home = `<a class="dhome" href="/docs/"${current === 'index' ? ' aria-current="page"' : ''}>Overview</a>`;
  return `<aside class="dside" id="side"><nav aria-label="Documentation">${home}${groups.join('')}</nav></aside>`;
}

function tocList(toc) {
  return `<ul>${toc
    .map((t) => `<li class="d${t.depth}"><a href="#${esc(t.id)}">${esc(t.text)}</a></li>`)
    .join('')}</ul>`;
}

function pager(prev, next) {
  if (!prev && !next) return '';
  const card = (p, dir) =>
    p
      ? `<a class="pg pg-${dir}" href="${pageUrl(p.slug)}"><span>${dir === 'prev' ? 'Previous' : 'Next'}</span><b>${esc(p.title)}</b></a>`
      : '<span></span>';
  return `<nav class="pager" aria-label="Previous and next page">${card(prev, 'prev')}${card(next, 'next')}</nav>`;
}

function landingCards(nav) {
  return nav
    .map(
      ({ group, pages }) =>
        `<section class="lgroup"><h2 id="${esc(group.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}">${esc(group)}</h2><div class="lcards">${pages
          .map(
            (p) =>
              `<a class="lcard" href="${pageUrl(p.slug)}"><b>${esc(p.title)}</b><span>${esc(p.summary)}</span></a>`,
          )
          .join('')}</div></section>`,
    )
    .join('');
}

/** One complete HTML document for a page. */
export function renderShell({ page, nav, group, summary, prev, next }) {
  const isLanding = page.slug === 'index';
  const title = isLanding ? 'Monize documentation' : `${page.title} - Monize documentation`;
  const url = `${SITE}${pageUrl(page.slug)}`;
  const toc = page.toc.filter((t) => t.depth === 2 || t.depth === 3);
  const crumbs = isLanding
    ? ''
    : `<nav class="crumbs" aria-label="Breadcrumb"><a href="/docs/">Docs</a><span aria-hidden="true">/</span><span>${esc(group)}</span></nav>`;
  const hero = isLanding
    ? `<div class="lhero"><h1>${esc(page.title)}</h1><p class="lede">${esc(summary)}</p><button class="lsearch" type="button" data-search-open>${SEARCH_ICON}<span>Search the documentation</span><kbd>/</kbd></button></div>${landingCards(nav)}`
    : `<h1>${esc(page.title)}</h1>`;
  const mobileToc =
    toc.length > 1 ? `<details class="toc-m"><summary>On this page</summary>${tocList(toc)}</details>` : '';
  const sideToc =
    toc.length > 1 ? `<aside class="dtoc" aria-label="On this page"><p>On this page</p>${tocList(toc)}</aside>` : '';

  return `<!doctype html>
<!-- Generated from website/docs/${page.slug}.md by frontend/scripts/build-website-docs.mjs. Edit the Markdown, then run "npm run docs:build" in frontend/. -->
<html lang="en" data-theme="dark" class="docs-root">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(summary)}">
<meta name="theme-color" content="#4fa091">
<link rel="canonical" href="${url}">
<link rel="icon" type="image/svg+xml" href="/assets/img/monize-logo.svg">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Monize">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(summary)}">
<meta property="og:url" content="${url}">
<link rel="stylesheet" href="/assets/css/styles.css">
<link rel="stylesheet" href="/assets/css/docs.css">
${THEME_BOOT}
</head>
<body class="docs${isLanding ? ' landing' : ''}">
<a class="skip" href="#content">Skip to content</a>
<header id="hdr" class="dhdr">
  <button id="sideBtn" class="icobtn dside-btn" type="button" aria-label="Open the page list" aria-controls="side" aria-expanded="false">&#9776;</button>
  <a class="brand" href="/"><img class="logo" src="/assets/img/monize-logo.svg" alt="" width="30" height="30"><span>Monize</span></a>
  <a class="dlabel" href="/docs/">Docs</a>
  <button class="dsearch" type="button" data-search-open aria-haspopup="dialog" aria-label="Search the documentation">${SEARCH_ICON}<span>Search docs</span><kbd>/</kbd></button>
  <nav class="dnav" aria-label="Site">
    <a href="/">Home</a>
    <a href="https://demo.monize.net" rel="noopener">Live demo</a>
    <a href="${REPO}" rel="noopener">GitHub</a>
  </nav>
  <button id="theme" class="icobtn" type="button" title="Toggle light / dark" aria-label="Toggle colour theme">&#9790;</button>
</header>
<div class="dshade" id="shade" hidden></div>
<div class="dlayout">
${sidebar(nav, page.slug)}
<main id="content" class="dmain" tabindex="-1">
${crumbs}
<article class="doc">
${hero}
${mobileToc}
${page.html}
</article>
${pager(prev, next)}
<p class="dedit"><a href="${REPO}/edit/main/website/docs/${page.slug}.md" rel="noopener">Edit this page on GitHub</a><a href="${REPO}/issues/new" rel="noopener">Report a problem with the docs</a></p>
</main>
${sideToc}
</div>
<footer class="dfoot"><div class="wrap"><span>Monize is released under the AGPL-3.0 licence.</span><span><a href="/">monize.net</a> &middot; <a href="https://demo.monize.net" rel="noopener">Live demo</a> &middot; <a href="${REPO}" rel="noopener">GitHub</a></span></div></footer>
<div class="sdlg" id="search" role="dialog" aria-modal="true" aria-label="Search the documentation" hidden>
  <div class="sbox">
    <label class="sfield"><span class="sr">Search the documentation</span><input id="q" type="search" placeholder="Search the docs, e.g. &quot;split transaction&quot;" autocomplete="off" spellcheck="false" aria-controls="sres"></label>
    <ul id="sres" class="sres" role="listbox" aria-label="Results"></ul>
    <p class="shint" id="shint"><kbd>&uarr;</kbd><kbd>&darr;</kbd> to move, <kbd>Enter</kbd> to open, <kbd>Esc</kbd> to close</p>
  </div>
</div>
<script src="/assets/js/docs.js" defer></script>
</body>
</html>
`;
}
