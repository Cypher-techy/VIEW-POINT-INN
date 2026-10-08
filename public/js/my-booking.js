(function () {
  'use strict';

  var TYPES = { room: 'Room booking', table: 'Table reservation', event: 'Event booking', order: 'Food order' };
  var MESSAGES = {
    pending: 'We have received this and will contact you to confirm.',
    confirmed: 'This is confirmed. We look forward to seeing you.',
    preparing: 'The kitchen is preparing your order.',
    ready: 'Your order is ready.',
    completed: 'This has been completed. Thank you for choosing Viewpoint Inn.',
    cancelled: 'This has been cancelled.'
  };

  function $(id) { return document.getElementById(id); }
  var form = $('lookup-form');
  var result = $('lookup-result');
  var cancelButton = $('result-cancel');
  var credentials = null;

  function fmtDate(value) {
    var p = value.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
    });
  }

  function rows(record) {
    var d = record.details || {};
    if (record.type === 'room') {
      return [['Room', d.rooms + ' × ' + d.roomType], ['Check-in', fmtDate(d.checkIn)], ['Check-out', fmtDate(d.checkOut)], ['Guests', d.guests]];
    }
    if (record.type === 'table') {
      return [['Date', fmtDate(d.date)], ['Time', d.time], ['Guests', d.guests], ['Seating', d.area]];
    }
    if (record.type === 'event') {
      return [['Event', d.eventType], ['Date', fmtDate(d.date) + (d.startTime ? ' at ' + d.startTime : '')], ['Guests', d.guests]];
    }
    var list = record.items.map(function (i) { return i.qty + ' × ' + i.name; }).join(', ');
    return [['Items', list], ['Total', 'KSh ' + record.total.toLocaleString('en-KE')],
      ['Service', record.mode + (record.location ? ' (' + record.location + ')' : '')]];
  }

  function show(record) {
    $('result-type').textContent = TYPES[record.type] + ' for ' + record.name;
    $('result-ref').textContent = record.ref;
    var status = $('result-status');
    status.textContent = record.status;
    status.className = 'status status-' + record.status;
    $('result-message').textContent = MESSAGES[record.status] || '';

    var list = $('result-details');
    list.textContent = '';
    rows(record).forEach(function (row) {
      var wrap = document.createElement('div');
      var dt = document.createElement('dt');
      var dd = document.createElement('dd');
      dt.textContent = row[0];
      dd.textContent = row[1];
      wrap.append(dt, dd);
      list.appendChild(wrap);
    });

    cancelButton.hidden = !record.canCancel;
    cancelButton.textContent = record.type === 'order' ? 'Cancel this order' : 'Cancel this booking';
    result.hidden = false;
    result.focus();
  }

  function request(url) {
    var errorBox = $('lookup-error');
    errorBox.hidden = true;
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (res.ok && body.record) return show(body.record);
        result.hidden = url.indexOf('cancel') === -1;
        errorBox.textContent = body.error || 'Something went wrong. Please try again.';
        errorBox.hidden = false;
      });
    }).catch(function () {
      errorBox.textContent = 'We could not reach the server. Check your connection and try again.';
      errorBox.hidden = false;
    });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    credentials = { ref: form.elements.ref.value.trim(), phone: form.elements.phone.value.trim() };
    var submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    request('/api/my-booking').then(function () { submit.disabled = false; });
  });

  cancelButton.addEventListener('click', function () {
    if (!window.confirm('Cancel ' + credentials.ref.toUpperCase() + '? This cannot be undone online.')) return;
    cancelButton.disabled = true;
    request('/api/my-booking/cancel').then(function () { cancelButton.disabled = false; });
  });

  // Links such as /my-booking?ref=VPR-ABCDE fill in the reference.
  var ref = new URLSearchParams(window.location.search).get('ref');
  if (ref) form.elements.ref.value = ref;
})();
