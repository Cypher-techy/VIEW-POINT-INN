(function () {
  'use strict';

  var BOOKING_VIEWS = ['room', 'table', 'event', 'order'];
  var OPEN_STATUSES = ['pending', 'confirmed', 'preparing', 'ready'];

  // records holds bookings and food orders together; an order has type "order".
  var state = { user: null, records: [], menu: [], menuCategories: [], reviews: [], today: '', view: 'room' };

  function $(id) { return document.getElementById(id); }

  // Builds an element. Guest-supplied data only ever goes in through textContent, never as HTML.
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === 'text') node.textContent = attrs[key];
      else if (key === 'class') node.className = attrs[key];
      else node.setAttribute(key, attrs[key]);
    });
    (children || []).forEach(function (child) { if (child) node.appendChild(child); });
    return node;
  }

  function api(method, url, body) {
    return fetch(url, {
      method: method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      if (res.status === 401) {
        window.location.href = '/staff';
        throw new Error('Your session has ended. Please sign in again.');
      }
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
        return data;
      });
    });
  }

  function showMessage(id, message) {
    var box = $(id);
    box.textContent = message || '';
    box.hidden = !message;
  }

  function fmtDate(value) {
    var p = value.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
    });
  }

  function money(amount) { return 'KSh ' + amount.toLocaleString('en-KE'); }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  function isOpen(r) { return OPEN_STATUSES.indexOf(r.status) !== -1; }
  function recordUrl(r) { return '/api/admin/' + (r.type === 'order' ? 'orders' : 'bookings') + '/' + r.id; }

  // The date staff need to act by: arrival for rooms, the day for tables and events, time placed for orders.
  function primaryDate(r) {
    if (r.type === 'order') return r.createdAt;
    return r.type === 'room' ? r.details.checkIn : r.details.date;
  }

  function detailLines(r) {
    var d = r.details;
    if (r.type === 'order') {
      return r.items.map(function (i) { return i.qty + ' × ' + i.name; }).concat([
        'Total ' + money(r.total),
        r.mode + (r.location ? ' (' + r.location + ')' : '')
      ]);
    }
    if (r.type === 'room') {
      var nights = Math.round((Date.parse(d.checkOut) - Date.parse(d.checkIn)) / 86400000);
      return [
        plural(d.rooms, d.roomType),
        fmtDate(d.checkIn) + ' to ' + fmtDate(d.checkOut) + ' (' + plural(nights, 'night') + ')',
        plural(d.guests, 'guest')
      ];
    }
    if (r.type === 'table') {
      return [fmtDate(d.date) + ' at ' + d.time, plural(d.guests, 'guest') + ', ' + d.area];
    }
    var lines = [d.eventType, fmtDate(d.date) + (d.startTime ? ' at ' + d.startTime : ''), plural(d.guests, 'guest')];
    if (d.services.length) lines.push('Needs: ' + d.services.join(', '));
    return lines;
  }

  function renderStats() {
    var all = state.records;
    var today = state.today;
    $('stat-pending').textContent = all.filter(function (r) { return r.status === 'pending'; }).length;
    $('stat-arrivals').textContent = all.filter(function (r) {
      return r.type === 'room' && r.details.checkIn === today && isOpen(r);
    }).length;
    $('stat-tables').textContent = all.filter(function (r) {
      return r.type === 'table' && r.details.date === today && r.status !== 'cancelled';
    }).length;
    $('stat-events').textContent = all.filter(function (r) {
      return r.type === 'event' && r.details.date >= today && isOpen(r);
    }).length;

    function badge(id, count) {
      $(id).textContent = count;
      $(id).hidden = count === 0;
    }
    BOOKING_VIEWS.forEach(function (type) {
      badge('badge-' + type, all.filter(function (r) { return r.type === type && r.status === 'pending'; }).length);
    });
    badge('badge-reviews', state.reviews.filter(function (r) { return r.status === 'pending'; }).length);
  }

  function showBookingError(err) { showMessage('bookings-error', err.message); }

  function applyUpdate(data) {
    state.records = state.records.map(function (r) { return r.id === data.booking.id ? data.booking : r; });
    render();
  }

  function patchRecord(record, changes) {
    showMessage('bookings-error', '');
    api('PATCH', recordUrl(record), changes).then(applyUpdate).catch(showBookingError);
  }

  function actionButton(label, className, handler) {
    var b = el('button', { type: 'button', text: label, class: className || '' });
    b.addEventListener('click', handler);
    return b;
  }

  // The next step in each workflow: bookings are confirmed then completed; orders are prepared, readied, then completed.
  var NEXT_STEP = {
    booking: { pending: ['Confirm', 'confirmed'], confirmed: ['Mark completed', 'completed'] },
    order: { pending: ['Accept order', 'preparing'], preparing: ['Mark ready', 'ready'], ready: ['Mark completed', 'completed'] }
  };

  function rowActions(r) {
    var actions = [];
    var noun = r.type === 'order' ? 'order' : 'booking';
    var next = NEXT_STEP[noun][r.status];
    if (next) actions.push(actionButton(next[0], 'primary', function () { patchRecord(r, { status: next[1] }); }));
    if (isOpen(r)) {
      actions.push(actionButton('Cancel', 'danger', function () {
        if (window.confirm('Cancel ' + noun + ' ' + r.ref + ' for ' + r.name + '?')) patchRecord(r, { status: 'cancelled' });
      }));
    } else {
      actions.push(actionButton('Reopen', '', function () { patchRecord(r, { status: 'pending' }); }));
    }
    actions.push(actionButton(r.staffNote ? 'Edit note' : 'Add note', '', function () {
      var note = window.prompt('Staff note for ' + r.ref + ' (only staff can see this):', r.staffNote || '');
      if (note !== null) patchRecord(r, { staffNote: note });
    }));
    if (state.user.role === 'admin') {
      actions.push(actionButton('Delete', 'danger', function () {
        if (!window.confirm('Permanently delete ' + noun + ' ' + r.ref + '? This cannot be undone.')) return;
        showMessage('bookings-error', '');
        api('DELETE', recordUrl(r)).then(function () {
          state.records = state.records.filter(function (x) { return x.id !== r.id; });
          render();
        }).catch(showBookingError);
      }));
    }
    return el('div', { class: 'row-actions' }, actions);
  }

  function renderBookings() {
    var filter = $('filter-status').value;
    var query = $('filter-search').value.trim().toLowerCase();

    var rows = state.records.filter(function (r) {
      if (r.type !== state.view) return false;
      if (filter === 'active' ? !isOpen(r) : filter !== 'all' && r.status !== filter) return false;
      if (!query) return true;
      return [r.name, r.phone, r.email, r.ref].join(' ').toLowerCase().indexOf(query) !== -1;
    });

    // Open work is listed soonest first; history is listed newest first.
    if (filter === 'active' || filter === 'pending') {
      rows.sort(function (a, b) { return primaryDate(a) < primaryDate(b) ? -1 : primaryDate(a) > primaryDate(b) ? 1 : 0; });
    }

    var body = $('bookings-body');
    body.textContent = '';
    rows.forEach(function (r) {
      var received = new Date(r.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      var notes = [];
      if (r.notes) notes.push(el('span', { text: r.notes }));
      if (r.staffNote) notes.push(el('span', { class: 'staff-note', text: 'Staff: ' + r.staffNote }));

      var statusCell = [el('span', { class: 'status status-' + r.status, text: r.status })];
      if (r.updatedBy) statusCell.push(el('span', { class: 'sub', text: 'by ' + r.updatedBy }));

      body.appendChild(el('tr', {}, [
        el('td', {}, [el('span', { class: 'ref', text: r.ref }), el('span', { class: 'sub', text: 'Received ' + received })]),
        el('td', {}, [
          el('span', { text: r.name }),
          el('a', { href: 'tel:' + r.phone.replace(/[^\d+]/g, ''), text: r.phone }),
          r.email ? el('a', { class: 'sub', href: 'mailto:' + r.email, text: r.email }) : null
        ]),
        el('td', {}, detailLines(r).map(function (line) { return el('span', { text: line }); })),
        el('td', {}, notes),
        el('td', {}, statusCell),
        el('td', {}, [rowActions(r)])
      ]));
    });

    $('bookings-empty').hidden = rows.length > 0;
  }

  /* Menu */

  function menuError(err) { showMessage('menu-error', err.message); }

  function patchMenu(item, changes) {
    showMessage('menu-error', '');
    api('PATCH', '/api/admin/menu/' + item.id, changes).then(function (data) {
      state.menu = state.menu.map(function (m) { return m.id === data.item.id ? data.item : m; });
      renderMenu();
    }).catch(menuError);
  }

  function renderMenu() {
    var wrap = $('menu-admin');
    wrap.textContent = '';
    state.menuCategories.forEach(function (category) {
      var items = state.menu.filter(function (m) { return m.category === category; });
      if (!items.length) return;
      wrap.appendChild(el('h3', { class: 'menu-cat', text: category }));
      wrap.appendChild(el('ul', { class: 'user-list' }, items.map(function (item) {
        return el('li', {}, [
          el('div', {}, [
            el('span', { text: item.name + ', ' + money(item.price) }),
            el('span', { class: 'sub', text: (item.available ? 'Available' : 'Hidden from website') + (item.description ? '. ' + item.description : '') })
          ]),
          el('div', { class: 'row-actions' }, [
            actionButton(item.available ? 'Hide' : 'Make available', '', function () { patchMenu(item, { available: !item.available }); }),
            actionButton('Change price', '', function () {
              var price = window.prompt('New price for ' + item.name + ' in KSh:', item.price);
              if (price !== null) patchMenu(item, { price: price.trim() });
            }),
            actionButton('Delete', 'danger', function () {
              if (!window.confirm('Remove ' + item.name + ' from the menu?')) return;
              showMessage('menu-error', '');
              api('DELETE', '/api/admin/menu/' + item.id).then(function () {
                state.menu = state.menu.filter(function (m) { return m.id !== item.id; });
                renderMenu();
              }).catch(menuError);
            })
          ])
        ]);
      })));
    });
    $('menu-empty').hidden = state.menu.length > 0;

    var select = $('m-category');
    if (!select.options.length) {
      state.menuCategories.forEach(function (c) { select.appendChild(el('option', { text: c })); });
    }
  }

  $('menu-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = e.target;
    showMessage('menu-form-error', '');
    api('POST', '/api/admin/menu', {
      name: form.elements.name.value,
      category: form.elements.category.value,
      price: form.elements.price.value,
      description: form.elements.description.value
    }).then(function (data) {
      state.menu.push(data.item);
      var category = form.elements.category.value;
      form.reset();
      form.elements.category.value = category;
      form.elements.name.focus();
      renderMenu();
    }).catch(function (err) { showMessage('menu-form-error', err.message); });
  });

  /* Reviews */

  function reviewsError(err) { showMessage('reviews-error', err.message); }

  function renderReviews() {
    var list = $('review-admin');
    list.textContent = '';
    state.reviews.forEach(function (review) {
      var approved = review.status === 'approved';
      list.appendChild(el('li', {}, [
        el('div', {}, [
          el('span', { text: review.name + ', ' + plural(review.rating, 'star') }),
          el('span', { class: 'sub', text: review.text }),
          el('span', { class: 'status status-' + (approved ? 'confirmed' : 'pending'), text: approved ? 'On website' : 'Awaiting approval' })
        ]),
        el('div', { class: 'row-actions' }, [
          actionButton(approved ? 'Hide' : 'Approve', approved ? '' : 'primary', function () {
            showMessage('reviews-error', '');
            api('PATCH', '/api/admin/reviews/' + review.id, { status: approved ? 'pending' : 'approved' }).then(function (data) {
              state.reviews = state.reviews.map(function (r) { return r.id === data.review.id ? data.review : r; });
              render();
            }).catch(reviewsError);
          }),
          actionButton('Delete', 'danger', function () {
            if (!window.confirm('Delete the review from ' + review.name + '?')) return;
            showMessage('reviews-error', '');
            api('DELETE', '/api/admin/reviews/' + review.id).then(function () {
              state.reviews = state.reviews.filter(function (r) { return r.id !== review.id; });
              render();
            }).catch(reviewsError);
          })
        ])
      ]));
    });
    $('reviews-empty').hidden = state.reviews.length > 0;
  }

  function render() {
    renderStats();
    if (BOOKING_VIEWS.indexOf(state.view) !== -1) renderBookings();
    if (state.view === 'menu') renderMenu();
    if (state.view === 'reviews') renderReviews();
  }

  function loadData() {
    return api('GET', '/api/admin/bookings').then(function (data) {
      state.records = data.bookings.concat(data.orders);
      state.menu = data.menu;
      state.menuCategories = data.menuCategories;
      state.reviews = data.reviews;
      state.today = data.today;
      showMessage('bookings-error', '');
      render();
      $('updated').textContent = 'Updated ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) +
        '. Refreshes every minute.';
    }).catch(showBookingError);
  }

  /* Staff accounts */

  function loadUsers() {
    return api('GET', '/api/admin/users').then(function (data) {
      var list = $('user-list');
      list.textContent = '';
      data.users.forEach(function (user) {
        var remove = null;
        if (user.id !== state.user.id) {
          remove = el('div', { class: 'row-actions' }, [actionButton('Remove', 'danger', function () {
            if (!window.confirm('Remove the account for ' + user.name + '? They will be signed out.')) return;
            api('DELETE', '/api/admin/users/' + user.id).then(loadUsers).catch(function (err) { showMessage('user-error', err.message); });
          })]);
        }
        list.appendChild(el('li', {}, [
          el('div', {}, [
            el('span', { text: user.name + (user.id === state.user.id ? ' (you)' : '') }),
            el('span', { class: 'sub', text: user.username + ', ' + (user.role === 'admin' ? 'administrator' : 'staff') })
          ]),
          remove
        ]));
      });
    }).catch(function (err) { showMessage('user-error', err.message); });
  }

  $('user-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = e.target;
    showMessage('user-error', '');
    showMessage('user-ok', '');
    api('POST', '/api/admin/users', {
      name: form.elements.name.value,
      username: form.elements.username.value,
      password: form.elements.password.value,
      role: form.elements.role.value
    }).then(function (data) {
      form.reset();
      showMessage('user-ok', 'Added ' + data.user.name + '. Give them their username and temporary password.');
      return loadUsers();
    }).catch(function (err) { showMessage('user-error', err.message); });
  });

  /* Account */

  $('password-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = e.target;
    showMessage('password-error', '');
    showMessage('password-ok', '');
    if (form.elements.next.value !== form.elements.confirm.value) {
      return showMessage('password-error', 'The two new passwords do not match.');
    }
    api('POST', '/api/auth/password', { current: form.elements.current.value, next: form.elements.next.value }).then(function (data) {
      state.user = data.user;
      form.reset();
      $('pw-notice').hidden = true;
      showMessage('password-ok', 'Your password has been changed.');
    }).catch(function (err) { showMessage('password-error', err.message); });
  });

  /* Navigation */

  function switchView(view) {
    state.view = view;
    document.querySelectorAll('[data-view]').forEach(function (tab) {
      if (tab.dataset.view === view) tab.setAttribute('aria-current', 'true');
      else tab.removeAttribute('aria-current');
    });
    $('view-bookings').hidden = BOOKING_VIEWS.indexOf(view) === -1;
    ['menu', 'reviews', 'staff', 'account'].forEach(function (name) {
      $('view-' + name).hidden = view !== name;
    });
    render();
    if (view === 'staff') loadUsers();
  }

  document.querySelectorAll('[data-view]').forEach(function (tab) {
    tab.addEventListener('click', function () { switchView(tab.dataset.view); });
  });
  document.querySelectorAll('[data-view-link]').forEach(function (link) {
    link.addEventListener('click', function () { switchView(link.dataset.viewLink); });
  });

  $('filter-status').addEventListener('change', renderBookings);
  $('filter-search').addEventListener('input', renderBookings);
  $('refresh').addEventListener('click', loadData);
  $('logout').addEventListener('click', function () {
    api('POST', '/api/auth/logout').then(function () { window.location.href = '/staff'; }).catch(showBookingError);
  });

  api('GET', '/api/auth/me').then(function (data) {
    state.user = data.user;
    $('staff-user').textContent = data.user.name;
    $('tab-staff').hidden = data.user.role !== 'admin';
    $('pw-notice').hidden = !data.user.mustChangePassword;
    return loadData();
  }).catch(showBookingError);

  // Skip the refresh while someone is typing in a form, so their entry is not disturbed.
  setInterval(function () {
    var typing = document.activeElement && document.activeElement.closest('form');
    if (!document.hidden && state.user && !typing) loadData();
  }, 60000);
})();
