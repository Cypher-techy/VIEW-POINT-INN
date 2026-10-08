(function () {
  'use strict';

  var form = document.getElementById('login-form');
  var errorBox = document.getElementById('login-error');

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errorBox.hidden = true;
    var submit = form.querySelector('[type="submit"]');
    submit.disabled = true;

    fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: form.elements.username.value, password: form.elements.password.value })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (res.ok) {
          window.location.href = '/staff/dashboard';
          return;
        }
        errorBox.textContent = body.error || 'Could not sign in. Please try again.';
        errorBox.hidden = false;
        submit.disabled = false;
        form.elements.password.value = '';
        form.elements.password.focus();
      });
    }).catch(function () {
      errorBox.textContent = 'Could not reach the server. Check your connection and try again.';
      errorBox.hidden = false;
      submit.disabled = false;
    });
  });
})();
