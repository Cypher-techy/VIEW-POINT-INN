// Vercel entry point: every page and API request is handled by the same server code.
const handler = require('../server.js');

// vercel.json rewrites every address to /api/index?__path=<original path>.
// Put the original address back before the server sees the request.
module.exports = function (req, res) {
  const url = new URL(req.url, 'http://localhost');
  const original = url.searchParams.get('__path');
  if (original !== null) {
    url.searchParams.delete('__path');
    const query = url.searchParams.toString();
    req.url = '/' + original.replace(/^\/+/, '') + (query ? '?' + query : '');
  }
  return handler(req, res);
};
