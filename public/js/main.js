(function () {
  'use strict';

  var header = document.querySelector('.site-header');
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('site-nav');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Navigation ---------- */

  function navOpen() { return nav.classList.contains('is-open'); }

  function setNav(open) {
    nav.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    onScroll();
  }
  toggle.addEventListener('click', function () {
    setNav(toggle.getAttribute('aria-expanded') !== 'true');
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') setNav(false);
  });

  nav.querySelectorAll('a').forEach(function (link) {
    if (link.getAttribute('href') === window.location.pathname) link.setAttribute('aria-current', 'page');
  });

  /* ---------- Scroll-linked motion ---------- */

  var progress = document.createElement('div');
  progress.className = 'scroll-progress';
  progress.setAttribute('aria-hidden', 'true');
  document.body.appendChild(progress);

  var heroImage = document.querySelector('.hero-img, .page-hero-img');
  var lastY = window.scrollY;
  var ticking = false;

  function update() {
    ticking = false;
    var y = window.scrollY;
    var max = document.documentElement.scrollHeight - window.innerHeight;

    header.classList.toggle('is-scrolled', y > 40 || navOpen());
    // The header slides away while reading down the page and returns on the way back up.
    header.classList.toggle('is-hidden', y > lastY && y > 320 && !navOpen());
    progress.style.transform = 'scaleX(' + (max > 0 ? Math.min(1, y / max) : 0) + ')';
    // Parallax: the hero photo drifts down at a third of the scroll speed.
    if (heroImage && !reduceMotion && y < window.innerHeight * 1.2) heroImage.style.translate = '0 ' + Math.round(y * 0.3) + 'px';

    lastY = y;
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(update);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  update();

  /* ---------- Reveal on scroll ---------- */

  var reveals = Array.prototype.slice.call(document.querySelectorAll('.reveal'));

  function finish(node) {
    // Once shown, drop the animation classes so hover effects use their own timing again.
    node.classList.remove('reveal', 'is-visible');
    node.style.transitionDelay = '';
  }

  if (reduceMotion || !('IntersectionObserver' in window)) {
    reveals.forEach(finish);
  } else {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var node = entry.target;
        observer.unobserve(node);
        // Items in the same row follow one another instead of arriving all at once.
        var siblings = Array.prototype.filter.call(node.parentNode.children, function (el) {
          return el.classList.contains('reveal');
        });
        var delay = (siblings.indexOf(node) % 4) * 110;
        node.style.transitionDelay = delay + 'ms';
        node.classList.add('is-visible');
        window.setTimeout(function () { finish(node); }, delay + 1700);
      });
    // Threshold 0 so blocks taller than the screen (long forms, the FAQ list) still trigger.
    }, { threshold: 0, rootMargin: '0px 0px -10% 0px' });
    reveals.forEach(function (node) { observer.observe(node); });
  }

  /* ---------- Counting numbers in the hero ---------- */

  if (!reduceMotion) {
    document.querySelectorAll('.hero-facts strong').forEach(function (node) {
      var match = node.textContent.match(/^(\d+)(.*)$/);
      if (!match) return;
      var target = Number(match[1]);
      var suffix = match[2];
      var start = null;
      node.textContent = '0' + suffix;
      function step(now) {
        if (start === null) start = now;
        var t = Math.min(1, (now - start) / 1600);
        node.textContent = Math.round(target * (1 - Math.pow(1 - t, 3))) + suffix;
        if (t < 1) window.requestAnimationFrame(step);
      }
      window.setTimeout(function () { window.requestAnimationFrame(step); }, 900);
    });
  }

  /* ---------- Gallery lightbox ---------- */

  var items = Array.prototype.slice.call(document.querySelectorAll('.gallery-item'));
  if (!items.length || typeof HTMLDialogElement === 'undefined') return;

  var dialog = document.createElement('dialog');
  dialog.className = 'lightbox';
  dialog.setAttribute('aria-label', 'Photo viewer');

  function button(label) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    return b;
  }
  var prev = button('Previous');
  var next = button('Next');
  var close = button('Close');
  var arrows = document.createElement('div');
  arrows.append(prev, next);
  var bar = document.createElement('div');
  bar.className = 'lightbox-bar';
  bar.append(arrows, close);
  var image = document.createElement('img');
  var caption = document.createElement('p');
  caption.className = 'lightbox-caption';
  dialog.append(bar, image, caption);
  document.body.appendChild(dialog);

  var current = 0;
  function show(index) {
    current = (index + items.length) % items.length;
    var item = items[current];
    image.src = item.href;
    image.alt = item.querySelector('img').alt;
    caption.textContent = item.dataset.caption || '';
    // Restart the fade so each photo eases in.
    image.classList.remove('is-shown');
    void image.offsetWidth;
    image.classList.add('is-shown');
  }

  items.forEach(function (item, index) {
    item.addEventListener('click', function (e) {
      e.preventDefault();
      show(index);
      dialog.showModal();
    });
  });
  prev.addEventListener('click', function () { show(current - 1); });
  next.addEventListener('click', function () { show(current + 1); });
  close.addEventListener('click', function () { dialog.close(); });
  dialog.addEventListener('click', function (e) {
    if (e.target === dialog) dialog.close();
  });
  dialog.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft') show(current - 1);
    if (e.key === 'ArrowRight') show(current + 1);
  });
})();
