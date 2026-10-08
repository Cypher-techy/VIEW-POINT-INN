'use strict';

// Viewpoint Inn Mbuinzau: website, booking API and staff dashboard.
// No dependencies. Run with: node server.js

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const VIEWS_DIR = path.join(ROOT, 'views');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const FIRST_LOGIN_FILE = path.join(DATA_DIR, 'first-login.txt');

const PORT = Number(process.env.PORT) || 4000;
// Set TRUST_PROXY=1 when running behind a reverse proxy that sets X-Forwarded-* headers.
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const VERSION = Date.now().toString(36);

const SITE = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
const IMAGES = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'img', 'manifest.json'), 'utf8'));

const ROOM_TYPES = ['Deluxe Single Room', 'Deluxe Double Room', 'Business Apartment'];
const TABLE_AREAS = ['Restaurant', 'Garden', 'Bar & Lounge', 'VIP Lounge'];
const EVENT_TYPES = ['Wedding', 'Birthday or party', 'Conference or meeting', 'Corporate function', 'Team retreat', 'Other'];
const EVENT_SERVICES = ['Catering', 'Guest rooms', 'Conference room', 'Garden space'];
const STATUSES = ['pending', 'confirmed', 'completed', 'cancelled'];
const MENU_CATEGORIES = ['Breakfast', 'Starters & snacks', 'Main dishes', 'Sides', 'Desserts', 'Hot drinks', 'Soft drinks', 'Bar'];
const ORDER_MODES = ['Eat in', 'Pickup', 'Room delivery'];
const ORDER_STATUSES = ['pending', 'preparing', 'ready', 'completed', 'cancelled'];
const PHONE_RE = /^\+?\d[\d\s-]{7,18}$/;

const SESSION_COOKIE = 'vp_session';
const SESSION_HOURS = 12;

const PAGES = {
  '/': 'pages/home',
  '/rooms': 'pages/rooms',
  '/dining': 'pages/dining',
  '/events': 'pages/events',
  '/gallery': 'pages/gallery',
  '/contact': 'pages/contact',
  '/menu': 'pages/menu',
  '/faq': 'pages/faq',
  '/my-booking': 'pages/my-booking',
  '/terms': 'pages/terms',
  '/privacy': 'pages/privacy',
  '/book': 'pages/book'
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ---------- Storage ---------- */

let db = { users: [], sessions: [], bookings: [], orders: [], menu: [], reviews: [] };

function loadDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
  }
  db.sessions = db.sessions.filter(function (s) { return s.expiresAt > Date.now(); });
}

// Write to a temp file then rename, so a crash mid-write cannot corrupt the database.
function saveDb() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

/* ---------- Passwords and sessions ---------- */

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  return salt.toString('hex') + ':' + crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password, stored) {
  const parts = stored.split(':');
  const expected = Buffer.from(parts[1], 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(parts[0], 'hex'), 64);
  return crypto.timingSafeEqual(actual, expected);
}

const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function ensureAdmin() {
  if (db.users.length) return;
  const fromEnv = process.env.ADMIN_PASSWORD;
  const password = fromEnv || crypto.randomBytes(9).toString('base64url');
  db.users.push({
    id: crypto.randomUUID(),
    username: 'admin',
    name: 'Administrator',
    role: 'admin',
    passwordHash: hashPassword(password),
    mustChangePassword: !fromEnv,
    createdAt: new Date().toISOString()
  });
  saveDb();
  if (!fromEnv) {
    fs.writeFileSync(FIRST_LOGIN_FILE,
      'Viewpoint Inn staff dashboard: first login\r\n\r\n' +
      'Username: admin\r\nPassword: ' + password + '\r\n\r\n' +
      'Change this password after signing in. This file is deleted when you do.\r\n');
    console.log('\nFirst run: created the staff admin account.');
    console.log('  Username: admin');
    console.log('  Password: ' + password);
    console.log('  (also saved in data/first-login.txt until you change it)\n');
  }
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(function (pair) {
    const i = pair.indexOf('=');
    if (i > 0) out[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  });
  return out;
}

function getSession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = sha256(token);
  const session = db.sessions.find(function (s) { return s.tokenHash === tokenHash && s.expiresAt > Date.now(); });
  if (!session) return null;
  const user = db.users.find(function (u) { return u.id === session.userId; });
  return user ? { session: session, user: user } : null;
}

function isHttps(req) {
  return Boolean(req.socket.encrypted) || (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https');
}

function sessionCookie(req, token, maxAgeSeconds) {
  return SESSION_COOKIE + '=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAgeSeconds +
    (isHttps(req) ? '; Secure' : '');
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    mustChangePassword: Boolean(user.mustChangePassword),
    createdAt: user.createdAt
  };
}

/* ---------- Rate limiting ---------- */

const buckets = new Map();

function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count <= max;
}

setInterval(function () {
  const now = Date.now();
  buckets.forEach(function (bucket, key) {
    if (bucket.resetAt <= now) buckets.delete(key);
  });
  db.sessions = db.sessions.filter(function (s) { return s.expiresAt > now; });
}, 10 * 60 * 1000).unref();

function clientIp(req) {
  if (TRUST_PROXY && req.headers['x-forwarded-for']) {
    return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

/* ---------- Validation ---------- */

function str(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
}

function int(value, min, max) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function isDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === value;
}

// The inn's local date, so "today" is right regardless of where the server runs.
function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date());
}

function addDays(date, days) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function checkDate(errors, field, value, label) {
  const now = today();
  if (!isDate(value)) errors[field] = 'Please choose ' + label + '.';
  else if (value < now) errors[field] = 'This date is in the past. Please choose a later one.';
  else if (value > addDays(now, 730)) errors[field] = 'Please choose a date within the next two years.';
}

function validateBooking(type, body) {
  const errors = {};
  const value = {
    name: str(body.name, 80),
    phone: str(body.phone, 20),
    email: str(body.email, 120).toLowerCase(),
    notes: str(body.notes, 600),
    details: {}
  };
  const d = value.details;

  if (value.name.length < 2) errors.name = 'Please enter your name.';
  if (!PHONE_RE.test(value.phone)) errors.phone = 'Please enter a valid phone number.';
  if (value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.email)) errors.email = 'Please enter a valid email address.';

  if (type === 'room') {
    d.checkIn = str(body.checkIn, 10);
    d.checkOut = str(body.checkOut, 10);
    d.roomType = str(body.roomType, 40);
    d.rooms = int(body.rooms, 1, 10);
    d.guests = int(body.guests, 1, 20);
    checkDate(errors, 'checkIn', d.checkIn, 'a check-in date');
    if (!isDate(d.checkOut)) errors.checkOut = 'Please choose a check-out date.';
    else if (!errors.checkIn && d.checkOut <= d.checkIn) errors.checkOut = 'Check-out must be after check-in.';
    else if (!errors.checkIn && d.checkOut > addDays(d.checkIn, 60)) errors.checkOut = 'For stays longer than 60 nights, please call us.';
    if (!ROOM_TYPES.includes(d.roomType)) errors.roomType = 'Please choose a room type.';
    if (d.rooms === null) errors.rooms = 'Enter between 1 and 10 rooms.';
    if (d.guests === null) errors.guests = 'Enter between 1 and 20 guests.';
  } else if (type === 'table') {
    d.date = str(body.date, 10);
    d.time = str(body.time, 5);
    d.guests = int(body.guests, 1, 30);
    d.area = str(body.area, 40);
    checkDate(errors, 'date', d.date, 'a date');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(d.time)) errors.time = 'Please choose a time.';
    if (d.guests === null) errors.guests = 'Enter between 1 and 30 guests. For larger groups, book an event.';
    if (!TABLE_AREAS.includes(d.area)) errors.area = 'Please choose where you would like to sit.';
  } else {
    d.eventType = str(body.eventType, 40);
    d.date = str(body.date, 10);
    d.startTime = str(body.startTime, 5);
    d.guests = int(body.guests, 1, 200);
    d.services = Array.isArray(body.services)
      ? EVENT_SERVICES.filter(function (s) { return body.services.includes(s); })
      : [];
    if (!EVENT_TYPES.includes(d.eventType)) errors.eventType = 'Please choose the type of event.';
    checkDate(errors, 'date', d.date, 'an event date');
    if (d.startTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(d.startTime)) errors.startTime = 'Please enter a valid start time.';
    if (d.guests === null) errors.guests = 'Enter between 1 and 200 guests.';
  }

  return { errors: errors, value: value };
}

function newRef(type) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let ref;
  do {
    ref = 'VP' + type.charAt(0).toUpperCase() + '-';
    for (const byte of crypto.randomBytes(5)) ref += alphabet[byte % alphabet.length];
  } while (db.bookings.concat(db.orders).some(function (b) { return b.ref === ref; }));
  return ref;
}

/* ---------- Templates ---------- */

function esc(value) {
  return String(value).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function srcset(name) {
  return IMAGES[name].widths.map(function (w) { return '/img/' + name + '-' + w + '.webp ' + w + 'w'; }).join(', ');
}

// {{img:name|alt text|sizes|class|eager}} expands to a responsive, lazy-loaded image tag.
function imgTag(arg) {
  const parts = arg.split('|').map(function (s) { return s.trim(); });
  const name = parts[0];
  const meta = IMAGES[name];
  if (!meta) return '';
  const fallback = meta.widths[Math.min(1, meta.widths.length - 1)];
  return '<img src="/img/' + name + '-' + fallback + '.webp" srcset="' + srcset(name) + '"' +
    ' sizes="' + esc(parts[2] || '100vw') + '" width="' + meta.w + '" height="' + meta.h + '"' +
    ' alt="' + esc(parts[1] || '') + '"' + (parts[3] ? ' class="' + esc(parts[3]) + '"' : '') +
    (parts[4] === 'eager' ? ' fetchpriority="high"' : ' loading="lazy"') + ' decoding="async">';
}

const SITE_VARS = {};
Object.keys(SITE).forEach(function (key) { SITE_VARS[key] = esc(SITE[key]); });

const pageCache = new Map();

function renderPage(name) {
  const file = path.join(VIEWS_DIR, name + '.html');
  const layoutFile = path.join(VIEWS_DIR, 'layout.html');
  const stamp = fs.statSync(file).mtimeMs + ':' + fs.statSync(layoutFile).mtimeMs;
  const hit = pageCache.get(name);
  if (hit && hit.stamp === stamp) return hit.entry;

  let body = fs.readFileSync(file, 'utf8');
  let meta = {};
  const match = body.match(/^<!--meta\s+([\s\S]*?)-->\s*/);
  if (match) {
    meta = JSON.parse(match[1]);
    body = body.slice(match[0].length);
  }

  let html = meta.layout === 'none'
    ? body
    : fs.readFileSync(layoutFile, 'utf8').replace('{{content}}', function () { return body; });

  const vars = Object.assign({}, SITE_VARS, {
    v: VERSION,
    year: String(new Date().getFullYear()),
    title: esc(meta.title || SITE.name),
    description: esc(meta.description || ''),
    preload: meta.hero && IMAGES[meta.hero]
      ? '<link rel="preload" as="image" type="image/webp" imagesrcset="' + srcset(meta.hero) + '" imagesizes="100vw" fetchpriority="high">'
      : '',
    scripts: (meta.scripts || []).map(function (s) {
      return '<script src="/js/' + esc(s) + '.js?v=' + VERSION + '" defer></script>';
    }).join('\n  ')
  });

  html = html
    .replace(/\{\{img:([^}]+)\}\}/g, function (m, arg) { return imgTag(arg); })
    .replace(/\{\{(\w+)\}\}/g, function (m, key) { return key in vars ? vars[key] : m; });

  const entry = makeEntry(Buffer.from(html), '.html');
  pageCache.set(name, { stamp: stamp, entry: entry });
  return entry;
}

/* ---------- Responses ---------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.svg', '.txt']);
const LONG_LIVED = new Set(['.webp', '.jpg', '.png', '.ico', '.woff2', '.svg']);

// Text assets are compressed once and kept in memory, so repeat requests cost nothing.
function makeEntry(buf, ext) {
  const entry = {
    buf: buf,
    type: MIME[ext] || 'application/octet-stream',
    etag: '"' + crypto.createHash('sha1').update(buf).digest('hex').slice(0, 20) + '"'
  };
  if (COMPRESSIBLE.has(ext) && buf.length > 512) {
    const params = {};
    params[zlib.constants.BROTLI_PARAM_QUALITY] = 9;
    entry.br = zlib.brotliCompressSync(buf, { params: params });
    entry.gz = zlib.gzipSync(buf, { level: 9 });
  }
  return entry;
}

function sendEntry(req, res, entry, cacheControl, status) {
  const headers = { 'Content-Type': entry.type, 'ETag': entry.etag, 'Cache-Control': cacheControl };
  if (entry.br) headers.Vary = 'Accept-Encoding';
  if ((status || 200) === 200 && req.headers['if-none-match'] === entry.etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  const accepts = String(req.headers['accept-encoding'] || '');
  let body = entry.buf;
  if (entry.br && /\bbr\b/.test(accepts)) {
    body = entry.br;
    headers['Content-Encoding'] = 'br';
  } else if (entry.gz && /\bgzip\b/.test(accepts)) {
    body = entry.gz;
    headers['Content-Encoding'] = 'gzip';
  }
  headers['Content-Length'] = body.length;
  res.writeHead(status || 200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

function sendPage(req, res, name, options) {
  const opts = options || {};
  if (opts.private) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  sendEntry(req, res, renderPage(name), opts.private ? 'no-store' : 'no-cache', opts.status);
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function redirect(res, location) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

const assetCache = new Map();

function serveStatic(req, res, pathname, versioned) {
  let relative;
  try {
    relative = decodeURIComponent(pathname);
  } catch (err) {
    return false;
  }
  if (relative.includes('\0')) return false;
  const file = path.normalize(path.join(PUBLIC_DIR, relative));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return false;

  let stat;
  try {
    stat = fs.statSync(file);
  } catch (err) {
    return false;
  }
  if (!stat.isFile()) return false;

  const ext = path.extname(file).toLowerCase();
  let entry = assetCache.get(file);
  if (!entry || entry.mtimeMs !== stat.mtimeMs) {
    entry = makeEntry(fs.readFileSync(file), ext);
    entry.mtimeMs = stat.mtimeMs;
    assetCache.set(file, entry);
  }

  let cacheControl = 'public, max-age=3600';
  if (versioned) cacheControl = 'public, max-age=31536000, immutable';
  else if (LONG_LIVED.has(ext)) cacheControl = 'public, max-age=2592000';
  sendEntry(req, res, entry, cacheControl);
  return true;
}

function readJson(req) {
  return new Promise(function (resolve, reject) {
    if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
      return reject(new HttpError(415, 'Unsupported request.'));
    }
    const chunks = [];
    let size = 0;
    req.on('data', function (chunk) {
      size += chunk.length;
      if (size > 20000) {
        reject(new HttpError(413, 'Request is too large.'));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', function () {
      try {
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not an object');
        resolve(data);
      } catch (err) {
        reject(new HttpError(400, 'Invalid request.'));
      }
    });
    req.on('error', reject);
  });
}

/* ---------- API ---------- */

async function createBooking(req, res, type) {
  const body = await readJson(req);
  // Hidden field that real visitors never fill in; bots do. Pretend it worked.
  if (str(body.website, 50)) return json(res, 201, { ref: 'VP-00000' });
  if (!rateLimit('book:' + clientIp(req), 10, 60 * 60 * 1000)) {
    return json(res, 429, { error: 'Too many requests from this device. Please call us to book.' });
  }

  const result = validateBooking(type, body);
  if (Object.keys(result.errors).length) {
    return json(res, 422, { error: 'Please check the highlighted fields.', errors: result.errors });
  }

  const now = new Date().toISOString();
  const booking = Object.assign({
    id: crypto.randomUUID(),
    ref: newRef(type),
    type: type,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    updatedBy: null,
    staffNote: ''
  }, result.value);
  db.bookings.push(booking);
  saveDb();
  json(res, 201, { ref: booking.ref });
}

async function createOrder(req, res) {
  const body = await readJson(req);
  if (str(body.website, 50)) return json(res, 201, { ref: 'VP-00000' });
  if (!rateLimit('order:' + clientIp(req), 10, 60 * 60 * 1000)) {
    return json(res, 429, { error: 'Too many requests from this device. Please call us to order.' });
  }

  const errors = {};
  const order = {
    name: str(body.name, 80),
    phone: str(body.phone, 20),
    notes: str(body.notes, 300),
    mode: str(body.mode, 20),
    location: str(body.location, 30),
    items: [],
    total: 0
  };
  if (order.name.length < 2) errors.name = 'Please enter your name.';
  if (!PHONE_RE.test(order.phone)) errors.phone = 'Please enter a valid phone number.';
  if (!ORDER_MODES.includes(order.mode)) errors.mode = 'Please choose how you would like your order.';
  if (order.mode === 'Room delivery' && !order.location) errors.location = 'Please enter your room number.';

  // Prices and names always come from the stored menu, never from the browser.
  (Array.isArray(body.items) ? body.items.slice(0, 40) : []).forEach(function (line) {
    const item = line && db.menu.find(function (m) { return m.id === line.id && m.available; });
    const qty = line ? int(line.qty, 1, 50) : null;
    if (!item || !qty) return;
    order.items.push({ id: item.id, name: item.name, price: item.price, qty: qty });
    order.total += item.price * qty;
  });
  if (!order.items.length) {
    return json(res, 422, { error: 'Your order is empty, or those items are no longer available. Please refresh the menu.' });
  }
  if (Object.keys(errors).length) {
    return json(res, 422, { error: 'Please check the highlighted fields.', errors: errors });
  }

  const now = new Date().toISOString();
  const record = Object.assign({
    id: crypto.randomUUID(),
    ref: newRef('order'),
    type: 'order',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    updatedBy: null,
    staffNote: ''
  }, order);
  db.orders.push(record);
  saveDb();
  json(res, 201, { ref: record.ref, total: record.total });
}

async function createReview(req, res) {
  const body = await readJson(req);
  if (str(body.website, 50)) return json(res, 201, { ok: true });
  if (!rateLimit('review:' + clientIp(req), 3, 60 * 60 * 1000)) {
    return json(res, 429, { error: 'You have sent several reviews already. Please try again later.' });
  }
  const errors = {};
  const review = { name: str(body.name, 60), rating: int(body.rating, 1, 5), text: str(body.text, 500) };
  if (review.name.length < 2) errors.name = 'Please enter your name.';
  if (review.rating === null) errors.rating = 'Please choose a rating.';
  if (review.text.length < 10) errors.text = 'Please write at least a sentence.';
  if (Object.keys(errors).length) {
    return json(res, 422, { error: 'Please check the highlighted fields.', errors: errors });
  }
  db.reviews.push(Object.assign({ id: crypto.randomUUID(), status: 'pending', createdAt: new Date().toISOString() }, review));
  saveDb();
  json(res, 201, { ok: true });
}

// Guests prove a booking is theirs with its reference plus the phone number they gave.
function phoneKey(phone) {
  return String(phone).replace(/\D/g, '').slice(-9);
}

function canGuestCancel(record) {
  return record.type === 'order' ? record.status === 'pending' : record.status === 'pending' || record.status === 'confirmed';
}

async function guestLookup(req, res, cancel) {
  const body = await readJson(req);
  if (!rateLimit('lookup:' + clientIp(req), 15, 15 * 60 * 1000)) {
    return json(res, 429, { error: 'Too many attempts. Please wait 15 minutes or call us.' });
  }
  const ref = str(body.ref, 12).toUpperCase();
  const key = phoneKey(str(body.phone, 20));
  const record = key.length === 9 && db.bookings.concat(db.orders).find(function (r) {
    return r.ref === ref && phoneKey(r.phone) === key;
  });
  if (!record) return json(res, 404, { error: 'We could not find a booking with that reference and phone number.' });

  if (cancel) {
    if (!canGuestCancel(record)) return json(res, 422, { error: 'This can no longer be cancelled online. Please call us.' });
    record.status = 'cancelled';
    record.updatedAt = new Date().toISOString();
    record.updatedBy = 'Guest (online)';
    saveDb();
  }
  json(res, 200, {
    record: {
      ref: record.ref,
      type: record.type,
      status: record.status,
      name: record.name,
      createdAt: record.createdAt,
      details: record.details,
      items: record.items,
      total: record.total,
      mode: record.mode,
      location: record.location,
      canCancel: canGuestCancel(record)
    }
  });
}

async function login(req, res) {
  const body = await readJson(req);
  const username = str(body.username, 30).toLowerCase();
  const password = typeof body.password === 'string' ? body.password.slice(0, 128) : '';
  const ip = clientIp(req);
  if (!rateLimit('login:' + ip, 10, 15 * 60 * 1000) || !rateLimit('login-user:' + username, 10, 15 * 60 * 1000)) {
    return json(res, 429, { error: 'Too many sign-in attempts. Please wait 15 minutes and try again.' });
  }

  const user = db.users.find(function (u) { return u.username === username; });
  // Always run a hash check so response time does not reveal whether the username exists.
  const ok = verifyPassword(password, user ? user.passwordHash : DUMMY_HASH) && Boolean(user);
  if (!ok) return json(res, 401, { error: 'Incorrect username or password.' });

  const token = crypto.randomBytes(32).toString('base64url');
  db.sessions.push({ tokenHash: sha256(token), userId: user.id, expiresAt: Date.now() + SESSION_HOURS * 3600 * 1000 });
  saveDb();
  res.setHeader('Set-Cookie', sessionCookie(req, token, SESSION_HOURS * 3600));
  json(res, 200, { user: publicUser(user) });
}

async function changePassword(req, res, auth) {
  const body = await readJson(req);
  const current = typeof body.current === 'string' ? body.current.slice(0, 128) : '';
  const next = typeof body.next === 'string' ? body.next : '';
  if (!rateLimit('pw:' + auth.user.id, 10, 15 * 60 * 1000)) {
    return json(res, 429, { error: 'Too many attempts. Please wait 15 minutes.' });
  }
  if (!verifyPassword(current, auth.user.passwordHash)) return json(res, 422, { error: 'Your current password is incorrect.' });
  if (next.length < 8 || next.length > 128) return json(res, 422, { error: 'The new password must be at least 8 characters.' });
  if (next === current) return json(res, 422, { error: 'Choose a password different from the current one.' });

  auth.user.passwordHash = hashPassword(next);
  auth.user.mustChangePassword = false;
  // Sign out every other device using this account.
  db.sessions = db.sessions.filter(function (s) { return s.userId !== auth.user.id || s === auth.session; });
  saveDb();
  if (auth.user.username === 'admin') fs.rmSync(FIRST_LOGIN_FILE, { force: true });
  json(res, 200, { user: publicUser(auth.user) });
}

async function updateRecord(req, res, auth, list, statuses, id) {
  const booking = list.find(function (b) { return b.id === id; });
  if (!booking) return json(res, 404, { error: 'Not found.' });
  const body = await readJson(req);
  if (body.status !== undefined) {
    if (!statuses.includes(body.status)) return json(res, 422, { error: 'Unknown status.' });
    booking.status = body.status;
  }
  if (body.staffNote !== undefined) booking.staffNote = str(body.staffNote, 600);
  booking.updatedAt = new Date().toISOString();
  booking.updatedBy = auth.user.name;
  saveDb();
  json(res, 200, { booking: booking });
}

// Creates a menu item, or updates one when `existing` is given (only the fields sent are changed).
async function saveMenuItem(req, res, existing) {
  const body = await readJson(req);
  const item = Object.assign({ name: '', description: '', category: '', price: null, available: true }, existing);
  if (body.name !== undefined) item.name = str(body.name, 60);
  if (body.description !== undefined) item.description = str(body.description, 160);
  if (body.category !== undefined) item.category = str(body.category, 40);
  if (body.price !== undefined) item.price = int(body.price, 0, 1000000);
  if (body.available !== undefined) item.available = Boolean(body.available);

  if (item.name.length < 2) return json(res, 422, { error: 'Please enter the name of the dish or drink.' });
  if (!MENU_CATEGORIES.includes(item.category)) return json(res, 422, { error: 'Please choose a category.' });
  if (item.price === null) return json(res, 422, { error: 'Please enter the price in shillings as a whole number.' });

  if (existing) {
    Object.assign(existing, item);
  } else {
    item.id = crypto.randomUUID();
    item.createdAt = new Date().toISOString();
    db.menu.push(item);
  }
  saveDb();
  json(res, existing ? 200 : 201, { item: existing || item });
}

async function updateReview(req, res, id) {
  const review = db.reviews.find(function (r) { return r.id === id; });
  if (!review) return json(res, 404, { error: 'Review not found.' });
  const body = await readJson(req);
  if (body.status !== 'pending' && body.status !== 'approved') return json(res, 422, { error: 'Unknown status.' });
  review.status = body.status;
  saveDb();
  json(res, 200, { review: review });
}

function publicMenu() {
  return db.menu.filter(function (m) { return m.available; }).map(function (m) {
    return { id: m.id, name: m.name, description: m.description, category: m.category, price: m.price };
  });
}

async function createUser(req, res) {
  const body = await readJson(req);
  const username = str(body.username, 30).toLowerCase();
  const name = str(body.name, 80);
  const password = typeof body.password === 'string' ? body.password : '';
  const role = body.role === 'admin' ? 'admin' : 'staff';
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
    return json(res, 422, { error: 'Username must be 3 to 30 characters: letters, numbers, dot, dash or underscore.' });
  }
  if (name.length < 2) return json(res, 422, { error: 'Please enter the staff member\'s name.' });
  if (password.length < 8 || password.length > 128) return json(res, 422, { error: 'The password must be at least 8 characters.' });
  if (db.users.some(function (u) { return u.username === username; })) return json(res, 422, { error: 'That username is already taken.' });

  const user = {
    id: crypto.randomUUID(),
    username: username,
    name: name,
    role: role,
    passwordHash: hashPassword(password),
    mustChangePassword: true,
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  saveDb();
  json(res, 201, { user: publicUser(user) });
}

function deleteUser(res, auth, id) {
  const user = db.users.find(function (u) { return u.id === id; });
  if (!user) return json(res, 404, { error: 'Staff account not found.' });
  if (user.id === auth.user.id) return json(res, 422, { error: 'You cannot remove your own account.' });
  db.users = db.users.filter(function (u) { return u.id !== id; });
  db.sessions = db.sessions.filter(function (s) { return s.userId !== id; });
  saveDb();
  json(res, 200, { ok: true });
}

async function api(req, res, pathname) {
  const method = req.method;

  // Browsers send Origin on cross-site writes; reject any that are not from this site.
  if (method !== 'GET' && req.headers.origin) {
    let originHost = '';
    try {
      originHost = new URL(req.headers.origin).host;
    } catch (err) { /* malformed Origin is treated as a mismatch */ }
    if (originHost !== req.headers.host) throw new HttpError(403, 'Forbidden.');
  }

  let match = pathname.match(/^\/api\/bookings\/(room|table|event)$/);
  if (match && method === 'POST') return createBooking(req, res, match[1]);
  if (pathname === '/api/auth/login' && method === 'POST') return login(req, res);
  if (pathname === '/api/menu' && method === 'GET') return json(res, 200, { categories: MENU_CATEGORIES, items: publicMenu() });
  if (pathname === '/api/orders' && method === 'POST') return createOrder(req, res);
  if (pathname === '/api/reviews' && method === 'POST') return createReview(req, res);
  if (pathname === '/api/reviews' && method === 'GET') {
    const approved = db.reviews.filter(function (r) { return r.status === 'approved'; }).map(function (r) {
      return { name: r.name, rating: r.rating, text: r.text, createdAt: r.createdAt };
    });
    return json(res, 200, { reviews: approved.reverse() });
  }
  if (pathname === '/api/my-booking' && method === 'POST') return guestLookup(req, res, false);
  if (pathname === '/api/my-booking/cancel' && method === 'POST') return guestLookup(req, res, true);

  const auth = getSession(req);
  if (!auth) return json(res, 401, { error: 'Please sign in.' });

  if (pathname === '/api/auth/me' && method === 'GET') return json(res, 200, { user: publicUser(auth.user) });
  if (pathname === '/api/auth/logout' && method === 'POST') {
    db.sessions = db.sessions.filter(function (s) { return s !== auth.session; });
    saveDb();
    res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
    return json(res, 200, { ok: true });
  }
  if (pathname === '/api/auth/password' && method === 'POST') return changePassword(req, res, auth);

  const isAdmin = auth.user.role === 'admin';
  const newestFirst = function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; };

  if (pathname === '/api/admin/bookings' && method === 'GET') {
    return json(res, 200, {
      bookings: db.bookings.slice().sort(newestFirst),
      orders: db.orders.slice().sort(newestFirst),
      reviews: db.reviews.slice().sort(newestFirst),
      menu: db.menu,
      menuCategories: MENU_CATEGORIES,
      today: today()
    });
  }
  if (pathname === '/api/admin/menu' && method === 'POST') return saveMenuItem(req, res, null);

  match = pathname.match(/^\/api\/admin\/(bookings|orders|menu|reviews)\/([0-9a-f-]{36})$/);
  if (match && method === 'PATCH') {
    const id = match[2];
    if (match[1] === 'bookings') return updateRecord(req, res, auth, db.bookings, STATUSES, id);
    if (match[1] === 'orders') return updateRecord(req, res, auth, db.orders, ORDER_STATUSES, id);
    if (match[1] === 'reviews') return updateReview(req, res, id);
    const item = db.menu.find(function (m) { return m.id === id; });
    if (!item) return json(res, 404, { error: 'Menu item not found.' });
    return saveMenuItem(req, res, item);
  }
  if (match && method === 'DELETE') {
    const kind = match[1];
    // Bookings and orders are records of what guests asked for; only administrators may erase them.
    if ((kind === 'bookings' || kind === 'orders') && !isAdmin) {
      return json(res, 403, { error: 'Only an administrator can delete bookings and orders.' });
    }
    const before = db[kind].length;
    db[kind] = db[kind].filter(function (r) { return r.id !== match[2]; });
    if (db[kind].length === before) return json(res, 404, { error: 'Not found.' });
    saveDb();
    return json(res, 200, { ok: true });
  }

  if (pathname === '/api/admin/users') {
    if (!isAdmin) return json(res, 403, { error: 'Only an administrator can manage staff accounts.' });
    if (method === 'GET') return json(res, 200, { users: db.users.map(publicUser) });
    if (method === 'POST') return createUser(req, res);
  }
  match = pathname.match(/^\/api\/admin\/users\/([0-9a-f-]{36})$/);
  if (match && method === 'DELETE') {
    if (!isAdmin) return json(res, 403, { error: 'Only an administrator can manage staff accounts.' });
    return deleteUser(res, auth, match[1]);
  }

  json(res, 404, { error: 'Not found.' });
}

/* ---------- Router ---------- */

async function handle(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; " +
    "frame-src https://www.google.com; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");

  const url = new URL(req.url, 'http://localhost');
  let pathname = url.pathname;
  if (pathname.length > 1 && pathname.endsWith('/')) return redirect(res, pathname.replace(/\/+$/, '') || '/');

  if (pathname.startsWith('/api/')) return api(req, res, pathname);

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }

  if (PAGES[pathname]) return sendPage(req, res, PAGES[pathname]);
  if (pathname === '/index.html') return redirect(res, '/');
  if (pathname === '/staff') {
    if (getSession(req)) return redirect(res, '/staff/dashboard');
    return sendPage(req, res, 'staff/login', { private: true });
  }
  if (pathname === '/staff/dashboard') {
    if (!getSession(req)) return redirect(res, '/staff');
    return sendPage(req, res, 'staff/dashboard', { private: true });
  }

  if (serveStatic(req, res, pathname, url.searchParams.has('v'))) return;
  sendPage(req, res, 'pages/404', { status: 404 });
}

loadDb();
ensureAdmin();

http.createServer(function (req, res) {
  handle(req, res).catch(function (err) {
    if (res.headersSent) return res.end();
    if (err instanceof HttpError) return json(res, err.status, { error: err.message });
    console.error(err);
    json(res, 500, { error: 'Something went wrong on our side. Please try again.' });
  });
}).listen(PORT, function () {
  console.log('Viewpoint Inn website running at http://localhost:' + PORT);
  console.log('Staff dashboard at http://localhost:' + PORT + '/staff');
});
