/* eslint-disable */
const { useState, useEffect, useMemo, useRef } = React;

// ---------- api ----------
async function api(path, opts = {}, adminToken = null) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (adminToken) headers['Authorization'] = `Bearer ${adminToken}`;
  const res = await fetch(path, { ...opts, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || 'request failed');
  }
  return res.json();
}

// ---------- helpers ----------
const CONDITIONS = [
  { value: 'good', label: 'Good' },
  { value: 'needs_cleaning', label: 'Needs Cleaning' },
  { value: 'needs_repair', label: 'Needs Repair' },
  { value: 'damaged', label: 'Damaged' },
];
const LABEL = { good: 'Good', damaged: 'Damaged', needs_repair: 'Needs Repair', needs_cleaning: 'Needs Cleaning' };

function fmtTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const opts = d.toDateString() === now.toDateString()
    ? { hour: '2-digit', minute: '2-digit' }
    : { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' };
  return d.toLocaleString(undefined, opts);
}
function actionLabel(a) {
  return { created: 'Created', updated: 'Updated', moved: 'Moved', condition_changed: 'Condition changed', notes_updated: 'Notes updated', deleted: 'Deleted', photo_added: 'Photo added', photo_removed: 'Photo removed' }[a] || a;
}
function isVideo(mime) { return (mime || '').startsWith('video/'); }

// ---------- lightbox ----------
function Lightbox({ att, onClose }) {
  useEffect(() => {
    const fn = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);
  return (
    <div className="lightbox" onClick={onClose}>
      <button className="lightbox-close" onClick={onClose}>✕</button>
      <div className="lightbox-inner" onClick={e => e.stopPropagation()}>
        {isVideo(att.mime_type)
          ? <video src={att.url} controls autoPlay style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: 10 }} />
          : <img src={att.url} alt={att.original_name} style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: 10, display: 'block' }} />
        }
        <div className="lightbox-caption">{att.original_name} · {att.uploaded_by} · {fmtTime(att.uploaded_at)}</div>
      </div>
    </div>
  );
}

// ---------- attachment strip ----------
function AttachmentStrip({ itemId, adminToken }) {
  const [attachments, setAttachments] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');
  const isAdmin = !!adminToken;

  useEffect(() => {
    fetch(`/api/items/${itemId}/attachments`).then(r => r.json()).then(setAttachments).catch(() => setAttachments([]));
  }, [itemId]);

  useEffect(() => {
    function onAdded(e) {
      const att = e.detail;
      if (att.item_id !== itemId) return;
      setAttachments(prev => prev ? [...prev, att] : [att]);
    }
    function onDeleted(e) {
      const { id, item_id } = e.detail;
      if (item_id !== itemId) return;
      setAttachments(prev => prev ? prev.filter(a => a.id !== id) : []);
    }
    window.addEventListener('attachment:added', onAdded);
    window.addEventListener('attachment:deleted', onDeleted);
    return () => {
      window.removeEventListener('attachment:added', onAdded);
      window.removeEventListener('attachment:deleted', onDeleted);
    };
  }, [itemId]);

  async function upload(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setErr(''); setUploading(true);
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    try {
      const res = await fetch(`/api/items/${itemId}/attachments`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${adminToken}` },
        body: fd,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'upload failed');
    } catch (e) { setErr(e.message); }
    finally { setUploading(false); e.target.value = ''; }
  }

  async function remove(att) {
    if (!window.confirm(`Remove "${att.original_name}"?`)) return;
    try { await api(`/api/attachments/${att.id}`, { method: 'DELETE' }, adminToken); }
    catch (e) { setErr(e.message); }
  }

  if (attachments === null) return <div className="att-loading">Loading…</div>;
  return (
    <div className="att-strip">
      {attachments.length > 0 && (
        <div className="att-thumbs">
          {attachments.map(att => (
            <div className="att-thumb" key={att.id}>
              <div className="att-img-wrap" onClick={() => setLightbox(att)}>
                {isVideo(att.mime_type)
                  ? <div className="att-video-placeholder">▶ video</div>
                  : <img src={att.url} alt={att.original_name} />}
              </div>
              {isAdmin && <button className="att-remove" onClick={() => remove(att)} title="Remove">✕</button>}
            </div>
          ))}
        </div>
      )}
      {isAdmin && (
        <label className={`btn sm att-upload-btn ${uploading ? 'disabled' : ''}`}>
          {uploading ? 'Uploading…' : (attachments.length ? '+ More photos' : '📷 Add photo')}
          <input type="file" accept="image/*,video/mp4,video/quicktime" multiple capture="environment"
            onChange={upload} disabled={uploading} style={{ display: 'none' }} />
        </label>
      )}
      {err && <div className="err" style={{ marginTop: 4 }}>{err}</div>}
      {lightbox && <Lightbox att={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

// ---------- admin login modal ----------
function AdminLoginModal({ onLogin, onClose }) {
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr(''); setLoading(true);
    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/signup';
      const data = await api(endpoint, {
        method: 'POST',
        body: JSON.stringify({ username: username.trim(), password }),
      });
      onLogin(data);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <form className="modal" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()} onSubmit={submit}>
        <h2>{mode === 'login' ? 'Admin Login' : 'Create Admin Account'}</h2>
        <div className="field">
          <label>Username</label>
          <input value={username} onChange={e => setUsername(e.target.value)} autoFocus autoComplete="username" />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
        </div>
        <div className="err">{err}</div>
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={loading}>
            {loading ? '…' : (mode === 'login' ? 'Log in' : 'Create account')}
          </button>
        </div>
        <div style={{ marginTop: 12, fontSize: 13, color: '#888', textAlign: 'center' }}>
          {mode === 'login'
            ? <span>New admin? <button type="button" className="link-btn" onClick={() => { setMode('signup'); setErr(''); }}>Create account</button></span>
            : <span>Already have an account? <button type="button" className="link-btn" onClick={() => { setMode('login'); setErr(''); }}>Log in</button></span>
          }
        </div>
      </form>
    </div>
  );
}

// ---------- admin panel (manage users) ----------
function AdminPanel({ adminToken, currentUser, onClose }) {
  const [admins, setAdmins] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api('/api/auth/admins', {}, adminToken).then(setAdmins).catch(e => setErr(e.message));
  }, []);

  async function remove(id, name) {
    if (!window.confirm(`Remove admin "${name}"? They will lose access immediately.`)) return;
    try {
      await api(`/api/auth/admins/${id}`, { method: 'DELETE' }, adminToken);
      setAdmins(prev => prev.filter(a => a.id !== id));
    } catch (e) { setErr(e.message); }
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Admin Accounts</h2>
        <div style={{ color: '#888', fontSize: 13, marginBottom: 12 }}>
          All admins can add, update, and delete items.
        </div>
        {err && <div className="err">{err}</div>}
        {admins === null && <div style={{ color: '#888', fontSize: 13 }}>Loading…</div>}
        {admins && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {admins.map(a => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#1a1a1a', borderRadius: 10, padding: '10px 12px' }}>
                <span style={{ flex: 1, fontWeight: 600 }}>{a.name}</span>
                <span style={{ fontSize: 12, color: '#888' }}>{fmtTime(a.created_at)}</span>
                {a.id !== currentUser.id && (
                  <button className="btn sm danger" onClick={() => remove(a.id, a.name)}>Remove</button>
                )}
                {a.id === currentUser.id && (
                  <span style={{ fontSize: 11, color: '#ffd447', fontWeight: 700 }}>YOU</span>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="actions" style={{ marginTop: 14 }}>
          <button type="button" className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

// ---------- item form modal ----------
function ItemForm({ initial, adminToken, eventId, onClose, onSaved, onDelete }) {
  const [name, setName] = useState(initial?.name || '');
  const [location, setLocation] = useState(initial?.location || '');
  const [condition, setCondition] = useState(initial?.condition || 'good');
  const [requestor, setRequestor] = useState(initial?.requestor || '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const isEdit = !!initial?.id;

  async function save(e) {
    e.preventDefault();
    setErr(''); setSaving(true);
    try {
      const body = { name: name.trim(), location: location.trim(), condition, requestor: requestor.trim(), notes: notes.trim() };
      const saved = isEdit
        ? await api(`/api/items/${initial.id}`, { method: 'PATCH', body: JSON.stringify(body) }, adminToken)
        : await api(`/api/events/${eventId}/items`, { method: 'POST', body: JSON.stringify(body) }, adminToken);
      onSaved(saved); onClose();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  async function del() {
    if (!window.confirm(`Delete "${initial.name}"? This cannot be undone.`)) return;
    try {
      await api(`/api/items/${initial.id}`, { method: 'DELETE' }, adminToken);
      onDelete && onDelete(initial.id); onClose();
    } catch (e) { setErr(e.message); }
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <form className="modal" onClick={e => e.stopPropagation()} onSubmit={save}>
        <h2>{isEdit ? 'Update item' : 'Add item'}</h2>
        <div className="field"><label>Name</label>
          <input value={name} onChange={e => setName(e.target.value)} autoFocus />
        </div>
        <div className="field"><label>Current location</label>
          <input value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Main Stage" />
        </div>
        <div className="field"><label>Condition</label>
          <select value={condition} onChange={e => setCondition(e.target.value)}>
            {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div className="field"><label>Requestor</label>
          <input value={requestor} onChange={e => setRequestor(e.target.value)} placeholder="Who requested this?" />
        </div>
        <div className="field"><label>Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Anything else relevant" />
        </div>
        {isEdit && (
          <div className="field"><label>Photos / attachments</label>
            <AttachmentStrip itemId={initial.id} adminToken={adminToken} />
          </div>
        )}
        <div className="err">{err}</div>
        <div className="actions">
          {isEdit && <button type="button" className="btn danger" onClick={del}>Delete</button>}
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Add item')}</button>
        </div>
      </form>
    </div>
  );
}

// ---------- new event modal ----------
function NewEventModal({ adminToken, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  async function save(e) {
    e.preventDefault();
    setErr(''); setSaving(true);
    try {
      const body = { name: name.trim() };
      if (code.trim()) body.code = code.trim();
      const ev = await api('/api/events', { method: 'POST', body: JSON.stringify(body) }, adminToken);
      onCreated(ev); onClose();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <form className="modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()} onSubmit={save}>
        <h2>New Event</h2>
        <div className="field"><label>Event name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Al Wasl Volleyball" autoFocus />
        </div>
        <div className="field"><label>Short code (optional)</label>
          <input value={code} onChange={e => setCode(e.target.value)} placeholder="Auto-generated if blank" />
        </div>
        <div className="err">{err}</div>
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Creating…' : 'Create event'}</button>
        </div>
      </form>
    </div>
  );
}

// ---------- history modal ----------
function HistoryModal({ item, onClose }) {
  const [events, setEvents] = useState(null);
  useEffect(() => {
    fetch(`/api/items/${item.id}/history`).then(r => r.json()).then(setEvents).catch(() => setEvents([]));
  }, [item.id]);
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>History — {item.name}</h2>
        <div style={{ color: '#999', fontSize: 13, marginBottom: 10 }}>Full audit trail of every change.</div>
        <div className="history">
          {events === null && <div style={{ color: '#888', fontSize: 13 }}>Loading…</div>}
          {events?.length === 0 && <div style={{ color: '#888', fontSize: 13 }}>No history yet.</div>}
          {events?.map(ev => (
            <div className="event" key={ev.id}>
              <div className="head">
                <span className="who">{ev.changed_by}</span>
                <span>{fmtTime(ev.changed_at)}</span>
              </div>
              <div className="action">{actionLabel(ev.action)}</div>
              <div className="changes">
                {ev.action === 'created' ? (
                  <span>Created at <b>{ev.changes.location || '—'}</b> · <b>{LABEL[ev.changes.condition] || ev.changes.condition}</b>{ev.changes.requestor ? ` · requestor: ${ev.changes.requestor}` : ''}</span>
                ) : ev.action === 'deleted' ? <span>Removed from inventory.</span>
                : ev.action === 'photo_added' ? <span>Attached: {ev.changes.filename}</span>
                : ev.action === 'photo_removed' ? <span>Removed photo: {ev.changes.filename}</span>
                : Object.entries(ev.changes).map(([k, v]) => (
                  <span className="chg" key={k}>
                    <span className="k">{k}:</span>{' '}
                    <span className="from">{k === 'condition' ? (LABEL[v.from] || v.from) : (v.from || '—')}</span>
                    <span className="arrow">→</span>
                    <span className="to">{k === 'condition' ? (LABEL[v.to] || v.to) : (v.to || '—')}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="actions"><button type="button" className="btn primary" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

// ---------- main app ----------
function App() {
  // Admin auth — persisted in localStorage
  const [admin, setAdmin] = useState(() => {
    try { return JSON.parse(localStorage.getItem('eit:admin')) || null; } catch { return null; }
  });

  // Events + selected event
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState(() => localStorage.getItem('eit:eventId') || '');

  // Items
  const [items, setItems] = useState([]);
  const [cardAttachments, setCardAttachments] = useState({});

  // UI state
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [editingItem, setEditingItem] = useState(null);
  const [historyItem, setHistoryItem] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);
  const [newEventOpen, setNewEventOpen] = useState(false);
  const [toast, setToast] = useState('');
  const socketRef = useRef(null);

  const isAdmin = !!admin;
  const currentEvent = events.find(e => e.id === eventId) || null;

  function flash(msg) {
    setToast(msg);
    setTimeout(() => setToast(t => t === msg ? '' : t), 2200);
  }

  function handleLogin({ token, user }) {
    const a = { token, ...user };
    setAdmin(a);
    localStorage.setItem('eit:admin', JSON.stringify(a));
    setLoginOpen(false);
    flash(`Logged in as ${user.name}`);
  }

  function logout() {
    setAdmin(null);
    localStorage.removeItem('eit:admin');
    flash('Logged out');
  }

  // Load events on mount
  useEffect(() => {
    fetch('/api/events').then(r => r.json()).then(rows => {
      setEvents(rows);
      // Auto-select first event if none selected or selection is stale
      if (rows.length && (!eventId || !rows.find(e => e.id === eventId))) {
        setEventId(rows[0].id);
        localStorage.setItem('eit:eventId', rows[0].id);
      }
    }).catch(() => {});
  }, []);

  // Load items when event changes
  useEffect(() => {
    if (!eventId) return;
    localStorage.setItem('eit:eventId', eventId);
    fetch(`/api/events/${eventId}/items`).then(r => r.json()).then(rows => {
      setItems(rows);
      rows.forEach(it => {
        fetch(`/api/items/${it.id}/attachments`).then(r => r.json()).then(atts => {
          if (atts.length) setCardAttachments(prev => ({ ...prev, [it.id]: atts[0] }));
        });
      });
    }).catch(() => setItems([]));
  }, [eventId]);

  // Socket.IO — real-time updates
  useEffect(() => {
    if (!eventId) return;
    const socket = io();
    socketRef.current = socket;
    socket.emit('join', eventId);

    socket.on('item:created', item => {
      if (item.event_id !== eventId) return;
      setItems(prev => prev.some(p => p.id === item.id) ? prev : [item, ...prev]);
    });
    socket.on('item:updated', item => {
      if (item.event_id !== eventId) return;
      setItems(prev => prev.map(p => p.id === item.id ? item : p));
    });
    socket.on('item:deleted', ({ id, event_id }) => {
      if (event_id !== eventId) return;
      setItems(prev => prev.filter(p => p.id !== id));
      setCardAttachments(prev => { const n = { ...prev }; delete n[id]; return n; });
    });
    socket.on('attachment:added', att => {
      window.dispatchEvent(new CustomEvent('attachment:added', { detail: att }));
      setCardAttachments(prev => prev[att.item_id] ? prev : { ...prev, [att.item_id]: att });
      flash('Photo added');
    });
    socket.on('attachment:deleted', ({ id, item_id }) => {
      window.dispatchEvent(new CustomEvent('attachment:deleted', { detail: { id, item_id } }));
      setCardAttachments(prev => {
        if (prev[item_id]?.id !== id) return prev;
        fetch(`/api/items/${item_id}/attachments`).then(r => r.json())
          .then(atts => setCardAttachments(p => ({ ...p, [item_id]: atts[0] || null })));
        return prev;
      });
    });
    socket.on('event:created', ev => {
      setEvents(prev => prev.some(e => e.id === ev.id) ? prev : [ev, ...prev]);
    });

    return () => { socket.emit('leave', eventId); socket.disconnect(); };
  }, [eventId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(it => {
      if (filter !== 'all' && it.condition !== filter) return false;
      if (!q) return true;
      return it.name.toLowerCase().includes(q) ||
        (it.location || '').toLowerCase().includes(q) ||
        (it.requestor || '').toLowerCase().includes(q) ||
        (it.notes || '').toLowerCase().includes(q);
    });
  }, [items, query, filter]);

  return (
    <div className="app">
      {/* ── top bar ── */}
      <div className="topbar">
        <span className="brand">SQUATWOLF</span>

        {/* event picker */}
        {events.length > 0 ? (
          <select className="event-select" value={eventId} onChange={e => setEventId(e.target.value)}>
            {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
          </select>
        ) : (
          <span className="event-pill">📍 No events yet</span>
        )}

        <span className="spacer" />

        {/* admin controls */}
        {isAdmin ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="btn sm ghost" style={{ color: '#ffd447', fontWeight: 700 }}
              onClick={() => setAdminPanelOpen(true)} title="Manage admins">
              {admin.name}
            </button>
            <button className="btn sm ghost" onClick={logout} title="Log out">↺</button>
          </div>
        ) : (
          <button className="btn sm" onClick={() => setLoginOpen(true)}>Admin Login</button>
        )}
      </div>

      {/* ── dashboard ── */}
      <div className="container">
        <div className="controls">
          <input className="search" placeholder="Search items…" value={query} onChange={e => setQuery(e.target.value)} />
          <select className="filter" value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="all">All conditions</option>
            {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          {isAdmin && (
            <>
              <button className="btn primary" onClick={() => setAddOpen(true)}>+ Add item</button>
              <button className="btn" onClick={() => setNewEventOpen(true)} title="New event">＋ Event</button>
            </>
          )}
        </div>

        {!eventId || events.length === 0 ? (
          <div className="empty">
            {isAdmin
              ? <>No events yet. <button className="link-btn" onClick={() => setNewEventOpen(true)}>Create the first event →</button></>
              : 'No events yet. Check back soon.'}
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            {items.length === 0
              ? (isAdmin ? 'No items yet. Tap "+ Add item" to start.' : 'No items in this event yet.')
              : 'No items match your search.'}
          </div>
        ) : (
          <div className="items">
            {filtered.map(it => {
              const thumb = cardAttachments[it.id];
              return (
                <div className="item" key={it.id}>
                  {thumb && !isVideo(thumb.mime_type) && (
                    <div className="item-thumb" onClick={() => isAdmin && setEditingItem(it)}>
                      <img src={thumb.url} alt={thumb.original_name} />
                    </div>
                  )}
                  <div className="row">
                    <div className="name">{it.name}</div>
                    <span className={`badge ${it.condition}`}>{LABEL[it.condition]}</span>
                  </div>
                  <div className="fields">
                    <span className="k">Location</span><span className="v">{it.location || '—'}</span>
                    <span className="k">Requestor</span><span className="v">{it.requestor || '—'}</span>
                    {it.notes && <><span className="k">Notes</span><span className="v">{it.notes}</span></>}
                  </div>
                  <div className="meta">Updated by {it.updated_by || '—'} · {fmtTime(it.updated_at)}</div>
                  <div className="actions">
                    <button className="btn sm" onClick={() => setHistoryItem(it)}>History</button>
                    {isAdmin && (
                      <button className="btn sm primary" onClick={() => setEditingItem(it)}>Update</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── modals ── */}
      {loginOpen && <AdminLoginModal onLogin={handleLogin} onClose={() => setLoginOpen(false)} />}

      {adminPanelOpen && (
        <AdminPanel adminToken={admin?.token} currentUser={admin} onClose={() => setAdminPanelOpen(false)} />
      )}

      {newEventOpen && (
        <NewEventModal
          adminToken={admin?.token}
          onClose={() => setNewEventOpen(false)}
          onCreated={ev => { setEvents(prev => [ev, ...prev]); setEventId(ev.id); flash(`Event "${ev.name}" created`); }}
        />
      )}

      {addOpen && (
        <ItemForm
          adminToken={admin?.token} eventId={eventId}
          onClose={() => setAddOpen(false)}
          onSaved={() => flash('Item added')}
        />
      )}

      {editingItem && (
        <ItemForm
          initial={editingItem} adminToken={admin?.token} eventId={eventId}
          onClose={() => setEditingItem(null)}
          onSaved={() => flash('Item updated')}
          onDelete={() => flash('Item deleted')}
        />
      )}

      {historyItem && <HistoryModal item={historyItem} onClose={() => setHistoryItem(null)} />}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
