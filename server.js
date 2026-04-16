require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');

const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('\n  ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env\n');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// multer: memory storage — files go to Supabase Storage, not disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\//i.test(file.mimetype) ||
      ['video/mp4', 'video/quicktime'].includes(file.mimetype);
    ok ? cb(null, true) : cb(new Error('Only images and short videos are allowed'));
  },
});

// ---------- auth middleware ----------
// Reads Authorization: Bearer <jwt> and verifies it with Supabase.
// Sets req.userName from the user's display name / email.
async function requireAdmin(req, res, next) {
  const token = (req.header('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return res.status(401).json({ error: 'Admin login required' });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid or expired session — please log in again' });
  req.userName = user.user_metadata?.name || user.email;
  req.user = user;
  next();
}

// ---------- helpers ----------
const nowISO = () => new Date().toISOString();
const VALID_CONDITIONS = ['good', 'damaged', 'needs_repair', 'needs_cleaning'];

function diff(before, after) {
  const fields = ['name', 'location', 'condition', 'requestor', 'notes'];
  const d = {};
  for (const f of fields) {
    if (before[f] !== after[f]) d[f] = { from: before[f], to: after[f] };
  }
  return d;
}

async function logHistory(itemId, eventId, action, changes, who) {
  await supabase.from('history').insert({
    item_id: itemId, event_id: eventId, action,
    changes, changed_by: who, changed_at: nowISO(),
  });
}

function dbErr(res, error) {
  console.error('[db]', error?.message || error);
  return res.status(500).json({ error: error?.message || 'database error' });
}

// ---------- storage bucket ----------
async function ensureBucket() {
  const { error } = await supabase.storage.createBucket('attachments', {
    public: true,
    fileSizeLimit: 25 * 1024 * 1024,
    allowedMimeTypes: ['image/*', 'video/mp4', 'video/quicktime'],
  });
  if (error && !error.message.includes('already exists')) {
    console.warn('[storage] bucket warning:', error.message);
  }
}

// ---------- auth routes ----------
// Usernames are stored internally as username@squatwolf.admin — never shown to users
const toEmail = (username) => `${username.toLowerCase().trim()}@squatwolf.admin`;

// Login with username + password
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const { data, error } = await supabase.auth.signInWithPassword({
    email: toEmail(username), password,
  });
  if (error) return res.status(401).json({ error: 'Invalid username or password' });
  res.json({
    token: data.session.access_token,
    user: {
      id: data.user.id,
      name: data.user.user_metadata?.name || username,
    },
  });
});

// Create admin account
app.post('/api/auth/signup', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (username.length < 2) return res.status(400).json({ error: 'Username must be at least 2 characters' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email: toEmail(username), password,
    user_metadata: { name: username.trim() },
    email_confirm: true,
  });
  if (createErr) {
    const msg = createErr.message.includes('already registered')
      ? 'Username already taken'
      : createErr.message;
    return res.status(400).json({ error: msg });
  }

  const { data: session, error: signInErr } = await supabase.auth.signInWithPassword({
    email: toEmail(username), password,
  });
  if (signInErr) return res.status(500).json({ error: signInErr.message });

  res.json({
    token: session.session.access_token,
    user: { id: created.user.id, name: username.trim() },
  });
});

// List admins (admin-only)
app.get('/api/auth/admins', requireAdmin, async (req, res) => {
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) return dbErr(res, error);
  res.json(data.users.map(u => ({
    id: u.id,
    name: u.user_metadata?.name || u.email.replace('@squatwolf.admin', ''),
    created_at: u.created_at,
  })));
});

// Delete admin account
app.delete('/api/auth/admins/:id', requireAdmin, async (req, res) => {
  if (req.user.id === req.params.id) {
    return res.status(400).json({ error: "You can't delete your own account" });
  }
  const { error } = await supabase.auth.admin.deleteUser(req.params.id);
  if (error) return dbErr(res, error);
  res.json({ ok: true });
});

// ---------- events ----------
app.get('/api/events', async (req, res) => {
  const { data, error } = await supabase
    .from('events').select('*').order('created_at', { ascending: false });
  if (error) return dbErr(res, error);
  res.json(data);
});

app.post('/api/events', requireAdmin, async (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const code = (req.body.code || Math.random().toString(36).slice(2, 8)).toUpperCase();
  const { data, error } = await supabase.from('events').insert({ name, code }).select().single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Event code already in use' });
    return dbErr(res, error);
  }
  io.emit('event:created', data);
  res.json(data);
});

// ---------- items ----------
app.get('/api/events/:eventId/items', async (req, res) => {
  const { data, error } = await supabase
    .from('items').select('*')
    .eq('event_id', req.params.eventId)
    .order('updated_at', { ascending: false });
  if (error) return dbErr(res, error);
  res.json(data);
});

app.post('/api/events/:eventId/items', requireAdmin, async (req, res) => {
  const eventId = req.params.eventId;
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const location = (req.body.location || '').trim();
  const condition = req.body.condition || 'good';
  const requestor = (req.body.requestor || '').trim();
  const notes = (req.body.notes || '').trim();
  if (!VALID_CONDITIONS.includes(condition)) return res.status(400).json({ error: 'invalid condition' });

  const now = nowISO();
  const { data: item, error } = await supabase.from('items').insert({
    event_id: eventId, name, location, condition, requestor, notes,
    created_at: now, updated_at: now, updated_by: req.userName,
  }).select().single();
  if (error) return dbErr(res, error);

  await logHistory(item.id, eventId, 'created',
    { name, location, condition, requestor, notes }, req.userName);
  io.to(eventId).emit('item:created', item);
  res.json(item);
});

app.patch('/api/items/:id', requireAdmin, async (req, res) => {
  const { data: existing, error: fetchErr } = await supabase
    .from('items').select('*').eq('id', req.params.id).single();
  if (fetchErr) return res.status(404).json({ error: 'item not found' });

  const next = {
    name: req.body.name !== undefined ? String(req.body.name).trim() : existing.name,
    location: req.body.location !== undefined ? String(req.body.location).trim() : existing.location,
    condition: req.body.condition !== undefined ? req.body.condition : existing.condition,
    requestor: req.body.requestor !== undefined ? String(req.body.requestor).trim() : existing.requestor,
    notes: req.body.notes !== undefined ? String(req.body.notes).trim() : existing.notes,
  };
  if (!next.name) return res.status(400).json({ error: 'name required' });
  if (!VALID_CONDITIONS.includes(next.condition)) return res.status(400).json({ error: 'invalid condition' });

  const changes = diff(existing, next);
  if (Object.keys(changes).length === 0) return res.json(existing);

  let action = 'updated';
  if (changes.location && Object.keys(changes).length === 1) action = 'moved';
  else if (changes.condition && Object.keys(changes).length === 1) action = 'condition_changed';
  else if (changes.notes && Object.keys(changes).length === 1) action = 'notes_updated';

  const { data: updated, error: updateErr } = await supabase
    .from('items').update({ ...next, updated_at: nowISO(), updated_by: req.userName })
    .eq('id', req.params.id).select().single();
  if (updateErr) return dbErr(res, updateErr);

  await logHistory(existing.id, existing.event_id, action, changes, req.userName);
  io.to(existing.event_id).emit('item:updated', updated);
  res.json(updated);
});

app.delete('/api/items/:id', requireAdmin, async (req, res) => {
  const { data: existing, error: fetchErr } = await supabase
    .from('items').select('*').eq('id', req.params.id).single();
  if (fetchErr) return res.status(404).json({ error: 'item not found' });

  await logHistory(req.params.id, existing.event_id, 'deleted',
    { name: existing.name, location: existing.location, condition: existing.condition }, req.userName);
  const { error } = await supabase.from('items').delete().eq('id', req.params.id);
  if (error) return dbErr(res, error);

  io.to(existing.event_id).emit('item:deleted', { id: req.params.id, event_id: existing.event_id });
  res.json({ ok: true });
});

// ---------- attachments ----------
app.get('/api/items/:id/attachments', async (req, res) => {
  const { data, error } = await supabase
    .from('attachments').select('*')
    .eq('item_id', req.params.id)
    .order('uploaded_at', { ascending: true });
  if (error) return dbErr(res, error);
  res.json(data);
});

app.post('/api/items/:id/attachments', requireAdmin, (req, res, next) => {
  upload.array('files', 10)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  const { data: item, error: fetchErr } = await supabase
    .from('items').select('id, event_id').eq('id', req.params.id).single();
  if (fetchErr) return res.status(404).json({ error: 'item not found' });
  if (!req.files?.length) return res.status(400).json({ error: 'no files uploaded' });

  const added = [];
  for (const f of req.files) {
    const ext = path.extname(f.originalname).toLowerCase() || '';
    const storagePath = `${item.event_id}/${item.id}/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    const { error: uploadErr } = await supabase.storage
      .from('attachments').upload(storagePath, f.buffer, { contentType: f.mimetype });
    if (uploadErr) { console.error('[storage]', uploadErr.message); continue; }

    const { data: { publicUrl } } = supabase.storage.from('attachments').getPublicUrl(storagePath);
    const { data: att, error: insertErr } = await supabase.from('attachments').insert({
      item_id: item.id, event_id: item.event_id,
      storage_path: storagePath, original_name: f.originalname,
      mime_type: f.mimetype, size: f.size, url: publicUrl,
      uploaded_by: req.userName, uploaded_at: nowISO(),
    }).select().single();
    if (insertErr) { console.error('[db]', insertErr.message); continue; }

    await logHistory(item.id, item.event_id, 'photo_added', { filename: f.originalname }, req.userName);
    added.push(att);
  }
  if (!added.length) return res.status(500).json({ error: 'all uploads failed' });
  added.forEach(att => io.to(item.event_id).emit('attachment:added', att));
  res.json(added);
});

app.delete('/api/attachments/:id', requireAdmin, async (req, res) => {
  const { data: att, error: fetchErr } = await supabase
    .from('attachments').select('*').eq('id', req.params.id).single();
  if (fetchErr) return res.status(404).json({ error: 'attachment not found' });
  await supabase.storage.from('attachments').remove([att.storage_path]);
  const { error } = await supabase.from('attachments').delete().eq('id', req.params.id);
  if (error) return dbErr(res, error);
  await logHistory(att.item_id, att.event_id, 'photo_removed', { filename: att.original_name }, req.userName);
  io.to(att.event_id).emit('attachment:deleted', { id: att.id, item_id: att.item_id });
  res.json({ ok: true });
});

// ---------- history ----------
app.get('/api/items/:id/history', async (req, res) => {
  const { data, error } = await supabase
    .from('history').select('*').eq('item_id', req.params.id)
    .order('changed_at', { ascending: false });
  if (error) return dbErr(res, error);
  res.json(data);
});

app.get('/api/events/:eventId/history', async (req, res) => {
  const { data, error } = await supabase
    .from('history').select('*').eq('event_id', req.params.eventId)
    .order('changed_at', { ascending: false }).limit(200);
  if (error) return dbErr(res, error);
  res.json(data);
});

// ---------- socket ----------
io.on('connection', (socket) => {
  socket.on('join', (eventId) => {
    if (typeof eventId === 'string' && eventId.length) socket.join(eventId);
  });
  socket.on('leave', (eventId) => {
    if (typeof eventId === 'string' && eventId.length) socket.leave(eventId);
  });
});

// ---------- start ----------
async function start() {
  await ensureBucket();
  const { error } = await supabase.from('events').select('id').limit(1);
  if (error?.code === '42P01') {
    console.error('\n  Tables missing — run setup.sql in your Supabase dashboard first.\n');
    process.exit(1);
  }
  console.log('[db] Supabase connected ✓');
  server.listen(PORT, () => {
    console.log(`\n  Event Inventory Tracker → http://localhost:${PORT}\n`);
  });
}

start();
