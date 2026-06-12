/* ============================================================================
 * Butterflyfx shared nav - ONE source, derived onto every page.
 * The site is a dimensional hierarchy: the hub is the whole; each page is a
 * point in it (shown in the breadcrumb); sections are points in the page.
 * Include on any page:  <script src="/nav.js" data-page="Method" defer></script>
 * ==========================================================================*/
(function () {
  var GOLD = '#e3b86b', CYAN = '#7cf3ff';
  var sc = document.currentScript;
  var page = (sc && sc.getAttribute('data-page')) || (document.title.split(/[·|]/)[0] || '').trim();
  var here = location.pathname.replace(/index\.html$/, '') || '/';

  // remove any pre-existing top nav so there's never a duplicate
  var old = document.querySelector('nav'); if (old) old.remove();

  var css = document.createElement('style');
  css.textContent =
    '.bfx-nav{position:sticky;top:0;z-index:1000;backdrop-filter:blur(14px);' +
    'background:rgba(8,10,18,.62);border-bottom:1px solid rgba(255,255,255,.10);' +
    'font-family:"Segoe UI",system-ui,sans-serif}' +
    '.bfx-nav .row{max-width:1180px;margin:0 auto;display:flex;align-items:center;gap:1rem;' +
    'padding:.6rem 1.618rem;flex-wrap:wrap}' +
    '.bfx-nav .brand{display:flex;align-items:center;gap:.5rem;font-weight:800;color:#eaf1f8;' +
    'margin-right:auto;text-decoration:none;font-size:1rem}' +
    '.bfx-nav .brand img{height:24px;filter:drop-shadow(0 0 8px rgba(227,184,107,.5))}' +
    '.bfx-nav .brand b{color:' + GOLD + '}' +
    '.bfx-nav a.lnk{color:#9fb0c4;text-decoration:none;font-size:.92rem;padding:.2rem 0;' +
    'border-bottom:2px solid transparent}' +
    '.bfx-nav a.lnk:hover,.bfx-nav a.lnk.here{color:#eaf1f8;border-bottom-color:' + CYAN + '}' +
    '.bfx-crumb{max-width:1180px;margin:0 auto;padding:.4rem 1.618rem;color:#6c7c90;' +
    'font-family:ui-monospace,monospace;font-size:.74rem;letter-spacing:.5px}' +
    '.bfx-crumb a{color:' + CYAN + ';text-decoration:none}' +
    '.bfx-crumb .sep{opacity:.5;margin:0 .45rem}';
  document.head.appendChild(css);

  var links = [['Home', '/'], ['About', '/about.html'], ['Method', '/method.html'],
               ['Resume', '/resume.html'], ['Research', '/research.html'], ['Contact', '/contact.html']];
  var inner = '<div class="row"><a class="brand" href="/"><img src="/assets/butterfly.png" alt="Butterflyfx">Butterfly<b>fx</b></a>';
  links.forEach(function (l) {
    var on = (l[1] === here) ? ' here' : '';
    inner += '<a class="lnk' + on + '" href="' + l[1] + '">' + l[0] + '</a>';
  });
  inner += '<a class="lnk" href="https://github.com/kenbin64" target="_blank" rel="noopener">GitHub</a></div>';

  // breadcrumb = the dimensional position: the whole, then this point within it
  var crumb = '<div class="bfx-crumb"><a href="/">⨳ Butterflyfx</a>';
  if (page && here !== '/') crumb += '<span class="sep">›</span>' + page;
  crumb += '</div>';

  var nav = document.createElement('nav');
  nav.className = 'bfx-nav';
  nav.innerHTML = inner + crumb;
  document.body.insertBefore(nav, document.body.firstChild);
})();
