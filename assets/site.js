// Shared: nav scrim + mobile menu toggle. Kept tiny on purpose.
(function () {
  var nav = document.getElementById('nav');
  if (nav) {
    addEventListener('scroll', function () {
      nav.classList.toggle('scrolled', scrollY > 20);
    }, { passive: true });
  }
  var mb = document.getElementById('menu-btn'), nl = document.getElementById('nav-links');
  if (mb && nl) {
    mb.addEventListener('click', function () {
      var open = nl.classList.toggle('open');
      document.body.classList.toggle('menu-open', open);
      mb.setAttribute('aria-expanded', open);
    });
    nl.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        nl.classList.remove('open');
        document.body.classList.remove('menu-open');
        mb.setAttribute('aria-expanded', false);
      }
    });
  }
})();
