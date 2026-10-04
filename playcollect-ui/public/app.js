/* Playcollect – Oberfläche: Suche, Ein-Klick-Sammeln, Einpflegen, Nachladen */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var isLoggedIn = document.body.getAttribute('data-logged-in') === '1';
  var T = window.PC_T || {};
  var LANG = document.body.getAttribute('data-locale') || 'de';
  function tr(key, vars) {
    var text = T[key] || key;
    Object.keys(vars || {}).forEach(function (k) { text = text.replace('{' + k + '}', vars[k]); });
    return text;
  }
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function debounce(fn, wait) {
    var timer;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(ctx, args); }, wait);
    };
  }

  // ---------------------------------------------------------------- Toasts
  var toastRegion = $('[data-toast-region]');
  function toast(message, options) {
    if (!toastRegion) return;
    options = options || {};
    var el = document.createElement('div');
    el.className = 'toast' + (options.kind ? ' toast-' + options.kind : '');
    el.innerHTML = '<span>' + message + '</span>';
    if (options.action) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = options.action.label;
      btn.addEventListener('click', function () { options.action.run(); remove(); });
      el.appendChild(btn);
    }
    toastRegion.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('is-in'); });
    var timer = setTimeout(remove, options.duration || 4200);
    function remove() {
      clearTimeout(timer);
      el.classList.remove('is-in');
      setTimeout(function () { el.remove(); }, 250);
    }
    while (toastRegion.children.length > 3) toastRegion.firstChild.remove();
  }

  // ---------------------------------------------------------------- API
  function api(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body || {})
    }).then(function (res) {
      return res.json().catch(function () { return { ok: false, error: 'Unerwartete Antwort.' }; })
        .then(function (json) { json.status = res.status; return json; });
    });
  }

  function goLogin() {
    window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname + window.location.search);
  }

  // ---------------------------------------------------------------- Bilder
  function markLoadedImages(root) {
    $$('.pic img', root).forEach(function (img) {
      var pic = img.parentNode;
      function ok() { pic.classList.add('is-loaded'); }
      function bad() { img.remove(); }
      if (img.complete) { if (img.naturalWidth > 0) ok(); else bad(); return; }
      img.addEventListener('load', ok, { once: true });
      img.addEventListener('error', bad, { once: true });
    });
  }
  markLoadedImages(document);

  // ---------------------------------------------------------------- Sammlungsstatus (Ein-Klick)
  function applyState(setNumber, state) {
    if (!state) return;
    $$('[data-collect][data-set="' + cssEscape(setNumber) + '"]').forEach(function (btn) {
      var list = btn.getAttribute('data-list');
      var on = list === 'owned' ? state.owned > 0 : !!state.wishlist;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (btn.classList.contains('qa')) {
        btn.title = list === 'owned'
          ? (on ? 'In meiner Sammlung – klicken zum Entfernen' : 'Hab ich!')
          : (on ? 'Auf der Wunschliste – klicken zum Entfernen' : 'Auf die Wunschliste');
      }
      if (btn.getAttribute('data-mode') === 'add' && list === 'owned') {
        var counter = btn.querySelector('[data-row-count]');
        if (counter) counter.textContent = state.owned > 0 ? '· ' + state.owned + '×' : '';
      }
    });
    var panel = $('[data-action-panel][data-set="' + cssEscape(setNumber) + '"]');
    if (panel) {
      var box = $('[data-own-box]', panel);
      var stepper = $('[data-stepper]', panel);
      var label = $('[data-own-label]', panel);
      var wishLabel = $('[data-wish-label]', panel);
      var hint = $('[data-own-hint]', panel);
      if (box) box.classList.toggle('is-on', state.owned > 0);
      if (stepper) stepper.hidden = !(state.owned > 0);
      if (label) label.textContent = state.owned > 0 ? 'In meiner Sammlung' : 'Hab ich!';
      if (wishLabel) wishLabel.textContent = state.wishlist ? 'Auf der Wunschliste' : 'Wunschliste';
      var qty = $('[data-qty]', panel);
      if (qty) qty.textContent = state.owned > 0 ? state.owned : 1;
      if (hint) {
        hint.hidden = !(state.owned > 0);
        if (state.owned > 0 && !hint.innerHTML) {
          hint.innerHTML = '<a href="/konto/sammlung?q=' + encodeURIComponent(setNumber) + '">Zustand, Preis und Notizen eintragen</a>';
        }
      }
    }
  }

  function cssEscape(value) {
    return window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&');
  }

  function pop(el) {
    if (reduceMotion || !el) return;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }

  function collect(btn) {
    if (!isLoggedIn) { goLogin(); return Promise.resolve(); }
    var set = btn.getAttribute('data-set');
    var list = btn.getAttribute('data-list');
    var mode = btn.getAttribute('data-mode') || 'toggle';
    var isOn = btn.classList.contains('is-on');
    var action = 'add';
    if (mode !== 'add' && isOn) {
      if (list === 'owned' && !window.confirm(tr('confirmRemove', { num: set }))) {
        return Promise.resolve();
      }
      action = 'remove';
    }
    btn.disabled = true;
    return api('/api/collect', { set_number: set, list: list, action: action, quantity: 1 }).then(function (res) {
      btn.disabled = false;
      if (res.login) { goLogin(); return null; }
      if (!res.ok) { toast(esc(res.error || tr('error')), { kind: 'error' }); return null; }
      applyState(res.set.number, res.state);
      pop(btn);
      var name = esc(res.set.name);
      if (action === 'remove') {
        toast((list === 'owned' ? tr('removedOwn') : tr('removedWish')) + name);
      } else if (list === 'owned') {
        toast('<b>' + esc(tr('own')) + '</b> ' + name + (res.state.owned > 1 ? ' (' + res.state.owned + '×)' : '') + (res.wishlist_cleared ? esc(tr('fromWish')) : ''), {
          action: mode === 'add' ? { label: tr('undo'), run: function () {
            api('/api/collect', { set_number: set, list: 'owned', action: 'set', quantity: Math.max(0, res.state.owned - 1) }).then(function (r) { if (r.ok) { applyState(set, r.state); recountSession(-1, res.state.owned === 1); } });
          } } : null
        });
      } else {
        toast(tr('wishAdded') + name, { action: { label: tr('undo'), run: function () {
          api('/api/collect', { set_number: set, list: 'wishlist', action: 'remove' }).then(function (r) { if (r.ok) applyState(set, r.state); });
        } } });
      }
      return res;
    }).catch(function () {
      btn.disabled = false;
      toast(tr('offline'), { kind: 'error' });
      return null;
    });
  }

  document.addEventListener('click', function (event) {
    var btn = event.target.closest('[data-collect]');
    if (!btn) return;
    event.preventDefault();
    event.stopPropagation();
    collect(btn).then(function (res) {
      if (res && btn.getAttribute('data-mode') === 'add' && btn.getAttribute('data-list') === 'owned' && res.state.owned > 0) {
        logSession(btn, res);
      }
    });
  });

  // Mengen-Stepper auf der Detailseite
  document.addEventListener('click', function (event) {
    var step = event.target.closest('[data-step]');
    if (!step) return;
    var panel = step.closest('[data-action-panel]');
    if (!panel) return;
    var set = panel.getAttribute('data-set');
    var current = Number(($('[data-qty]', panel) || {}).textContent) || 1;
    var next = current + Number(step.getAttribute('data-step'));
    if (next < 1) {
      if (!window.confirm(tr('confirmRemove', { num: set }))) return;
      api('/api/collect', { set_number: set, list: 'owned', action: 'remove' }).then(function (r) { if (r.ok) applyState(set, r.state); });
      return;
    }
    if (next > 99) return;
    api('/api/collect', { set_number: set, list: 'owned', action: 'set', quantity: next }).then(function (r) {
      if (r.ok) applyState(set, r.state); else toast(esc(r.error || tr('error')), { kind: 'error' });
    });
  });

  // ---------------------------------------------------------------- Live-Suche (Vorschläge)
  function initSuggest(form) {
    var input = $('[data-suggest]', form);
    var list = $('[data-suggest-list]', form);
    if (!input || !list) return;
    var items = [];
    var active = -1;
    var controller = null;

    function close() { list.hidden = true; active = -1; input.removeAttribute('aria-activedescendant'); }
    function render(query) {
      if (!items.length) {
        list.innerHTML = '<div class="suggest-empty">' + esc(tr('noHit')) + ' „' + esc(query) + '“. <a href="/einpflegen?q=' + encodeURIComponent(query) + '">' + esc(tr('createSet')) + '</a></div>';
        list.hidden = false;
        return;
      }
      list.innerHTML = items.map(function (item, idx) {
        var badge = item.owned ? '<span class="suggest-badge is-own">' + esc(tr('badgeOwn')) + '</span>' : (item.wishlist ? '<span class="suggest-badge is-wish">' + esc(tr('badgeWish')) + '</span>' : '');
        return '<a class="suggest-item" id="sg-' + idx + '" role="option" href="' + esc(item.url) + '" style="--tc:' + esc(item.color) + '">'
          + '<span class="suggest-pic pic' + '"><span class="pic-fallback">' + esc(item.number) + '</span>' + (item.image ? '<img src="' + esc(item.image) + '" alt="" loading="lazy">' : '') + '</span>'
          + '<span class="suggest-copy"><strong>' + esc(item.name) + '</strong><small>Set ' + esc(item.number) + (item.year ? ' · ' + esc(item.year) : '') + (item.theme ? ' · ' + esc(item.theme) : '') + '</small></span>' + badge + '</a>';
      }).join('') + '<a class="suggest-all" href="/entdecken?q=' + encodeURIComponent(query) + '">' + esc(tr('allHits')) + ' „' + esc(query) + '“ →</a>';
      list.hidden = false;
      markLoadedImages(list);
    }
    var fetchSuggest = debounce(function () {
      var q = input.value.trim();
      if (q.length < 2) { close(); return; }
      if (controller) controller.abort();
      controller = window.AbortController ? new AbortController() : null;
      fetch('/api/suggest?lang=' + LANG + '&q=' + encodeURIComponent(q), { credentials: 'same-origin', signal: controller ? controller.signal : undefined })
        .then(function (r) { return r.json(); })
        .then(function (json) { items = json.items || []; active = -1; render(q); })
        .catch(function () {});
    }, 160);

    input.addEventListener('input', fetchSuggest);
    input.addEventListener('focus', function () { if (items.length && input.value.trim().length >= 2) list.hidden = false; });
    input.addEventListener('keydown', function (event) {
      var links = $$('.suggest-item', list);
      if (event.key === 'Escape') { close(); return; }
      if (list.hidden || !links.length) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        active = (active + (event.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
        links.forEach(function (l, i) { l.classList.toggle('is-active', i === active); });
        links[active].scrollIntoView({ block: 'nearest' });
        input.setAttribute('aria-activedescendant', 'sg-' + active);
      } else if (event.key === 'Enter' && active >= 0) {
        event.preventDefault();
        window.location.href = links[active].getAttribute('href');
      }
    });
    document.addEventListener('click', function (event) { if (!form.contains(event.target)) close(); });
  }
  $$('[data-suggest-form]').forEach(initSuggest);

  // „/“ springt ins Suchfeld
  document.addEventListener('keydown', function (event) {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
    var tag = (document.activeElement && document.activeElement.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || (document.activeElement && document.activeElement.isContentEditable)) return;
    var field = $('#hero-q') || $('#header-q');
    if (field) { event.preventDefault(); field.focus(); field.select(); }
  });

  // ---------------------------------------------------------------- Filter automatisch anwenden
  $$('[data-autosubmit]').forEach(function (el) {
    el.addEventListener('change', function () {
      var form = el.closest('form');
      if (form) form.submit();
    });
  });

  // ---------------------------------------------------------------- Mehr laden (auch automatisch beim Scrollen)
  $$('[data-load-more]').forEach(function (wrap) {
    var link = $('[data-load-more-link]', wrap);
    var results = $('[data-results] .set-grid');
    if (!link || !results) return;
    var loading = false;
    function load() {
      if (loading || !wrap.isConnected) return;
      loading = true;
      link.classList.add('is-loading');
      var url = link.getAttribute('href') + '&partial=1';
      fetch(url, { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (json) {
        var tpl = document.createElement('template');
        tpl.innerHTML = json.html;
        results.appendChild(tpl.content);
        markLoadedImages(results);
        if (json.nextPage) {
          link.setAttribute('href', link.getAttribute('href').replace(/page=\d+/, 'page=' + json.nextPage));
          var rest = link.querySelector('.muted');
          if (rest) rest.textContent = '(' + tr('more', { n: json.remaining.toLocaleString(LANG === 'de' ? 'de-DE' : LANG) }) + ')';
          link.classList.remove('is-loading');
          loading = false;
        } else {
          wrap.remove();
        }
      }).catch(function () { link.classList.remove('is-loading'); loading = false; });
    }
    link.addEventListener('click', function (event) { event.preventDefault(); load(); });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) load();
      }, { rootMargin: '500px 0px' }).observe(wrap);
    }
  });

  // ---------------------------------------------------------------- Galerie auf der Detailseite
  document.addEventListener('click', function (event) {
    var thumb = event.target.closest('[data-detail-thumb]');
    if (!thumb) return;
    var gallery = thumb.closest('[data-detail-gallery]');
    var main = gallery && $('[data-detail-main-image]', gallery);
    if (!main) return;
    main.src = thumb.getAttribute('data-fullsrc');
    main.alt = thumb.getAttribute('data-alt') || '';
    $$('[data-detail-thumb]', gallery).forEach(function (b) { b.classList.toggle('is-active', b === thumb); });
  });

  // ---------------------------------------------------------------- Zahlen hochzählen
  var counters = $$('[data-count]');
  if (counters.length && 'IntersectionObserver' in window && !reduceMotion) {
    var countObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        countObserver.unobserve(entry.target);
        var el = entry.target;
        var target = Number(el.getAttribute('data-count')) || 0;
        var start = performance.now();
        var duration = 900;
        (function tick(now) {
          var t = Math.min(1, (now - start) / duration);
          var eased = 1 - Math.pow(1 - t, 3);
          el.textContent = Math.round(target * eased).toLocaleString('de-DE');
          if (t < 1) requestAnimationFrame(tick);
        })(start);
      });
    }, { threshold: 0.4 });
    counters.forEach(function (el) { countObserver.observe(el); });
  }

  // ---------------------------------------------------------------- Datei-Dropzone
  function readAsBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '').split(',')[1] || ''); };
      reader.onerror = function () { reject(new Error('Datei konnte nicht gelesen werden.')); };
      reader.readAsDataURL(file);
    });
  }

  $$('[data-dropzone]').forEach(function (zone) {
    var input = $('[data-image-input]', zone);
    var label = $('[data-drop-label]', zone);
    if (!input) return;
    function show() {
      var file = input.files && input.files[0];
      zone.classList.toggle('has-file', !!file);
      if (label) label.textContent = file ? file.name : label.getAttribute('data-default') || label.textContent;
      var old = $('.dropzone-preview', zone);
      if (old) old.remove();
      if (file && /^image\//.test(file.type)) {
        var img = document.createElement('img');
        img.className = 'dropzone-preview';
        img.alt = '';
        img.src = URL.createObjectURL(file);
        zone.appendChild(img);
      }
    }
    if (label) label.setAttribute('data-default', label.textContent);
    input.addEventListener('change', show);
    ['dragenter', 'dragover'].forEach(function (name) {
      zone.addEventListener(name, function (event) { event.preventDefault(); zone.classList.add('is-drag'); });
    });
    ['dragleave', 'drop'].forEach(function (name) {
      zone.addEventListener(name, function (event) { event.preventDefault(); zone.classList.remove('is-drag'); });
    });
    zone.addEventListener('drop', function (event) {
      if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length) {
        input.files = event.dataTransfer.files;
        show();
      }
    });
  });

  // ---------------------------------------------------------------- Foto zu einem Set ergänzen
  $$('[data-photo-upload]').forEach(function (box) {
    var input = $('[data-photo-input]', box);
    var status = $('[data-photo-status]', box);
    if (!input) return;
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;
      if (status) status.textContent = 'Wird hochgeladen …';
      readAsBase64(file).then(function (b64) {
        return api('/api/sets/' + encodeURIComponent(box.getAttribute('data-set')) + '/image', { image_base64: b64 });
      }).then(function (res) {
        if (res.ok) { window.location.reload(); return; }
        if (res.login) { goLogin(); return; }
        if (status) status.textContent = res.error || 'Upload fehlgeschlagen.';
      }).catch(function () { if (status) status.textContent = 'Upload fehlgeschlagen.'; });
    });
  });

  // ---------------------------------------------------------------- Einpflegen
  var session = $('[data-session-list]');
  var sessionEmpty = $('[data-session-empty]');
  var totalSets = $('[data-total-sets]');
  var totalPieces = $('[data-total-pieces]');

  function bump(el, delta) {
    if (!el) return;
    var current = Number(String(el.textContent).replace(/\./g, '')) || 0;
    el.textContent = Math.max(0, current + delta).toLocaleString('de-DE');
    pop(el);
  }

  function recountSession(deltaPieces, removedSet) {
    bump(totalPieces, deltaPieces);
    if (removedSet) bump(totalSets, -1);
  }

  function logSession(btn, res) {
    if (!session) return;
    var row = btn.closest('[data-qrow]');
    var number = res.set.number;
    var existing = $('[data-session-set="' + cssEscape(number) + '"]', session);
    if (existing) existing.remove();
    var li = document.createElement('li');
    li.className = 'mini-row is-new';
    li.setAttribute('data-session-set', number);
    var imgEl = row ? $('.pic img', row) : null;
    var imgUrl = imgEl ? imgEl.getAttribute('src') : '';
    li.innerHTML = '<a class="mini-thumb" href="/sets/' + encodeURIComponent(number) + '"><div class="pic"><span class="pic-fallback">' + esc(number) + '</span>' + (imgUrl ? '<img src="' + esc(imgUrl) + '" alt="">' : '') + '</div></a>'
      + '<div class="mini-copy"><a href="/sets/' + encodeURIComponent(number) + '"><strong>' + esc(res.set.name) + '</strong></a><span>Set ' + esc(number) + ' · ' + res.state.owned + '×</span></div>';
    session.insertBefore(li, session.firstChild);
    markLoadedImages(li);
    if (sessionEmpty) sessionEmpty.hidden = true;
    while (session.children.length > 8) session.lastChild.remove();
    bump(totalPieces, 1);
    if (res.state.owned === 1) bump(totalSets, 1);
  }

  var quickadd = $('[data-quickadd]');
  if (quickadd) {
    var qInput = $('[data-quickadd-input]', quickadd);
    var qResults = $('[data-quickadd-results]', quickadd);
    var qItems = [];
    var qController = null;

    var qSearch = debounce(function () {
      var q = qInput.value.trim();
      if (q.length < 2) { qItems = []; qResults.innerHTML = ''; return; }
      if (qController) qController.abort();
      qController = window.AbortController ? new AbortController() : null;
      fetch('/api/suggest?lang=de&q=' + encodeURIComponent(q), { credentials: 'same-origin', signal: qController ? qController.signal : undefined })
        .then(function (r) { return r.json(); })
        .then(function (json) { qItems = json.items || []; renderQuick(q); })
        .catch(function () {});
    }, 140);

    function renderQuick(q) {
      if (!qItems.length) {
        qResults.innerHTML = '<div class="qempty"><strong>Nichts gefunden für „' + esc(q) + '“.</strong><p>Fehlt das Set im Katalog? Leg es selbst an.</p><button type="button" class="btn btn-primary" data-open-create="' + esc(q) + '">Set „' + esc(q) + '“ neu anlegen</button></div>';
        return;
      }
      qResults.innerHTML = qItems.map(function (item) {
        return '<div class="qrow" data-qrow style="--tc:' + esc(item.color) + '">'
          + '<a class="qthumb" href="' + esc(item.url) + '"><div class="pic"><span class="pic-fallback">' + esc(item.number) + '</span>' + (item.image ? '<img src="' + esc(item.image) + '" alt="">' : '') + '</div></a>'
          + '<div class="qcopy"><a href="' + esc(item.url) + '"><strong>' + esc(item.name) + '</strong></a><span>Set ' + esc(item.number) + (item.year ? ' · ' + esc(item.year) : '') + (item.theme ? ' · ' + esc(item.theme) : '') + '</span></div>'
          + '<div class="qactions">'
          + '<button type="button" class="btn btn-own btn-sm' + (item.owned ? ' is-on' : '') + '" data-collect data-mode="add" data-set="' + esc(item.number) + '" data-list="owned">' + '<svg class="ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> Hab ich <span data-row-count>' + (item.owned ? '· ' + item.owned + '×' : '') + '</span></button>'
          + '<button type="button" class="qa qa-wish' + (item.wishlist ? ' is-on' : '') + '" data-collect data-set="' + esc(item.number) + '" data-list="wishlist" aria-label="Wunschliste" title="Wunschliste"><svg class="ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg></button>'
          + '</div></div>';
      }).join('');
      markLoadedImages(qResults);
    }

    qInput.addEventListener('input', qSearch);
    qInput.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      var q = qInput.value.trim().toLowerCase();
      if (!q || !qItems.length) return;
      var target = null;
      qItems.forEach(function (item) { if (!target && item.number.toLowerCase() === q) target = item; });
      if (!target && qItems.length === 1) target = qItems[0];
      if (!target) { var first = $('[data-collect][data-list="owned"]', qResults); if (first) first.focus(); return; }
      var btn = $('[data-qrow] [data-collect][data-list="owned"][data-set="' + cssEscape(target.number) + '"]', qResults);
      if (btn) {
        btn.click();
        qInput.value = '';
        qInput.focus();
        setTimeout(function () { qItems = []; qResults.innerHTML = ''; }, 900);
      }
    });
    if (qInput.value.trim().length >= 2) qSearch();
    if (window.matchMedia('(pointer: fine)').matches) qInput.focus();

    // Neu anlegen
    var fold = $('[data-create-fold]');
    var form = $('[data-create-form]');
    document.addEventListener('click', function (event) {
      var open = event.target.closest('[data-open-create]');
      if (!open || !fold || !form) return;
      var value = open.getAttribute('data-open-create') || '';
      fold.open = true;
      if (/^[0-9A-Za-z][0-9A-Za-z._\-\/]{1,19}$/.test(value) && /\d/.test(value)) form.set_number.value = value; else form.name.value = value;
      fold.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      (form.set_number.value ? form.name : form.set_number).focus();
    });
    if (fold && form) {
      var themeSelect = $('[data-theme-select]', form);
      var newTheme = $('[data-new-theme]', form);
      themeSelect.addEventListener('change', function () {
        var isNew = themeSelect.value === '__new__';
        newTheme.hidden = !isNew;
        if (isNew) newTheme.querySelector('input').focus();
      });
      var errorBox = $('[data-create-error]', form);
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        errorBox.hidden = true;
        var submit = $('[data-create-submit]', form);
        var file = form.image.files && form.image.files[0];
        var payload = {
          set_number: form.set_number.value,
          name: form.name.value,
          release_year: form.release_year.value,
          description: form.description.value,
          theme_slug: themeSelect.value === '__new__' ? '' : themeSelect.value,
          new_theme: themeSelect.value === '__new__' ? form.new_theme.value : '',
          add_to: (form.querySelector('[name="add_to"]:checked') || {}).value || ''
        };
        submit.disabled = true;
        submit.textContent = 'Wird angelegt …';
        (file ? readAsBase64(file) : Promise.resolve('')).then(function (b64) {
          if (b64) payload.image_base64 = b64;
          return api('/api/sets/create', payload);
        }).then(function (res) {
          submit.disabled = false;
          submit.textContent = 'Set anlegen';
          if (res.login) { goLogin(); return; }
          if (!res.ok) {
            errorBox.hidden = false;
            errorBox.innerHTML = esc(res.error || 'Das hat nicht geklappt.') + (res.url ? ' <a href="' + esc(res.url) + '">Zum Set</a>' : '');
            return;
          }
          toast('<b>Angelegt:</b> ' + esc(res.set.name), { action: { label: 'Ansehen', run: function () { window.location.href = res.set.url; } } });
          if (res.state && res.state.owned > 0) {
            logSession(form, { set: { number: res.set.number, name: res.set.name }, state: res.state });
          }
          form.reset();
          newTheme.hidden = true;
          $$('[data-dropzone]', form).forEach(function (z) {
            z.classList.remove('has-file');
            var p = $('.dropzone-preview', z); if (p) p.remove();
            var l = $('[data-drop-label]', z); if (l) l.textContent = l.getAttribute('data-default');
          });
          fold.open = false;
          qInput.value = '';
          qResults.innerHTML = '';
          qInput.focus();
        }).catch(function () {
          submit.disabled = false;
          submit.textContent = 'Set anlegen';
          errorBox.hidden = false;
          errorBox.textContent = 'Keine Verbindung. Bitte versuche es nochmal.';
        });
      });
    }

    // Viele auf einmal
    var bulk = $('[data-bulk-form]');
    if (bulk) {
      var bulkResult = $('[data-bulk-result]', bulk);
      bulk.addEventListener('submit', function (event) {
        event.preventDefault();
        var list = (bulk.querySelector('[name="list"]:checked') || {}).value || 'owned';
        api('/api/collect/bulk', { numbers: bulk.numbers.value, list: list }).then(function (res) {
          bulkResult.hidden = false;
          if (res.login) { goLogin(); return; }
          if (!res.ok) { bulkResult.className = 'form-alert form-error'; bulkResult.textContent = res.error || 'Das hat nicht geklappt.'; return; }
          var pieces = res.added.reduce(function (sum, a) { return sum + a.quantity; }, 0);
          bulkResult.className = 'form-alert form-success';
          bulkResult.innerHTML = '<strong>' + res.added.length + ' Sets eingetragen</strong> (' + pieces + ' Stück)'
            + (res.missing.length ? '<br>Nicht im Katalog: ' + res.missing.map(function (n) { return '<button type="button" class="link-btn" data-open-create="' + esc(n) + '">' + esc(n) + '</button>'; }).join(', ') : '');
          if (list === 'owned') { bump(totalSets, res.added.length); bump(totalPieces, pieces); }
          if (!res.missing.length) bulk.numbers.value = '';
          else bulk.numbers.value = res.missing.join(' ');
          toast('<b>' + res.added.length + ' Sets</b> eingetragen');
        });
      });
    }
  }
})();
