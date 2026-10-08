(function () {
  'use strict';

  var LABELS = { room: 'room booking', table: 'table reservation', event: 'event booking' };

  var tabs = Array.prototype.slice.call(document.querySelectorAll('[data-tab]'));
  var panels = Array.prototype.slice.call(document.querySelectorAll('[data-panel]'));
  var tabList = document.querySelector('.tabs');
  var success = document.getElementById('booking-success');
  var params = new URLSearchParams(window.location.search);

  function selectTab(type, focus) {
    tabs.forEach(function (tab) {
      var active = tab.dataset.tab === type;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focus) tab.focus();
    });
    panels.forEach(function (panel) {
      panel.hidden = panel.dataset.panel !== type;
    });
  }

  tabs.forEach(function (tab, index) {
    tab.addEventListener('click', function () { selectTab(tab.dataset.tab); });
    tab.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var step = e.key === 'ArrowRight' ? 1 : -1;
      selectTab(tabs[(index + step + tabs.length) % tabs.length].dataset.tab, true);
    });
  });

  // Links such as /book?type=table&area=Garden open the right tab with the option chosen.
  var startType = params.get('type');
  if (LABELS[startType]) selectTab(startType);
  [['room', 'r-type'], ['area', 't-area']].forEach(function (pair) {
    var value = params.get(pair[0]);
    var select = document.getElementById(pair[1]);
    var match = value && Array.prototype.some.call(select.options, function (o) { return o.value === value; });
    if (match) select.value = value;
  });

  function toInputDate(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }
  function nextDay(value) {
    var p = value.split('-').map(Number);
    return toInputDate(new Date(p[0], p[1] - 1, p[2] + 1));
  }

  var today = toInputDate(new Date());
  document.querySelectorAll('input[type="date"]').forEach(function (input) { input.min = today; });
  var checkIn = document.getElementById('r-in');
  var checkOut = document.getElementById('r-out');
  checkOut.min = nextDay(today);
  checkIn.addEventListener('change', function () {
    if (!checkIn.value) return;
    checkOut.min = nextDay(checkIn.value);
    if (checkOut.value && checkOut.value <= checkIn.value) checkOut.value = '';
  });

  function clearErrors(form) {
    form.querySelectorAll('.field-error').forEach(function (node) { node.remove(); });
    form.querySelectorAll('[aria-invalid]').forEach(function (node) { node.removeAttribute('aria-invalid'); });
    form.querySelector('.form-error').hidden = true;
  }

  function showErrors(form, message, errors) {
    var box = form.querySelector('.form-error');
    box.textContent = message;
    box.hidden = false;
    var first = null;
    Object.keys(errors || {}).forEach(function (name) {
      var input = form.elements[name];
      if (!input || !input.closest) return;
      input.setAttribute('aria-invalid', 'true');
      var note = document.createElement('span');
      note.className = 'field-error';
      note.textContent = errors[name];
      input.closest('.field').appendChild(note);
      first = first || input;
    });
    if (first) first.focus();
  }

  function showSuccess(type, ref) {
    document.getElementById('booking-ref').textContent = ref;
    document.getElementById('booking-wa').href = 'https://wa.me/' + document.body.dataset.whatsapp + '?text=' +
      encodeURIComponent('Hello Viewpoint Inn, I have just sent a ' + LABELS[type] + ' request. My reference is ' + ref + '.');
    tabList.hidden = true;
    panels.forEach(function (panel) { panel.hidden = true; });
    success.hidden = false;
    success.focus();
    success.scrollIntoView({ block: 'center' });
  }

  document.getElementById('booking-again').addEventListener('click', function () {
    success.hidden = true;
    tabList.hidden = false;
    selectTab(tabs.filter(function (t) { return t.getAttribute('aria-selected') === 'true'; })[0].dataset.tab);
  });

  document.querySelectorAll('[data-booking]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      clearErrors(form);

      var type = form.dataset.booking;
      var data = {};
      new FormData(form).forEach(function (value, key) {
        if (key === 'services') (data.services = data.services || []).push(value);
        else data[key] = value;
      });

      var submit = form.querySelector('[type="submit"]');
      submit.disabled = true;

      fetch('/api/bookings/' + type, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (res.ok && body.ref) {
            form.reset();
            showSuccess(type, body.ref);
          } else {
            showErrors(form, body.error || 'We could not send your request. Please try again or call us.', body.errors);
          }
        });
      }).catch(function () {
        showErrors(form, 'We could not reach the server. Check your connection and try again, or call us.');
      }).then(function () {
        submit.disabled = false;
      });
    });
  });
})();
