/* eslint-disable */
const { useState, useEffect, useMemo, useRef } = React;

// ---------- Supabase client ----------
const SUPABASE_URL = 'https://jnqlhfehhqnhqscvwjxp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpucWxoZmVoaHFuaHFzY3Z3anhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzMjU0OTcsImV4cCI6MjA5MTkwMTQ5N30.oBknXVFJZhpaBujHUH1MVW-UbKb_tBPCX6gwY8RYCsE';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
  realtime: { params: { eventsPerSecond: 10 } },
});

// ---------- helpers ----------
const CONDITIONS = [
  { value: 'good',          label: 'Good' },
  { value: 'needs_cleaning',label: 'Needs Cleaning' },
  { value: 'needs_repair',  label: 'Needs Repair' },
  { value: 'damaged',       label: 'Damaged' },
];
const LABEL = { good: 'Good', damaged: 'Damaged', needs_repair: 'Needs Repair', needs_cleaning: 'Needs Cleaning' };
const VALID  = new Set(['good', 'damaged', 'needs_repair', 'needs_cleaning']);

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = new Date();
  const opts = d.toDateString() === now.toDateString()
    ? { hour: '2-digit', minute: '2-digit' }
    : { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' };
  return d.toLocaleString(undefined, opts);
}
function actionLabel(a) {
  return { created:'Created', updated:'Updated', moved:'Moved', condition_changed:'Condition changed',
    notes_updated:'Notes updated', deleted:'Deleted', photo_added:'Photo added', photo_removed:'Photo removed' }[a] || a;
}
function isVideo(mime) { return (mime || '').startsWith('video/'); }

function diff(before, after) {
  const fields = ['name','location','condition','requestor','notes'];
  const d = {};
  for (const f of fields) if (before[f] !== after[f]) d[f] = { from: before[f], to: after[f] };
  return d;
}

async function logHistory(item_id, event_id, action, changes, changed_by) {
  await sb.from('history').insert({ item_id, event_id, action, changes, changed_by, changed_at: new Date().toISOString() });
}

// ---------- lightbox ----------
function Lightbox({ att, onClose }) {
  useEffect(() => {
    const fn = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);
  return (
    <div className="lightbox" onClick={onClose}>
      <button className="lightbox-close" onClick={onClose}>✕</button>
      <div className="lightbox-inner" onClick={e => e.stopPropagation()}>
        {isVideo(att.mime_type)
          ? <video src={att.url} controls autoPlay style={{maxWidth:'100%',maxHeight:'80vh',borderRadius:10}} />
          : <img src={att.url} alt={att.original_name} style={{maxWidth:'100%',maxHeight:'80vh',borderRadius:10,display:'block'}} />}
        <div className="lightbox-caption">{att.original_name} · {att.uploaded_by} · {fmtTime(att.uploaded_at)}</div>
      </div>
    </div>
  );
}

// ---------- attachment strip ----------
function AttachmentStrip({ itemId, eventId, adminName, isAdmin }) {
  const [attachments, setAttachments] = useState(null);
  const [lightbox, setLightbox]       = useState(null);
  const [uploading, setUploading]     = useState(false);
  const [err, setErr]                 = useState('');

  useEffect(() => {
    sb.from('attachments').select('*').eq('item_id', itemId).order('uploaded_at')
      .then(({ data }) => setAttachments(data || []));
  }, [itemId]);

  async function upload(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setErr(''); setUploading(true);
    for (const f of files) {
      const ext  = f.name.split('.').pop().toLowerCase();
      const path = `${eventId}/${itemId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: upErr } = await sb.storage.from('attachments').upload(path, f, { contentType: f.type });
      if (upErr) { setErr(upErr.message); continue; }
      const { data: { publicUrl } } = sb.storage.from('attachments').getPublicUrl(path);
      const { data: att } = await sb.from('attachments').insert({
        item_id: itemId, event_id: eventId, storage_path: path,
        original_name: f.name, mime_type: f.type, size: f.size,
        url: publicUrl, uploaded_by: adminName, uploaded_at: new Date().toISOString(),
      }).select().single();
      if (att) {
        setAttachments(prev => [...(prev || []), att]);
        await logHistory(itemId, eventId, 'photo_added', { filename: f.name }, adminName);
      }
    }
    setUploading(false); e.target.value = '';
  }

  async function remove(att) {
    if (!window.confirm(`Remove "${att.original_name}"?`)) return;
    await sb.storage.from('attachments').remove([att.storage_path]);
    await sb.from('attachments').delete().eq('id', att.id);
    await logHistory(itemId, eventId, 'photo_removed', { filename: att.original_name }, adminName);
    setAttachments(prev => prev.filter(a => a.id !== att.id));
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
              {isAdmin && <button className="att-remove" onClick={() => remove(att)}>✕</button>}
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
  const [mode, setMode]         = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr]           = useState('');
  const [loading, setLoading]   = useState(false);

  const toEmail = u => `${u.toLowerCase().trim()}@squatwolf.admin`;

  async function submit(e) {
    e.preventDefault();
    setErr(''); setLoading(true);
    try {
      if (mode === 'signup') {
        const { error } = await sb.auth.signUp({
          email: toEmail(username), password,
          options: { data: { name: username.trim() } },
        });
        if (error) throw new Error(error.message.includes('already') ? 'Username already taken' : error.message);
      }
      const { data, error: signInErr } = await sb.auth.signInWithPassword({
        email: toEmail(username), password,
      });
      if (signInErr) throw new Error('Invalid username or password');
      onLogin({
        token: data.session.access_token,
        id: data.user.id,
        name: data.user.user_metadata?.name || username.trim(),
      });
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
          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
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
            : <span>Have an account? <button type="button" className="link-btn" onClick={() => { setMode('login'); setErr(''); }}>Log in</button></span>}
        </div>
      </form>
    </div>
  );
}

// ---------- item form ----------
function ItemForm({ initial, admin, eventId, onClose, onSaved, onDelete }) {
  const [name, setName]         = useState(initial?.name || '');
  const [location, setLocation] = useState(initial?.location || '');
  const [condition, setCondition] = useState(initial?.condition || 'good');
  const [requestor, setRequestor] = useState(initial?.requestor || '');
  const [notes, setNotes]       = useState(initial?.notes || '');
  const [err, setErr]           = useState('');
  const [saving, setSaving]     = useState(false);
  const isEdit = !!initial?.id;

  async function save(e) {
    e.preventDefault();
    if (!name.trim()) return setErr('Name is required');
    if (!VALID.has(condition)) return setErr('Invalid condition');
    setErr(''); setSaving(true);
    try {
      const now = new Date().toISOString();
      const payload = { name: name.trim(), location: location.trim(), condition,
        requestor: requestor.trim(), notes: notes.trim(),
        updated_at: now, updated_by: admin.name };

      if (isEdit) {
        const changes = diff(initial, payload);
        if (Object.keys(changes).length === 0) { onClose(); return; }
        const { data, error } = await sb.from('items').update(payload).eq('id', initial.id).select().single();
        if (error) throw new Error(error.message);

        let action = 'updated';
        if (changes.location && Object.keys(changes).length === 1) action = 'moved';
        else if (changes.condition && Object.keys(changes).length === 1) action = 'condition_changed';
        else if (changes.notes && Object.keys(changes).length === 1) action = 'notes_updated';
        await logHistory(initial.id, initial.event_id, action, changes, admin.name);
        onSaved(data);
      } else {
        const { data, error } = await sb.from('items').insert({
          ...payload, event_id: eventId, created_at: now,
        }).select().single();
        if (error) throw new Error(error.message);
        await logHistory(data.id, eventId, 'created',
          { name: data.name, location: data.location, condition: data.condition,
            requestor: data.requestor, notes: data.notes }, admin.name);
        onSaved(data);
      }
      onClose();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  async function del() {
    if (!window.confirm(`Delete "${initial.name}"? This cannot be undone.`)) return;
    await logHistory(initial.id, initial.event_id, 'deleted',
      { name: initial.name, location: initial.location, condition: initial.condition }, admin.name);
    await sb.from('items').delete().eq('id', initial.id);
    onDelete && onDelete(initial.id);
    onClose();
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
            <AttachmentStrip itemId={initial.id} eventId={initial.event_id} adminName={admin.name} isAdmin={true} />
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
function NewEventModal({ admin, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr]   = useState('');
  const [saving, setSaving] = useState(false);

  async function save(e) {
    e.preventDefault();
    if (!name.trim()) return setErr('Name required');
    setSaving(true);
    const finalCode = (code.trim() || Math.random().toString(36).slice(2, 8)).toUpperCase();
    const { data, error } = await sb.from('events').insert({ name: name.trim(), code: finalCode }).select().single();
    if (error) { setErr(error.message.includes('unique') ? 'Code already in use' : error.message); setSaving(false); return; }
    onCreated(data); onClose();
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
    sb.from('history').select('*').eq('item_id', item.id).order('changed_at', { ascending: false })
      .then(({ data }) => setEvents(data || []));
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
              <div className="head"><span className="who">{ev.changed_by}</span><span>{fmtTime(ev.changed_at)}</span></div>
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
  const [admin, setAdmin]   = useState(() => {
    try { return JSON.parse(localStorage.getItem('eit:admin')) || null; } catch { return null; }
  });
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState(() => localStorage.getItem('eit:eventId') || '');
  const [items, setItems]   = useState([]);
  const [cardThumbs, setCardThumbs] = useState({});
  const [query, setQuery]   = useState('');
  const [filter, setFilter] = useState('all');
  const [editingItem, setEditingItem]   = useState(null);
  const [historyItem, setHistoryItem]   = useState(null);
  const [addOpen, setAddOpen]           = useState(false);
  const [loginOpen, setLoginOpen]       = useState(false);
  const [newEventOpen, setNewEventOpen] = useState(false);
  const [toast, setToast]   = useState('');
  const channelRef = useRef(null);

  const isAdmin = !!admin;
  const currentEvent = events.find(e => e.id === eventId) || null;

  function flash(msg) {
    setToast(msg);
    setTimeout(() => setToast(t => t === msg ? '' : t), 2200);
  }

  // Restore Supabase session on load
  useEffect(() => {
    sb.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        const stored = JSON.parse(localStorage.getItem('eit:admin') || 'null');
        if (stored) setAdmin({ ...stored, token: session.access_token });
      } else {
        setAdmin(null);
        localStorage.removeItem('eit:admin');
      }
    });
    sb.auth.onAuthStateChange((event, session) => {
      if (!session) { setAdmin(null); localStorage.removeItem('eit:admin'); }
    });
  }, []);

  // Load events
  useEffect(() => {
    sb.from('events').select('*').order('created_at', { ascending: false })
      .then(({ data }) => {
        const rows = data || [];
        setEvents(rows);
        if (rows.length && (!eventId || !rows.find(e => e.id === eventId))) {
          setEventId(rows[0].id);
          localStorage.setItem('eit:eventId', rows[0].id);
        }
      });
  }, []);

  // Load items + thumbnails when event changes
  useEffect(() => {
    if (!eventId) return;
    localStorage.setItem('eit:eventId', eventId);
    sb.from('items').select('*').eq('event_id', eventId).order('updated_at', { ascending: false })
      .then(({ data }) => {
        const rows = data || [];
        setItems(rows);
        rows.forEach(it => {
          sb.from('attachments').select('*').eq('item_id', it.id).order('uploaded_at').limit(1)
            .then(({ data: atts }) => {
              if (atts?.length) setCardThumbs(prev => ({ ...prev, [it.id]: atts[0] }));
            });
        });
      });
  }, [eventId]);

  // Supabase Realtime
  useEffect(() => {
    if (!eventId) return;
    if (channelRef.current) sb.removeChannel(channelRef.current);

    const ch = sb.channel(`event-${eventId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'items', filter: `event_id=eq.${eventId}` },
        ({ new: item }) => setItems(prev => prev.some(p => p.id === item.id) ? prev : [item, ...prev]))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'items', filter: `event_id=eq.${eventId}` },
        ({ new: item }) => setItems(prev => prev.map(p => p.id === item.id ? item : p)))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'items', filter: `event_id=eq.${eventId}` },
        ({ old }) => { setItems(prev => prev.filter(p => p.id !== old.id)); setCardThumbs(prev => { const n={...prev}; delete n[old.id]; return n; }); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'attachments', filter: `event_id=eq.${eventId}` },
        ({ new: att }) => setCardThumbs(prev => prev[att.item_id] ? prev : { ...prev, [att.item_id]: att }))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'attachments', filter: `event_id=eq.${eventId}` },
        ({ old }) => {
          setCardThumbs(prev => {
            if (prev[old.item_id]?.id !== old.id) return prev;
            sb.from('attachments').select('*').eq('item_id', old.item_id).order('uploaded_at').limit(1)
              .then(({ data }) => setCardThumbs(p => ({ ...p, [old.item_id]: data?.[0] || null })));
            return prev;
          });
        })
      .subscribe();

    channelRef.current = ch;
    return () => sb.removeChannel(ch);
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

  function handleLogin(data) {
    const a = { token: data.token, id: data.id, name: data.name };
    setAdmin(a);
    localStorage.setItem('eit:admin', JSON.stringify(a));
    setLoginOpen(false);
    flash(`Logged in as ${data.name}`);
  }

  function logout() {
    sb.auth.signOut();
    setAdmin(null);
    localStorage.removeItem('eit:admin');
    flash('Logged out');
  }

  return (
    <div className="app">
      <div className="topbar">
        <span className="brand">SQUATWOLF</span>
        {events.length > 0 ? (
          <select className="event-select" value={eventId} onChange={e => { setEventId(e.target.value); localStorage.setItem('eit:eventId', e.target.value); }}>
            {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
          </select>
        ) : (
          <span className="event-pill">📍 No events</span>
        )}
        <span className="spacer" />
        {isAdmin ? (
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ color:'#ffd447', fontWeight:700, fontSize:13 }}>{admin.name}</span>
            <button className="btn sm ghost" onClick={logout} title="Log out">↺</button>
          </div>
        ) : (
          <button className="btn sm" onClick={() => setLoginOpen(true)}>Admin Login</button>
        )}
      </div>

      <div className="container">
        <div className="controls">
          <input className="search" placeholder="Search items…" value={query} onChange={e => setQuery(e.target.value)} />
          <select className="filter" value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="all">All conditions</option>
            {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          {isAdmin && <>
            <button className="btn primary" onClick={() => setAddOpen(true)}>+ Add item</button>
            <button className="btn" onClick={() => setNewEventOpen(true)}>＋ Event</button>
          </>}
        </div>

        {!eventId || events.length === 0 ? (
          <div className="empty">
            {isAdmin
              ? <><button className="link-btn" onClick={() => setNewEventOpen(true)}>Create the first event →</button></>
              : 'No events yet.'}
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
              const thumb = cardThumbs[it.id];
              return (
                <div className="item" key={it.id}>
                  {thumb && !isVideo(thumb.mime_type) && (
                    <div className="item-thumb"><img src={thumb.url} alt={thumb.original_name} /></div>
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
                    {isAdmin && <button className="btn sm primary" onClick={() => setEditingItem(it)}>Update</button>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {loginOpen    && <AdminLoginModal onLogin={handleLogin} onClose={() => setLoginOpen(false)} />}
      {newEventOpen && <NewEventModal admin={admin} onClose={() => setNewEventOpen(false)} onCreated={ev => { setEvents(prev => [ev, ...prev]); setEventId(ev.id); flash(`Event "${ev.name}" created`); }} />}
      {addOpen      && <ItemForm admin={admin} eventId={eventId} onClose={() => setAddOpen(false)} onSaved={() => flash('Item added')} />}
      {editingItem  && <ItemForm initial={editingItem} admin={admin} eventId={eventId} onClose={() => setEditingItem(null)} onSaved={() => flash('Item updated')} onDelete={() => flash('Item deleted')} />}
      {historyItem  && <HistoryModal item={historyItem} onClose={() => setHistoryItem(null)} />}
      {toast        && <div className="toast">{toast}</div>}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
