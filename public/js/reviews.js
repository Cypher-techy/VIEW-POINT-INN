(function () {
  'use strict';

  var list = document.getElementById('review-list');
  var form = document.getElementById('review-form');
  if (!list || !form) return;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  fetch('/api/reviews').then(function (res) { return res.json(); }).then(function (data) {
    (data.reviews || []).forEach(function (review) {
      var card = el('li', 'review-card');
      var stars = el('p', 'stars', '★★★★★'.slice(0, review.rating) + '☆☆☆☆☆'.slice(0, 5 - review.rating));
      stars.setAttribute('aria-label', review.rating + ' out of 5 stars');
      var date = new Date(review.createdAt).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
      card.append(stars, el('blockquote', '', review.text), el('p', 'review-by', review.name + ', ' + date));
      list.appendChild(card);
    });
    list.hidden = list.children.length === 0;
    document.getElementById('review-none').hidden = list.children.length > 0;
  }).catch(function () { /* the section still offers the form */ });

  var errorBox = form.querySelector('.form-error');
  var okBox = form.querySelector('.form-ok');

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errorBox.hidden = true;
    okBox.hidden = true;
    var submit = form.querySelector('[type="submit"]');
    submit.disabled = true;

    fetch('/api/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.elements.name.value,
        rating: form.elements.rating.value,
        text: form.elements.text.value,
        website: form.elements.website.value
      })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (res.ok) {
          form.reset();
          okBox.textContent = 'Thank you. Your review will appear here once our team has read it.';
          okBox.hidden = false;
          return;
        }
        var details = Object.keys(body.errors || {}).map(function (k) { return body.errors[k]; }).join(' ');
        errorBox.textContent = details || body.error || 'We could not send your review. Please try again.';
        errorBox.hidden = false;
      });
    }).catch(function () {
      errorBox.textContent = 'We could not reach the server. Check your connection and try again.';
      errorBox.hidden = false;
    }).then(function () {
      submit.disabled = false;
    });
  });
})();
