# Viewpoint Inn Mbuinzau website

Public website, online booking (rooms, tables, events) and a staff dashboard.
It needs Node.js 18 or newer and nothing else: there is no `npm install` step.

## Run it

Double-click `start.bat`, or run:

```
node server.js
```

Then open:

- Website: http://localhost:4000
- Staff dashboard: http://localhost:4000/staff

## First staff login

The first time the server starts it creates an `admin` account with a random
password. The password is shown in the server window and saved in
`data/first-login.txt`. Sign in, open **My account** and change it; the file is
then deleted. Add other staff under the **Staff** tab.

## Changing details

- **Phone, WhatsApp, address, social and listing links:** `site.config.json`.
  Restart the server afterwards.
- **Page text:** the files in `views/pages/`.
- **Room types, seating areas, event types:** the lists at the top of
  `server.js`, and the matching `<option>` lists in `views/pages/book.html`.

## Photos

Photos live in `public/img/` as WebP files in several widths
(`name-480.webp`, `name-800.webp`, `name-1000.webp`) and are listed in
`public/img/manifest.json`. Pages reference them as
`{{img:name|description|sizes}}` and the server writes the full image tag.
To add a photo, export it at those widths, add an entry to the manifest and
use its name in a page.

## Bookings and data

Everything is stored in `data/db.json`. Back this file up regularly. Passwords
are stored hashed, never in plain text. The `data/` folder must not be shared
or published.

## Putting it online

Host it anywhere that runs Node.js and keeps the `data/` folder between
restarts. Settings are environment variables:

| Variable | Purpose |
| --- | --- |
| `PORT` | Port to listen on (default 4000) |
| `DATA_DIR` | Where to keep `db.json` (default `./data`) |
| `ADMIN_PASSWORD` | Sets the first admin password instead of generating one |
| `TRUST_PROXY` | Set to `1` behind a reverse proxy or host that terminates HTTPS |

Serve it over HTTPS in production so staff sign-in is encrypted.
