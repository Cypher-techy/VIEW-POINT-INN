(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
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
  function money(amount) { return 'KSh ' + amount.toLocaleString('en-KE'); }

  var items = [];
  var cart = {}; // item id -> quantity
  var form = $('order-form');
  var errorBox = form.querySelector('.form-error');

  function cartLines() {
    return items.filter(function (item) { return cart[item.id]; }).map(function (item) {
      return { item: item, qty: cart[item.id] };
    });
  }

  function change(id, delta) {
    var qty = Math.min(50, Math.max(0, (cart[id] || 0) + delta));
    if (qty) cart[id] = qty;
    else delete cart[id];
    renderCart();
  }

  function qtyButton(label, name, id, delta) {
    var b = el('button', { type: 'button', text: label, 'aria-label': name });
    b.addEventListener('click', function () { change(id, delta); });
    return b;
  }

  function renderCart() {
    var lines = cartLines();
    var total = 0;
    var list = $('cart-lines');
    list.textContent = '';
    lines.forEach(function (line) {
      total += line.item.price * line.qty;
      list.appendChild(el('li', {}, [
        el('span', { class: 'cart-name', text: line.item.name }),
        el('span', { class: 'qty' }, [
          qtyButton('−', 'Remove one ' + line.item.name, line.item.id, -1),
          el('span', { text: String(line.qty) }),
          qtyButton('+', 'Add one more ' + line.item.name, line.item.id, 1)
        ]),
        el('span', { class: 'cart-price', text: money(line.item.price * line.qty) })
      ]));
    });
    $('cart-empty').hidden = lines.length > 0;
    $('cart-total-row').hidden = lines.length === 0;
    $('cart-total').textContent = money(total);
    form.hidden = lines.length === 0;
  }

  function renderMenu(categories) {
    var list = $('menu-list');
    var filters = $('menu-filters');
    var used = categories.filter(function (c) { return items.some(function (i) { return i.category === c; }); });

    function show(category) {
      filters.querySelectorAll('button').forEach(function (b) {
        b.setAttribute('aria-pressed', String(b.dataset.category === category));
      });
      list.querySelectorAll('[data-category]').forEach(function (section) {
        section.hidden = category !== 'all' && section.dataset.category !== category;
      });
    }

    ['all'].concat(used).forEach(function (category) {
      var chip = el('button', { type: 'button', class: 'chip', 'data-category': category, text: category === 'all' ? 'All' : category });
      chip.addEventListener('click', function () { show(category); });
      filters.appendChild(chip);
    });

    used.forEach(function (category) {
      var cards = items.filter(function (i) { return i.category === category; }).map(function (item) {
        var add = el('button', { type: 'button', class: 'btn btn-small btn-outline', text: 'Add', 'aria-label': 'Add ' + item.name + ' to your order' });
        add.addEventListener('click', function () { change(item.id, 1); });
        return el('li', { class: 'menu-item' }, [
          el('div', {}, [
            el('h3', { text: item.name }),
            item.description ? el('p', { text: item.description }) : null
          ]),
          el('div', { class: 'menu-item-buy' }, [el('strong', { text: money(item.price) }), add])
        ]);
      });
      list.appendChild(el('section', { class: 'menu-section', 'data-category': category }, [
        el('h2', { text: category }),
        el('ul', {}, cards)
      ]));
    });

    filters.hidden = used.length < 2;
    show('all');
  }

  fetch('/api/menu').then(function (res) { return res.json(); }).then(function (data) {
    items = data.items || [];
    if (!items.length) {
      $('menu-status').textContent = 'Our online menu is being prepared. For now, please call or WhatsApp us to order, or ask at the restaurant.';
      return;
    }
    $('menu-status').hidden = true;
    $('cart').hidden = false;
    renderMenu(data.categories || []);
    renderCart();
  }).catch(function () {
    $('menu-status').textContent = 'We could not load the menu. Check your connection and refresh the page.';
  });

  var mode = $('o-mode');
  function updateLocationLabel() {
    var label = $('o-location-label');
    label.textContent = mode.value === 'Room delivery' ? 'Room number' : 'Table number ';
    if (mode.value !== 'Room delivery') label.appendChild(el('span', { class: 'optional', text: '(optional)' }));
    $('o-location').closest('.field').hidden = mode.value === 'Pickup';
  }
  mode.addEventListener('change', updateLocationLabel);
  updateLocationLabel();

  function clearErrors() {
    form.querySelectorAll('.field-error').forEach(function (n) { n.remove(); });
    form.querySelectorAll('[aria-invalid]').forEach(function (n) { n.removeAttribute('aria-invalid'); });
    errorBox.hidden = true;
  }

  function showErrors(message, errors) {
    errorBox.textContent = message;
    errorBox.hidden = false;
    var first = null;
    Object.keys(errors || {}).forEach(function (name) {
      var input = form.elements[name];
      if (!input || !input.closest) return;
      input.setAttribute('aria-invalid', 'true');
      input.closest('.field').appendChild(el('span', { class: 'field-error', text: errors[name] }));
      first = first || input;
    });
    if (first) first.focus();
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    clearErrors();
    var submit = form.querySelector('[type="submit"]');
    submit.disabled = true;

    fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.elements.name.value,
        phone: form.elements.phone.value,
        mode: mode.value,
        location: mode.value === 'Pickup' ? '' : form.elements.location.value,
        notes: form.elements.notes.value,
        website: form.elements.website.value,
        items: cartLines().map(function (line) { return { id: line.item.id, qty: line.qty }; })
      })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok || !body.ref) {
          return showErrors(body.error || 'We could not send your order. Please try again or call us.', body.errors);
        }
        $('order-ref').textContent = body.ref;
        $('order-summary').textContent = 'Total ' + money(body.total) + ', paid at the inn.';
        cart = {};
        form.reset();
        updateLocationLabel();
        renderCart();
        $('cart-body').hidden = true;
        $('order-success').hidden = false;
        $('order-success').focus();
      });
    }).catch(function () {
      showErrors('We could not reach the server. Check your connection and try again, or call us.');
    }).then(function () {
      submit.disabled = false;
    });
  });

  $('order-again').addEventListener('click', function () {
    $('order-success').hidden = true;
    $('cart-body').hidden = false;
  });
})();
