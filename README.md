# Event Inventory Tracker

Real-time inventory tracker for SQUATWOLF events. Mobile-friendly, no external services required.

## Stack

- **Backend:** Node.js + Express + Socket.IO
- **Frontend:** React 18 via CDN + Babel standalone (no build step)
- **Persistence:** JSON file at `./inventory.json` with atomic writes — survives restarts, no native deps required
- **Real-time:** Socket.IO (one room per event)

For a production deployment swap the JSON store for Postgres/SQLite — the store is isolated at the top of `server.js`.

## Run it

```bash
cd event-inventory-tracker
npm install
npm start
```

Open `http://localhost:3000`.

First run seeds a demo event ("SQUATWOLF Demo Event", code `DEMO`) with 5 items so the UI is usable right away.

## How the auth / permissions work

There is intentionally no real auth — this is an MVP for on-site use.

- On entry, pick/create an event, enter your name, pick a role (**Editor** or **Viewer**).
- The name + role is stored in `localStorage` and sent in `x-user` / `x-role` headers.
- The server rejects mutating requests (POST/PATCH/DELETE) if `x-role !== 'editor'`.
- Viewers can see everything including history but can't change anything.
- Every change is logged in the `history` table with the editor's name.

This keeps the MVP simple. A real deployment should layer proper auth on top (invite links, SSO, etc.).

## Features covered

- Multi-event support (create / switch / join by list)
- Item CRUD (add / update / delete with confirmation)
- Real-time dashboard — updates from any user show instantly on every connected client
- Full audit trail per item — who moved it, when, from/to values
- Permission levels — Editor vs Viewer, enforced server-side
- Mobile-first layout — sticky top bar, large touch targets, 1-column grid on phones
- Search (name / location / requestor / notes) + condition filter
- SQLite persistence — data survives restarts
- SQUATWOLF brand hint (black + yellow accent, uppercase wordmark)

## API cheatsheet

```
GET    /api/events
POST   /api/events                         { name, code? }
GET    /api/events/:id/items
POST   /api/events/:id/items               (editor) { name, location, condition, requestor, notes }
PATCH  /api/items/:id                      (editor) { ...partial }
DELETE /api/items/:id                      (editor)
GET    /api/items/:id/history
GET    /api/events/:id/history
```

Editor endpoints require `x-role: editor` and `x-user: <name>` headers.

## Socket events

Client emits `join` / `leave` with `eventId`. Server broadcasts to the event's room:

- `item:created`
- `item:updated`
- `item:deleted`
- `event:created` (global)

## Intentional scope cuts (add later)

- Real auth (SSO, invite links with signed tokens)
- Photos / attachments per item
- CSV export of history
- Email / Slack notifications on damage or missing items
- Push-notifications for mobile
- Bulk import of items at event setup
