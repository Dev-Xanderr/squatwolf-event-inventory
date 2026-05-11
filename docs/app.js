/* eslint-disable */
const { useState, useEffect, useMemo, useRef } = React;

// ---------- Supabase ----------
const SUPABASE_URL      = 'https://jnqlhfehhqnhqscvwjxp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpucWxoZmVoaHFuaHFzY3Z3anhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzMjU0OTcsImV4cCI6MjA5MTkwMTQ5N30.oBknXVFJZhpaBujHUH1MVW-UbKb_tBPCX6gwY8RYCsE';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Workaround for supabase-js v2 navigator.locks deadlock: when the auth
    // token already exists in localStorage on page load, the default lock
    // (built on navigator.locks) hangs indefinitely waiting for the
    // initialize call. That blocks getSession() AND every PostgREST query.
    // Override with a pass-through; we accept the small risk of two tabs
    // racing a token refresh — supabase-js handles that gracefully.
    lock: (name, acquireTimeout, fn) => fn(),
  },
});

// ---------- constants ----------
const CONDITIONS = [
  { value: 'good',           label: 'Good' },
  { value: 'needs_cleaning', label: 'Needs Cleaning' },
  { value: 'needs_repair',   label: 'Needs Repair' },
  { value: 'damaged',        label: 'Damaged' },
];
const CLABEL = { good: 'Good', needs_cleaning: 'Needs Cleaning', needs_repair: 'Needs Repair', damaged: 'Damaged', retired: 'Retired' };
const CATEGORIES = ['Audio', 'Signage', 'Furniture', 'Equipment', 'Comms', 'Other'];
// Deployment workflow state machine. Order matters — index = stage number.
// `gate` controls who can advance from this state forward.
const WORKFLOW_STATES = [
  { v: 'draft',     label: 'Draft',      sub: 'Building the request',         gate: 'admin'  },
  { v: 'requested', label: 'Requested',  sub: 'Awaiting approval',            gate: 'master' },
  { v: 'approved',  label: 'Approved',   sub: 'Ready to ship',                gate: 'admin'  },
  { v: 'shipped',   label: 'Shipped',    sub: 'In transit to venue',          gate: 'admin'  },
  { v: 'arrived',   label: 'Arrived',    sub: 'On site at the venue',         gate: 'admin'  },
  { v: 'returning', label: 'Returning',  sub: 'Coming back to storage',       gate: 'admin'  },
  { v: 'closed',    label: 'Closed',     sub: 'All items returned & checked', gate: 'admin'  },
];
function workflowIndex(state) {
  const i = WORKFLOW_STATES.findIndex(s => s.v === state);
  return i === -1 ? 0 : i;
}

const DEPARTMENTS = [
  'Finance',
  'Human Resources',
  'Events and Community',
  'Social Media Team',
  'Logistics',
  'Expansion',
  'Design Team',
  'Retail Team',
  'Founders Content Creator',
];

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
// Render an event's date range as one line. Prefers TIMESTAMPTZ start/end
// when present (shows "Mar 5, 10:00 — Mar 7, 22:00"), falls back to
// DATE-only ("Mar 5–7") for pre-migration data.
function fmtDateRange(ev) {
  // Prefer datetimes when set
  if (ev?.event_start_at || ev?.event_end_at) {
    const sd = ev.event_start_at ? new Date(ev.event_start_at) : null;
    const ed = ev.event_end_at   ? new Date(ev.event_end_at)   : null;
    const fmtDateTime = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      + ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    if (sd && ed) {
      // Same calendar day → "Mar 5 · 10:00–22:00"
      if (sd.toDateString() === ed.toDateString()) {
        const dayPart = sd.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        const sTime = sd.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        const eTime = ed.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        return `${dayPart} · ${sTime}–${eTime}`;
      }
      return `${fmtDateTime(sd)} — ${fmtDateTime(ed)}`;
    }
    if (sd) return fmtDateTime(sd);
    if (ed) return fmtDateTime(ed);
  }
  // Date-only fallback
  const start = ev?.event_start_date || ev?.event_date;
  const end   = ev?.event_end_date   || ev?.event_date;
  if (!start && !end) return '—';
  if (!end || start === end) return fmtDate(start);
  const sd = new Date(start), ed = new Date(end);
  const sameMonth = sd.getMonth() === ed.getMonth() && sd.getFullYear() === ed.getFullYear();
  if (sameMonth) {
    const month = sd.toLocaleDateString(undefined, { month: 'short' });
    return `${month} ${sd.getDate()}–${ed.getDate()}, ${ed.getFullYear()}`;
  }
  return `${fmtDate(start)} – ${fmtDate(end)}`;
}
function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso), now = new Date();
  const opts = d.toDateString() === now.toDateString()
    ? { hour: '2-digit', minute: '2-digit' }
    : { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' };
  return d.toLocaleString(undefined, opts);
}
function actionLabel(a) {
  return { item_created:'Item added', item_updated:'Item updated', item_deleted:'Item removed',
    assigned:'Assigned to deployment', location_updated:'Location updated', condition_changed:'Condition changed',
    notes_updated:'Notes updated', returned:'Returned', photo_added:'Photo added', photo_removed:'Photo removed',
    repaired:'Marked repaired', retired:'Retired',
    packed:'Packed', unpacked:'Marked not packed',
    damage_reported:'Damage reported',
    workflow_advanced:'Workflow advanced', workflow_sent_back:'Sent back for revision',
    workflow_rolled_back:'Workflow rolled back' }[a] || a;
}
function isVideo(m) { return (m||'').startsWith('video/'); }
function diffObj(before, after, fields) {
  const d = {};
  for (const f of fields) if (String(before[f]||'') !== String(after[f]||'')) d[f] = { from: before[f], to: after[f] };
  return d;
}

// ---------- QR helpers ----------
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
function itemUrl(id) {
  // encode the deep-link form so any QR scanner opens this app on the item
  return `${location.origin}${location.pathname}?item=${id}`;
}
function eventUrl(id) {
  return `${location.origin}${location.pathname}?event=${id}`;
}
function parseScanned(text) {
  // accept raw UUID, our deep-link URL, or anything containing a UUID
  const m = String(text||'').match(UUID_RE);
  return m ? m[0] : null;
}
function qrSvgString(text) {
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ scalable: true, margin: 0 });
}

// ---------- Item thumbnail primitive ----------
// One small component used on every row (dashboard, items grid, etc.).
// `useItemThumbs()` fetches the photo URL per item id once: prefer the oldest
// master-level image, fall back to the oldest event-level image so items only
// photographed during a deployment still get a thumbnail.
function useItemThumbs() {
  const [thumbs, setThumbs] = useState({});
  useEffect(() => {
    let cancelled = false;
    sb.from('attachments')
      .select('item_id, url, mime_type, event_item_id, uploaded_at')
      .like('mime_type', 'image/%')
      .order('uploaded_at', { ascending: true })
      .then(({ data }) => {
        if (cancelled) return;
        const t = {};
        (data || []).forEach(a => { if (a.event_item_id == null && !t[a.item_id]) t[a.item_id] = a.url; });
        (data || []).forEach(a => { if (!t[a.item_id]) t[a.item_id] = a.url; });
        setThumbs(t);
      });
    return () => { cancelled = true; };
  }, []);
  return thumbs;
}

function ItemThumb({ url, name, category, size = 40, className = '' }) {
  const initial = (category || name || '?').trim().charAt(0).toUpperCase();
  const cls = `item-thumb item-thumb-${size}${className ? ' ' + className : ''}`;
  if (url) {
    return <span className={cls}><img src={url} alt="" loading="lazy" /></span>;
  }
  return <span className={`${cls} item-thumb-fallback`}>{initial}</span>;
}

// ---------- CSV helpers ----------
function toCsv(rows, headers) {
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const out = [headers.join(',')];
  for (const r of rows) out.push(headers.map((h) => esc(r[h])).join(','));
  return out.join('\r\n');
}
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false, i = 0;
  const finishCell = () => { row.push(cell); cell = ''; };
  const finishRow  = () => { rows.push(row); row = []; };
  while (i < text.length) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i+1] === '"') { cell += '"'; i += 2; continue; }
        q = false; i++; continue;
      }
      cell += c; i++; continue;
    }
    if (c === '"') { q = true; i++; continue; }
    if (c === ',')  { finishCell(); i++; continue; }
    if (c === '\r' && text[i+1] === '\n') { finishCell(); finishRow(); i += 2; continue; }
    if (c === '\n' || c === '\r') { finishCell(); finishRow(); i++; continue; }
    cell += c; i++;
  }
  if (cell.length > 0 || row.length > 0) { finishCell(); finishRow(); }
  // strip trailing fully-empty rows
  while (rows.length && rows[rows.length-1].every((s) => s === '')) rows.pop();
  return rows;
}
function downloadFile(filename, content, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿' + content], { type: mime }); // BOM for Excel
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}

// ---------- toast / error reporting ----------
// Lightweight pub-sub so any component can fire a toast without prop-drilling.
function toast(msg, kind = 'info') {
  window.dispatchEvent(new CustomEvent('eit:toast', { detail: { msg, kind } }));
}
// Translate raw Supabase / Postgres errors into something a human at a venue
// can act on. Codes we know about today, fall back to message otherwise.
function friendlyError(err) {
  if (!err) return '';
  const code = err.code || err?.error_code;
  const msg  = err.message || String(err);
  if (code === '42501' || /row-level security/i.test(msg))
    return 'Your access changed. Refresh the page or sign in again.';
  if (code === '23505' || /duplicate key/i.test(msg))
    return 'That already exists.';
  if (code === '23503' || /foreign key/i.test(msg))
    return 'Linked to other records — remove those first.';
  if (/Sign-up restricted/i.test(msg))
    return 'Sign-up is restricted to @squatwolf.com email addresses.';
  if (/Failed to fetch|NetworkError|networkError/i.test(msg))
    return 'No connection — check your wifi and try again.';
  return msg;
}
// Wrap a promise: on resolve, return the value; on reject (or {error}), fire a toast.
async function reportable(promise, contextLabel) {
  try {
    const r = await promise;
    if (r && r.error) {
      toast(`${contextLabel || 'Action failed'}: ${friendlyError(r.error)}`, 'err');
      return r;
    }
    return r;
  } catch (e) {
    toast(`${contextLabel || 'Action failed'}: ${friendlyError(e)}`, 'err');
    throw e;
  }
}

// Hook: while `busy` is true, warn before unload + intercept backdrop close.
// Returns a `safeClose` that no-ops while busy, and a `backdropProps` to spread.
function useUnloadGuard(busy, onClose) {
  useEffect(() => {
    if (!busy) return;
    const fn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', fn);
    return () => window.removeEventListener('beforeunload', fn);
  }, [busy]);
  const safeClose = () => { if (!busy) onClose?.(); };
  return { safeClose };
}

// ---------- imperative confirm ----------
// Replaces window.confirm. Use:
//   if (!await confirm({ title, body, danger:true })) return;
// Brand-consistent and works inside iOS PWAs (where window.confirm misbehaves).
let _confirmHandler = null;
function confirm(opts) {
  return new Promise((resolve) => {
    if (!_confirmHandler) { resolve(window.confirm(opts.body || opts.title || 'Are you sure?')); return; }
    _confirmHandler({ ...opts, resolve });
  });
}
function ConfirmHost() {
  const [opts, setOpts] = useState(null);
  useEffect(() => {
    _confirmHandler = (o) => setOpts(o);
    return () => { _confirmHandler = null; };
  }, []);
  if (!opts) return null;
  function answer(v) { opts.resolve(v); setOpts(null); }
  return (
    <div className="backdrop" onClick={()=>answer(false)} style={{zIndex:80}}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:380}}>
        <h2>{opts.title || 'Are you sure?'}</h2>
        <div style={{fontFamily:"'Manrope',sans-serif",fontSize:14,color:'#EFEFEF',marginBottom:14,lineHeight:1.45}}>
          {opts.body}
        </div>
        <div className="actions">
          <button type="button" className="btn ghost" onClick={()=>answer(false)}>{opts.cancelLabel || 'Cancel'}</button>
          <button type="button" className={`btn ${opts.danger ? 'danger' : 'primary'}`}
            onClick={()=>answer(true)}>{opts.confirmLabel || (opts.danger ? 'Yes, do it' : 'Confirm')}</button>
        </div>
      </div>
    </div>
  );
}

function ToastHost() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const fn = (e) => {
      const id = Math.random().toString(36).slice(2);
      const next = { id, msg: e.detail.msg, kind: e.detail.kind || 'info' };
      setItems(prev => [...prev, next]);
      setTimeout(() => setItems(prev => prev.filter(t => t.id !== id)), next.kind === 'err' ? 6000 : 3500);
    };
    window.addEventListener('eit:toast', fn);
    return () => window.removeEventListener('eit:toast', fn);
  }, []);
  if (items.length === 0) return null;
  return (
    <div className="toast-host">
      {items.map(t => (
        <div key={t.id} className={`toast-item ${t.kind}`}>
          {t.msg}
        </div>
      ))}
    </div>
  );
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
function AttachmentStrip({ itemId, eventItemId, adminName, isAdmin }) {
  const [atts, setAtts]       = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const [uploading, setUp]    = useState(false);
  const [err, setErr]         = useState('');

  const filter = eventItemId
    ? q => q.eq('event_item_id', eventItemId)
    : q => q.eq('item_id', itemId).is('event_item_id', null);

  useEffect(() => {
    filter(sb.from('attachments').select('*')).order('uploaded_at')
      .then(({ data }) => setAtts(data || []));
  }, [itemId, eventItemId]);

  async function upload(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setErr(''); setUp(true);
    for (const f of files) {
      const ext  = f.name.split('.').pop().toLowerCase();
      const path = `${itemId}/${eventItemId||'master'}/${Date.now()}.${ext}`;
      const { error: upErr } = await sb.storage.from('attachments').upload(path, f, { contentType: f.type });
      if (upErr) { setErr(friendlyError(upErr)); continue; }
      const { data: { publicUrl } } = sb.storage.from('attachments').getPublicUrl(path);
      const row = { item_id: itemId, storage_path: path, original_name: f.name,
        mime_type: f.type, size: f.size, url: publicUrl,
        uploaded_by: adminName, uploaded_at: new Date().toISOString() };
      if (eventItemId) row.event_item_id = eventItemId;
      const { data: att } = await sb.from('attachments').insert(row).select().single();
      if (att) setAtts(prev => [...(prev||[]), att]);
    }
    setUp(false); e.target.value = '';
  }

  async function remove(att) {
    if (!await confirm({ title: 'Remove photo?', body: `Remove "${att.original_name}"?`, danger: true, confirmLabel: 'Remove' })) return;
    await sb.storage.from('attachments').remove([att.storage_path]);
    await sb.from('attachments').delete().eq('id', att.id);
    setAtts(prev => prev.filter(a => a.id !== att.id));
  }

  if (atts === null) return <div className="att-loading">Loading…</div>;
  return (
    <div className="att-strip">
      {atts.length > 0 && (
        <div className="att-thumbs">
          {atts.map(att => (
            <div className="att-thumb" key={att.id}>
              <div className="att-img-wrap" onClick={() => setLightbox(att)}>
                {isVideo(att.mime_type)
                  ? <div className="att-video-placeholder">▶</div>
                  : <img src={att.url} alt={att.original_name} />}
              </div>
              {isAdmin && <button className="att-remove" onClick={() => remove(att)}>✕</button>}
            </div>
          ))}
        </div>
      )}
      {isAdmin && (
        <label className={`btn sm att-upload-btn ${uploading?'disabled':''}`}>
          {uploading ? 'Uploading…' : (atts.length ? '+ More photos' : '📷 Add photo')}
          <input type="file" accept="image/*,video/mp4,video/quicktime" multiple capture="environment"
            onChange={upload} disabled={uploading} style={{display:'none'}} />
        </label>
      )}
      {err && <div className="err" style={{marginTop:4}}>{err}</div>}
      {lightbox && <Lightbox att={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

// ---------- history list ----------
function HistoryList({ itemId, eventItemId }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    const q = eventItemId
      ? sb.from('history').select('*').eq('event_item_id', eventItemId)
      : sb.from('history').select('*').eq('item_id', itemId);
    q.order('changed_at', { ascending: false }).then(({ data }) => setRows(data || []));
  }, [itemId, eventItemId]);

  if (rows === null) return <div style={{color:'#888',fontSize:13}}>Loading…</div>;
  if (!rows.length)  return <div style={{color:'#888',fontSize:13}}>No history yet.</div>;
  return (
    <div className="history">
      {rows.map(ev => (
        <div className="event" key={ev.id}>
          <div className="head"><span className="who">{ev.changed_by}</span><span>{fmtTime(ev.changed_at)}</span></div>
          <div className="action">{actionLabel(ev.action)}</div>
          <div className="changes">
            {ev.changes && Object.keys(ev.changes).length > 0 && (
              typeof ev.changes === 'object' && ev.changes.note
                ? <span>{ev.changes.note}</span>
                : Object.entries(ev.changes).map(([k, v]) =>
                  typeof v === 'object' && v.from !== undefined ? (
                    <span className="chg" key={k}>
                      <span className="k">{k}:</span>{' '}
                      <span className="from">{k==='condition'?(CLABEL[v.from]||v.from):(v.from||'—')}</span>
                      <span className="arrow">→</span>
                      <span className="to">{k==='condition'?(CLABEL[v.to]||v.to):(v.to||'—')}</span>
                    </span>
                  ) : (
                    <span className="chg" key={k}><span className="k">{k}:</span> {String(v)}</span>
                  )
                )
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- scan landing ----------
// Direct deep-link cold-load: when someone scans a QR sticker the very first
// thing they see is a focused, clean card — no tabs, no list, no flicker.
function ScanLanding({ kind, id, onDismiss }) {
  const [item, setItem]   = useState(null);
  const [event, setEvent] = useState(null);
  const [eis, setEis]     = useState([]);   // event_items if kind === 'event'
  const [outAt, setOutAt] = useState(null); // event the item is currently out at
  const [err, setErr]     = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (kind === 'item') {
          const { data, error } = await sb.from('items').select('*').eq('id', id).maybeSingle();
          if (cancelled) return;
          if (error) throw error;
          if (!data) { setErr('Item not found.'); setLoading(false); return; }
          setItem(data);
          // is this item currently out somewhere?
          const { data: o } = await sb.from('event_items')
            .select('current_location, status, events(id, name, event_date)')
            .eq('item_id', id).eq('status', 'out').limit(1);
          if (!cancelled && o && o.length) setOutAt(o[0]);
        } else {
          const { data, error } = await sb.from('events').select('*').eq('id', id).maybeSingle();
          if (cancelled) return;
          if (error) throw error;
          if (!data) { setErr('Deployment not found.'); setLoading(false); return; }
          setEvent(data);
          const { data: ei } = await sb.from('event_items')
            .select('*, items(id, name, category, condition, storage_location)')
            .eq('event_id', id).order('assigned_at');
          if (!cancelled) setEis(ei || []);
        }
      } catch (e) {
        if (!cancelled) setErr(friendlyError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [kind, id]);

  return (
    <div className="scan-landing">
      <div className="scan-landing-bar">
        <span className="brand">SQUATWOLF</span>
        <span className="spacer" />
      </div>

      <div className="scan-landing-body">
        {loading && <div className="empty">Loading…</div>}
        {err && !loading && (
          <div className="scan-error">
            <h2>Couldn't find that</h2>
            <div className="scan-error-sub">{err}</div>
            <button className="btn primary" onClick={onDismiss}>Open inventory</button>
          </div>
        )}

        {!loading && !err && kind === 'item' && item && (
          <div className="scan-card">
            <div className="scan-card-head">
              <div style={{flex:1, minWidth:0}}>
                <div className="scan-card-kicker">Scanned item</div>
                <h1 className="scan-card-title">{item.name}</h1>
                <div className="scan-card-sub">{item.category||'—'} · Stored at: {item.storage_location||'—'}</div>
              </div>
              <span className={`badge ${item.condition}`}>{CLABEL[item.condition]||item.condition}</span>
            </div>

            <div className="scan-card-status">
              {item.condition === 'retired' ? (
                <div className="scan-card-line muted">This item is retired and out of service.</div>
              ) : outAt ? (
                <>
                  <div className="scan-card-line"><span className="k">Status</span><span className="v out">Out at deployment</span></div>
                  <div className="scan-card-line"><span className="k">Deployment</span><span className="v">{outAt.events?.name || '—'}</span></div>
                  <div className="scan-card-line"><span className="k">At</span><span className="v">{outAt.current_location || '—'}</span></div>
                </>
              ) : (
                <div className="scan-card-line"><span className="k">Status</span><span className="v stored">Stored — not on a deployment</span></div>
              )}
              {item.notes && <div className="scan-card-line"><span className="k">Notes</span><span className="v">{item.notes}</span></div>}
            </div>

            <AttachmentStrip itemId={item.id} adminName={null} isAdmin={false} />

            <div className="actions" style={{marginTop:18,justifyContent:'space-between'}}>
              <LoginPrompt verb="edit" />
              <button className="btn primary" onClick={onDismiss}>Open in app</button>
            </div>
          </div>
        )}

        {!loading && !err && kind === 'event' && event && (
          <div className="scan-card">
            <div className="scan-card-head">
              <div style={{flex:1, minWidth:0}}>
                <div className="scan-card-kicker">Deployment</div>
                <h1 className="scan-card-title">{event.name}</h1>
                <div className="scan-card-sub">
                  {fmtDate(event.event_date)}{event.location ? ' · ' + event.location : ''}
                </div>
              </div>
            </div>

            <div className="scan-card-status">
              <div className="scan-card-line"><span className="k">Total</span><span className="v">{eis.length}</span></div>
              <div className="scan-card-line"><span className="k">Out</span><span className="v out">{eis.filter(e=>e.status==='out').length}</span></div>
              <div className="scan-card-line"><span className="k">Returned</span><span className="v stored">{eis.filter(e=>e.status==='returned').length}</span></div>
            </div>

            <div className="section-label">Items</div>
            {eis.length === 0
              ? <div className="empty">No items assigned to this deployment.</div>
              : <div className="scan-item-list">
                  {eis.slice(0, 25).map(ei => (
                    <div key={ei.id} className="scan-item-row">
                      <div style={{flex:1, minWidth:0}}>
                        <div className="scan-item-name">{ei.items?.name || '—'}</div>
                        <div className="scan-item-sub">{ei.current_location || '—'}</div>
                      </div>
                      <span className={`badge ${ei.status==='returned'?'status-returned':'status-out'}`}>
                        {ei.status==='returned'?'Returned':'Out'}
                      </span>
                    </div>
                  ))}
                  {eis.length > 25 && (
                    <div className="scan-item-sub" style={{padding:'6px 12px'}}>+ {eis.length - 25} more — open in app to see all</div>
                  )}
                </div>
            }

            <div className="actions" style={{marginTop:18,justifyContent:'space-between'}}>
              <LoginPrompt verb="manage" />
              <button className="btn primary" onClick={onDismiss}>Open in app</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- inline "log in to edit" prompt ----------
// Surfaces a low-key call to action wherever admin actions are hidden,
// so guests aren't left silently wondering why nothing's clickable.
// Dispatches a custom event the App listens for, so we don't have to
// prop-drill setLoginOpen through every nested component.
function requestLogin() {
  window.dispatchEvent(new Event('eit:request-login'));
}
// Context-aware: if the user is signed in but lacks write access (viewer or
// pending), tell them to ask a master rather than "log in".
function LoginPrompt({ verb = 'edit' }) {
  const [session, setSession] = useState(() => {
    try { return JSON.parse(localStorage.getItem('eit:session')) || null; } catch { return null; }
  });
  useEffect(() => {
    const fn = () => {
      try { setSession(JSON.parse(localStorage.getItem('eit:session')) || null); } catch { setSession(null); }
    };
    window.addEventListener('storage', fn);
    return () => window.removeEventListener('storage', fn);
  }, []);
  const isSignedIn = !!session;
  const isAdminLike = session?.role === 'admin' || session?.role === 'master';
  if (isAdminLike) return null;  // shouldn't render — admins see real buttons
  if (isSignedIn) {
    return (
      <span className="login-prompt no-action" title="Edit access is granted by a master admin">
        <span className="login-prompt-dot">●</span> Ask a master for edit access
      </span>
    );
  }
  return (
    <button type="button" className="login-prompt" onClick={requestLogin}>
      <span className="login-prompt-dot">●</span> Log in to {verb}
    </button>
  );
}

// ---------- QR scanner modal ----------
// Two modes:
//   single (default) — scan once, fire onScan, close.
//   continuous       — stay open after each scan; parent shows running counter,
//                      last-scan toast with Undo, and explicit "Done" to close.
//
// Always also supports a manual-code entry fallback for cameras that don't work.
function playBeep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    o.type = 'sine';
    g.gain.value = 0.06;
    o.connect(g); g.connect(ctx.destination);
    o.start();
    setTimeout(() => { o.stop(); ctx.close(); }, 90);
  } catch { /* silent */ }
  try { navigator.vibrate?.(35); } catch { /* silent */ }
}

function ScannerModal({ onClose, onScan, title, mode = 'single', counter, lastScan, onUndoLast }) {
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef    = useRef(null);
  const lockRef   = useRef(false);
  const [err, setErr]         = useState('');
  const [flash, setFlash]     = useState(false);
  const [manualOpen, setMan]  = useState(false);
  const [manualVal, setManVal]= useState('');

  useEffect(() => {
    let cancelled = false;
    async function start() {
      if (!window.jsQR) { setErr('Scanner library not loaded — refresh the page.'); return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream;
        v.setAttribute('playsinline', 'true');
        await v.play().catch(() => {});
        const c = canvasRef.current;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        const tick = () => {
          if (cancelled) return;
          if (!lockRef.current && v.readyState === 4 && v.videoWidth) {
            c.width  = v.videoWidth;
            c.height = v.videoHeight;
            ctx.drawImage(v, 0, 0, c.width, c.height);
            const img = ctx.getImageData(0, 0, c.width, c.height);
            const code = window.jsQR(img.data, c.width, c.height, { inversionAttempts: 'dontInvert' });
            if (code && code.data) {
              const id = parseScanned(code.data);
              if (id) {
                lockRef.current = true;
                playBeep();
                setFlash(true);
                setTimeout(() => setFlash(false), 220);
                Promise.resolve(onScan(id)).finally(() => {
                  if (mode === 'continuous') {
                    // 700ms cooldown so we don't re-scan the same code that's
                    // still in frame
                    setTimeout(() => { lockRef.current = false; }, 700);
                  }
                });
                if (mode === 'single') return;
              }
            }
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch (e) {
        setErr(e.name === 'NotAllowedError'
          ? 'Camera permission denied. Allow camera access in your browser, or use Type code below.'
          : 'Camera unavailable: ' + (e.message || e.name));
      }
    }
    start();
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  function submitManual(e) {
    e.preventDefault();
    const id = parseScanned(manualVal);
    if (!id) { setErr('Not a valid code.'); return; }
    setErr('');
    setManVal('');
    playBeep();
    setFlash(true);
    setTimeout(() => setFlash(false), 220);
    Promise.resolve(onScan(id)).finally(() => {
      if (mode === 'single') onClose();
    });
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal scanner-modal" onClick={e => e.stopPropagation()}>
        <h2 style={{margin:0,marginBottom:12,display:'flex',alignItems:'center',gap:10}}>
          <span style={{flex:1}}>{title || 'Scan QR'}</span>
          {mode === 'continuous' && counter != null && (
            <span className="scanner-counter">{counter}</span>
          )}
        </h2>
        <div className={`scanner-frame${flash ? ' flash' : ''}`}>
          <video ref={videoRef} muted playsInline />
          <canvas ref={canvasRef} style={{display:'none'}} />
          <div className="scanner-reticle" />
        </div>

        {lastScan && mode === 'continuous' && (
          <div className={`scanner-toast ${lastScan.kind || 'ok'}`}>
            <span style={{flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
              {lastScan.label}
            </span>
            {onUndoLast && lastScan.canUndo && (
              <button type="button" className="scanner-undo" onClick={onUndoLast}>Undo</button>
            )}
          </div>
        )}

        {err
          ? <div className="err" style={{marginTop:10}}>{err}</div>
          : <div style={{fontFamily:"'Azeret Mono',monospace",fontSize:11,color:'#7A7A7A',marginTop:10,letterSpacing:'0.04em',textTransform:'uppercase'}}>
              {mode === 'continuous' ? 'Keep scanning — modal stays open' : 'Point camera at item label'}
            </div>
        }

        {!manualOpen && (
          <div style={{marginTop:8}}>
            <button type="button" className="link-btn" onClick={()=>setMan(true)}>Type code manually instead</button>
          </div>
        )}
        {manualOpen && (
          <form onSubmit={submitManual} style={{marginTop:10,display:'flex',gap:6}}>
            <input value={manualVal} onChange={e=>setManVal(e.target.value)}
              placeholder="Paste code or full URL"
              style={{flex:1,background:'#1a1a1a',border:'1px solid #2a2a2a',color:'#FAFAFA',padding:'10px 12px',fontFamily:"'Azeret Mono',monospace",fontSize:12}}
              autoFocus />
            <button type="submit" className="btn primary sm">Submit</button>
          </form>
        )}

        <div className="actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            {mode === 'continuous' ? 'Done' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Stocktake flow ----------
// Two-phase: scan continuously, accumulate verified item ids in a session set,
// then "Done" → review modal showing what's missing vs. expected. No DB writes
// while scanning; the session set is ephemeral. The review screen filters by
// storage location so staff can do one room at a time.
function StocktakeFlow({ onClose }) {
  const [phase,    setPhase]    = useState('scanning');
  const [items,    setItems]    = useState([]);
  const [verified, setVerified] = useState(() => new Set());
  const [unknown,  setUnknown]  = useState([]);  // codes that didn't match an item
  const [lastScan, setLastScan] = useState(null);
  const thumbs = useItemThumbs();

  useEffect(() => {
    sb.from('items').select('*').neq('condition', 'retired').order('name')
      .then(({ data }) => setItems(data || []));
  }, []);

  function handleScan(id) {
    if (verified.has(id)) {
      setLastScan({ kind: 'info', label: 'Already verified', at: Date.now() });
      return;
    }
    const item = items.find(it => it.id === id);
    if (!item) {
      setUnknown(u => u.includes(id) ? u : [...u, id]);
      setLastScan({ kind: 'err', label: 'Unknown code — not in inventory', at: Date.now() });
      return;
    }
    setVerified(v => { const n = new Set(v); n.add(id); return n; });
    setLastScan({ kind: 'ok', label: `Verified: ${item.name}`, at: Date.now() });
  }

  function handleDone() {
    if (verified.size === 0 && unknown.length === 0) { onClose(); return; }
    setPhase('review');
  }

  if (phase === 'scanning') {
    return (
      <ScannerModal title="Stocktake"
        mode="continuous"
        counter={verified.size}
        lastScan={lastScan}
        onClose={handleDone}
        onScan={handleScan} />
    );
  }
  return <StocktakeReview items={items} verified={verified} unknown={unknown}
    thumbs={thumbs}
    onResume={() => setPhase('scanning')}
    onClose={onClose} />;
}

function StocktakeReview({ items, verified, unknown, thumbs, onResume, onClose }) {
  const [locFilter, setLocFilter] = useState('all');
  const locations = ['all', ...Array.from(new Set(items.map(it => it.storage_location || 'No storage set'))).sort()];
  const inScope = locFilter === 'all'
    ? items
    : items.filter(it => (it.storage_location || 'No storage set') === locFilter);
  const missing  = inScope.filter(it => !verified.has(it.id));
  const verifiedItems = inScope.filter(it =>  verified.has(it.id));

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal stocktake-review" onClick={e => e.stopPropagation()}>
        <h2 style={{margin:0,marginBottom:6}}>Stocktake summary</h2>
        <div className="stocktake-stats">
          <div className="stocktake-stat">
            <div className="stocktake-stat-value" style={{color:'var(--accent-good)'}}>{verifiedItems.length}</div>
            <div className="stocktake-stat-label">Verified</div>
          </div>
          <div className="stocktake-stat">
            <div className="stocktake-stat-value" style={{color: missing.length > 0 ? 'var(--accent-bad)' : 'var(--text-mute)'}}>{missing.length}</div>
            <div className="stocktake-stat-label">Missing</div>
          </div>
          <div className="stocktake-stat">
            <div className="stocktake-stat-value" style={{color: unknown.length > 0 ? 'var(--accent-warn)' : 'var(--text-mute)'}}>{unknown.length}</div>
            <div className="stocktake-stat-label">Unknown scans</div>
          </div>
        </div>

        <div style={{display:'flex',gap:8,marginTop:14,marginBottom:10,alignItems:'center'}}>
          <span style={{fontSize:11,color:'#7A7A7A',letterSpacing:'0.04em',textTransform:'uppercase'}}>Filter by location</span>
          <select className="filter" value={locFilter} onChange={e=>setLocFilter(e.target.value)}>
            {locations.map(loc => (
              <option key={loc} value={loc}>{loc === 'all' ? 'All locations' : loc}</option>
            ))}
          </select>
        </div>

        <div className="stocktake-list-head">Missing ({missing.length})</div>
        {missing.length === 0 ? (
          <div className="dash-empty allclear">ALL ACCOUNTED FOR</div>
        ) : (
          <div className="dash-list" style={{maxHeight:240,overflowY:'auto'}}>
            {missing.map(it => (
              <div className="dash-row dash-row-attention" key={it.id}>
                <ItemThumb url={thumbs[it.id]} name={it.name} category={it.category} />
                <div style={{flex:1,minWidth:0}}>
                  <div className="dash-row-name">{it.name}</div>
                  <div className="dash-row-sub">{it.category||'—'} · {it.storage_location||'No storage set'}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {verifiedItems.length > 0 && (
          <details style={{marginTop:14}}>
            <summary style={{cursor:'pointer',fontSize:12,color:'#9a9a9a',letterSpacing:'0.04em',textTransform:'uppercase'}}>
              Verified ({verifiedItems.length})
            </summary>
            <div className="dash-list" style={{marginTop:8,maxHeight:200,overflowY:'auto'}}>
              {verifiedItems.map(it => (
                <div className="dash-row" key={it.id}>
                  <ItemThumb url={thumbs[it.id]} name={it.name} category={it.category} />
                  <div style={{flex:1,minWidth:0}}>
                    <div className="dash-row-name">{it.name}</div>
                    <div className="dash-row-sub">{it.category||'—'} · {it.storage_location||'No storage set'}</div>
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}

        <div className="actions" style={{marginTop:16}}>
          <button className="btn ghost" onClick={onResume}>Keep scanning</button>
          <button className="btn primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ---------- CSV import modal ----------
function CsvImportModal({ admin, existingItems, onClose, onImported }) {
  const [text, setText]         = useState('');
  const [parsed, setParsed]     = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [err, setErr]           = useState('');

  const { safeClose } = useUnloadGuard(saving, onClose);

  const VALID_COND = new Set(['good','needs_cleaning','needs_repair','damaged','retired']);
  const existingNames = new Map(); // lowercased name → existing item
  existingItems.forEach((it) => existingNames.set(it.name.trim().toLowerCase(), it));

  function loadFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => setText(String(r.result || ''));
    r.readAsText(f);
  }

  function preview() {
    setErr('');
    if (!text.trim()) { setErr('Paste or upload a CSV first.'); return; }
    let rows;
    try { rows = parseCsv(text); }
    catch (e) { setErr('Could not parse CSV: ' + e.message); return; }
    if (rows.length < 2) { setErr('CSV needs a header row and at least one data row.'); return; }

    const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
    const required = ['name'];
    for (const r of required) {
      if (!headers.includes(r)) { setErr(`Missing required column: ${r}`); return; }
    }

    const colIdx = (name) => headers.indexOf(name);
    const idx = {
      name:             colIdx('name'),
      category:         colIdx('category'),
      storage_location: colIdx('storage_location') >= 0 ? colIdx('storage_location') : colIdx('storage'),
      condition:        colIdx('condition'),
      notes:            colIdx('notes'),
    };

    const mappedRows = rows.slice(1).map((cells) => {
      const get = (i) => i >= 0 ? (cells[i] || '').trim() : '';
      const name = get(idx.name);

      let category = get(idx.category);
      if (category && !CATEGORIES.includes(category)) {
        const found = CATEGORIES.find((c) => c.toLowerCase() === category.toLowerCase());
        category = found || 'Other';
      } else if (!category) category = 'Other';

      let condition = (get(idx.condition) || 'good').toLowerCase().replace(/\s+/g, '_').replace('-', '_');
      if (!VALID_COND.has(condition)) condition = 'good';

      const mapped = {
        name,
        category,
        storage_location: get(idx.storage_location),
        condition,
        notes: get(idx.notes),
      };

      let status = 'add', reason = '';
      if (!name)                                            { status = 'skip'; reason = 'Missing name'; }
      else if (existingNames.has(name.toLowerCase()))       { status = 'skip'; reason = 'Already exists'; }

      return { raw: cells, mapped, status, reason };
    });

    setParsed({ headers, rows: mappedRows });
  }

  async function performImport() {
    if (!parsed) return;
    const toAdd = parsed.rows.filter((r) => r.status === 'add');
    setSaving(true); setErr('');
    setProgress({ done: 0, total: toAdd.length });
    try {
      const now = new Date().toISOString();
      // chunk for safety on large imports
      const CHUNK = 50;
      let done = 0;
      for (let i = 0; i < toAdd.length; i += CHUNK) {
        const slice = toAdd.slice(i, i + CHUNK);
        const payload = slice.map((r) => ({
          ...r.mapped,
          created_at: now, updated_at: now, updated_by: admin.name,
        }));
        const { data, error } = await sb.from('items').insert(payload).select('id, name, storage_location');
        if (error) throw error;
        // history per row
        if (data && data.length) {
          await sb.from('history').insert(data.map((it) => ({
            item_id: it.id, action: 'item_created',
            changes: { note: `Imported via CSV. Stored at: ${it.storage_location||'—'}` },
            changed_by: admin.name, changed_at: now,
          })));
        }
        done += slice.length;
        setProgress({ done, total: toAdd.length });
      }
      onImported(); onClose();
    } catch (e) {
      setErr(friendlyError(e));
      setSaving(false);
    }
  }

  const addCount  = parsed?.rows.filter((r) => r.status === 'add').length || 0;
  const skipCount = parsed?.rows.filter((r) => r.status === 'skip').length || 0;

  return (
    <div className="backdrop" onClick={safeClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{maxWidth:760}}>
        <h2>Import items from CSV</h2>

        {!parsed && (
          <>
            <div style={{fontFamily:"'Azeret Mono',monospace",fontSize:11,color:'#7A7A7A',marginBottom:10,letterSpacing:'0.04em'}}>
              Required column: <strong style={{color:'#FAFAFA'}}>name</strong>. Optional: category, storage_location, condition, notes.
              Existing items (matched by name) are skipped — import only adds new rows.
            </div>
            <div className="field">
              <label>Upload CSV file</label>
              <input type="file" accept=".csv,text/csv,text/plain" onChange={loadFile} />
            </div>
            <div className="field">
              <label>…or paste CSV here</label>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8}
                placeholder={'name,category,storage_location,condition,notes\nAudio mixer,Audio,Warehouse — Shelf A1,good,Channel 16'} />
            </div>
            {err && <div className="err">{err}</div>}
            <div className="actions">
              <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
              <button type="button" className="btn primary" onClick={preview} disabled={!text.trim()}>Preview</button>
            </div>
          </>
        )}

        {parsed && (
          <>
            <div style={{fontFamily:"'Azeret Mono',monospace",fontSize:12,color:'#7A7A7A',marginBottom:10,letterSpacing:'0.04em',textTransform:'uppercase'}}>
              <span style={{color:'#5fcf7e'}}>{addCount} to add</span>
              {skipCount > 0 && <> · <span style={{color:'#d48a34'}}>{skipCount} skipped</span></>}
            </div>
            <div style={{maxHeight:340, overflowY:'auto', border:'1px solid #2a2a2a'}}>
              <table className="csv-preview">
                <thead>
                  <tr>
                    <th style={{width:'8%'}}>Status</th>
                    <th>Name</th>
                    <th>Category</th>
                    <th>Storage</th>
                    <th>Condition</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.map((r, i) => (
                    <tr key={i} className={r.status === 'skip' ? 'skip' : 'add'}>
                      <td>{r.status === 'add' ? 'Add' : 'Skip'}</td>
                      <td>{r.mapped.name || <em style={{color:'#888'}}>—</em>}</td>
                      <td>{r.mapped.category}</td>
                      <td>{r.mapped.storage_location || ''}</td>
                      <td>{CLABEL[r.mapped.condition]||r.mapped.condition}</td>
                      <td style={{color:'#d48a34'}}>{r.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {saving && (
              <div style={{marginTop:10,fontFamily:"'Azeret Mono',monospace",fontSize:12,color:'#d48a34'}}>
                Importing {progress.done}/{progress.total}…
              </div>
            )}
            {err && <div className="err" style={{marginTop:8}}>{err}</div>}

            <div className="actions">
              <button type="button" className="btn ghost" onClick={() => { setParsed(null); setErr(''); }} disabled={saving}>Back</button>
              <button type="button" className="btn primary" disabled={!addCount || saving}
                onClick={() => setConfirming(true)}>
                {saving ? 'Importing…' : `Import ${addCount} item${addCount===1?'':'s'}`}
              </button>
            </div>

            {confirming && (
              <div className="backdrop" onClick={() => !saving && setConfirming(false)} style={{zIndex:20}}>
                <div className="modal" onClick={(e) => e.stopPropagation()} style={{maxWidth:380}}>
                  <h2>Are you sure?</h2>
                  <div style={{fontFamily:"'Manrope',sans-serif",fontSize:14,color:'#EFEFEF',marginBottom:14}}>
                    Add <strong>{addCount}</strong> item{addCount===1?'':'s'} to the master inventory?
                    {skipCount > 0 && <><br /><span style={{color:'#7A7A7A',fontFamily:"'Azeret Mono',monospace",fontSize:12}}>{skipCount} row{skipCount===1?'':'s'} will be skipped.</span></>}
                  </div>
                  <div className="actions">
                    <button type="button" className="btn ghost" onClick={() => setConfirming(false)} disabled={saving}>Cancel</button>
                    <button type="button" className="btn primary" disabled={saving}
                      onClick={() => { setConfirming(false); performImport(); }}>
                      {saving ? 'Importing…' : 'Yes, import'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------- printable label sheet ----------
function LabelSheet({ items, onClose }) {
  const sheetRef = useRef(null);
  function doPrint() {
    window.print();
  }
  return (
    <div className="backdrop label-backdrop" onClick={onClose}>
      <div className="modal label-modal" onClick={e => e.stopPropagation()}>
        <h2>Print labels</h2>
        <div style={{fontFamily:"'Azeret Mono',monospace",fontSize:11,color:'#7A7A7A',marginBottom:12,letterSpacing:'0.04em',textTransform:'uppercase'}}>
          {items.length} label{items.length===1?'':'s'} · use browser print → save as PDF or send to a label printer
        </div>
        <div className="label-sheet" ref={sheetRef}>
          {items.map(it => (
            <div className="label" key={it.id}>
              <div className="label-qr"
                dangerouslySetInnerHTML={{ __html: qrSvgString(itemUrl(it.id)) }} />
              <div className="label-meta">
                <div className="label-name">{it.name}</div>
                <div className="label-sub">{it.category||'—'}</div>
                <div className="label-id">{String(it.id).slice(0,8)}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="actions no-print">
          <button type="button" className="btn ghost" onClick={onClose}>Close</button>
          <button type="button" className="btn primary" onClick={doPrint}>Print</button>
        </div>
      </div>
    </div>
  );
}

// ---------- admin login / request access ----------
function AdminLoginModal({ onLogin, onClose }) {
  const [mode, setMode] = useState('signin'); // 'signin' | 'request' | 'sent'
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [name, setName]         = useState('');
  const [err, setErr]           = useState('');
  const [info, setInfo]         = useState('');
  const [loading, setLoading]   = useState(false);
  const [sentEmail, setSentEmail] = useState('');

  async function signIn(e) {
    e.preventDefault(); setErr(''); setInfo(''); setLoading(true);
    const { data, error } = await sb.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) {
      setErr(error.message === 'Invalid login credentials'
        ? 'Email or password is incorrect.'
        : friendlyError(error));
      setLoading(false);
      return;
    }
    // Resolve role from admin_users; if not present, this is a pending account.
    const { data: row } = await sb.from('admin_users').select('*').eq('user_id', data.user.id).maybeSingle();
    onLogin({
      id:    data.user.id,
      email: data.user.email,
      name:  row?.name || data.user.user_metadata?.name || data.user.email,
      role:  row?.role || null,           // null = signed in but pending approval
    });
  }

  async function requestAccess(e) {
    e.preventDefault(); setErr(''); setInfo(''); setLoading(true);
    const trimmedEmail = email.trim().toLowerCase();
    if (!name.trim()) { setErr('Please enter your name.'); setLoading(false); return; }
    if (!trimmedEmail.endsWith('@squatwolf.com')) {
      setErr('Sign-up is restricted to @squatwolf.com email addresses.');
      setLoading(false); return;
    }
    if (password.length < 8) { setErr('Password must be at least 8 characters.'); setLoading(false); return; }
    const { data, error } = await sb.auth.signUp({
      email: trimmedEmail,
      password,
      options: { data: { name: name.trim() } },
    });
    if (error) { setErr(friendlyError(error)); setLoading(false); return; }
    // If email confirmation is required, session is null until they confirm.
    if (!data.session) {
      setSentEmail(trimmedEmail);
      setMode('sent');
      setLoading(false);
      return;
    }
    // Otherwise they're signed in immediately; trigger has queued an admin_requests row.
    const { data: row } = await sb.from('admin_users').select('*').eq('user_id', data.user.id).maybeSingle();
    onLogin({
      id:    data.user.id,
      email: data.user.email,
      name:  row?.name || name.trim(),
      role:  row?.role || null,
    });
  }

  async function resetPassword() {
    setErr(''); setInfo('');
    if (!email.trim()) { setErr('Enter your email first.'); return; }
    const { error } = await sb.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: location.origin + location.pathname,
    });
    if (error) { setErr(friendlyError(error)); return; }
    setInfo('Password reset email sent. Check your inbox.');
  }

  // Inline @squatwolf.com domain validation for the Sign-up tab (3.6).
  // Empty field = no warning; once they've typed an @ we evaluate.
  const emailLooksWrong = mode === 'request'
    && email.includes('@')
    && !email.trim().toLowerCase().endsWith('@squatwolf.com');
  const submitDisabled = loading || (mode === 'request' && (!email.trim() || !email.trim().toLowerCase().endsWith('@squatwolf.com') || !name.trim() || password.length < 8));

  if (mode === 'sent') {
    return (
      <div className="backdrop" onClick={onClose}>
        <div className="modal" style={{maxWidth:400}} onClick={e=>e.stopPropagation()}>
          <h2>Check your email</h2>
          <div style={{fontFamily:"'Manrope',sans-serif",fontSize:14,color:'#EFEFEF',lineHeight:1.5,marginBottom:14}}>
            We sent a confirmation link to <strong>{sentEmail}</strong>. Click it to activate your account, then come back and sign in.
          </div>
          <div style={{fontFamily:"'Azeret Mono',monospace",fontSize:11,color:'#7A7A7A',marginBottom:18,letterSpacing:'0.04em'}}>
            Can't find it? Check your spam folder.
          </div>
          <div className="actions">
            <button type="button" className="btn ghost" onClick={onClose}>Close</button>
            <button type="button" className="btn primary" onClick={()=>{setMode('signin'); setErr(''); setInfo(''); setPassword('');}}>
              Back to sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <form className="modal" style={{maxWidth:380}} onClick={e=>e.stopPropagation()}
        onSubmit={mode === 'signin' ? signIn : requestAccess}>
        <h2>{mode === 'signin' ? 'Sign in' : 'Sign up'}</h2>

        <div className="auth-tabs">
          <button type="button" className={mode==='signin' ? 'active' : ''} onClick={()=>{setMode('signin'); setErr(''); setInfo('');}}>
            Sign in
          </button>
          <button type="button" className={mode==='request' ? 'active' : ''} onClick={()=>{setMode('request'); setErr(''); setInfo('');}}>
            Sign up
          </button>
        </div>

        {mode === 'request' && (
          <div className="field"><label>Your name</label>
            <input value={name} onChange={e=>setName(e.target.value)}
              placeholder="e.g. Alex Martins" autoFocus autoComplete="name" />
          </div>
        )}
        <div className="field">
          <label>Work email</label>
          <input type="email" value={email} onChange={e=>setEmail(e.target.value)}
            autoFocus={mode==='signin'} autoComplete="email"
            placeholder="you@squatwolf.com" required
            className={emailLooksWrong ? 'input-warn' : ''} />
          {emailLooksWrong && (
            <div style={{fontFamily:"'Azeret Mono',monospace",fontSize:11,color:'#d48a34',marginTop:4,letterSpacing:'0.04em'}}>
              ⚠ Must be a @squatwolf.com address
            </div>
          )}
        </div>
        <div className="field">
          <label>Password{mode==='request' ? ' (min 8 chars)' : ''}</label>
          <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
            autoComplete={mode==='signin' ? 'current-password' : 'new-password'}
            placeholder={mode==='signin' ? 'Your password' : 'Create a password'} required />
        </div>

        {info && <div className="ok">{info}</div>}
        {err  && <div className="err">{err}</div>}

        <div className="actions" style={{justifyContent:'space-between'}}>
          {mode === 'signin'
            ? <button type="button" className="link-btn" onClick={resetPassword}>Forgot password?</button>
            : <span />}
          <div style={{display:'flex',gap:8}}>
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn primary" disabled={submitDisabled}>
              {loading ? '…' : (mode==='signin' ? 'Sign in' : 'Sign up')}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

// ---------- item form (master list) ----------
function ItemFormModal({ initial, admin, onClose, onSaved }) {
  const [name, setName]                   = useState(initial?.name || '');
  const [category, setCategory]           = useState(initial?.category || 'Equipment');
  const [storageLocation, setStorage]     = useState(initial?.storage_location || '');
  const [condition, setCondition]         = useState(initial?.condition || 'good');
  const [notes, setNotes]                 = useState(initial?.notes || '');
  const [err, setErr]                     = useState('');
  const [saving, setSaving]               = useState(false);
  const isEdit = !!initial?.id;

  async function save(e) {
    e.preventDefault();
    if (!name.trim()) return setErr('Name required');
    setSaving(true); setErr('');
    const now = new Date().toISOString();
    const payload = { name: name.trim(), category, storage_location: storageLocation.trim(),
      condition, notes: notes.trim(), updated_at: now, updated_by: admin.name };
    try {
      if (isEdit) {
        const changes = diffObj(initial, payload, ['name','category','storage_location','condition','notes']);
        const { data, error } = await sb.from('items').update(payload).eq('id', initial.id).select().single();
        if (error) throw error;
        if (Object.keys(changes).length)
          await sb.from('history').insert({ item_id: initial.id, action: 'item_updated',
            changes, changed_by: admin.name, changed_at: now });
        onSaved(data);
      } else {
        const { data, error } = await sb.from('items').insert({ ...payload, created_at: now }).select().single();
        if (error) throw error;
        await sb.from('history').insert({ item_id: data.id, action: 'item_created',
          changes: { note: `Added to master inventory. Stored at: ${storageLocation||'—'}` },
          changed_by: admin.name, changed_at: now });
        onSaved(data);
      }
      onClose();
    } catch(e) { setErr(friendlyError(e)); setSaving(false); }
  }

  async function del() {
    if (!await confirm({ title: 'Delete this item?', body: `Delete "${initial.name}" from master inventory? This cannot be undone.`, danger: true, confirmLabel: 'Delete' })) return;
    await sb.from('items').delete().eq('id', initial.id);
    onSaved(null); onClose();
  }

  async function setConditionAndLog(newCond, action, noteText) {
    setSaving(true); setErr('');
    const now = new Date().toISOString();
    try {
      const { data, error } = await sb.from('items').update({
        condition: newCond, updated_at: now, updated_by: admin.name,
      }).eq('id', initial.id).select().single();
      if (error) throw error;
      await sb.from('history').insert({
        item_id: initial.id, action,
        changes: { note: noteText, from: initial.condition, to: newCond },
        changed_by: admin.name, changed_at: now,
      });
      onSaved(data);
      onClose();
    } catch(e) { setErr(friendlyError(e)); setSaving(false); }
  }

  async function markRepaired() {
    if (!await confirm({ title: 'Mark repaired?', body: `Set "${initial.name}" back to Good condition and back in service?`, confirmLabel: 'Mark repaired' })) return;
    await setConditionAndLog('good', 'repaired', `Marked repaired (was ${CLABEL[initial.condition]||initial.condition})`);
  }
  async function retire() {
    if (!await confirm({ title: 'Retire this item?', body: `Retire "${initial.name}"? It will be hidden from new deployments. You can reactivate later if needed.`, danger: true, confirmLabel: 'Retire' })) return;
    await setConditionAndLog('retired', 'retired', `Retired (was ${CLABEL[initial.condition]||initial.condition})`);
  }
  async function reactivate() {
    if (!await confirm({ title: 'Reactivate item?', body: `Bring "${initial.name}" back into service?`, confirmLabel: 'Reactivate' })) return;
    await setConditionAndLog('good', 'repaired', 'Reactivated from retirement');
  }

  const isRetired      = initial?.condition === 'retired';
  const needsAttention = ['needs_cleaning','needs_repair','damaged'].includes(initial?.condition);

  return (
    <div className="backdrop" onClick={onClose}>
      <form className="modal" onClick={e=>e.stopPropagation()} onSubmit={save}>
        <h2>{isEdit ? 'Edit item' : 'Add item to inventory'}</h2>

        {isEdit && isRetired && (
          <div className="status-banner retired-banner">
            <div>
              <div className="status-banner-title">Retired</div>
              <div className="status-banner-sub">Hidden from new deployments. Reactivate to use again.</div>
            </div>
            <button type="button" className="btn sm primary" onClick={reactivate} disabled={saving}>Reactivate</button>
          </div>
        )}
        {isEdit && needsAttention && (
          <div className="status-banner attention-banner">
            <div>
              <div className="status-banner-title">{CLABEL[initial.condition]}</div>
              <div className="status-banner-sub">Mark repaired when fixed, or retire if it's beyond saving.</div>
            </div>
            <div style={{display:'flex',gap:6}}>
              <button type="button" className="btn sm" onClick={markRepaired} disabled={saving}>Mark repaired</button>
            </div>
          </div>
        )}

        <div className="field"><label>Name</label>
          <input value={name} onChange={e=>setName(e.target.value)} autoFocus />
        </div>
        <div className="field"><label>Category</label>
          <select value={category} onChange={e=>setCategory(e.target.value)}>
            {CATEGORIES.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="field"><label>Storage location</label>
          <input value={storageLocation} onChange={e=>setStorage(e.target.value)} placeholder="e.g. Warehouse — Shelf A1" />
        </div>
        <div className="field"><label>Condition</label>
          <select value={condition} onChange={e=>setCondition(e.target.value)}>
            {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div className="field"><label>Notes</label>
          <textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Anything worth noting" />
        </div>
        {isEdit && (
          <div className="field"><label>Photos</label>
            <AttachmentStrip itemId={initial.id} adminName={admin.name} isAdmin={true} />
          </div>
        )}
        <div className="err">{err}</div>
        <div className="actions">
          {isEdit && <button type="button" className="btn danger" onClick={del}>Delete</button>}
          {isEdit && !isRetired && (
            <button type="button" className="btn" onClick={retire} disabled={saving} title="Take this item out of service">Retire</button>
          )}
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={saving}>{saving?'Saving…':(isEdit?'Save changes':'Add item')}</button>
        </div>
      </form>
    </div>
  );
}

// ---------- item detail modal (history across events) ----------
function ItemDetailModal({ item, admin, onClose, onEdit }) {
  const [history, setHistory] = useState(null);
  const [eventItems, setEventItems] = useState([]);
  const [showQr, setShowQr] = useState(false);
  const [damageOpen, setDamageOpen] = useState(false);

  useEffect(() => {
    sb.from('history').select('*').eq('item_id', item.id).order('changed_at', { ascending: false })
      .then(({ data }) => setHistory(data || []));
    sb.from('event_items').select('*, events(name, event_date)').eq('item_id', item.id)
      .order('assigned_at', { ascending: false })
      .then(({ data }) => setEventItems(data || []));
  }, [item.id]);

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12}}>
          <div style={{flex:1}}>
            <h2 style={{margin:0}}>{item.name}</h2>
            <div style={{fontFamily:"'Azeret Mono',monospace",fontSize:11,color:'#7A7A7A',marginTop:2}}>{item.category} · {item.storage_location||'—'}</div>
          </div>
          <span className={`badge ${item.condition}`}>{CLABEL[item.condition]}</span>
        </div>

        {item.notes && <div style={{background:'#1a1a1a',border:'1px solid #2a2a2a',padding:'8px 12px',fontSize:13,marginBottom:12,fontFamily:"'Manrope',sans-serif"}}>{item.notes}</div>}

        <AttachmentStrip itemId={item.id} adminName={admin?.name} isAdmin={!!admin} />

        {eventItems.length > 0 && (
          <>
            <div className="section-label">Used in events</div>
            <div style={{display:'flex',flexDirection:'column',gap:6}}>
              {eventItems.map(ei => (
                <div key={ei.id} style={{background:'#1a1a1a',border:'1px solid #2a2a2a',padding:'10px 12px'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:16,letterSpacing:'0.04em',textTransform:'uppercase'}}>{ei.events?.name}</span>
                    <span className={`badge ${ei.status==='returned'?'status-returned':'status-out'}`}>
                      {ei.status==='returned'?'Returned':'Out'}
                    </span>
                  </div>
                  <div style={{fontFamily:"'Azeret Mono',monospace",fontSize:11,color:'#7A7A7A',marginTop:3}}>{fmtDate(ei.events?.event_date)}</div>
                  {ei.returned_at && <div style={{fontFamily:"'Azeret Mono',monospace",fontSize:11,color:'#7A7A7A'}}>Returned {fmtTime(ei.returned_at)} by {ei.returned_by} · {CLABEL[ei.condition_on_return]||ei.condition_on_return}</div>}
                </div>
              ))}
            </div>
          </>
        )}

        <div className="section-label">Full history</div>
        <HistoryList itemId={item.id} />

        {showQr && (
          <div style={{background:'#1a1a1a',border:'1px solid #2a2a2a',padding:14,marginTop:12,display:'flex',flexDirection:'column',alignItems:'center',gap:8}}>
            <div className="qr-block" style={{width:200,height:200,background:'#fff',padding:8}}
              dangerouslySetInnerHTML={{ __html: qrSvgString(itemUrl(item.id)) }} />
            <div style={{fontFamily:"'Azeret Mono',monospace",fontSize:10,color:'#7A7A7A',letterSpacing:'0.06em',textTransform:'uppercase'}}>
              {String(item.id).slice(0,8)}
            </div>
          </div>
        )}

        <div className="actions" style={{marginTop:14}}>
          <button className="btn" onClick={()=>setShowQr(s => !s)}>{showQr ? 'Hide QR' : 'Show QR'}</button>
          {admin && item.condition !== 'retired' && (
            <button className="btn" onClick={()=>setDamageOpen(true)} title="Report damage">🛠 Report damage</button>
          )}
          {admin
            ? <button className="btn primary" onClick={onEdit}>Edit item</button>
            : <LoginPrompt verb="edit" />}
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>
        {damageOpen && (
          <DamageReportModal item={item} admin={admin}
            onClose={()=>setDamageOpen(false)}
            onSaved={()=>{
              // refresh history list inline so the new entry appears
              sb.from('history').select('*').eq('item_id', item.id).order('changed_at', { ascending: false })
                .then(({ data }) => setHistory(data || []));
            }} />
        )}
      </div>
    </div>
  );
}

// ---------- damage report modal ----------
// Focused flow for "I just discovered damage on this item." Captures severity,
// optional note, and optional photo (camera-friendly on mobile via the
// capture attribute). Updates condition on master + event_item if applicable,
// uploads the photo to attachments, and writes a single damage_reported
// history entry that bundles all three pieces of context together.
function DamageReportModal({ item, eventItem, admin, onClose, onSaved }) {
  const [severity, setSeverity] = useState('damaged');
  const [note,     setNote]     = useState('');
  const [photo,    setPhoto]    = useState(null);
  const [saving,   setSaving]   = useState(false);
  const [err,      setErr]      = useState('');

  async function save(e) {
    e.preventDefault();
    setSaving(true); setErr('');
    const now = new Date().toISOString();
    try {
      // 1. Update condition on master
      await sb.from('items').update({
        condition: severity, updated_at: now, updated_by: admin.name,
      }).eq('id', item.id);

      // 2. Mirror to event_item if we're inside one
      if (eventItem) {
        await sb.from('event_items').update({
          condition: severity, updated_at: now, updated_by: admin.name,
        }).eq('id', eventItem.id);
      }

      // 3. Upload photo if provided
      let photoUrl = null;
      if (photo) {
        const ext = (photo.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `${item.id}/${eventItem?.id || 'master'}/damage-${Date.now()}.${ext}`;
        const { error: upErr } = await sb.storage.from('attachments').upload(path, photo, { contentType: photo.type });
        if (upErr) throw upErr;
        const { data: { publicUrl } } = sb.storage.from('attachments').getPublicUrl(path);
        const attRow = {
          item_id: item.id, storage_path: path, original_name: photo.name,
          mime_type: photo.type, size: photo.size, url: publicUrl,
          uploaded_by: admin.name, uploaded_at: now,
        };
        if (eventItem) attRow.event_item_id = eventItem.id;
        await sb.from('attachments').insert(attRow);
        photoUrl = publicUrl;
      }

      // 4. History entry
      await sb.from('history').insert({
        item_id: item.id, event_item_id: eventItem?.id || null,
        event_id: eventItem?.event_id || null,
        action: 'damage_reported',
        changes: {
          condition: { from: item.condition, to: severity },
          note: note.trim() || null,
          photo_url: photoUrl,
        },
        changed_by: admin.name, changed_at: now,
      });

      onSaved?.();
      onClose();
    } catch (e) {
      setErr(friendlyError(e));
      setSaving(false);
    }
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <form className="modal" style={{maxWidth:440}} onClick={e=>e.stopPropagation()} onSubmit={save}>
        <h2>Report damage</h2>
        <div style={{fontSize:12,color:'#9a9a9a',marginBottom:10}}>
          For <b>{item.name}</b>{eventItem ? ' · on this deployment' : ''}
        </div>
        <div className="field"><label>Severity</label>
          <div className="dept-chips">
            {[['damaged','Damaged'],['needs_repair','Needs repair'],['needs_cleaning','Needs cleaning']].map(([v, lbl]) => (
              <button type="button" key={v}
                className={`dept-chip${severity === v ? ' on' : ''}`}
                onClick={()=>setSeverity(v)}>{lbl}</button>
            ))}
          </div>
        </div>
        <div className="field"><label>What happened? (optional)</label>
          <textarea value={note} onChange={e=>setNote(e.target.value)} rows="3"
            placeholder="e.g. Wheel snapped during teardown"
            style={{width:'100%',background:'#1a1a1a',border:'1px solid #2a2a2a',color:'#FAFAFA',padding:'8px 10px',fontFamily:"'Manrope',sans-serif",fontSize:13,resize:'vertical'}} />
        </div>
        <div className="field"><label>Photo (optional)</label>
          <input type="file" accept="image/*" capture="environment"
            onChange={e=>setPhoto(e.target.files?.[0] || null)} />
          {photo && (
            <div style={{fontSize:11,color:'#9a9a9a',marginTop:4}}>{photo.name} · {Math.round(photo.size/1024)}kb</div>
          )}
        </div>
        {err && <div className="err">{err}</div>}
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? 'Reporting…' : '🛠 Report'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------- event form ----------
// Dual-mode: pass `event` for edit, omit for create.
function EventFormModal({ admin, event, onClose, onSaved }) {
  const isEdit = !!event;
  // Convert an ISO timestamp to the local-clock "YYYY-MM-DDTHH:MM" form that
  // <input type="datetime-local"> wants. Skips the "Z" so the browser
  // doesn't shift the displayed value into UTC.
  const isoToLocal = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const dateToLocalDefault = (dateStr, hour) => {
    if (!dateStr) return '';
    return `${dateStr}T${String(hour).padStart(2,'0')}:00`;
  };
  const [name, setName]       = useState(event?.name || '');
  const [date, setDate]       = useState(event?.event_date || '');
  // Start / end are now full datetimes. Backfill from legacy date columns
  // (default 10:00 / 22:00 local) when an event predates this migration.
  const [startAt, setStart]   = useState(
    event?.event_start_at ? isoToLocal(event.event_start_at)
    : dateToLocalDefault(event?.event_start_date || event?.event_date, 10)
  );
  const [endAt, setEnd]       = useState(
    event?.event_end_at ? isoToLocal(event.event_end_at)
    : dateToLocalDefault(event?.event_end_date || event?.event_date, 22)
  );
  const [loadInAt, setLI]     = useState(event?.load_in_at  ? isoToLocal(event.load_in_at)  : '');
  const [loadOutAt, setLO]    = useState(event?.load_out_at ? isoToLocal(event.load_out_at) : '');
  const [location, setLoc]    = useState(event?.location || '');
  const [accessNotes, setAN]  = useState(event?.venue_access_notes || '');
  const [driver, setDriver]   = useState(event?.driver_name || '');
  const [vehicle, setVehicle] = useState(event?.vehicle_plate || '');
  const [depts, setDepts]     = useState(() => new Set(event?.departments || []));
  const [showLogistics, setShowLog] = useState(!!(event?.load_in_at || event?.driver_name || event?.venue_access_notes));
  const [err, setErr]         = useState('');
  const [saving, setSaving]   = useState(false);

  function toggleDept(d) {
    setDepts(prev => {
      const n = new Set(prev);
      n.has(d) ? n.delete(d) : n.add(d);
      return n;
    });
  }

  async function save(e) {
    e.preventDefault();
    if (!name.trim()) return setErr('Event name required');
    setSaving(true);
    // Pull the date portion from start/end datetimes for the legacy DATE
    // columns (so sorts / fallbacks that still read those keep working).
    const startDateOnly = startAt ? startAt.slice(0, 10) : null;
    const endDateOnly   = endAt   ? endAt.slice(0, 10)   : null;
    const legacyDate = startDateOnly || endDateOnly || date || null;
    const payload = {
      name: name.trim(),
      event_date: legacyDate,
      event_start_date: startDateOnly || legacyDate,
      event_end_date:   endDateOnly   || legacyDate,
      event_start_at: startAt ? new Date(startAt).toISOString() : null,
      event_end_at:   endAt   ? new Date(endAt).toISOString()   : null,
      load_in_at:  loadInAt  ? new Date(loadInAt).toISOString()  : null,
      load_out_at: loadOutAt ? new Date(loadOutAt).toISOString() : null,
      location: location.trim(),
      venue_access_notes: accessNotes.trim(),
      driver_name: driver.trim(),
      vehicle_plate: vehicle.trim(),
      departments: Array.from(depts),
    };
    // New events start as "draft" so they go through the request → approve
    // workflow. Edits don't touch workflow_state — that advances via the
    // tracker buttons. Migration defaulted historical rows to 'approved'.
    // Master-created deployments skip the approval gate by default.
    const startState = admin?.role === 'master' ? 'approved' : 'draft';
    const nowIso = new Date().toISOString();
    const q = isEdit
      ? sb.from('events').update(payload).eq('id', event.id).select().single()
      : sb.from('events').insert({
          ...payload,
          workflow_state: startState,
          // Stamp who created the deployment so the WorkflowTracker has a
          // name to show on auto-completed stages (master auto-approve
          // skips the per-stage history rows that normally fill this in).
          workflow_updated_at: nowIso,
          workflow_updated_by: admin.name,
        }).select().single();
    const { data, error } = await q;
    if (error) { setErr(friendlyError(error)); setSaving(false); return; }
    onSaved(data); onClose();
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <form className="modal" style={{maxWidth:480}} onClick={e=>e.stopPropagation()} onSubmit={save}>
        <h2>{isEdit ? 'Edit deployment' : 'New deployment'}</h2>
        {!isEdit && (
          <div style={{fontSize:12,color:'#9a9a9a',marginTop:-6,marginBottom:14,letterSpacing:'0.02em',lineHeight:1.5}}>
            A deployment bundles the items, logistics, and approvals for one event activation.
          </div>
        )}
        <div className="field"><label>Event name</label>
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Al Wasl Volleyball Tournament" autoFocus />
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
          <div className="field" style={{margin:0}}><label>Starts</label>
            <input type="datetime-local" value={startAt}
              onChange={e=>{
                setStart(e.target.value);
                // If end is empty or before the new start, push it forward
                // by 12h so single-event opens still feel like one input.
                if (!endAt || endAt < e.target.value) {
                  if (e.target.value) {
                    const d = new Date(e.target.value);
                    d.setHours(d.getHours() + 12);
                    const pad = (n) => String(n).padStart(2,'0');
                    setEnd(`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
                  }
                }
              }} />
          </div>
          <div className="field" style={{margin:0}}><label>Ends</label>
            <input type="datetime-local" value={endAt} min={startAt || undefined}
              onChange={e=>setEnd(e.target.value)} />
          </div>
        </div>
        <div className="field"><label>Location / venue</label>
          <input value={location} onChange={e=>setLoc(e.target.value)} placeholder="e.g. Al Wasl Sports Club" />
        </div>
        <div className="field"><label>Departments involved</label>
          <div style={{fontSize:11,color:'#7A7A7A',marginTop:-2,marginBottom:6,letterSpacing:'0.02em'}}>
            Tap to tag teams that need visibility — they'll see this deployment surfaced in their workflows.
          </div>
          <div className="dept-chips">
            {DEPARTMENTS.map(d => (
              <button type="button" key={d}
                className={`dept-chip${depts.has(d) ? ' on' : ''}`}
                onClick={()=>toggleDept(d)}>
                {d}
              </button>
            ))}
          </div>
        </div>
        <div style={{borderTop:'1px solid #2a2a2a',marginTop:6,paddingTop:10}}>
          <button type="button"
            onClick={()=>setShowLog(s=>!s)}
            style={{background:'transparent',border:0,color:'#9a9a9a',fontFamily:"'Manrope',sans-serif",fontSize:11,fontWeight:700,letterSpacing:'0.06em',textTransform:'uppercase',cursor:'pointer',padding:'4px 0'}}>
            {showLogistics ? '▾' : '▸'} Logistics & access
          </button>
          {showLogistics && (
            <div style={{paddingTop:6}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div className="field" style={{margin:0}}><label>Load-in (date & time)</label>
                  <input type="datetime-local" value={loadInAt} onChange={e=>setLI(e.target.value)} />
                </div>
                <div className="field" style={{margin:0}}><label>Load-out (date & time)</label>
                  <input type="datetime-local" value={loadOutAt} onChange={e=>setLO(e.target.value)} />
                </div>
              </div>
              <div className="field"><label>Venue access notes</label>
                <textarea value={accessNotes} onChange={e=>setAN(e.target.value)} rows="2"
                  placeholder="e.g. Service elevator off Door 4, 7ft height limit · gate pass needed 48h ahead"
                  style={{width:'100%',background:'#1a1a1a',border:'1px solid #2a2a2a',color:'#FAFAFA',padding:'8px 10px',fontFamily:"'Manrope',sans-serif",fontSize:13,resize:'vertical'}} />
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div className="field" style={{margin:0}}><label>Driver</label>
                  <input value={driver} onChange={e=>setDriver(e.target.value)} placeholder="e.g. Faisal · +971 50 …" />
                </div>
                <div className="field" style={{margin:0}}><label>Vehicle / plate</label>
                  <input value={vehicle} onChange={e=>setVehicle(e.target.value)} placeholder="e.g. Pickup A 4569" />
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="err">{err}</div>
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? (isEdit ? 'Saving…' : 'Creating…') : (isEdit ? 'Save changes' : 'Create deployment')}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------- approval action bar ----------
// Shown at the very top of EventDetail's main column when workflow_state is
// 'requested' AND the viewer is a master. The audit's #1 critical finding
// was that the Approve CTA was buried in the sidebar; this hoists it to
// where the eye lands first. Inline submitter context + both Approve and
// Send back actions, no scrolling needed.
function ApprovalActionBar({ event, onApprove, onSendBack }) {
  const [sendBackOpen, setSendBackOpen] = useState(false);
  const submittedBy = event.workflow_updated_by || 'someone';
  const submittedAt = event.workflow_updated_at;
  return (
    <div className="approval-bar">
      <div className="approval-bar-icon">●</div>
      <div className="approval-bar-body">
        <div className="approval-bar-head">Awaiting your approval</div>
        <div className="approval-bar-sub">
          Submitted by <b>{submittedBy}</b>
          {submittedAt && <> · {fmtTime(submittedAt)}</>}
        </div>
      </div>
      <div className="approval-bar-actions">
        <button type="button" className="btn ghost sm" onClick={()=>setSendBackOpen(true)}>↶ Send back</button>
        <button type="button" className="btn primary" onClick={onApprove}>✓ Approve request</button>
      </div>
      {sendBackOpen && (
        <SendBackModal event={event}
          onClose={()=>setSendBackOpen(false)}
          onSend={(reason)=>{ setSendBackOpen(false); onSendBack(reason); }} />
      )}
    </div>
  );
}

// ---------- send-back banner ----------
// Shown on draft deployments only. Pulls the most recent comment that starts
// with the "↶ Sent back:" prefix (written by setWorkflow when a master rejects
// a request) and surfaces it as a red banner so the requester sees the reason
// on first page load instead of having to ping master on WhatsApp.
function SendBackBanner({ event }) {
  const [comment, setComment] = useState(null);
  useEffect(() => {
    if (event.workflow_state !== 'draft') { setComment(null); return; }
    // Only fetch send-back comments newer than the most recent workflow
    // transition. Server-side filter so we don't have to do Date math in JS.
    // Previously this used a fragile `Date < Date - 1000` arithmetic which
    // worked but was hard to read and easy to break.
    let q = sb.from('event_comments')
      .select('*').eq('event_id', event.id)
      .like('body', '↶ Sent back:%');
    if (event.workflow_updated_at) q = q.gte('created_at', event.workflow_updated_at);
    q.order('created_at', { ascending: false })
      .limit(1)
      .then(({ data }) => setComment(data?.[0] || null));
  }, [event.id, event.workflow_state, event.workflow_updated_at]);
  if (!comment) return null;
  const reason = comment.body.replace(/^↶ Sent back:\s*/, '');
  return (
    <div className="send-back-banner">
      <span className="send-back-icon">↶</span>
      <div className="send-back-body">
        <div className="send-back-head">Sent back for revision</div>
        <div className="send-back-text">{reason}</div>
        <div className="send-back-meta">— {comment.author_name} · {fmtTime(comment.created_at)}</div>
      </div>
    </div>
  );
}

// ---------- workflow tracker ----------
// Vertical step list shown in the deployment sidebar. Past stages are checked
// off, the current stage shows the action button for the next transition,
// future stages are dimmed. Master can roll back any stage; admin can only
// advance. State→action mapping lives here so the rest of the app stays
// agnostic to workflow specifics.
function WorkflowTracker({ event, admin, isMaster, onAdvance }) {
  const state = event.workflow_state || 'approved';
  const idx = workflowIndex(state);
  const canActOnCurrent = admin && (
    WORKFLOW_STATES[idx]?.gate === 'admin' ||
    (WORKFLOW_STATES[idx]?.gate === 'master' && isMaster)
  );
  const [sendBackOpen, setSendBackOpen] = useState(false);

  // Pull workflow transitions for this event so each completed step can
  // show who advanced it and when. We re-fetch when state changes so the
  // "Now: …" header + done-stage meta stay current after a transition.
  const [transitions, setTransitions] = useState([]);
  useEffect(() => {
    sb.from('history')
      .select('action, changes, changed_by, changed_at')
      .eq('event_id', event.id)
      .in('action', ['workflow_advanced', 'workflow_rolled_back', 'workflow_sent_back'])
      .order('changed_at', { ascending: true })
      .then(({ data }) => setTransitions(data || []));
  }, [event.id, state]);

  // Build a "who/when entered each state" map by walking transitions
  // chronologically — last entry into a state wins.
  const enteredAt = {};
  transitions.forEach(t => {
    const to = t.changes?.to;
    if (to) enteredAt[to] = { by: t.changed_by, at: t.changed_at };
  });

  const advanceCta = {
    draft:     { label: 'Submit for approval',     to: 'requested' },
    requested: { label: 'Approve request',         to: 'approved'  },
    approved:  { label: 'Mark as shipped',         to: 'shipped'   },
    shipped:   { label: 'Confirm arrival',         to: 'arrived'   },
    arrived:   { label: 'Mark items returning',    to: 'returning' },
    returning: { label: 'Close — all returned',    to: 'closed'    },
  };
  const cta = advanceCta[state];

  function rollback() {
    if (idx === 0) return;
    const prev = WORKFLOW_STATES[idx - 1].v;
    onAdvance(prev, { kind: 'rollback', toast: `Rolled back to ${prev}` });
  }

  const currentStage = WORKFLOW_STATES[idx];

  return (
    <div className="sidebar-card workflow-card">
      <div className="sidebar-card-head">
        <span>Workflow</span>
        {isMaster && idx > 0 && state !== 'closed' && (
          <button type="button" className="link-btn" onClick={rollback} title="Step back one stage">↶ Back</button>
        )}
      </div>

      {/* "Now" headline — at-a-glance answer to "what state is this in?".
          Replaces the user having to scan seven dots to find the current one. */}
      <div className={`workflow-now workflow-now-${state}`}>
        <div className="workflow-now-label">Now</div>
        <div className="workflow-now-stage">{currentStage.label}</div>
        <div className="workflow-now-sub">{currentStage.sub}</div>
      </div>

      <ol className="workflow-steps">
        {WORKFLOW_STATES.map((s, i) => {
          const status = i < idx ? 'done' : (i === idx ? 'current' : 'pending');
          // Done stages prefer the explicit history entry. When that's
          // missing (master auto-approve on create skips draft/requested/
          // approved in one shot without inserting history per stage), fall
          // back to the event's most recent workflow_updated_at + by so the
          // stages don't show as anonymous checked-off boxes.
          const meta = status === 'done'
            ? (enteredAt[s.v] || (event.workflow_updated_by ? { by: event.workflow_updated_by, at: event.workflow_updated_at } : null))
            : null;
          return (
            <li key={s.v} className={`workflow-step workflow-step-${status}`}>
              <div className="workflow-bullet">
                {status === 'done' ? '✓' : (status === 'current' ? '●' : '○')}
              </div>
              <div className="workflow-step-body">
                <div className="workflow-step-label">{s.label}</div>
                {meta
                  ? <div className="workflow-step-meta">{meta.by} · {fmtTime(meta.at)}</div>
                  : <div className="workflow-step-sub">{s.sub}</div>}
              </div>
            </li>
          );
        })}
      </ol>
      {state !== 'closed' && (
        <div className="workflow-actions">
          {cta && canActOnCurrent && (
            <button type="button" className="btn primary" onClick={()=>onAdvance(cta.to, { toast: `Moved to ${cta.to}` })}>
              {cta.label} →
            </button>
          )}
          {cta && !canActOnCurrent && (
            <div className="workflow-locked">
              {WORKFLOW_STATES[idx]?.gate === 'master'
                ? 'Awaiting master approval'
                : 'Read-only access — only Admins can advance this'}
            </div>
          )}
          {state === 'requested' && isMaster && (
            <button type="button" className="btn ghost sm" onClick={()=>setSendBackOpen(true)} style={{marginTop:6}}>
              Send back for revision
            </button>
          )}
        </div>
      )}
      {state === 'closed' && (
        <div className="workflow-closed">Deployment closed · {fmtTime(event.workflow_updated_at)}</div>
      )}
      {sendBackOpen && (
        <SendBackModal event={event}
          onClose={()=>setSendBackOpen(false)}
          onSend={(reason)=>{ setSendBackOpen(false); onAdvance('draft', { kind: 'send_back', reason, toast: 'Sent back for revision' }); }} />
      )}
    </div>
  );
}

// ---------- send-back modal ----------
// Replaces the previous window.prompt with a styled modal that previews
// what the requester will see, so masters know they're writing reader-
// facing copy. Reason is required.
function SendBackModal({ event, onClose, onSend }) {
  const [reason, setReason] = useState('');
  const trimmed = reason.trim();
  return (
    <div className="backdrop" onClick={onClose}>
      <form className="modal" style={{maxWidth:460}} onClick={e=>e.stopPropagation()}
        onSubmit={(e)=>{ e.preventDefault(); if (trimmed) onSend(trimmed); }}>
        <h2>Send back for revision</h2>
        <div style={{fontSize:12,color:'#9a9a9a',marginBottom:12,letterSpacing:'0.02em',lineHeight:1.5}}>
          The requester will see this as a red banner on top of the draft.
          Be specific so they know what to fix.
        </div>
        <div className="field"><label>Why are you sending this back?</label>
          <textarea value={reason} onChange={e=>setReason(e.target.value)} rows="3"
            placeholder="e.g. Add the audio gear too — last activation needed it"
            autoFocus
            style={{width:'100%',background:'#1a1a1a',border:'1px solid #2a2a2a',color:'#FAFAFA',padding:'8px 10px',fontFamily:"'Manrope',sans-serif",fontSize:13,resize:'vertical'}} />
        </div>
        {trimmed && (
          <div style={{background:'#2b0d0d',border:'1px solid #5a2222',borderLeft:'3px solid var(--accent-bad)',borderRadius:8,padding:'10px 12px',marginTop:6}}>
            <div style={{fontFamily:"'Manrope',sans-serif",fontSize:10,fontWeight:700,letterSpacing:'0.06em',textTransform:'uppercase',color:'var(--accent-bad)',marginBottom:4}}>
              Preview — requester sees:
            </div>
            <div style={{fontFamily:"'Manrope',sans-serif",fontSize:13,color:'#d4d4d4',whiteSpace:'pre-wrap',wordBreak:'break-word'}}>
              ↶ Sent back: {trimmed}
            </div>
          </div>
        )}
        <div className="actions" style={{marginTop:14}}>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!trimmed}>↶ Send back</button>
        </div>
      </form>
    </div>
  );
}

// ---------- logistics panel (sidebar) ----------
// Renders load-in / load-out times, driver, vehicle plate, and venue access
// notes. Empty states are admin-only "Add" prompts. Editing routes through
// the existing EventFormModal (Logistics & access section auto-expands when
// any logistics field is already set).
function LogisticsPanel({ event, admin, onEdit }) {
  const hasAny = !!(event.load_in_at || event.load_out_at ||
                    event.driver_name || event.vehicle_plate ||
                    event.venue_access_notes);
  const fmtLoad = (iso) => {
    if (!iso) return null;
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  return (
    <div className="sidebar-card">
      <div className="sidebar-card-head">
        <span>Logistics</span>
        {admin && <button type="button" className="link-btn" onClick={onEdit}>{hasAny ? 'Edit' : '+ Add'}</button>}
      </div>
      {!hasAny ? (
        <div style={{fontSize:11,color:'#7A7A7A',padding:'4px 0',letterSpacing:'0.04em'}}>
          {admin
            ? 'No load-in time, driver, or access notes yet.'
            : 'No logistics info yet.'}
        </div>
      ) : (
        <div className="logistics-grid">
          {event.load_in_at && (
            <div className="logistics-row">
              <span className="logistics-key">Load-in</span>
              <span className="logistics-val">{fmtLoad(event.load_in_at)}</span>
            </div>
          )}
          {event.load_out_at && (
            <div className="logistics-row">
              <span className="logistics-key">Load-out</span>
              <span className="logistics-val">{fmtLoad(event.load_out_at)}</span>
            </div>
          )}
          {event.driver_name && (
            <div className="logistics-row">
              <span className="logistics-key">Driver</span>
              <span className="logistics-val">{event.driver_name}</span>
            </div>
          )}
          {event.vehicle_plate && (
            <div className="logistics-row">
              <span className="logistics-key">Vehicle</span>
              <span className="logistics-val">{event.vehicle_plate}</span>
            </div>
          )}
          {event.venue_access_notes && (
            <div className="logistics-notes">
              <div className="logistics-notes-head">Access notes</div>
              <div className="logistics-notes-body">{event.venue_access_notes}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- contacts panel (sidebar) ----------
// Per-deployment people: venue mgr, logistics, vendor PoCs, etc. tel: and
// mailto: links work great on mobile. Admins can add/edit/delete.
function ContactsPanel({ event, admin }) {
  const [contacts, setContacts] = useState(null);
  const [editing,  setEditing]  = useState(null);   // { id?, name, role, phone, email, notes } | 'new'

  async function load() {
    const { data } = await sb.from('event_contacts')
      .select('*').eq('event_id', event.id).order('created_at');
    setContacts(data || []);
  }
  useEffect(() => { load(); }, [event.id]);

  // Realtime — updates flow across clients
  useEffect(() => {
    const ch = sb.channel(`event-contacts-${event.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'event_contacts', filter: `event_id=eq.${event.id}` },
        load)
      .subscribe();
    return () => sb.removeChannel(ch);
  }, [event.id]);

  async function remove(c) {
    if (!await confirm({ title: 'Remove contact?', body: `Remove ${c.name} from this deployment?`, danger: true, confirmLabel: 'Remove' })) return;
    const { error } = await sb.from('event_contacts').delete().eq('id', c.id);
    if (error) toast(`Couldn't remove: ${friendlyError(error)}`, 'err');
  }

  return (
    <div className="sidebar-card">
      <div className="sidebar-card-head">
        <span>Contacts</span>
        {admin && (
          <button type="button" className="link-btn" onClick={()=>setEditing('new')}>+ Add</button>
        )}
      </div>
      {contacts === null ? (
        <div style={{fontSize:11,color:'#7A7A7A',padding:'4px 0'}}>Loading…</div>
      ) : contacts.length === 0 ? (
        <div style={{fontSize:11,color:'#7A7A7A',padding:'4px 0',letterSpacing:'0.04em'}}>
          No contacts yet — add venue, vendor, or internal PoCs.
        </div>
      ) : (
        <ul className="contact-list">
          {contacts.map(c => (
            <li key={c.id} className="contact">
              <div className="contact-head">
                <div style={{flex:1, minWidth:0}}>
                  <div className="contact-name">{c.name}</div>
                  {c.role && <div className="contact-role">{c.role}</div>}
                </div>
                {admin && (
                  <div style={{display:'flex',gap:4,flex:'none'}}>
                    <button type="button" className="contact-action" onClick={()=>setEditing(c)} title="Edit">✎</button>
                    <button type="button" className="contact-action" onClick={()=>remove(c)} title="Remove">✕</button>
                  </div>
                )}
              </div>
              {(c.phone || c.email) && (
                <div className="contact-links">
                  {c.phone && <a className="contact-link" href={`tel:${c.phone.replace(/[^+\d]/g,'')}`}>📞 {c.phone}</a>}
                  {c.email && <a className="contact-link" href={`mailto:${c.email}`}>✉ {c.email}</a>}
                </div>
              )}
              {c.notes && <div className="contact-notes">{c.notes}</div>}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <ContactFormModal admin={admin} event={event}
          contact={editing === 'new' ? null : editing}
          onClose={()=>setEditing(null)}
          onSaved={()=>setEditing(null)} />
      )}
    </div>
  );
}

function ContactFormModal({ admin, event, contact, onClose, onSaved }) {
  const isEdit = !!contact;
  const [name,  setName]  = useState(contact?.name  || '');
  const [role,  setRole]  = useState(contact?.role  || '');
  const [phone, setPhone] = useState(contact?.phone || '');
  const [email, setEmail] = useState(contact?.email || '');
  const [notes, setNotes] = useState(contact?.notes || '');
  const [err,   setErr]   = useState('');
  const [saving,setSaving]= useState(false);

  async function save(e) {
    e.preventDefault();
    if (!name.trim()) return setErr('Name required');
    setSaving(true);
    const payload = {
      name: name.trim(), role: role.trim(),
      phone: phone.trim(), email: email.trim(),
      notes: notes.trim(),
    };
    try {
      if (isEdit) {
        const { error } = await sb.from('event_contacts').update(payload).eq('id', contact.id);
        if (error) throw error;
      } else {
        const { error } = await sb.from('event_contacts').insert({
          ...payload, event_id: event.id, created_by: admin.name,
        });
        if (error) throw error;
      }
      onSaved();
      onClose();
    } catch (e) {
      setErr(friendlyError(e));
      setSaving(false);
    }
  }

  async function del() {
    if (!await confirm({ title: 'Remove contact?', body: `Remove ${contact.name} from this deployment?`, danger: true, confirmLabel: 'Remove' })) return;
    await sb.from('event_contacts').delete().eq('id', contact.id);
    onSaved(); onClose();
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <form className="modal" style={{maxWidth:420}} onClick={e=>e.stopPropagation()} onSubmit={save}>
        <h2>{isEdit ? 'Edit contact' : 'Add contact'}</h2>
        <div className="field"><label>Name</label>
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Ahmed Rashid" autoFocus />
        </div>
        <div className="field"><label>Role / company</label>
          <input value={role} onChange={e=>setRole(e.target.value)} placeholder="e.g. Venue manager · Coca-Cola Arena" />
        </div>
        <div className="field"><label>Phone</label>
          <input type="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+971 50 …" />
        </div>
        <div className="field"><label>Email</label>
          <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="ahmed@…" />
        </div>
        <div className="field"><label>Notes</label>
          <textarea value={notes} onChange={e=>setNotes(e.target.value)} rows="2"
            placeholder="e.g. Best to call between 9–11am"
            style={{width:'100%',background:'#1a1a1a',border:'1px solid #2a2a2a',color:'#FAFAFA',padding:'8px 10px',fontFamily:"'Manrope',sans-serif",fontSize:13,resize:'vertical'}} />
        </div>
        {err && <div className="err">{err}</div>}
        <div className="actions" style={{justifyContent:'space-between'}}>
          {isEdit
            ? <button type="button" className="btn ghost" onClick={del} style={{color:'var(--accent-bad)'}}>Remove</button>
            : <span />}
          <div style={{display:'flex',gap:8}}>
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? 'Saving…' : (isEdit ? 'Save' : 'Add')}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

// ---------- deployment activity feed ----------
// Chronological log of every system event scoped to this deployment.
// Reads from the history table (which we've been writing to all along —
// pack/unpack, workflow transitions, condition changes, damage, returns,
// assignments). Mounts at the bottom of EventDetail above Comments so
// you can see "what happened" before adding to "what people said."
//
// Distinct from Comments: this is auto-collected and read-only; Comments
// are human-authored.
function ActivityFeed({ event }) {
  const [rows, setRows] = useState(null);
  const [showAll, setShowAll] = useState(false);

  async function load() {
    const { data } = await sb.from('history')
      .select('*, items(name)')
      .eq('event_id', event.id)
      .order('changed_at', { ascending: false })
      .limit(100);
    setRows(data || []);
  }
  useEffect(() => { load(); }, [event.id]);

  useEffect(() => {
    const ch = sb.channel(`activity-${event.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'history', filter: `event_id=eq.${event.id}` },
        load)
      .subscribe();
    return () => sb.removeChannel(ch);
  }, [event.id]);

  if (rows === null) {
    return (
      <div className="activity-panel">
        <div className="section-label" style={{marginTop:0}}>Activity</div>
        <div style={{fontSize:11,color:'#7A7A7A',padding:'4px 0'}}>Loading…</div>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="activity-panel">
        <div className="section-label" style={{marginTop:0}}>Activity</div>
        <div style={{fontSize:11,color:'#7A7A7A',padding:'4px 0',letterSpacing:'0.04em'}}>
          No activity yet — actions you take here appear in this feed.
        </div>
      </div>
    );
  }

  const visible = showAll ? rows : rows.slice(0, 12);
  return (
    <div className="activity-panel">
      <div className="section-label" style={{marginTop:0}}>Activity ({rows.length})</div>
      <ol className="activity-list">
        {visible.map(r => <ActivityRow key={r.id} row={r} />)}
      </ol>
      {!showAll && rows.length > 12 && (
        <button type="button" className="link-btn" onClick={()=>setShowAll(true)}
          style={{marginTop:8}}>
          Show all {rows.length} entries →
        </button>
      )}
    </div>
  );
}

// Maps an action to {icon, tone} for visual category scanning.
// Tone is one of: workflow / item / condition / photo / damage / return / pack
function activityVisual(action) {
  if (action?.startsWith('workflow_')) return { icon: '⚙', tone: 'workflow' };
  if (action === 'assigned')           return { icon: '+', tone: 'item' };
  if (action === 'returned')           return { icon: '↩', tone: 'return' };
  if (action === 'packed')             return { icon: '✓', tone: 'pack' };
  if (action === 'unpacked')           return { icon: '↶', tone: 'pack' };
  if (action === 'damage_reported')    return { icon: '🛠', tone: 'damage' };
  if (action === 'condition_changed')  return { icon: '◆', tone: 'condition' };
  if (action === 'repaired')           return { icon: '✓', tone: 'condition' };
  if (action === 'retired')            return { icon: '○', tone: 'condition' };
  if (action === 'photo_added')        return { icon: '📷', tone: 'photo' };
  if (action === 'photo_removed')      return { icon: '✕', tone: 'photo' };
  if (action === 'item_created' || action === 'item_updated' || action === 'item_deleted')
                                       return { icon: '◇', tone: 'item' };
  if (action === 'location_updated' || action === 'notes_updated')
                                       return { icon: '✎', tone: 'item' };
  return { icon: '●', tone: 'item' };
}

function ActivityRow({ row }) {
  const { icon, tone } = activityVisual(row.action);
  const itemName = row.items?.name;
  const changes = row.changes || {};

  // Render the body — action-specific so the most-relevant detail comes first
  let body;
  if (row.action === 'workflow_advanced' || row.action === 'workflow_rolled_back') {
    body = <span>Workflow: <b>{changes.from || '—'}</b> → <b>{changes.to || '—'}</b></span>;
  } else if (row.action === 'workflow_sent_back') {
    body = <span>Sent back to draft{changes.note ? <>: <i>"{changes.note}"</i></> : null}</span>;
  } else if (row.action === 'condition_changed' && changes.condition) {
    const c = changes.condition;
    body = <span>{itemName ? <><b>{itemName}</b> · </> : null}condition: <b>{CLABEL[c.from]||c.from}</b> → <b>{CLABEL[c.to]||c.to}</b></span>;
  } else if (row.action === 'damage_reported') {
    body = <span><b>{itemName || 'Item'}</b> · damage reported{changes.condition?.to ? <> ({CLABEL[changes.condition.to]||changes.condition.to})</> : null}{changes.note ? <>: <i>"{changes.note}"</i></> : null}</span>;
  } else if (row.action === 'packed') {
    body = <span><b>{itemName || 'Item'}</b> marked packed</span>;
  } else if (row.action === 'unpacked') {
    body = <span><b>{itemName || 'Item'}</b> marked not packed</span>;
  } else if (row.action === 'returned') {
    body = <span><b>{itemName || 'Item'}</b> returned</span>;
  } else if (row.action === 'assigned') {
    body = <span><b>{itemName || 'Item'}</b> assigned to deployment</span>;
  } else if (row.action === 'location_updated' && changes.current_location) {
    body = <span><b>{itemName || 'Item'}</b> · location → {changes.current_location.to || changes.current_location}</span>;
  } else {
    body = <span>{actionLabel(row.action)}{itemName ? <> · <b>{itemName}</b></> : null}{changes.note ? <>: <i>{changes.note}</i></> : null}</span>;
  }

  return (
    <li className={`activity-row activity-tone-${tone}`}>
      <div className="activity-icon">{icon}</div>
      <div className="activity-body">
        <div className="activity-text">{body}</div>
        <div className="activity-meta">{row.changed_by || '—'} · {fmtTime(row.changed_at)}</div>
      </div>
    </li>
  );
}

// ---------- deployment comments / internal notes ----------
// Append-only feed per deployment. All signed-in users can read; admins post.
// Realtime channel pushes new comments to every open client.
function CommentsPanel({ event, admin, viewerName }) {
  const [comments, setComments] = useState(null);
  const [body,     setBody]     = useState('');
  const [posting,  setPosting]  = useState(false);

  async function load() {
    const { data } = await sb.from('event_comments')
      .select('*').eq('event_id', event.id).order('created_at', { ascending: true });
    setComments(data || []);
  }
  useEffect(() => { load(); }, [event.id]);

  // Realtime — new comments from any client appear instantly
  useEffect(() => {
    const ch = sb.channel(`event-comments-${event.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'event_comments', filter: `event_id=eq.${event.id}` },
        load)
      .subscribe();
    return () => sb.removeChannel(ch);
  }, [event.id]);

  async function post(e) {
    e.preventDefault();
    const text = body.trim();
    if (!text || !admin) return;
    setPosting(true);
    try {
      const { data: sess } = await sb.auth.getUser();
      const { error } = await sb.from('event_comments').insert({
        event_id: event.id, body: text,
        author_id: sess?.user?.id || null,
        author_name: admin.name,
      });
      if (error) throw error;
      setBody('');
    } catch (e) {
      toast(`Couldn't post: ${friendlyError(e)}`, 'err');
    } finally {
      setPosting(false);
    }
  }

  async function remove(c) {
    if (!await confirm({ title: 'Delete this note?', body: 'Remove your comment from this deployment?', danger: true, confirmLabel: 'Delete' })) return;
    const { error } = await sb.from('event_comments').delete().eq('id', c.id);
    if (error) toast(`Couldn't delete: ${friendlyError(error)}`, 'err');
  }

  return (
    <div className="comments-panel">
      <div className="section-label" style={{marginTop:0}}>Notes</div>
      {comments === null ? (
        <div className="empty" style={{padding:'14px'}}>Loading…</div>
      ) : comments.length === 0 ? (
        <div style={{fontSize:12,color:'#7A7A7A',padding:'4px 0 10px',letterSpacing:'0.04em'}}>
          No notes yet — share status, blockers, or coordination here.
        </div>
      ) : (
        <div className="comments-list">
          {comments.map(c => {
            const mine = c.author_name === viewerName;
            return (
              <div className="comment" key={c.id}>
                <div className="comment-head">
                  <span className="comment-author">{c.author_name}</span>
                  <span className="comment-time">{fmtTime(c.created_at)}</span>
                  {mine && (
                    <button type="button" className="comment-del" onClick={()=>remove(c)} title="Delete">✕</button>
                  )}
                </div>
                <div className="comment-body">{c.body}</div>
              </div>
            );
          })}
        </div>
      )}
      {admin ? (
        <form className="comment-compose" onSubmit={post}>
          <textarea value={body} onChange={e=>setBody(e.target.value)}
            rows="2" placeholder="Add a note…"
            onKeyDown={e=>{ if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post(e); }} />
          <button type="submit" className="btn primary sm" disabled={posting || !body.trim()}>
            {posting ? '…' : 'Post'}
          </button>
        </form>
      ) : (
        <div style={{fontSize:11,color:'#7A7A7A',padding:'8px 0 0'}}>Notes are admin-only — ask a master to bump your role to post.</div>
      )}
    </div>
  );
}

// ---------- preflight banner ----------
// Shown at the top of EventDetail for events whose event_date is in the
// future. Summarises shipment-readiness in one line ("Ready" / "X issues") +
// click to expand the issue list. Computed from already-loaded data — no
// extra queries.
function PreflightBanner({ event, eventItems, items }) {
  const [expanded, setExpanded] = useState(false);

  // Only relevant for future events with assignments
  if (!event.event_date) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const eventDay = new Date(event.event_date + 'T00:00:00');
  if (eventDay.getTime() < today.getTime()) return null;

  const onDeploy   = eventItems.filter(ei => ei.status === 'out');
  if (onDeploy.length === 0) {
    return (
      <div className="preflight preflight-empty">
        <span className="preflight-icon">○</span>
        <span className="preflight-summary">No items assigned yet</span>
      </div>
    );
  }

  const unpacked   = onDeploy.filter(ei => !ei.packed_at);
  const badCondItems = onDeploy
    .map(ei => ({ ei, it: items[ei.item_id] }))
    .filter(({ ei }) => ['damaged','needs_repair','needs_cleaning'].includes(ei.condition));

  const issues = [];
  if (unpacked.length > 0) issues.push({
    kind: 'unpacked',
    label: `${unpacked.length} not packed yet`,
    rows: unpacked.map(ei => ({ ei, it: items[ei.item_id] })),
  });
  if (badCondItems.length > 0) issues.push({
    kind: 'condition',
    label: `${badCondItems.length} in poor condition`,
    rows: badCondItems,
  });

  const totalIssues = unpacked.length + badCondItems.length;
  const ready = totalIssues === 0;
  const cls = ready ? 'preflight preflight-ready' : 'preflight preflight-issues';

  const dayMs = 24 * 3600 * 1000;
  const daysOff = Math.round((eventDay.getTime() - today.getTime()) / dayMs);
  const whenLabel =
    daysOff === 0 ? 'Today' :
    daysOff === 1 ? 'Tomorrow' :
    `In ${daysOff} days`;

  return (
    <div className={cls}>
      <button type="button" className="preflight-head"
        onClick={()=>!ready && setExpanded(e=>!e)}
        style={{cursor: ready ? 'default' : 'pointer'}}>
        <span className="preflight-icon">{ready ? '✓' : '⚠'}</span>
        <span className="preflight-summary">
          {ready ? `Ready to ship — ${whenLabel}` : `${totalIssues} issue${totalIssues===1?'':'s'} before ${whenLabel.toLowerCase()}`}
        </span>
        {!ready && <span className="preflight-toggle">{expanded ? '▴' : '▾'}</span>}
      </button>
      {!ready && expanded && (
        <div className="preflight-body">
          {issues.map(group => (
            <div key={group.kind} className="preflight-group">
              <div className="preflight-group-head">{group.label}</div>
              {group.rows.map(({ ei, it }) => (
                <div key={ei.id} className="preflight-row">
                  <span className="preflight-row-name">{it?.name || '(unknown)'}</span>
                  {group.kind === 'condition' && (
                    <span className={`badge ${ei.condition}`}>{CLABEL[ei.condition]}</span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- delete deployment ----------
// Master-only destructive action with two guardrails:
//   1. Block the delete entirely if any items are still 'out' — leaving them
//      orphaned would make them invisible-but-checked-out forever. Surface
//      a "Return all first" button that opens BulkReturnModal.
//   2. If clear, require typing the deployment name verbatim to confirm.
// Cascades take care of event_items, comments, contacts, and event-scoped
// history rows via the existing FK ON DELETE CASCADE chain.
function DeleteDeploymentModal({ event, eventItems, admin, onClose, onReturnAll, onDeleted }) {
  const [typed, setTyped]   = useState('');
  const [busy,  setBusy]    = useState(false);
  const [err,   setErr]     = useState('');
  const outCount  = eventItems.filter(ei => ei.status === 'out').length;
  const blocked   = outCount > 0;
  const canDelete = !blocked && typed.trim() === event.name.trim();

  async function doDelete() {
    if (!canDelete || busy) return;
    setBusy(true); setErr('');
    try {
      const { error } = await sb.from('events').delete().eq('id', event.id);
      if (error) throw error;
      onDeleted();
    } catch (e) {
      setErr(friendlyError(e));
      setBusy(false);
    }
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" style={{maxWidth:460}} onClick={e=>e.stopPropagation()}>
        <h2 style={{color: blocked ? undefined : 'var(--accent-bad)'}}>
          {blocked ? 'Return items first' : 'Delete deployment'}
        </h2>
        {blocked ? (
          <>
            <div style={{fontSize:13,color:'#d4d4d4',lineHeight:1.5}}>
              <b>{event.name}</b> still has <b>{outCount}</b> item{outCount===1?'':'s'} marked
              as out. Deleting it now would leave them stuck in "checked out"
              limbo with no way back to storage.
            </div>
            <div style={{fontSize:12,color:'#9a9a9a',marginTop:10,letterSpacing:'0.04em'}}>
              Return them first using the bulk-return flow, then come back to delete.
            </div>
            <div className="actions" style={{marginTop:14}}>
              <button className="btn ghost" onClick={onClose}>Cancel</button>
              <button className="btn primary" onClick={onReturnAll}>↩ Return all items</button>
            </div>
          </>
        ) : (
          <>
            <div style={{fontSize:13,color:'#d4d4d4',lineHeight:1.5}}>
              This permanently deletes <b>{event.name}</b>, all its item
              assignments, comments, contacts, and history. <b>This cannot
              be undone.</b> Master-level item history and master-level
              photos survive.
            </div>
            <div className="field" style={{marginTop:14}}>
              <label>Type the deployment name to confirm</label>
              <input value={typed} onChange={e=>setTyped(e.target.value)}
                placeholder="Type the name above to confirm" autoFocus />
            </div>
            {err && <div className="err">{err}</div>}
            <div className="actions" style={{marginTop:6}}>
              <button className="btn ghost" onClick={onClose}>Cancel</button>
              <button className="btn primary" onClick={doDelete} disabled={!canDelete || busy}
                style={canDelete ? {background:'var(--accent-bad-bg)',borderColor:'var(--accent-bad-bd)',color:'var(--accent-bad)'} : undefined}>
                {busy ? 'Deleting…' : '🗑 Delete deployment'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- duplicate deployment ----------
// Clones an event + all its current assignments to a fresh deployment.
// Items currently out at OTHER deployments are skipped — can't double-book.
// Reset packed/returned flags so the new event starts clean.
function DuplicateEventModal({ admin, source, sourceItems, onClose, onDuplicated }) {
  const [name, setName]   = useState((source.name || 'Deployment') + ' (copy)');
  const [date, setDate]   = useState('');
  const [keepDepts, setKD] = useState(true);
  const [keepLoc,   setKL] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState('');
  const [skipped, setSkipped] = useState(0);

  async function save(e) {
    e.preventDefault();
    if (!name.trim()) return setErr('Event name required');
    setSaving(true);
    try {
      // 1. Create the new event
      const { data: newEv, error: evErr } = await sb.from('events').insert({
        name: name.trim(),
        event_date: date || null,
        location: keepLoc ? (source.location || '') : '',
        departments: keepDepts ? (source.departments || []) : [],
      }).select().single();
      if (evErr) throw evErr;

      // 2. Decide which source assignments can be carried over.
      //    Skip items currently "out" at any deployment that isn't the source
      //    (the source's own out items are fine — we're duplicating them).
      const itemIds = sourceItems.map(ei => ei.item_id);
      const { data: outAtOthers } = await sb.from('event_items')
        .select('item_id, event_id').eq('status', 'out').in('item_id', itemIds);
      const blocked = new Set((outAtOthers || [])
        .filter(r => r.event_id !== source.id)
        .map(r => r.item_id));

      // Refresh master conditions so the new event reflects current state.
      const { data: masters } = await sb.from('items').select('id, condition').in('id', itemIds);
      const condBy = {};
      (masters || []).forEach(m => { condBy[m.id] = m.condition; });

      const now = new Date().toISOString();
      const rows = sourceItems
        .filter(ei => !blocked.has(ei.item_id))
        .map(ei => ({
          event_id: newEv.id,
          item_id: ei.item_id,
          status: 'out',
          condition: condBy[ei.item_id] || ei.condition || 'good',
          current_location: '',
          assigned_by: admin.name,
          assigned_at: now,
          updated_at: now,
          updated_by: admin.name,
        }));

      let newRows = [];
      if (rows.length > 0) {
        const { data, error: insErr } = await sb.from('event_items').insert(rows).select();
        if (insErr) throw insErr;
        newRows = data || [];
      }

      // History entries — one per duplicated assignment
      if (newRows.length > 0) {
        await sb.from('history').insert(newRows.map(r => ({
          item_id: r.item_id, event_item_id: r.id, event_id: newEv.id,
          action: 'assigned',
          changes: { note: `Assigned via duplicate of "${source.name}"` },
          changed_by: admin.name, changed_at: now,
        })));
      }

      const skippedCount = sourceItems.length - rows.length;
      if (skippedCount > 0) setSkipped(skippedCount);

      onDuplicated(newEv);
    } catch (e) {
      setErr(friendlyError(e));
      setSaving(false);
    }
  }

  const itemCount = sourceItems.length;

  return (
    <div className="backdrop" onClick={onClose}>
      <form className="modal" style={{maxWidth:440}} onClick={e=>e.stopPropagation()} onSubmit={save}>
        <h2>Duplicate deployment</h2>
        <div style={{fontSize:12,color:'#9a9a9a',marginBottom:10}}>
          Cloning <b>{source.name}</b>{itemCount > 0 ? ` and its ${itemCount} item assignment${itemCount===1?'':'s'}` : ''}.
        </div>
        <div className="field"><label>New event name</label>
          <input value={name} onChange={e=>setName(e.target.value)} autoFocus />
        </div>
        <div className="field"><label>Event date (optional)</label>
          <input type="date" value={date} onChange={e=>setDate(e.target.value)} />
        </div>
        <div className="field" style={{display:'flex',flexDirection:'column',gap:6}}>
          <label style={{display:'flex',gap:8,alignItems:'center',cursor:'pointer'}}>
            <input type="checkbox" checked={keepLoc} onChange={e=>setKL(e.target.checked)} />
            <span>Copy location ({source.location || '—'})</span>
          </label>
          <label style={{display:'flex',gap:8,alignItems:'center',cursor:'pointer'}}>
            <input type="checkbox" checked={keepDepts} onChange={e=>setKD(e.target.checked)} />
            <span>Copy departments ({(source.departments||[]).length})</span>
          </label>
        </div>
        <div style={{fontSize:11,color:'#7A7A7A',marginTop:6,letterSpacing:'0.04em'}}>
          Items currently out at other deployments will be skipped automatically.
          Pack / return flags are reset so the clone starts clean.
        </div>
        {skipped > 0 && (
          <div className="err" style={{marginTop:10,background:'#2b2208',borderColor:'#4a3a10',color:'#d4a534'}}>
            {skipped} item{skipped===1?'':'s'} couldn't be duplicated — already out at other deployment{skipped===1?'':'s'}.
          </div>
        )}
        {err && <div className="err">{err}</div>}
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? 'Duplicating…' : 'Duplicate'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------- assign items to event ----------
function AssignItemsModal({ event, admin, existingItemIds, onClose, onAssigned }) {
  const [items, setItems]       = useState([]);
  const [activeOut, setActiveOut] = useState({}); // item_id → deployment name (checked out elsewhere)
  const [selected, setSelected] = useState(new Set());
  const [saving, setSaving]     = useState(false);
  const [query, setQuery]       = useState('');

  const { safeClose } = useUnloadGuard(saving, onClose);

  useEffect(() => {
    sb.from('items').select('*').order('name').then(({ data }) => setItems(data || []));
    // find items currently out at OTHER deployments
    sb.from('event_items').select('item_id, events(name)').eq('status', 'out')
      .then(({ data }) => {
        const m = {};
        (data||[]).forEach(r => {
          // only block if it's a different deployment
          if (r.event_id !== event.id) m[r.item_id] = r.events?.name || 'another deployment';
        });
        setActiveOut(m);
      });
  }, []);

  // split items into available and unavailable for clear display
  // retired items are hidden from assignment entirely
  const matching = items.filter(it =>
    !existingItemIds.has(it.id) &&
    it.condition !== 'retired' &&
    it.name.toLowerCase().includes(query.toLowerCase())
  );
  const available   = matching.filter(it => !activeOut[it.id]);
  const unavailable = matching.filter(it =>  activeOut[it.id]);
  const NEEDS_FLAG = new Set(['needs_cleaning','needs_repair','damaged']);

  function toggle(id) {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  async function assign() {
    if (!selected.size) return;
    setSaving(true);
    const now = new Date().toISOString();
    const ids = Array.from(selected);
    // Single batch INSERT for the event_items rows, then single batch INSERT for history.
    const eiPayload = ids.map(item_id => ({
      event_id: event.id, item_id, status: 'out',
      assigned_by: admin.name, assigned_at: now,
      updated_at: now, updated_by: admin.name,
    }));
    const { data: eis, error: eiErr } = await sb.from('event_items').insert(eiPayload).select();
    if (eiErr) {
      toast(`Couldn't assign items: ${friendlyError(eiErr)}`, 'err');
      setSaving(false);
      return;
    }
    if (eis && eis.length) {
      const histPayload = eis.map(ei => ({
        item_id: ei.item_id, event_item_id: ei.id, event_id: event.id,
        action: 'assigned', changes: { note: `Assigned to deployment: ${event.name}` },
        changed_by: admin.name, changed_at: now,
      }));
      const { error: histErr } = await sb.from('history').insert(histPayload);
      if (histErr) toast(`Items assigned, but history wasn't recorded: ${friendlyError(histErr)}`, 'err');
    }
    onAssigned(); onClose();
  }

  return (
    <div className="backdrop" onClick={safeClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <h2>Assign items</h2>
        <input style={{marginBottom:10,width:'100%',background:'#1a1a1a',border:'1px solid #2a2a2a',color:'#FAFAFA',padding:'10px 12px',outline:'none',fontFamily:"'Azeret Mono',monospace",fontSize:13}} placeholder="Search items…"
          value={query} onChange={e=>setQuery(e.target.value)} />
        <div style={{maxHeight:340,overflowY:'auto',display:'flex',flexDirection:'column',gap:6}}>
          {available.length === 0 && unavailable.length === 0 && (
            <div style={{color:'#7A7A7A',fontFamily:"'Azeret Mono',monospace",fontSize:12}}>No items available.</div>
          )}

          {/* selectable items */}
          {available.map(it => {
            const flag = NEEDS_FLAG.has(it.condition);
            return (
              <label key={it.id} className={`check-row${selected.has(it.id)?' selected':''}${flag?' flagged':''}`}>
                <input type="checkbox" checked={selected.has(it.id)} onChange={()=>toggle(it.id)} style={{accentColor:'#B93A32',width:16,height:16}} />
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:17,letterSpacing:'0.04em',textTransform:'uppercase'}}>{it.name}</div>
                  <div style={{fontFamily:"'Azeret Mono',monospace",fontSize:11,color:'#7A7A7A'}}>{it.category} · {it.storage_location||'No storage set'}</div>
                  {flag && (
                    <div style={{fontFamily:"'Azeret Mono',monospace",fontSize:10,color:'#d4a534',letterSpacing:'0.06em',textTransform:'uppercase',marginTop:3}}>
                      ⚠ Item needs attention before deployment
                    </div>
                  )}
                </div>
                <span className={`badge ${it.condition}`}>{CLABEL[it.condition]}</span>
              </label>
            );
          })}

          {/* unavailable — out at another deployment */}
          {unavailable.length > 0 && (
            <>
              <div style={{fontFamily:"'Azeret Mono',monospace",fontSize:10,color:'#7A7A7A',letterSpacing:'0.08em',textTransform:'uppercase',marginTop:6,marginBottom:2}}>
                Currently out — unavailable
              </div>
              {unavailable.map(it => (
                <div key={it.id} className="check-row" style={{opacity:0.45,cursor:'not-allowed'}}>
                  <div style={{width:16,height:16,border:'1px solid #3a3a3a',flexShrink:0}} />
                  <div style={{flex:1}}>
                    <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:17,letterSpacing:'0.04em',textTransform:'uppercase'}}>{it.name}</div>
                    <div style={{fontFamily:"'Azeret Mono',monospace",fontSize:11,color:'#d48a34'}}>Out at: {activeOut[it.id]}</div>
                  </div>
                  <span className="badge status-out">Out</span>
                </div>
              ))}
            </>
          )}
        </div>

        {selected.size > 0 && <div style={{fontFamily:"'Azeret Mono',monospace",fontSize:12,color:'#B93A32',marginTop:8}}>{selected.size} item{selected.size>1?'s':''} selected</div>}
        <div className="actions" style={{marginTop:12}}>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!selected.size||saving} onClick={assign}>
            {saving ? 'Assigning…' : `Assign ${selected.size||''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- update event item modal ----------
function UpdateEventItemModal({ eventItem, item, admin, onClose, onSaved }) {
  const [location, setLocation]   = useState(eventItem.current_location || '');
  const [condition, setCondition] = useState(eventItem.condition || item?.condition || 'good');
  const [notes, setNotes]         = useState(eventItem.notes || '');
  // Per-item expected-return override. Lets a single item diverge from the
  // deployment's load-out timeline (going to repair, next event, etc.).
  // Default is empty — calendar falls back to event-level dates when blank.
  const isoToLocal = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const [expectedReturn, setExpectedReturn] = useState(isoToLocal(eventItem.expected_return_date));
  const [returning, setReturning]   = useState(false);
  const [retCondition, setRetCond]  = useState(eventItem.condition || 'good');
  const [retLocation, setRetLoc]    = useState(item?.storage_location || '');
  const [processedBy, setProcessed] = useState(admin.name);
  const [err, setErr]             = useState('');
  const [saving, setSaving]       = useState(false);

  async function save(e) {
    e.preventDefault(); setSaving(true); setErr('');
    const now = new Date().toISOString();
    try {
      const payload = { current_location: location.trim(), condition, notes: notes.trim(),
        expected_return_date: expectedReturn ? new Date(expectedReturn).toISOString() : null,
        updated_at: now, updated_by: admin.name };

      if (returning) {
        payload.status = 'returned';
        payload.returned_by = processedBy.trim() || admin.name;
        payload.returned_at = now;
        payload.condition_on_return = retCondition;
        payload.current_location = retLocation.trim();
        // update master item condition on return
        await sb.from('items').update({ condition: retCondition, updated_at: now, updated_by: admin.name })
          .eq('id', item.id);
      }

      const changes = diffObj(eventItem, payload, ['current_location','condition','notes']);
      const { data, error } = await sb.from('event_items').update(payload).eq('id', eventItem.id).select().single();
      if (error) throw error;

      const action = returning ? 'returned'
        : (changes.current_location && Object.keys(changes).length===1) ? 'location_updated'
        : (changes.condition && Object.keys(changes).length===1) ? 'condition_changed'
        : 'item_updated';

      if (returning || Object.keys(changes).length > 0) {
        await sb.from('history').insert({
          item_id: item.id, event_item_id: eventItem.id, event_id: eventItem.event_id,
          action, changes: returning
            ? { note: `Returned on ${new Date(now).toLocaleString()}. Sent to: ${retLocation.trim()||'—'}. Processed by: ${processedBy.trim()||admin.name}. Condition: ${CLABEL[retCondition]||retCondition}` }
            : changes,
          changed_by: admin.name, changed_at: now,
        });
      }
      onSaved(data); onClose();
    } catch(e) { setErr(friendlyError(e)); setSaving(false); }
  }

  async function removeFromEvent() {
    if (!await confirm({ title: 'Remove from event?', body: `Remove "${item?.name}" from this event? Its assignment record will be deleted.`, danger: true, confirmLabel: 'Remove' })) return;
    await sb.from('event_items').delete().eq('id', eventItem.id);
    onSaved(null); onClose();
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <form className="modal" onClick={e=>e.stopPropagation()} onSubmit={save}>
        <h2>{item?.name}</h2>
        <div style={{fontFamily:"'Azeret Mono',monospace",fontSize:11,color:'#7A7A7A',marginBottom:14}}>
          {item?.storage_location||'—'} · Assigned by {eventItem.assigned_by}
        </div>

        {!returning && <>
          <div className="field"><label>Current location at event</label>
            <input value={location} onChange={e=>setLocation(e.target.value)} placeholder="e.g. Main Stage" autoFocus />
          </div>
          <div className="field"><label>Condition</label>
            <select value={condition} onChange={e=>setCondition(e.target.value)}>
              {CONDITIONS.map(c=><option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div className="field"><label>Expected return (optional override)</label>
            <input type="datetime-local" value={expectedReturn} onChange={e=>setExpectedReturn(e.target.value)} />
            <div style={{fontSize:11,color:'#7A7A7A',marginTop:4,letterSpacing:'0.02em'}}>
              Leave blank to inherit the deployment's load-out time. Set when this item diverges — going to repair, next event, or staying out longer.
            </div>
          </div>
          <div className="field"><label>Notes</label>
            <textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Anything relevant" />
          </div>
        </>}

        {eventItem.status !== 'returned' && (
          <label className="check-row" style={{marginBottom:12}}>
            <input type="checkbox" checked={returning} onChange={e=>setReturning(e.target.checked)} style={{accentColor:'#B93A32',width:16,height:16}} />
            <span style={{fontFamily:"'Azeret Mono',monospace",fontSize:12,letterSpacing:'0.04em',textTransform:'uppercase'}}>Mark as returned</span>
          </label>
        )}

        {returning && (
          <>
            <div className="field"><label>Returned to (location sent)</label>
              <input value={retLocation} onChange={e=>setRetLoc(e.target.value)}
                placeholder={item?.storage_location || 'e.g. Warehouse — Shelf A1'} autoFocus />
            </div>
            <div className="field"><label>Processed by (who arranged transport)</label>
              <input value={processedBy} onChange={e=>setProcessed(e.target.value)}
                placeholder="Name of person who called transport" />
            </div>
            <div className="field"><label>Condition on return</label>
              <select value={retCondition} onChange={e=>setRetCond(e.target.value)}>
                {CONDITIONS.map(c=><option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div style={{background:'#1a1a1a',border:'1px solid #2a2a2a',padding:'10px 12px',marginBottom:14}}>
              <div style={{fontFamily:"'Azeret Mono',monospace",fontSize:10,color:'#7A7A7A',letterSpacing:'0.06em',textTransform:'uppercase',marginBottom:6}}>Return summary</div>
              <div style={{fontFamily:"'Azeret Mono',monospace",fontSize:12,display:'flex',flexDirection:'column',gap:4}}>
                <div><span style={{color:'#7A7A7A'}}>Date: </span>{new Date().toLocaleString()}</div>
                <div><span style={{color:'#7A7A7A'}}>Returned to: </span>{retLocation||'—'}</div>
                <div><span style={{color:'#7A7A7A'}}>Processed by: </span>{processedBy||'—'}</div>
              </div>
            </div>
          </>
        )}

        <div className="field"><label>Photos</label>
          <AttachmentStrip itemId={item?.id} eventItemId={eventItem.id} adminName={admin.name} isAdmin={true} />
        </div>

        <div className="err">{err}</div>
        <div className="actions">
          <button type="button" className="btn danger" onClick={removeFromEvent}>Remove</button>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? 'Saving…' : (returning ? 'Mark returned' : 'Save')}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------- deployment manifest (printable) ----------
function ManifestView({ event, eventItems, items, onClose }) {
  function doPrint() { window.print(); }
  const out      = eventItems.filter(ei => ei.status === 'out');
  const returned = eventItems.filter(ei => ei.status === 'returned');
  const generatedAt = new Date();

  return (
    <div className="backdrop label-backdrop" onClick={onClose}>
      <div className="modal manifest-modal" onClick={e => e.stopPropagation()}>
        <div className="actions no-print" style={{justifyContent:'space-between',marginTop:0,marginBottom:14}}>
          <h2 style={{margin:0}}>Deployment Manifest</h2>
          <div style={{display:'flex',gap:8}}>
            <button type="button" className="btn ghost" onClick={onClose}>Close</button>
            <button type="button" className="btn primary" onClick={doPrint}>Print / Save PDF</button>
          </div>
        </div>

        <div className="manifest-paper">
          <div className="manifest-head">
            <div style={{flex:1, minWidth:0}}>
              <div className="manifest-brand">SQUATWOLF</div>
              <div className="manifest-title">{event.name}</div>
              <div className="manifest-sub">
                {fmtDate(event.event_date)}
                {event.location ? ' · ' + event.location : ''}
              </div>
              <div className="manifest-meta">
                Generated {generatedAt.toLocaleString()}
              </div>
            </div>
            <div className="manifest-qr"
              dangerouslySetInnerHTML={{ __html: qrSvgString(eventUrl(event.id)) }} />
          </div>

          <div className="manifest-stats">
            <div><span className="manifest-stat-num">{eventItems.length}</span> Total</div>
            <div><span className="manifest-stat-num" style={{color:'#d48a34'}}>{out.length}</span> Out</div>
            <div><span className="manifest-stat-num" style={{color:'#5fcf7e'}}>{returned.length}</span> Returned</div>
          </div>

          {eventItems.length === 0 ? (
            <div className="empty" style={{marginTop:14}}>No items on this deployment.</div>
          ) : (
            <table className="manifest-table">
              <thead>
                <tr>
                  <th style={{width:'4%'}}>#</th>
                  <th>Item</th>
                  <th>Category</th>
                  <th>Condition</th>
                  <th>Status</th>
                  <th>Location</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {eventItems.map((ei, i) => {
                  const it = items[ei.item_id];
                  return (
                    <tr key={ei.id}>
                      <td>{i+1}</td>
                      <td className="m-item-name">{it?.name || '(missing)'}</td>
                      <td>{it?.category || '—'}</td>
                      <td>{CLABEL[ei.condition] || ei.condition || '—'}</td>
                      <td>{ei.status === 'returned' ? 'Returned' : 'Out'}</td>
                      <td>
                        {ei.status === 'returned'
                          ? `Sent to ${ei.current_location||'—'}`
                          : (ei.current_location || '—')}
                      </td>
                      <td>
                        {ei.status === 'returned'
                          ? `By ${ei.returned_by||'—'} · ${fmtTime(ei.returned_at)}${ei.condition_on_return && ei.condition_on_return!==ei.condition ? ' · '+(CLABEL[ei.condition_on_return]||ei.condition_on_return) : ''}`
                          : (ei.notes || '')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <div className="manifest-foot">
            Live link: {eventUrl(event.id)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- bulk return modal ----------
function BulkReturnModal({ event, eventItems, items, admin, onClose, onDone }) {
  const outItems = useMemo(
    () => eventItems.filter(ei => ei.status === 'out'),
    [eventItems]
  );

  const [defaultLocation, setDefaultLocation] = useState('');
  const [defaultCondition, setDefaultCondition] = useState('good');
  const [processedBy, setProcessedBy] = useState(admin?.name || '');
  const [overrides, setOverrides] = useState({});
  const [selected, setSelected] = useState(() => new Set(outItems.map(ei => ei.id)));
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [err, setErr] = useState('');

  const { safeClose } = useUnloadGuard(saving, onClose);

  function toggle(id) {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function setRowCondition(id, val) {
    setOverrides(prev => ({ ...prev, [id]: val }));
  }

  async function performReturn() {
    setSaving(true); setErr('');
    const ids = Array.from(selected);
    setProgress({ done: 0, total: ids.length });
    const now = new Date().toISOString();
    const procBy = (processedBy || admin?.name || '').trim();

    // Run all per-row updates in parallel (Promise.all) — typical 30-row return
    // drops from ~6s to <1s. Each row produces 3 writes (event_item, master item
    // mirror, history) as before, but they overlap network-wise instead of
    // queuing.
    try {
      const tasks = ids.map(async (eiId) => {
        const ei = outItems.find(x => x.id === eiId);
        if (!ei) return;
        const item = items[ei.item_id];
        const cond = overrides[eiId] || defaultCondition;
        const retLoc = (defaultLocation || item?.storage_location || '').trim();

        const payload = {
          status: 'returned',
          returned_by: procBy,
          returned_at: now,
          condition_on_return: cond,
          current_location: retLoc,
          condition: cond,
          updated_at: now,
          updated_by: admin?.name || procBy,
        };
        const { error: upErr } = await sb.from('event_items').update(payload).eq('id', eiId);
        if (upErr) throw upErr;

        // Fire master-item mirror + history insert in parallel
        await Promise.all([
          item ? sb.from('items').update({
            condition: cond, updated_at: now, updated_by: admin?.name || procBy,
          }).eq('id', item.id) : Promise.resolve(),
          sb.from('history').insert({
            item_id: ei.item_id, event_item_id: eiId, event_id: event.id,
            action: 'returned',
            changes: { note: `Returned (bulk) on ${new Date(now).toLocaleString()}. Sent to: ${retLoc||'—'}. Processed by: ${procBy||'—'}. Condition: ${CLABEL[cond]||cond}` },
            changed_by: admin?.name || procBy, changed_at: now,
          }),
        ]);
        setProgress(p => ({ done: p.done + 1, total: p.total }));
      });
      await Promise.all(tasks);
      onDone();
      onClose();
    } catch (e) {
      setErr(friendlyError(e));
      setSaving(false);
    }
  }

  if (outItems.length === 0) {
    return (
      <div className="backdrop" onClick={onClose}>
        <div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:420}}>
          <h2>Return all</h2>
          <div className="empty" style={{padding:'24px 16px'}}>No items currently out at this deployment.</div>
          <div className="actions"><button className="btn ghost" onClick={onClose}>Close</button></div>
        </div>
      </div>
    );
  }

  return (
    <div className="backdrop" onClick={safeClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <h2>Return all from {event.name}</h2>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14}}>
          <div className="field" style={{margin:0}}>
            <label>Return location (default)</label>
            <input value={defaultLocation} onChange={e=>setDefaultLocation(e.target.value)}
              placeholder="e.g. Warehouse — Shelf A1" />
          </div>
          <div className="field" style={{margin:0}}>
            <label>Default condition</label>
            <select value={defaultCondition} onChange={e=>setDefaultCondition(e.target.value)}>
              {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
        </div>
        <div className="field" style={{marginBottom:14}}>
          <label>Processed by</label>
          <input value={processedBy} onChange={e=>setProcessedBy(e.target.value)} placeholder="Who arranged transport" />
        </div>

        <div className="section-label" style={{marginTop:0}}>
          {selected.size} of {outItems.length} selected
          <span style={{float:'right'}}>
            <button type="button" className="link-btn" onClick={()=>setSelected(new Set(outItems.map(ei=>ei.id)))}>Select all</button>
            {' · '}
            <button type="button" className="link-btn" onClick={()=>setSelected(new Set())}>None</button>
          </span>
        </div>

        <div style={{maxHeight:340,overflowY:'auto',display:'flex',flexDirection:'column',gap:6}}>
          {outItems.map(ei => {
            const it = items[ei.item_id];
            const isSel = selected.has(ei.id);
            return (
              <label key={ei.id} className={`check-row${isSel?' selected':''}`}>
                <input type="checkbox" checked={isSel} onChange={()=>toggle(ei.id)}
                  style={{accentColor:'#B93A32',width:16,height:16}} />
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:16,letterSpacing:'0.04em',textTransform:'uppercase',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                    {it?.name || '—'}
                  </div>
                  <div style={{fontFamily:"'Azeret Mono',monospace",fontSize:11,color:'#7A7A7A'}}>
                    At: {ei.current_location || '—'}
                  </div>
                </div>
                <select value={overrides[ei.id] || defaultCondition}
                  onChange={e=>setRowCondition(ei.id, e.target.value)}
                  onClick={e=>e.preventDefault()}
                  style={{background:'#0e0e0e',border:'1px solid #2a2a2a',color:'#FAFAFA',padding:'4px 6px',fontSize:11,fontFamily:"'Azeret Mono',monospace"}}>
                  {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </label>
            );
          })}
        </div>

        {err && <div className="err" style={{marginTop:10}}>{err}</div>}

        {saving && (
          <div style={{marginTop:12,fontFamily:"'Azeret Mono',monospace",fontSize:12,color:'#d48a34'}}>
            Returning {progress.done}/{progress.total}…
          </div>
        )}

        <div className="actions" style={{marginTop:14}}>
          <button type="button" className="btn ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="btn primary" disabled={!selected.size || saving}
            onClick={()=>setConfirming(true)}>
            {saving ? 'Returning…' : `Return ${selected.size||''}`}
          </button>
        </div>

        {confirming && (
          <div className="backdrop" onClick={()=>!saving && setConfirming(false)} style={{zIndex:20}}>
            <div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:380}}>
              <h2>Are you sure?</h2>
              <div style={{fontFamily:"'Manrope',sans-serif",fontSize:14,color:'#EFEFEF',marginBottom:8}}>
                Mark <strong>{selected.size}</strong> item{selected.size===1?'':'s'} as returned from{' '}
                <strong>{event.name}</strong>?
              </div>
              <div style={{fontFamily:"'Azeret Mono',monospace",fontSize:11,color:'#7A7A7A',letterSpacing:'0.04em',textTransform:'uppercase',marginBottom:12}}>
                Sent to: {(defaultLocation||'item storage location').trim() || '—'} · Processed by: {processedBy||'—'}
              </div>
              <div className="actions">
                <button type="button" className="btn ghost" onClick={()=>setConfirming(false)} disabled={saving}>Cancel</button>
                <button type="button" className="btn primary" disabled={saving}
                  onClick={()=>{ setConfirming(false); performReturn(); }}>
                  {saving ? 'Returning…' : 'Yes, return all'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- quick-condition row ----------
// One-tap mid-event condition change on a deployment item card. The 4 most
// common targets: Good · Cleaning · Repair · Damaged. Tap = write + history,
// no modal. Reserves the Update modal for everything else (notes, location, return).
function QuickConditionRow({ ei, admin, onChanged }) {
  const [busy, setBusy] = useState(false);
  const opts = [
    { v: 'good',           short: 'Good',   pill: 'good' },
    { v: 'needs_cleaning', short: 'Clean',  pill: 'needs_cleaning' },
    { v: 'needs_repair',   short: 'Repair', pill: 'needs_repair' },
    { v: 'damaged',        short: 'Damage', pill: 'damaged' },
  ];
  async function set(newCond) {
    if (newCond === ei.condition || busy) return;
    setBusy(true);
    const now = new Date().toISOString();
    const { error } = await sb.from('event_items').update({
      condition: newCond, updated_at: now, updated_by: admin.name,
    }).eq('id', ei.id);
    if (!error) {
      // Mirror onto master item too so dashboards reflect immediately.
      await sb.from('items').update({
        condition: newCond, updated_at: now, updated_by: admin.name,
      }).eq('id', ei.item_id);
      await sb.from('history').insert({
        item_id: ei.item_id, event_item_id: ei.id, event_id: ei.event_id,
        action: 'condition_changed',
        changes: { condition: { from: ei.condition, to: newCond } },
        changed_by: admin.name, changed_at: now,
      });
      onChanged?.();
    }
    setBusy(false);
  }
  return (
    <div className="quick-cond">
      <span className="quick-cond-label">Quick set:</span>
      {opts.map(o => (
        <button key={o.v}
          type="button"
          disabled={busy || o.v === ei.condition}
          className={`quick-cond-pill ${o.pill}${o.v === ei.condition ? ' selected' : ''}`}
          onClick={()=>set(o.v)}>
          {o.short}
        </button>
      ))}
    </div>
  );
}

// ---------- event detail ----------
function EventDetail({ event, admin, onBack }) {
  const [eventItems, setEventItems] = useState([]);
  const [items, setItems]           = useState({});
  const [assignOpen, setAssignOpen] = useState(false);
  const [updating, setUpdating]     = useState(null);
  const [query, setQuery]           = useState('');
  const [filter, setFilter]         = useState('all');
  const [scanOpen, setScanOpen]     = useState(false);
  const [scanMsg, setScanMsg]       = useState('');
  const [scanLog, setScanLog]       = useState([]);    // continuous mode: [{ id, kind, label, canUndo }, ...]
  const [bulkOpen, setBulkOpen]     = useState(false);
  const [manifestOpen, setManifest] = useState(false);
  const [editOpen, setEditOpen]     = useState(false);
  const [dupOpen, setDupOpen]       = useState(false);
  const [delOpen, setDelOpen]       = useState(false);
  const [moreOpen, setMoreOpen]     = useState(false);  // overflow menu for Return all + Delete
  const [damageFor, setDamageFor]   = useState(null);  // { ei, item } when reporting damage on a row
  // Local copy of the event so edits reflect immediately without round-tripping
  // through EventsTab's list. (Parent list refreshes on next tab visit.)
  const [currentEvent, setCurrentEvent] = useState(event);

  async function load() {
    const { data: eis } = await sb.from('event_items').select('*').eq('event_id', event.id).order('assigned_at');
    if (!eis?.length) { setEventItems([]); return; }
    const itemIds = [...new Set(eis.map(e=>e.item_id))];
    const { data: its } = await sb.from('items').select('*').in('id', itemIds);
    const map = {};
    (its||[]).forEach(it => map[it.id] = it);
    setItems(map);
    setEventItems(eis);
  }

  useEffect(() => { load(); }, [event.id]);

  const existingItemIds = new Set(eventItems.map(ei => ei.item_id));

  // Continuous-mode scan: stays open, accumulates a log, supports Undo of the
  // most recent successful assign. Returns silently — feedback flows via setScanLog.
  function pushScan(entry) { setScanLog(prev => [...prev, entry]); }

  async function handleScan(itemId) {
    // de-dupe: ignore if last successful scan was this same item within the cooldown
    const last = scanLog[scanLog.length - 1];
    if (last && last.id === itemId && last.kind === 'ok' && Date.now() - (last.at || 0) < 2000) return;

    // already on this deployment? open update modal (single-mode behaviour)
    const existing = eventItems.find(ei => ei.item_id === itemId);
    if (existing) {
      setScanOpen(false);
      setUpdating(existing);
      return;
    }

    const { data: master } = await sb.from('items').select('*').eq('id', itemId).maybeSingle();
    if (!master) { pushScan({ id: itemId, kind: 'err', label: 'Unknown code — not in inventory', at: Date.now() }); return; }
    if (master.condition === 'retired') {
      pushScan({ id: itemId, kind: 'err', label: `"${master.name}" is retired`, at: Date.now() });
      return;
    }

    const { data: outAt } = await sb.from('event_items')
      .select('event_id, events(name)').eq('item_id', itemId).eq('status', 'out').limit(1);
    const elsewhere = (outAt||[]).find(r => r.event_id !== event.id);
    if (elsewhere) {
      pushScan({ id: itemId, kind: 'err', label: `"${master.name}" is out at ${elsewhere.events?.name||'another deployment'}`, at: Date.now() });
      return;
    }
    if (!admin) {
      pushScan({ id: itemId, kind: 'err', label: 'Sign in as admin to assign', at: Date.now() });
      return;
    }

    const now = new Date().toISOString();
    const { data: ei, error } = await sb.from('event_items').insert({
      event_id: event.id, item_id: itemId, status: 'out',
      assigned_by: admin.name, assigned_at: now, updated_at: now, updated_by: admin.name,
    }).select().single();
    if (error) {
      pushScan({ id: itemId, kind: 'err', label: `Failed: ${error.message}`, at: Date.now() });
      return;
    }
    await sb.from('history').insert({
      item_id: itemId, event_item_id: ei.id, event_id: event.id,
      action: 'assigned',
      changes: { note: `Assigned to deployment via scan: ${event.name}` },
      changed_by: admin.name, changed_at: now,
    });
    pushScan({ id: itemId, kind: 'ok', label: `Added: ${master.name}`, eiId: ei.id, canUndo: true, at: Date.now() });
    load();
  }

  async function undoLastScan() {
    const idx = [...scanLog].reverse().findIndex(s => s.kind === 'ok' && s.canUndo);
    if (idx === -1) return;
    const realIdx = scanLog.length - 1 - idx;
    const entry = scanLog[realIdx];
    if (!entry?.eiId) return;
    // Delete the event_item; cascades remove its history via FK in v2 schema (event_id ON DELETE CASCADE doesn't apply here, history references event_item_id ON DELETE CASCADE).
    await sb.from('event_items').delete().eq('id', entry.eiId);
    setScanLog(prev => prev.map((s, i) => i === realIdx ? { ...s, canUndo: false, kind: 'undone', label: `Undone: ${s.label.replace(/^Added: /,'')}` } : s));
    load();
  }

  function closeScanner() {
    setScanOpen(false);
    setScanLog([]);
    if (scanLog.some(s => s.kind === 'ok')) setScanMsg(`Added ${scanLog.filter(s => s.kind==='ok').length} item(s) via scan`);
  }

  const scanSuccessCount = scanLog.filter(s => s.kind === 'ok').length;
  const lastScanForToast = scanLog.length ? scanLog[scanLog.length - 1] : null;

  const filtered = eventItems.filter(ei => {
    const it = items[ei.item_id];
    if (!it) return false;
    if (filter === 'out'        && ei.status !== 'out') return false;
    if (filter === 'returned'   && ei.status !== 'returned') return false;
    if (filter === 'packed'     && (ei.status !== 'out' || !ei.packed_at)) return false;
    if (filter === 'not_packed' && (ei.status !== 'out' || ei.packed_at))  return false;
    if (query && !it.name.toLowerCase().includes(query.toLowerCase()) &&
        !(ei.current_location||'').toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  // Advance / regress / send-back the deployment's workflow_state. Each
  // transition logs to history so the timeline records the full lifecycle.
  // Send-back additionally requires a reason — that drops a comment in
  // event_comments tagged with a "Sent back:" prefix so the requester sees
  // it as a banner on the draft.
  async function setWorkflow(nextState, opts = {}) {
    if (!admin) return;
    const fromState = currentEvent.workflow_state || 'approved';

    // Send-back: reason is required. The styled SendBackModal in
    // WorkflowTracker collects + previews it before calling us. Older
    // call paths could still go through window.prompt as a fallback,
    // but the UI no longer triggers that path.
    let reason = opts.reason;
    if (opts.kind === 'send_back' && !reason) {
      reason = window.prompt('Why are you sending this back? The requester will see this on the draft.');
      if (!reason || !reason.trim()) return;
      reason = reason.trim();
    }

    const now = new Date().toISOString();
    const patch = { workflow_state: nextState, workflow_updated_at: now, workflow_updated_by: admin.name };
    setCurrentEvent(prev => ({ ...prev, ...patch }));
    try {
      const { data, error } = await sb.from('events').update(patch).eq('id', currentEvent.id).select().single();
      if (error) throw error;
      setCurrentEvent(data);
      await sb.from('history').insert({
        event_id: currentEvent.id,
        action: opts.kind === 'send_back' ? 'workflow_sent_back' : (opts.kind === 'rollback' ? 'workflow_rolled_back' : 'workflow_advanced'),
        changes: { from: fromState, to: nextState, note: reason || opts.note || null },
        changed_by: admin.name, changed_at: now,
      });
      // Drop the reason as a comment so the requester sees it as a banner.
      if (opts.kind === 'send_back' && reason) {
        const { data: sess } = await sb.auth.getUser();
        await sb.from('event_comments').insert({
          event_id: currentEvent.id,
          body: `↶ Sent back: ${reason}`,
          author_id: sess?.user?.id || null,
          author_name: admin.name,
        });
      }
      toast(opts.toast || `Moved to ${nextState}`, 'ok');
    } catch (e) {
      toast(`Couldn't update workflow: ${friendlyError(e)}`, 'err');
      load();
    }
  }

  const outCount      = eventItems.filter(ei=>ei.status==='out').length;
  const returnedCount = eventItems.filter(ei=>ei.status==='returned').length;
  // "Packed" only counts items still on the deployment (not yet returned).
  const packedCount   = eventItems.filter(ei=>ei.status==='out' && ei.packed_at).length;

  // Toggle the pack-list flag on a single event_item. Optimistic update +
  // history insert so the timeline reflects the checkpoint.
  async function togglePacked(ei) {
    if (!admin) return;
    const now = new Date().toISOString();
    const becomingPacked = !ei.packed_at;
    const patch = becomingPacked
      ? { packed_at: now, packed_by: admin.name, updated_at: now, updated_by: admin.name }
      : { packed_at: null, packed_by: null, updated_at: now, updated_by: admin.name };
    setEventItems(prev => prev.map(x => x.id === ei.id ? { ...x, ...patch } : x));
    try {
      const { error } = await sb.from('event_items').update(patch).eq('id', ei.id);
      if (error) throw error;
      await sb.from('history').insert({
        item_id: ei.item_id, event_item_id: ei.id, event_id: event.id,
        action: becomingPacked ? 'packed' : 'unpacked',
        changes: { note: becomingPacked ? `Marked packed for ${event.name}` : `Marked not packed for ${event.name}` },
        changed_by: admin.name, changed_at: now,
      });
    } catch (e) {
      toast(`Couldn't update pack status: ${friendlyError(e)}`, 'err');
      load();  // rollback by refetching
    }
  }

  return (
    <div>
      <div className="back-bar">
        <button className="btn sm ghost" onClick={onBack}>← Back</button>
        <div style={{flex:1,overflow:'hidden'}}>
          <div className="ev-name">{currentEvent.name}</div>
          <div className="ev-sub">{fmtDateRange(currentEvent)}{currentEvent.location ? ' · '+currentEvent.location : ''}</div>
          {currentEvent.departments && currentEvent.departments.length > 0 && (
            <div className="dept-chips dept-chips-readonly">
              {currentEvent.departments.map(d => (
                <span key={d} className="dept-chip on">{d}</span>
              ))}
            </div>
          )}
        </div>
        <button className="btn sm" onClick={()=>setScanOpen(true)}>⊟ Scan</button>
        {eventItems.length > 0 && (
          <button className="btn sm" onClick={()=>setManifest(true)} title="Printable manifest">⎙ Manifest</button>
        )}
        {admin && <button className="btn sm" onClick={()=>setEditOpen(true)} title="Edit deployment">✎ Edit</button>}
        {admin && eventItems.length > 0 && (
          <button className="btn sm" onClick={()=>setDupOpen(true)} title="Duplicate deployment">⎘ Duplicate</button>
        )}
        {admin && (outCount > 0 || admin.role === 'master') && (
          <div className="more-menu" onMouseLeave={()=>setMoreOpen(false)}>
            <button className="btn sm" onClick={()=>setMoreOpen(o=>!o)} title="More actions" aria-expanded={moreOpen}>⋯ More</button>
            {moreOpen && (
              <div className="more-menu-pop" onClick={()=>setMoreOpen(false)}>
                {outCount > 0 && (
                  <button className="more-menu-item" onClick={()=>setBulkOpen(true)}>↩ Return all out items</button>
                )}
                {admin.role === 'master' && (
                  <button className="more-menu-item more-menu-danger" onClick={()=>setDelOpen(true)}>🗑 Delete deployment</button>
                )}
              </div>
            )}
          </div>
        )}
        {admin && <button className="btn sm primary" onClick={()=>setAssignOpen(true)}>+ Assign</button>}
        {!admin && <LoginPrompt verb="manage" />}
      </div>
      {scanMsg && (
        <div style={{margin:'8px 14px 0',padding:'8px 12px',background:'#1a1a1a',border:'1px solid #2a2a2a',
                     fontFamily:"'Azeret Mono',monospace",fontSize:12,color:'#d48a34'}}>
          {scanMsg}
        </div>
      )}


      <div className="container deploy-layout">
        <div className="deploy-main">
        {currentEvent.workflow_state === 'requested' && admin?.role === 'master' && (
          <ApprovalActionBar event={currentEvent}
            onApprove={()=>setWorkflow('approved', { toast: 'Request approved' })}
            onSendBack={(reason)=>setWorkflow('draft', { kind: 'send_back', reason, toast: 'Sent back for revision' })} />
        )}
        <SendBackBanner event={currentEvent} />
        <PreflightBanner event={currentEvent} eventItems={eventItems} items={items} />
        {/* stats */}
        <div style={{display:'flex',gap:10,marginBottom:12}}>
          <div className="stat-box">
            <div className="stat-value">{eventItems.length}</div>
            <div className="stat-label">Total</div>
          </div>
          <div className="stat-box">
            <div className="stat-value" style={{color:'#5aafd4'}}>{packedCount}{outCount > 0 && <span style={{fontSize:14,color:'#7A7A7A',fontWeight:500}}> / {outCount}</span>}</div>
            <div className="stat-label">Packed</div>
          </div>
          <div className="stat-box">
            <div className="stat-value" style={{color:'#d4a534'}}>{outCount}</div>
            <div className="stat-label">Out</div>
          </div>
          <div className="stat-box">
            <div className="stat-value" style={{color:'#5fcf7e'}}>{returnedCount}</div>
            <div className="stat-label">Returned</div>
          </div>
        </div>

        <div className="controls">
          <input className="search" placeholder="Search items…" value={query} onChange={e=>setQuery(e.target.value)} />
          <select className="filter" value={filter} onChange={e=>setFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="out">Out</option>
            <option value="packed">Packed</option>
            <option value="not_packed">Not packed</option>
            <option value="returned">Returned</option>
          </select>
        </div>

        {filtered.length === 0 ? (
          <div className="empty">
            {eventItems.length === 0
              ? (admin ? <>No items assigned yet. <button className="link-btn" onClick={()=>setAssignOpen(true)}>Assign items →</button></> : 'No items assigned yet.')
              : 'No items match your filter.'}
          </div>
        ) : (
          <div className="items">
            {filtered.map(ei => {
              const it = items[ei.item_id];
              if (!it) return null;
              const cardClass = `item item-${ei.status === 'returned' ? 'returned' : 'out'}`;
              return (
                <div className={cardClass} key={ei.id}>
                  <div className="row">
                    <div className="name">{it.name}</div>
                    <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                      <span className={`badge ${ei.condition}`}>{CLABEL[ei.condition]}</span>
                      {ei.status === 'out' && ei.packed_at && (
                        <span className="badge status-packed">Packed</span>
                      )}
                      <span className={`badge ${ei.status==='returned'?'status-returned':'status-out'}`}>
                        {ei.status==='returned'?'Returned':'Out'}
                      </span>
                    </div>
                  </div>
                  <div className="fields">
                    {ei.status !== 'returned' && <><span className="k">Location</span><span className="v">{ei.current_location||'—'}</span></>}
                    <span className="k">Storage</span><span className="v">{it.storage_location||'—'}</span>
                    <span className="k">Assigned by</span><span className="v">{ei.assigned_by||'—'}</span>
                    {!ei.returned_at && ei.expected_return_date && (
                      <>
                        <span className="k">Back by</span>
                        <span className="v" style={{color:'var(--accent-info)'}}>{fmtTime(ei.expected_return_date)} <span style={{fontSize:10,opacity:0.7,letterSpacing:'0.04em'}}>· OVERRIDE</span></span>
                      </>
                    )}
                    {ei.returned_at && <>
                      <span className="k">Return date</span><span className="v">{fmtTime(ei.returned_at)}</span>
                      <span className="k">Returned to</span><span className="v">{ei.current_location||'—'}</span>
                      <span className="k">Processed by</span><span className="v">{ei.returned_by||'—'}</span>
                      <span className="k">Return cond.</span><span className="v">{CLABEL[ei.condition_on_return]||ei.condition_on_return||'—'}</span>
                    </>}
                    {!ei.returned_at && ei.current_location && <><span className="k">Location</span><span className="v">{ei.current_location}</span></>}
                    {ei.notes && <><span className="k">Notes</span><span className="v">{ei.notes}</span></>}
                  </div>
                  <div className="meta">Updated by {ei.updated_by||'—'} · {fmtTime(ei.updated_at)}</div>
                  {admin && ei.status !== 'returned' && (
                    <QuickConditionRow ei={ei} admin={admin} onChanged={load} />
                  )}
                  <div className="actions">
                    {admin && ei.status === 'out' && (
                      <button className={`btn sm${ei.packed_at ? '' : ' primary'}`}
                        onClick={()=>togglePacked(ei)}
                        title={ei.packed_at ? 'Mark not packed' : 'Mark as packed'}>
                        {ei.packed_at ? '↶ Unpack' : '✓ Pack'}
                      </button>
                    )}
                    {admin && ei.status === 'out' && (
                      <button className="btn sm" onClick={()=>setDamageFor({ ei, item: it })} title="Report damage">🛠 Damage</button>
                    )}
                    {admin && ei.status !== 'returned' && (
                      <button className="btn sm" onClick={()=>setUpdating(ei)}>Update</button>
                    )}
                    {admin && ei.status === 'returned' && (
                      <button className="btn sm" onClick={()=>setUpdating(ei)}>View</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <ActivityFeed event={currentEvent} />
        <CommentsPanel event={currentEvent} admin={admin} viewerName={admin?.name || ''} />
        </div>{/* /.deploy-main */}

        <aside className="deploy-sidebar">
          <WorkflowTracker event={currentEvent} admin={admin}
            isMaster={admin?.role === 'master'}
            onAdvance={setWorkflow} />
          <LogisticsPanel event={currentEvent} admin={admin} onEdit={()=>setEditOpen(true)} />
          <ContactsPanel event={currentEvent} admin={admin} />
        </aside>
      </div>

      {assignOpen && (
        <AssignItemsModal event={event} admin={admin} existingItemIds={existingItemIds}
          onClose={()=>setAssignOpen(false)} onAssigned={load} />
      )}
      {updating && (
        <UpdateEventItemModal
          eventItem={updating} item={items[updating.item_id]} admin={admin}
          onClose={()=>setUpdating(null)}
          onSaved={(data) => { load(); setUpdating(null); }}
        />
      )}
      {scanOpen && (
        <ScannerModal title="Scan to assign / update"
          mode="continuous"
          counter={scanSuccessCount}
          lastScan={lastScanForToast}
          onUndoLast={undoLastScan}
          onClose={closeScanner}
          onScan={handleScan} />
      )}
      {bulkOpen && (
        <BulkReturnModal event={event} eventItems={eventItems} items={items} admin={admin}
          onClose={()=>setBulkOpen(false)} onDone={load} />
      )}
      {manifestOpen && (
        <ManifestView event={event} eventItems={eventItems} items={items}
          onClose={()=>setManifest(false)} />
      )}
      {editOpen && (
        <EventFormModal admin={admin} event={currentEvent}
          onClose={()=>setEditOpen(false)}
          onSaved={(updated)=>setCurrentEvent(updated)} />
      )}
      {dupOpen && (
        <DuplicateEventModal admin={admin} source={currentEvent} sourceItems={eventItems}
          onClose={()=>setDupOpen(false)}
          onDuplicated={(newEv)=>{ setDupOpen(false); onBack(); /* parent re-renders Events list */ toast(`Duplicated to "${newEv.name}"`, 'ok'); }}
        />
      )}
      {damageFor && (
        <DamageReportModal item={damageFor.item} eventItem={damageFor.ei} admin={admin}
          onClose={()=>setDamageFor(null)}
          onSaved={()=>{ setDamageFor(null); load(); toast('Damage reported', 'ok'); }} />
      )}
      {delOpen && (
        <DeleteDeploymentModal event={currentEvent} eventItems={eventItems} admin={admin}
          onClose={()=>setDelOpen(false)}
          onReturnAll={()=>{ setDelOpen(false); setBulkOpen(true); }}
          onDeleted={()=>{ toast(`Deleted "${currentEvent.name}"`, 'ok'); onBack(); }} />
      )}
    </div>
  );
}

// ---------- items tab (master list) ----------
function ItemsTab({ admin, openItemId, onOpened }) {
  const [items, setItems]       = useState([]);
  const [outMap, setOutMap]     = useState({}); // item_id → event name for checked-out items
  const thumbs                  = useItemThumbs();
  const [query, setQuery]       = useState('');
  const [catFilter, setCat]     = useState('all');
  const [condFilter, setCond]   = useState('all');
  const [locFilter, setLoc]     = useState('all');
  const [addOpen, setAddOpen]   = useState(false);
  const [viewing, setViewing]   = useState(null);
  const [editing, setEditing]   = useState(null);
  const [labelsOpen, setLabels] = useState(false);
  const [importOpen, setImport] = useState(false);

  function exportCsv() {
    const headers = ['name','category','storage_location','condition','notes','updated_at','updated_by'];
    const csv = toCsv(items, headers);
    const stamp = new Date().toISOString().slice(0,10);
    downloadFile(`squatwolf-inventory-${stamp}.csv`, csv);
  }

  // open by id (used by deep-link or scan from topbar)
  useEffect(() => {
    if (!openItemId || !items.length) return;
    const it = items.find(x => x.id === openItemId);
    if (it) {
      setViewing(it);
      onOpened?.();
    }
  }, [openItemId, items]);

  useEffect(() => {
    sb.from('items').select('*').order('name').then(({ data }) => setItems(data || []));
    // load which items are currently out and which deployment they're in
    sb.from('event_items').select('item_id, events(name)').eq('status', 'out')
      .then(({ data }) => {
        const m = {};
        (data||[]).forEach(r => { m[r.item_id] = r.events?.name || 'Unknown'; });
        setOutMap(m);
      });
  }, []);

  // realtime — items table
  useEffect(() => {
    const ch = sb.channel('items-master')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'items' },
        ({ new: it }) => setItems(prev => [...prev, it].sort((a,b)=>a.name.localeCompare(b.name))))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'items' },
        ({ new: it }) => setItems(prev => prev.map(p => p.id===it.id ? it : p)))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'items' },
        ({ old }) => setItems(prev => prev.filter(p => p.id !== old.id)))
      .subscribe();
    return () => sb.removeChannel(ch);
  }, []);

  // realtime — keep out-status in sync when event_items change
  useEffect(() => {
    const ch = sb.channel('event-items-status')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_items' }, () => {
        sb.from('event_items').select('item_id, events(name)').eq('status', 'out')
          .then(({ data }) => {
            const m = {};
            (data||[]).forEach(r => { m[r.item_id] = r.events?.name || 'Unknown'; });
            setOutMap(m);
          });
      })
      .subscribe();
    return () => sb.removeChannel(ch);
  }, []);

  // Distinct storage locations across the inventory, alphabetised.
  // "(no location)" sentinel groups items missing a storage_location.
  const NO_LOC = '(no location)';
  const locOptions = Array.from(new Set(items.map(it => it.storage_location?.trim() || NO_LOC))).sort();

  const filtered = items.filter(it => {
    if (catFilter !== 'all' && it.category !== catFilter) return false;
    // Hide retired items unless the user explicitly filters for them.
    if (condFilter === 'retired') {
      if (it.condition !== 'retired') return false;
    } else {
      if (it.condition === 'retired') return false;
      if (condFilter !== 'all' && it.condition !== condFilter) return false;
    }
    if (locFilter !== 'all') {
      const loc = it.storage_location?.trim() || NO_LOC;
      if (loc !== locFilter) return false;
    }
    if (query && !it.name.toLowerCase().includes(query.toLowerCase()) &&
        !(it.storage_location||'').toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="container">
      <div className="controls">
        <input className="search" placeholder="Search items…" value={query} onChange={e=>setQuery(e.target.value)} />
        <select className="filter" value={catFilter} onChange={e=>setCat(e.target.value)}>
          <option value="all">All categories</option>
          {CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
        <select className="filter" value={locFilter} onChange={e=>setLoc(e.target.value)}>
          <option value="all">All locations</option>
          {locOptions.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <select className="filter" value={condFilter} onChange={e=>setCond(e.target.value)}>
          <option value="all">All conditions</option>
          {CONDITIONS.map(c=><option key={c.value} value={c.value}>{c.label}</option>)}
          <option value="retired">Retired (hidden)</option>
        </select>
        {admin && <button className="btn primary" onClick={()=>setAddOpen(true)}>+ Add item</button>}
        {admin && items.length > 0 && (
          <button className="btn" onClick={()=>setLabels(true)} title="Print labels">⎙ Labels</button>
        )}
        {items.length > 0 && (
          <button className="btn" onClick={exportCsv} title="Download CSV">↓ Export</button>
        )}
        {admin && (
          <button className="btn" onClick={()=>setImport(true)} title="Bulk add from CSV">↑ Import</button>
        )}
        {!admin && <LoginPrompt verb="add or edit items" />}
      </div>
      {locFilter !== 'all' && (() => {
        const here = items.filter(it => (it.storage_location?.trim() || NO_LOC) === locFilter && it.condition !== 'retired');
        const out  = here.filter(it => outMap[it.id]).length;
        const attn = here.filter(it => ['damaged','needs_repair','needs_cleaning'].includes(it.condition)).length;
        return (
          <div className="loc-summary">
            <span className="loc-summary-name">📍 {locFilter}</span>
            <span className="loc-summary-stat">{here.length} items</span>
            <span className="loc-summary-stat" style={{color: out > 0 ? 'var(--accent-out)' : undefined}}>{out} out</span>
            <span className="loc-summary-stat" style={{color: attn > 0 ? 'var(--accent-warn)' : undefined}}>{attn} need attention</span>
          </div>
        );
      })()}

      {filtered.length === 0 ? (
        <div className="empty">
          {items.length === 0
            ? (admin
                ? <div style={{display:'flex',flexDirection:'column',gap:10,alignItems:'center'}}>
                    <div>No items yet — let's get the inventory started.</div>
                    <div style={{display:'flex',gap:8,flexWrap:'wrap',justifyContent:'center'}}>
                      <button className="btn primary" onClick={()=>setAddOpen(true)}>+ Add your first item</button>
                      <button className="btn" onClick={()=>setImport(true)}>↑ Import from CSV</button>
                    </div>
                  </div>
                : 'No items in inventory yet.')
            : 'No items match your filters.'}
        </div>
      ) : (
        <div className="items items-grid">
          {filtered.map(it => {
            const isOut       = !!outMap[it.id];
            const isRetired   = it.condition === 'retired';
            const needsAttn   = ['damaged','needs_repair','needs_cleaning'].includes(it.condition);
            const tileCls     = ['item-tile', 'clickable',
              isOut     && 'item-tile-out',
              isRetired && 'item-tile-retired',
              needsAttn && 'item-tile-attention',
            ].filter(Boolean).join(' ');
            const initial = (it.category || it.name || '?').trim().charAt(0).toUpperCase();
            return (
              <div className={tileCls} key={it.id} onClick={()=>setViewing(it)}>
                <div className="item-tile-photo">
                  {thumbs[it.id]
                    ? <img src={thumbs[it.id]} alt="" loading="lazy" />
                    : <div className="item-tile-photo-fallback" data-initial={initial}>{initial}</div>}
                  {isOut && <span className="item-tile-overlay status-out">Out</span>}
                  {isRetired && <span className="item-tile-overlay item-tile-overlay-retired">Retired</span>}
                </div>
                <div className="item-tile-body">
                  <div className="item-tile-name">{it.name}</div>
                  <div className="item-tile-meta">
                    {it.category || 'Uncategorized'}
                    {it.storage_location && <> · {it.storage_location}</>}
                  </div>
                  {it.condition !== 'good' && it.condition !== 'retired' && (
                    <span className={`badge ${it.condition}`}>{CLABEL[it.condition]}</span>
                  )}
                  {isOut && (
                    <div className="item-tile-out-line">In use for {outMap[it.id]}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {addOpen && (
        <ItemFormModal admin={admin} onClose={()=>setAddOpen(false)}
          onSaved={it => { if (it) setItems(prev => [...prev, it].sort((a,b)=>a.name.localeCompare(b.name))); }} />
      )}
      {viewing && (
        <ItemDetailModal item={viewing} admin={admin} onClose={()=>setViewing(null)}
          onEdit={()=>{ setEditing(viewing); setViewing(null); }} />
      )}
      {editing && (
        <ItemFormModal initial={editing} admin={admin} onClose={()=>setEditing(null)}
          onSaved={it => {
            if (it) setItems(prev => prev.map(p => p.id===it.id ? it : p));
            else setItems(prev => prev.filter(p => p.id !== editing.id));
            setEditing(null);
          }} />
      )}
      {labelsOpen && (
        <LabelSheet items={items} onClose={()=>setLabels(false)} />
      )}
      {importOpen && (
        <CsvImportModal admin={admin} existingItems={items}
          onClose={()=>setImport(false)}
          onImported={() => {
            // realtime sub will refresh the list, but force a reload for snappy feedback
            sb.from('items').select('*').order('name').then(({ data }) => setItems(data || []));
          }}
        />
      )}
    </div>
  );
}

// ---------- dashboard tab ----------
const OVERDUE_DAYS = 7;

function DashboardTab({ admin, onGoTo }) {
  const [items, setItems]     = useState(null);
  const [outRows, setOut]     = useState([]);   // event_items rows with status='out' + joined event
  const [upcoming, setUpcoming] = useState([]); // future events with their assigned event_items nested
  const [viewing, setViewing] = useState(null);
  const thumbs = useItemThumbs();

  async function load() {
    try {
      const todayIso = new Date().toISOString().slice(0, 10);
      const [itemsRes, outRes, upRes] = await Promise.all([
        sb.from('items').select('*').order('name'),
        sb.from('event_items').select('*, events(id, name, event_date)').eq('status','out'),
        // events from today onward, with their assigned items nested for the
        // thumb strip + count. limit 10 — anything further out belongs in the
        // Deployments tab, not the dashboard.
        sb.from('events')
          .select('id, name, event_date, event_start_at, event_end_at, location, departments, event_items(item_id, status, packed_at)')
          .gte('event_date', todayIso)
          .order('event_date', { ascending: true })
          .limit(10),
      ]);
      const errs = [itemsRes.error, outRes.error, upRes.error].filter(Boolean);
      if (errs.length) toast(`Couldn't load all dashboard data: ${friendlyError(errs[0])}`, 'err');
      setItems(itemsRes.data || []);
      setOut(outRes.data || []);
      setUpcoming(upRes.data || []);
    } catch (e) {
      toast(`Couldn't load dashboard: ${friendlyError(e)}`, 'err');
      setItems([]); setOut([]); setUpcoming([]);
    }
  }
  useEffect(() => { load(); }, []);

  // realtime — items, deployments, and assignments all feed this view
  useEffect(() => {
    const ch = sb.channel('dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'items' },       load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_items' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' },      load)
      .subscribe();
    return () => sb.removeChannel(ch);
  }, []);

  if (items === null) return <div className="container"><div className="empty">Loading…</div></div>;

  const itemMap = {};
  items.forEach(it => itemMap[it.id] = it);

  // Currently out — group by deployment, mark which rows are overdue
  const cutoff = Date.now() - OVERDUE_DAYS * 24 * 3600 * 1000;
  const isOverdueRow = (r) => {
    const d = r.events?.event_date ? new Date(r.events.event_date).getTime() : null;
    return d !== null && d < cutoff;
  };
  const outByEvent = {};
  outRows.forEach(r => {
    const eid = r.events?.id || r.event_id;
    if (!outByEvent[eid]) outByEvent[eid] = { event: r.events, rows: [] };
    outByEvent[eid].rows.push(r);
  });
  const outDeployments = Object.values(outByEvent);
  const overdueCount = outRows.filter(isOverdueRow).length;

  // Needs attention — items in damaged / needs_repair / needs_cleaning
  const needsAttention = items.filter(it =>
    it.condition === 'damaged' || it.condition === 'needs_repair' || it.condition === 'needs_cleaning'
  );

  const totalOut = outRows.length;

  // One-tap return from the dashboard. Reuses the same payload shape as the
  // bulk-return flow in EventDetail so the data ends up identical.
  async function markReturned(r) {
    const item = itemMap[r.item_id];
    const ok = await confirm({
      title: 'Mark returned?',
      body: `Mark "${item?.name || 'this item'}" as returned?`,
      confirmLabel: 'Mark returned',
    });
    if (!ok) return;

    const now    = new Date().toISOString();
    const cond   = r.condition || item?.condition || 'good';
    const retLoc = item?.storage_location || '';

    try {
      const { error: upErr } = await sb.from('event_items').update({
        status: 'returned',
        returned_by: admin.name,
        returned_at: now,
        condition_on_return: cond,
        current_location: retLoc,
        condition: cond,
        updated_at: now,
        updated_by: admin.name,
      }).eq('id', r.id);
      if (upErr) throw upErr;

      await Promise.all([
        item ? sb.from('items').update({
          condition: cond, updated_at: now, updated_by: admin.name,
        }).eq('id', item.id) : Promise.resolve(),
        sb.from('history').insert({
          item_id: r.item_id, event_item_id: r.id, event_id: r.event_id,
          action: 'returned',
          changes: { note: `Marked returned from dashboard. Sent to: ${retLoc||'—'}.` },
          changed_by: admin.name, changed_at: now,
        }),
      ]);

      toast(`Marked "${item?.name||'item'}" as returned`, 'ok');
      setOut(prev => prev.filter(x => x.id !== r.id));  // realtime will resync, but make UI feel instant
    } catch (e) {
      toast(`Couldn't mark returned: ${friendlyError(e)}`, 'err');
    }
  }

  return (
    <div className="container">
      {/* KPI row — leads with action-oriented numbers, not vanity totals */}
      <div className="kpi-row">
        <div className={`stat-box${upcoming.length > 0 ? ' alert info' : ''}`}>
          <div className="stat-value">{upcoming.length}</div>
          <div className="stat-label">Up next</div>
        </div>
        <div className={`stat-box${totalOut > 0 ? ' alert' : ''}`}>
          <div className="stat-value">{totalOut}</div>
          <div className="stat-label">Items out</div>
        </div>
        <div className={`stat-box${overdueCount > 0 ? ' alert danger' : ''}`}>
          <div className="stat-value">{overdueCount}</div>
          <div className="stat-label">Overdue</div>
        </div>
        <div className={`stat-box${needsAttention.length > 0 ? ' alert' : ''}`}>
          <div className="stat-value">{needsAttention.length}</div>
          <div className="stat-label">Needs attention</div>
        </div>
      </div>

      {/* Up next — upcoming deployments lead the dashboard */}
      <DashSection
        title="Up next"
        emptyText="No upcoming deployments scheduled."
      >
        {upcoming.map(ev => (
          <UpcomingCard key={ev.id} ev={ev} itemMap={itemMap} thumbs={thumbs}
            onOpen={()=>onGoTo?.('events', ev.id)} />
        ))}
      </DashSection>

      {/* Currently out — by deployment, overdue rows highlighted via the
          .dash-row-overdue accent border */}
      <DashSection
        title="Currently out"
        emptyText="ALL CLEAR — NOTHING CHECKED OUT"
        allClear
      >
        {outDeployments.map(({event, rows}) => (
          <div className="dash-group" key={event?.id || Math.random()}>
            <div className="dash-group-head">
              <span className="dash-group-name">{event?.name || '(unknown deployment)'}</span>
              <span className="dash-group-count">{rows.length}</span>
            </div>
            {rows.map(r => {
              const it = itemMap[r.item_id];
              const overdue = isOverdueRow(r);
              const days = r.events?.event_date
                ? Math.floor((Date.now() - new Date(r.events.event_date).getTime())/(24*3600*1000))
                : null;
              const cls = overdue ? 'dash-row dash-row-overdue' : 'dash-row dash-row-out';
              return (
                <div className={cls} key={r.id} onClick={()=>it && setViewing(it)}>
                  <ItemThumb url={thumbs[r.item_id]} name={it?.name} category={it?.category} />
                  <div style={{flex:1,minWidth:0}}>
                    <div className="dash-row-name">{it?.name || '(missing item)'}</div>
                    <div className="dash-row-sub">
                      At: {r.current_location||'—'}
                      {overdue && days != null && <> · <span style={{color:'var(--accent-bad)'}}>{days}d past event</span></>}
                    </div>
                  </div>
                  <span className={`badge ${r.condition||'good'}`}>{CLABEL[r.condition]||r.condition||'—'}</span>
                  {admin && (
                    <button className="btn dash-row-action"
                      onClick={(e)=>{ e.stopPropagation(); markReturned(r); }}
                      title="Mark returned">
                      ✓ Return
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </DashSection>

      {/* Needs attention — items in damaged / repair / cleaning states */}
      <DashSection
        title="Needs attention"
        emptyText="ALL CLEAR — EVERYTHING IN GOOD CONDITION"
        allClear
      >
        {needsAttention.map(it => (
          <div className="dash-row dash-row-attention" key={it.id} onClick={()=>setViewing(it)}>
            <ItemThumb url={thumbs[it.id]} name={it.name} category={it.category} />
            <div style={{flex:1,minWidth:0}}>
              <div className="dash-row-name">{it.name}</div>
              <div className="dash-row-sub">{it.category||'—'} · {it.storage_location||'No storage set'}</div>
            </div>
            <span className={`badge ${it.condition}`}>{CLABEL[it.condition]}</span>
          </div>
        ))}
      </DashSection>

      {viewing && (
        <ItemDetailModal item={viewing} admin={admin} onClose={()=>setViewing(null)}
          onEdit={()=>setViewing(null)} />
      )}
    </div>
  );
}

// ---------- Upcoming deployment card ----------
// Used on the dashboard's "Up next" section. Larger than a row to give the
// date prominence and the assigned-items thumb strip room to breathe.
function UpcomingCard({ ev, itemMap, thumbs, onOpen }) {
  const date = ev.event_date ? new Date(ev.event_date + 'T00:00:00') : null;
  const today = new Date(); today.setHours(0,0,0,0);
  const dayMs = 24 * 3600 * 1000;
  const daysOff = date ? Math.round((date.getTime() - today.getTime()) / dayMs) : null;
  const relLabel =
    daysOff === 0  ? 'Today' :
    daysOff === 1  ? 'Tomorrow' :
    daysOff != null && daysOff <= 7 ? `In ${daysOff} days` :
    date ? date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) :
    'Date TBD';
  const monthLabel = date ? date.toLocaleDateString(undefined, { month: 'short' }).toUpperCase() : '—';
  const dayLabel   = date ? date.getDate() : '?';
  const eis = ev.event_items || [];
  const itemCount = eis.length;
  const stripItems = eis.slice(0, 5).map(ei => itemMap[ei.item_id]).filter(Boolean);
  const overflow = Math.max(0, itemCount - stripItems.length);
  // Pack progress — only counts assignments still on the deployment, not returned ones
  const onDeploy = eis.filter(ei => ei.status !== 'returned');
  const packed   = onDeploy.filter(ei => ei.packed_at).length;
  const packPct  = onDeploy.length === 0 ? 0 : Math.round((packed / onDeploy.length) * 100);
  const allPacked = onDeploy.length > 0 && packed === onDeploy.length;

  return (
    <div className="upcoming-card clickable" onClick={onOpen}>
      <div className="upcoming-date">
        <div className="upcoming-date-day">{dayLabel}</div>
        <div className="upcoming-date-month">{monthLabel}</div>
      </div>
      <div className="upcoming-body">
        <div className="upcoming-head">
          <div className="upcoming-name">{ev.name}</div>
          <div className="upcoming-rel">{relLabel}</div>
        </div>
        <div className="upcoming-sub">
          {ev.location || 'No location set'}
          {' · '}
          {itemCount === 0 ? 'No items assigned yet' : `${itemCount} item${itemCount === 1 ? '' : 's'}`}
        </div>
        {ev.departments && ev.departments.length > 0 && (
          <div className="dept-chips dept-chips-readonly dept-chips-small">
            {ev.departments.map(d => <span key={d} className="dept-chip on">{d}</span>)}
          </div>
        )}
        {onDeploy.length > 0 && (
          <div className={`pack-progress${allPacked ? ' done' : ''}`} title={`${packed} of ${onDeploy.length} packed`}>
            <div className="pack-progress-bar"><div className="pack-progress-fill" style={{width: packPct + '%'}} /></div>
            <div className="pack-progress-label">
              {allPacked ? 'All packed' : `Packed ${packed} / ${onDeploy.length}`}
            </div>
          </div>
        )}
        {stripItems.length > 0 && (
          <div className="upcoming-strip">
            {stripItems.map((it, i) => (
              <ItemThumb key={i} url={thumbs[it.id]} name={it.name} category={it.category} />
            ))}
            {overflow > 0 && <span className="upcoming-strip-more">+{overflow}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function DashSection({ title, emptyText, allClear, children }) {
  const arr = React.Children.toArray(children).filter(Boolean);
  return (
    <div className="dash-section">
      <div className="dash-section-head">{title}</div>
      {arr.length === 0
        ? <div className={`dash-empty${allClear ? ' allclear' : ''}`}>{emptyText}</div>
        : <div className="dash-list">{arr}</div>}
    </div>
  );
}

// ---------- calendar tab ----------
// Horizontal-bar timeline of deployments. Each row is one event; the bar
// spans event_start_date → event_end_date. Today marker is a vertical line.
// Colour reflects workflow_state — overdue deployments (end-date passed but
// items still out) get the danger tint regardless of state.
//
// Default window: today − 7 days through today + 21. Prev/next paginate by
// 14-day windows. Falls back gracefully for events that pre-date the schema
// migration and only have a single event_date.
function CalendarTab({ onOpenDeployment, onOpenItem }) {
  // 'item' (default): one row per master item, bars per active assignment.
  //   Answers "where's my mannequin and when do I get it back?".
  // 'deployment': one row per event, single bar spanning event_start → end.
  //   Useful for the high-level "what's happening this fortnight" view.
  const [view,     setView]    = useState('item');
  const [deptFilter, setDept]  = useState('all');
  const [events,   setEvents]  = useState(null);
  const [eis,      setEis]     = useState([]);
  const [items,    setItems]   = useState({});
  const [winStart, setWinStart] = useState(() => {
    const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - 7); return d;
  });
  const WINDOW_DAYS = 28;
  const winEnd = new Date(winStart); winEnd.setDate(winStart.getDate() + WINDOW_DAYS - 1);

  async function load() {
    // Fetch every event — for SQUATWOLF's scale this stays well under any
    // size concern, and it avoids two failure modes the windowed query had:
    //   1. Item view going empty when out-items reference events outside the
    //      visible window (e.g. an item that was supposed to come back two
    //      weeks ago — the most overdue, most actionable case).
    //   2. Date-only DATE columns parsed in UTC vs. local-time window boundary
    //      drifting bars by a day across timezones.
    // Both views filter / clamp client-side instead.
    const { data: evs } = await sb.from('events')
      .select('id, name, event_date, event_start_date, event_end_date, event_start_at, event_end_at, location, workflow_state, departments, load_in_at, load_out_at')
      .order('event_start_at', { ascending: true, nullsFirst: false });

    const { data: eiRows } = await sb.from('event_items')
      .select('id, event_id, item_id, status, packed_at, expected_return_date')
      .eq('status', 'out');

    const itemIds = [...new Set((eiRows || []).map(e => e.item_id))];
    let itemsMap = {};
    if (itemIds.length) {
      const { data: its } = await sb.from('items').select('id, name, category, storage_location').in('id', itemIds);
      (its || []).forEach(it => { itemsMap[it.id] = it; });
    }

    setEvents(evs || []);
    setEis(eiRows || []);
    setItems(itemsMap);
  }
  useEffect(() => { load(); }, [winStart.getTime()]);

  useEffect(() => {
    const ch = sb.channel('calendar')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' },       load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_items' }, load)
      .subscribe();
    return () => sb.removeChannel(ch);
  }, [winStart.getTime()]);

  if (events === null) return <div className="container"><div className="empty">Loading…</div></div>;

  const dayMs = 24 * 3600 * 1000;
  const today = new Date(); today.setHours(0,0,0,0);

  const days = [];
  for (let i = 0; i < WINDOW_DAYS; i++) {
    const d = new Date(winStart); d.setDate(winStart.getDate() + i);
    days.push(d);
  }

  function offsetPct(date) {
    const dt = new Date(date); dt.setHours(0,0,0,0);
    const off = (dt.getTime() - winStart.getTime()) / dayMs;
    return (off / WINDOW_DAYS) * 100;
  }

  function shift(days) {
    setWinStart(prev => { const d = new Date(prev); d.setDate(prev.getDate() + days); return d; });
  }
  function jumpToToday() {
    const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - 7);
    setWinStart(d);
  }

  // ── Compute rows for the active view ───────────────────────────────────────
  // Department filter applies to both views — narrows the event set first.
  const eventsForView = deptFilter === 'all'
    ? events
    : events.filter(ev => (ev.departments || []).includes(deptFilter));
  let rows = [];
  let emptyText = '';

  if (view === 'item') {
    // Build per-item row: each event_item still 'out' yields a bar from its
    // shipping start to its return (with sensible fallbacks). Multiple bars
    // per item are possible (rare — same item assigned to two events) but
    // supported.
    const eventsById = {};
    eventsForView.forEach(ev => { eventsById[ev.id] = ev; });
    const byItem = {};
    eis.forEach(ei => {
      const ev = eventsById[ei.event_id];
      const it = items[ei.item_id];
      if (!ev || !it) return;
      // Bar dates: prefer item-level overrides, fall back to event-level.
      // Order favours the most-precise source (timestamp) at each tier.
      const startSrc = ei.packed_at || ev.load_in_at || ev.event_start_at || ev.event_start_date || ev.event_date;
      const endSrc   = ei.expected_return_date || ev.load_out_at || ev.event_end_at || ev.event_end_date || ev.event_date;
      if (!startSrc || !endSrc) return;
      let startD = new Date(startSrc);
      let endD   = new Date(endSrc);
      // Overdue: event end has passed but the item is still 'out' (workflow
      // not closed). Always include overdue bars even if their dates predate
      // the visible window — they're the most actionable rows on this page.
      const overdue = endD.getTime() < today.getTime() && ev.workflow_state !== 'closed';
      if (overdue && endD < winStart) {
        // Bar is entirely before the window. Show a marker spanning
        // [winStart, today] so the user sees there's an overdue item
        // without needing to pan the calendar.
        startD = new Date(winStart);
        endD   = new Date(today);
      } else if (!overdue && (endD < winStart || startD > winEnd)) {
        return;
      }
      if (!byItem[it.id]) byItem[it.id] = { item: it, bars: [] };
      byItem[it.id].bars.push({ ei, ev, startD, endD, overdue });
    });
    rows = Object.values(byItem);
    rows.sort((a, b) => {
      const aOver = a.bars.some(x => x.overdue);
      const bOver = b.bars.some(x => x.overdue);
      if (aOver !== bOver) return aOver ? -1 : 1;
      const aMin = Math.min(...a.bars.map(x => x.startD.getTime()));
      const bMin = Math.min(...b.bars.map(x => x.startD.getTime()));
      return aMin - bMin;
    });
    emptyText = 'No items out in this window.';
  } else {
    // Deployment view — one bar per event spanning its date range
    const outCountByEvent = {};
    eis.forEach(r => { outCountByEvent[r.event_id] = (outCountByEvent[r.event_id] || 0) + 1; });
    const decorated = eventsForView.map(ev => {
      // Prefer timestamps; fall back to dates parsed at local midnight so
      // the comparison with winStart/winEnd (also local midnight) is honest.
      const startSrc = ev.event_start_at || ev.event_start_date || ev.event_date;
      const endSrc   = ev.event_end_at   || ev.event_end_date   || ev.event_date || startSrc;
      if (!startSrc) return null;
      const startD = ev.event_start_at ? new Date(startSrc) : new Date(startSrc + 'T00:00:00');
      const endD   = ev.event_end_at   ? new Date(endSrc)   : new Date(endSrc   + 'T00:00:00');
      const itemsStillOut = outCountByEvent[ev.id] || 0;
      const overdue = endD.getTime() < today.getTime() && itemsStillOut > 0;
      // Show only events whose range intersects the visible window —
      // OR overdue events with items still out (always actionable).
      const intersects = !(endD < winStart || startD > winEnd);
      if (!intersects && !overdue) return null;
      return { ev, startD, endD, itemsStillOut, overdue };
    }).filter(Boolean);
    decorated.sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      return a.startD.getTime() - b.startD.getTime();
    });
    rows = decorated;
    emptyText = 'No deployments in this window.';
  }

  return (
    <div className="container">
      <div className="cal-toolbar">
        <div className="cal-view-toggle">
          <button type="button" className={view === 'item' ? 'on' : ''} onClick={()=>setView('item')}>By item</button>
          <button type="button" className={view === 'deployment' ? 'on' : ''} onClick={()=>setView('deployment')}>By deployment</button>
        </div>
        <select className="filter" value={deptFilter} onChange={e=>setDept(e.target.value)}>
          <option value="all">All departments</option>
          {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <button className="btn sm" onClick={()=>shift(-14)}>← Earlier</button>
        <button className="btn sm" onClick={jumpToToday}>Today</button>
        <button className="btn sm" onClick={()=>shift(14)}>Later →</button>
        <span className="cal-window-label">
          {winStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} — {winEnd.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
      </div>
      {/* Inline legend — always visible above the grid so colour meaning
          doesn't require scrolling past 20 bars to find. */}
      <div className="cal-legend cal-legend-inline">
        <span className="cal-legend-swatch cal-bar-state-draft"></span><span className="cal-legend-label">Draft</span>
        <span className="cal-legend-swatch cal-bar-state-requested"></span><span className="cal-legend-label">Requested</span>
        <span className="cal-legend-swatch cal-bar-state-approved"></span><span className="cal-legend-label">Approved</span>
        <span className="cal-legend-swatch cal-bar-state-shipped"></span><span className="cal-legend-label">Shipped</span>
        <span className="cal-legend-swatch cal-bar-state-arrived"></span><span className="cal-legend-label">On site</span>
        <span className="cal-legend-swatch cal-bar-state-returning"></span><span className="cal-legend-label">Returning</span>
        <span className="cal-legend-swatch cal-bar-state-closed"></span><span className="cal-legend-label">Closed</span>
        <span className="cal-legend-swatch cal-bar-overdue"></span><span className="cal-legend-label">Overdue</span>
      </div>

      {rows.length === 0 ? (
        <div className="empty">{emptyText}</div>
      ) : (
        <div className="cal-grid">
          {/* Date axis */}
          <div className="cal-header">
            {days.map((d, i) => {
              const isToday = d.getTime() === today.getTime();
              const isWeekend = d.getDay() === 0 || d.getDay() === 6;
              return (
                <div key={i} className={`cal-day-head${isToday ? ' today' : ''}${isWeekend ? ' weekend' : ''}`}>
                  <div className="cal-day-num">{d.getDate()}</div>
                  <div className="cal-day-name">{d.toLocaleDateString(undefined, { weekday: 'narrow' })}</div>
                </div>
              );
            })}
          </div>

          {view === 'item'
            ? rows.map(({ item, bars }) => (
                <div className="cal-row" key={item.id}>
                  <div className="cal-row-label" title={`${item.name}${item.storage_location ? ' · ' + item.storage_location : ''}`}
                    onClick={()=>onOpenItem?.(item.id)} style={{cursor:'pointer'}}>
                    {item.name}
                  </div>
                  <div className="cal-row-track">
                    {bars.map(({ ei, ev, startD, endD, overdue }, i) => {
                      const drawStart = startD < winStart ? winStart : startD;
                      const drawEnd   = endD   > winEnd   ? winEnd   : endD;
                      const left = offsetPct(drawStart);
                      const widthPct = Math.max(
                        100 / WINDOW_DAYS,
                        ((drawEnd.getTime() - drawStart.getTime()) / dayMs + 1) / WINDOW_DAYS * 100
                      );
                      const state = ev.workflow_state || 'approved';
                      const cls = overdue ? 'cal-bar-overdue' : `cal-bar-state-${state}`;
                      return (
                        <div key={i} className={`cal-bar ${cls}`}
                          style={{left: `${left}%`, width: `${widthPct}%`}}
                          onClick={(e) => { e.stopPropagation(); onOpenDeployment(ev.id); }}
                          title={`${item.name} at ${ev.name} · ${state}${overdue ? ' · OVERDUE' : ''}`}>
                          <span className="cal-bar-text">
                            {overdue && <>⚠ </>}
                            {ev.name}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            : rows.map(({ ev, startD, endD, overdue, itemsStillOut }) => {
                const drawStart = startD < winStart ? winStart : startD;
                const drawEnd   = endD   > winEnd   ? winEnd   : endD;
                const left  = offsetPct(drawStart);
                const widthPct = Math.max(
                  100 / WINDOW_DAYS,
                  ((drawEnd.getTime() - drawStart.getTime()) / dayMs + 1) / WINDOW_DAYS * 100
                );
                const state = ev.workflow_state || 'approved';
                const cls = overdue ? 'cal-bar-overdue' : `cal-bar-state-${state}`;
                return (
                  <div className="cal-row" key={ev.id}>
                    <div className="cal-row-label" title={ev.name}>{ev.name}</div>
                    <div className="cal-row-track">
                      <div className={`cal-bar ${cls}`}
                        style={{left: `${left}%`, width: `${widthPct}%`}}
                        onClick={()=>onOpenDeployment(ev.id)}
                        title={`${ev.name} · ${state}${overdue ? ' · OVERDUE' : ''}`}>
                        <span className="cal-bar-text">
                          {overdue && <>⚠ </>}
                          {state}{itemsStillOut > 0 && state !== 'closed' && <> · {itemsStillOut} out</>}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
        </div>
      )}

    </div>
  );
}

// ---------- events tab ----------
function EventsTab({ admin, openEventId, onOpened }) {
  const [events, setEvents]     = useState([]);
  const [selected, setSelected] = useState(null);
  const [newOpen, setNewOpen]   = useState(false);
  const [deptFilter, setDept]   = useState('all');   // 'all' | DEPARTMENTS[n]
  const [wfFilter,   setWf]     = useState('all');   // 'all' | workflow state

  useEffect(() => {
    sb.from('events').select('*').order('event_date', { ascending: false, nullsFirst: true })
      .then(({ data }) => setEvents(data || []));
  }, []);

  // Realtime so the list reflects edits / new deployments / state changes
  // without forcing the user to refresh
  useEffect(() => {
    const ch = sb.channel('events-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, ({ eventType, new: n, old: o }) => {
        if (eventType === 'INSERT') setEvents(prev => [n, ...prev]);
        else if (eventType === 'UPDATE') setEvents(prev => prev.map(p => p.id === n.id ? n : p));
        else if (eventType === 'DELETE') setEvents(prev => prev.filter(p => p.id !== o.id));
      })
      .subscribe();
    return () => sb.removeChannel(ch);
  }, []);

  // Filter the list by department + workflow state. Departments live as a
  // TEXT[] column on events; "all" means no filter.
  const filtered = events.filter(ev => {
    if (deptFilter !== 'all' && !(ev.departments || []).includes(deptFilter)) return false;
    if (wfFilter   !== 'all' && (ev.workflow_state || 'approved') !== wfFilter) return false;
    return true;
  });

  // open by id (deep-link)
  useEffect(() => {
    if (!openEventId || !events.length) return;
    const ev = events.find(e => e.id === openEventId);
    if (ev) {
      setSelected(ev);
      onOpened?.();
    }
  }, [openEventId, events]);

  if (selected) {
    return <EventDetail event={selected} admin={admin} onBack={()=>setSelected(null)} />;
  }

  return (
    <div className="container">
      <div className="controls" style={{marginBottom:12}}>
        {admin
          ? <button className="btn primary" onClick={()=>setNewOpen(true)}>+ New deployment</button>
          : <LoginPrompt verb="create deployments" />}
        <select className="filter" value={deptFilter} onChange={e=>setDept(e.target.value)}>
          <option value="all">All departments</option>
          {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select className="filter" value={wfFilter} onChange={e=>setWf(e.target.value)}>
          <option value="all">All states</option>
          {WORKFLOW_STATES.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
        </select>
      </div>
      {events.length === 0 ? (
        <div className="empty">
          {admin ? <>No deployments yet. <button className="link-btn" onClick={()=>setNewOpen(true)}>Create one →</button></>
            : 'No deployments yet.'}
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          No deployments match your filters.{' '}
          <button className="link-btn" onClick={()=>{ setDept('all'); setWf('all'); }}>Clear filters →</button>
        </div>
      ) : (
        <div className="items">
          {filtered.map(ev => {
            const wf = ev.workflow_state || 'approved';
            const wfLabel = WORKFLOW_STATES.find(s => s.v === wf)?.label || wf;
            return (
              <div className="item clickable" key={ev.id} onClick={()=>setSelected(ev)}>
                <div className="row">
                  <div className="name">{ev.name}</div>
                  <div style={{display:'flex',gap:6,alignItems:'center',flexShrink:0}}>
                    <span className={`wf-chip wf-chip-${wf}`}>{wfLabel}</span>
                    <span className="meta">{fmtDate(ev.event_date)}</span>
                  </div>
                </div>
                {ev.location && <div className="meta">{ev.location}</div>}
                <div className="meta">Tap to view →</div>
              </div>
            );
          })}
        </div>
      )}
      {newOpen && (
        <EventFormModal admin={admin} onClose={()=>setNewOpen(false)}
          onSaved={ev => { setEvents(prev => [ev, ...prev]); setSelected(ev); }} />
      )}
    </div>
  );
}

// ---------- manage team (masters only) ----------
function ManageTeamModal({ me, onClose }) {
  const [admins, setAdmins]     = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [err, setErr]           = useState('');
  const [busy, setBusy]         = useState(null); // { kind, id }

  async function load() {
    setLoading(true); setErr('');
    const [a, r] = await Promise.all([
      sb.from('admin_users').select('*').order('added_at'),
      sb.from('admin_requests').select('*').eq('status','pending').order('requested_at'),
    ]);
    if (a.error) setErr(friendlyError(a.error));
    setAdmins(a.data || []);
    setRequests(r.data || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  // Realtime — keep the team list fresh while open
  useEffect(() => {
    const ch = sb.channel('team-mgmt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_users' },    load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_requests' }, load)
      .subscribe();
    return () => sb.removeChannel(ch);
  }, []);

  const masterCount = admins.filter(a => a.role === 'master').length;

  async function approve(req, asRole) {
    setBusy({ kind:'approve', id:req.id }); setErr('');
    const now = new Date().toISOString();
    try {
      const { error: insErr } = await sb.from('admin_users').insert({
        user_id: req.user_id, email: req.email, name: req.name || req.email,
        role: asRole, added_by: me.id,
      });
      if (insErr) throw insErr;
      const { error: upErr } = await sb.from('admin_requests').update({
        status: 'approved', reviewed_by: me.id, reviewed_at: now,
      }).eq('id', req.id);
      if (upErr) throw upErr;
      load();
    } catch(e) { setErr(friendlyError(e)); }
    setBusy(null);
  }

  async function deny(req) {
    if (!await confirm({ title: 'Deny request?', body: `Deny access for ${req.email}? They can request again later.`, danger: true, confirmLabel: 'Deny' })) return;
    setBusy({ kind:'deny', id:req.id }); setErr('');
    const now = new Date().toISOString();
    const { error } = await sb.from('admin_requests').update({
      status: 'denied', reviewed_by: me.id, reviewed_at: now,
    }).eq('id', req.id);
    if (error) setErr(friendlyError(error));
    load(); setBusy(null);
  }

  async function changeRole(user, newRole) {
    // Self-demote out of master is only allowed if another master exists
    if (user.user_id === me.id && user.role === 'master' && newRole !== 'master') {
      if (masterCount <= 1) {
        setErr("You're the only master — promote someone else first.");
        return;
      }
      if (!await confirm({ title: 'Demote yourself?', body: `Set your own role to ${newRole}? You'll lose team management. Make sure another Master is in place first.`, danger: true, confirmLabel: 'Demote me' })) return;
    } else if (newRole === 'master') {
      if (!await confirm({ title: 'Promote to Master?', body: `${user.email} will be able to add, remove and change other admins.`, confirmLabel: 'Promote' })) return;
    } else if (newRole === 'admin') {
      if (!await confirm({ title: 'Set role to Admin?', body: `${user.email} will get full edit access on inventory and deployments.`, confirmLabel: 'Set Admin' })) return;
    } else if (newRole === 'viewer') {
      if (!await confirm({ title: 'Set role to Viewer?', body: `${user.email} will lose edit access. They'll keep read access.`, confirmLabel: 'Set Viewer' })) return;
    }
    setBusy({ kind:'role', id:user.user_id }); setErr('');
    const { error } = await sb.from('admin_users').update({ role: newRole }).eq('user_id', user.user_id);
    if (error) setErr(friendlyError(error));
    load(); setBusy(null);
  }

  async function remove(user) {
    if (user.role === 'master' && masterCount <= 1) {
      setErr("Can't remove the last master.");
      return;
    }
    if (!await confirm({ title: 'Remove from team?', body: `${user.email} will lose all access. They'll need to be re-approved if they want back in.`, danger: true, confirmLabel: 'Remove' })) return;
    setBusy({ kind:'remove', id:user.user_id }); setErr('');
    const { error } = await sb.from('admin_users').delete().eq('user_id', user.user_id);
    if (error) setErr(friendlyError(error));
    load(); setBusy(null);
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:640}}>
        <h2>Manage team</h2>

        <div className="role-legend">
          <div><span className="role-pill viewer">Viewer</span><span>Read-only — can browse, scan, export</span></div>
          <div><span className="role-pill admin">Admin</span><span>Full edit on inventory and deployments</span></div>
          <div><span className="role-pill master">Master</span><span>Everything an Admin does, plus team management</span></div>
        </div>

        {err && <div className="err" style={{marginBottom:10}}>{err}</div>}

        <div className="section-label" style={{marginTop:0}}>
          Pending requests {requests.length > 0 && <span style={{color:'#d48a34'}}>· {requests.length}</span>}
        </div>
        {loading
          ? <div className="empty" style={{padding:18}}>Loading…</div>
          : requests.length === 0
            ? <div className="empty" style={{padding:18}}>No pending requests.</div>
            : <div className="team-list">
                {requests.map(req => (
                  <div className="team-row" key={req.id}>
                    <div style={{flex:1, minWidth:0}}>
                      <div className="team-name">{req.name || req.email}</div>
                      <div className="team-sub">{req.email} · requested {fmtTime(req.requested_at)}</div>
                    </div>
                    <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                      <button className="btn sm danger" disabled={busy} onClick={()=>deny(req)}>Deny</button>
                      <button className="btn sm" disabled={busy} onClick={()=>approve(req,'viewer')}>Approve · Viewer</button>
                      <button className="btn sm" disabled={busy} onClick={()=>approve(req,'admin')}>Approve · Admin</button>
                      <button className="btn sm primary" disabled={busy} onClick={()=>approve(req,'master')}>Approve · Master</button>
                    </div>
                  </div>
                ))}
              </div>
        }

        <div className="section-label">
          Team members ({admins.length})
          <span style={{color:'#7A7A7A',fontFamily:"'Azeret Mono',monospace",fontSize:10,letterSpacing:'0.06em',float:'right'}}>
            {admins.filter(a=>a.role==='master').length}M · {admins.filter(a=>a.role==='admin').length}A · {admins.filter(a=>a.role==='viewer').length}V
          </span>
        </div>
        {admins.length === 0
          ? <div className="empty" style={{padding:18}}>No team members yet.</div>
          : <div className="team-list">
              {admins.map(u => {
                const isMe = u.user_id === me.id;
                return (
                  <div className="team-row" key={u.user_id}>
                    <div style={{flex:1, minWidth:0}}>
                      <div className="team-name">
                        {u.name || u.email}
                        {isMe && <span className="team-self"> (you)</span>}
                      </div>
                      <div className="team-sub">{u.email} · added {fmtTime(u.added_at)}</div>
                    </div>
                    <span className={`role-pill ${u.role}`} style={{marginRight:6}}>{u.role}</span>
                    <select className="role-select"
                      value={u.role} disabled={busy || (isMe && u.role==='master' && masterCount<=1)}
                      onChange={(e)=> e.target.value !== u.role && changeRole(u, e.target.value)}>
                      <option value="viewer">Viewer</option>
                      <option value="admin">Admin</option>
                      <option value="master">Master</option>
                    </select>
                    <button className="btn sm danger" disabled={busy || (u.role==='master' && masterCount<=1)} onClick={()=>remove(u)}>Remove</button>
                  </div>
                );
              })}
            </div>
        }

        <div className="actions">
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ---------- sign-in gate (shown when no session) ----------
// With reads now locked behind RLS, an unauth visitor would see an empty
// "Loading…" forever. Replace it with a focused sign-in card.
function SignInGate({ onLoginRequest, deepLinkLabel }) {
  return (
    <div className="signin-gate">
      <div className="signin-card">
        <div className="signin-brand">SQUATWOLF</div>
        <div className="signin-title">Event Inventory</div>
        <div className="signin-sub">
          {deepLinkLabel
            ? deepLinkLabel
            : 'Internal tool — sign in to continue.'}
        </div>
        <button className="btn primary signin-cta" onClick={onLoginRequest}>Sign in</button>
        <div className="signin-foot">
          Access is approved by a master admin. If you don't have an account, contact your team lead.
        </div>
      </div>
    </div>
  );
}

// ---------- viewer welcome banner ----------
// One-time, per-user, dismissible explainer for new Viewers so they know
// they're allowed to browse and what to ask for if they need to edit.
function ViewerWelcomeBanner({ userId }) {
  const key = `eit:viewer-welcome:${userId}`;
  const [show, setShow] = useState(() => !localStorage.getItem(key));
  if (!show) return null;
  function dismiss() { localStorage.setItem(key, '1'); setShow(false); }
  return (
    <div className="viewer-welcome">
      <div className="viewer-welcome-body">
        <strong>Welcome to the inventory.</strong>{' '}
        You can browse all items, deployments, and history, scan QR codes, and export the manifest. Editing (adding, returning, marking damaged) is reserved for Admins — ask a master to bump your role if you need it.
      </div>
      <button className="viewer-welcome-x" onClick={dismiss} aria-label="Dismiss">✕</button>
    </div>
  );
}

// ---------- admin welcome banner ----------
// One-time, per-user, dismissible orientation card for new Admins. Closes
// the cold-start gap that the UX audit flagged: viewers had a banner,
// admins didn't, so a brand-new admin landed on the dashboard with no idea
// where to start.
function AdminWelcomeBanner({ userId, isMaster }) {
  const key = `eit:admin-welcome:${userId}`;
  const [show, setShow] = useState(() => !localStorage.getItem(key));
  if (!show) return null;
  function dismiss() { localStorage.setItem(key, '1'); setShow(false); }
  return (
    <div className="viewer-welcome admin-welcome">
      <div className="viewer-welcome-body">
        <strong>You're set up as {isMaster ? 'a Master' : 'an Admin'}.</strong>{' '}
        Items live in the <b>Items</b> tab — that's the master inventory of every physical asset. <b>Deployments</b> bundle items, logistics, and approvals for one event activation. The <b>Calendar</b> shows what's out and when it's coming back. Tap <b>+ New deployment</b> in the Deployments tab to get started.
        {isMaster && <> You also approve requests submitted by other admins via the workflow tracker on each deployment.</>}
      </div>
      <button className="viewer-welcome-x" onClick={dismiss} aria-label="Dismiss">✕</button>
    </div>
  );
}

// ---------- main app ----------
function App() {
  // session: any signed-in user (admin OR pending). admin: only approved roles.
  // The rest of the app gates on `admin` so writes are blocked when pending.
  const [session, setSession]   = useState(() => {
    try { return JSON.parse(localStorage.getItem('eit:session')) || null; } catch { return null; }
  });
  const admin = session && (session.role === 'admin' || session.role === 'master') ? session : null;
  const isMaster = session?.role === 'master';
  const isViewer = session?.role === 'viewer';
  const isPending = session && !session.role;

  const [tab, setTab]           = useState('dashboard'); // 'dashboard' | 'items' | 'events'
  const [loginOpen, setLoginOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [openItemId, setOpenItemId]   = useState(null);
  const [openEventId, setOpenEventId] = useState(null);
  const [landing, setLanding]         = useState(null);  // { kind: 'item'|'event', id } | null
  const [online, setOnline]           = useState(() => typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [stocktakeOpen, setStocktakeOpen] = useState(false);
  // Pending team-access requests count — surfaces as a badge on the
  // ⚙ Team button so masters notice without having to open the modal.
  const [pendingCount, setPendingCount] = useState(0);
  useEffect(() => {
    if (!isMaster) { setPendingCount(0); return; }
    let cancelled = false;
    const refresh = () => {
      sb.from('admin_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending')
        .then(({ count }) => { if (!cancelled) setPendingCount(count || 0); });
    };
    refresh();
    const ch = sb.channel('pending-requests')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_requests' }, refresh)
      .subscribe();
    return () => { cancelled = true; sb.removeChannel(ch); };
  }, [isMaster]);

  // Topbar scan: works from any tab. Scanned QR can be either an item
  // (master inventory) or a deployment — we look up which it is and route
  // to the right tab + open the appropriate detail view.
  async function handleTopbarScan(scanned) {
    const id = parseScanned(scanned);
    if (!id) { toast('Unrecognized QR code', 'err'); return; }
    setScannerOpen(false);
    const [{ data: item }, { data: ev }] = await Promise.all([
      sb.from('items').select('id').eq('id', id).maybeSingle(),
      sb.from('events').select('id').eq('id', id).maybeSingle(),
    ]);
    if (item)      { setTab('items');  setOpenItemId(id); }
    else if (ev)   { setTab('events'); setOpenEventId(id); }
    else           { toast('Scanned QR doesn’t match any item or deployment', 'err'); }
  }

  useEffect(() => {
    const on  = () => { setOnline(true);  toast('Back online', 'ok'); };
    const off = () => { setOnline(false); toast('You’re offline — changes won’t save until you reconnect', 'err'); };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // deep-links: ?item=<uuid> or ?event=<uuid>
  // Show a focused ScanLanding card first; only enter the full app when dismissed.
  // We strip the param immediately so a refresh doesn't keep the landing pinned;
  // the `landing` state survives the sign-in gate if needed.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const itemId  = params.get('item');
    const eventId = params.get('event');
    if (itemId  && parseScanned(itemId))  setLanding({ kind: 'item',  id: parseScanned(itemId)  });
    if (eventId && parseScanned(eventId)) setLanding({ kind: 'event', id: parseScanned(eventId) });
    if (itemId || eventId) {
      const url = new URL(location.href);
      url.searchParams.delete('item');
      url.searchParams.delete('event');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  function dismissLanding() {
    if (!landing) return;
    if (landing.kind === 'item')  { setTab('items');  setOpenItemId(landing.id); }
    if (landing.kind === 'event') { setTab('events'); setOpenEventId(landing.id); }
    setLanding(null);
  }

  // Resolve role from admin_users for any active session — handles refresh,
  // master approving us in another tab, etc.
  async function resolveSession(authUser) {
    if (!authUser) return null;
    const { data: row } = await sb.from('admin_users').select('*').eq('user_id', authUser.id).maybeSingle();
    return {
      id:    authUser.id,
      email: authUser.email,
      name:  row?.name || authUser.user_metadata?.name || authUser.email,
      role:  row?.role || null,  // null = signed in but not approved yet
    };
  }
  function persistSession(s) {
    if (s) localStorage.setItem('eit:session', JSON.stringify(s));
    else   localStorage.removeItem('eit:session');
    // legacy key cleanup
    localStorage.removeItem('eit:admin');
  }

  useEffect(() => {
    sb.auth.getSession().then(async ({ data: { session: s } }) => {
      const next = await resolveSession(s?.user);
      setSession(next); persistSession(next);
    });
    const { data: sub } = sb.auth.onAuthStateChange(async (_, s) => {
      const next = await resolveSession(s?.user);
      setSession(next); persistSession(next);
    });
    return () => sub?.subscription?.unsubscribe?.();
  }, []);

  // Realtime: react when our admin_users row changes (master approves us, etc.)
  useEffect(() => {
    if (!session?.id) return;
    const ch = sb.channel('admin_users_self')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_users', filter: `user_id=eq.${session.id}` },
        async () => {
          const { data: { user } } = await sb.auth.getUser();
          const next = await resolveSession(user);
          setSession(next); persistSession(next);
        })
      .subscribe();
    return () => sb.removeChannel(ch);
  }, [session?.id]);

  // global "log in" request from inline prompts
  useEffect(() => {
    const fn = () => setLoginOpen(true);
    window.addEventListener('eit:request-login', fn);
    return () => window.removeEventListener('eit:request-login', fn);
  }, []);

  function handleLogin(data) {
    setSession(data); persistSession(data); setLoginOpen(false);
  }
  function logout() {
    sb.auth.signOut(); setSession(null); persistSession(null);
  }

  // No session — show the sign-in gate. If they hit a QR deep-link, mention it.
  if (!session) {
    return (
      <>
        <SignInGate
          onLoginRequest={() => setLoginOpen(true)}
          deepLinkLabel={
            landing
              ? `You scanned a ${landing.kind === 'item' ? 'product' : 'deployment'} QR — sign in to view it.`
              : null
          }
        />
        {loginOpen && <AdminLoginModal onLogin={handleLogin} onClose={()=>setLoginOpen(false)} />}
        <ToastHost />
        <ConfirmHost />
      </>
    );
  }

  // While the scan landing is up, render only that — no tabs, no chrome.
  if (landing) {
    return (
      <>
        <ScanLanding kind={landing.kind} id={landing.id} onDismiss={dismissLanding} />
        {loginOpen && <AdminLoginModal onLogin={handleLogin} onClose={()=>setLoginOpen(false)} />}
        <ToastHost />
        <ConfirmHost />
      </>
    );
  }

  return (
    <div className="app">
      {/* top bar */}
      <div className="topbar">
        <span className="brand">SQUATWOLF</span>
        <span className="spacer" />
        <div className="topbar-mode">
          {session.role === 'master' && <span className="role-pill master">Master<span className="role-name"> · {session.name}</span></span>}
          {session.role === 'admin'  && <span className="role-pill admin">Admin<span className="role-name"> · {session.name}</span></span>}
          {session.role === 'viewer' && <span className="role-pill viewer">Viewer<span className="role-name"> · {session.name}</span></span>}
          {!session.role             && <span className="role-pill pending">Pending<span className="role-name"> · {session.name}</span></span>}
          <button className="btn sm" onClick={()=>setScannerOpen(true)} title="Scan a QR code to open that item or deployment">⊟ Scan QR</button>
          {admin && (
            <button className="btn sm" onClick={()=>setStocktakeOpen(true)} title="Stocktake — scan everything in storage to see what's missing vs. expected">☑ Stocktake</button>
          )}
          {isMaster && (
            <button className="btn sm team-btn" onClick={()=>setManageOpen(true)}
              title={pendingCount > 0 ? `${pendingCount} pending request${pendingCount===1?'':'s'}` : 'Manage team'}>
              ⚙ Team
              {pendingCount > 0 && <span className="team-btn-badge">{pendingCount}</span>}
            </button>
          )}
          <button className="btn sm ghost" onClick={logout} title="Sign out">↺ Sign out</button>
        </div>
      </div>
      {!online && (
        <div className="offline-banner">
          ● Offline — changes won't save until you reconnect.
        </div>
      )}
      {isPending && (
        <div className="pending-banner">
          Your access is pending approval. You can browse the inventory but can't edit yet.
        </div>
      )}
      {isViewer && <ViewerWelcomeBanner userId={session.id} />}
      {admin && <AdminWelcomeBanner userId={session.id} isMaster={isMaster} />}

      {/* tabs */}
      <div className="tabs">
        {[['dashboard','Dashboard'],['items','Items'],['events','Deployments'],['calendar','Calendar']].map(([key,label]) => (
          <button key={key} onClick={()=>setTab(key)} className={tab===key?'active':''}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && <DashboardTab admin={admin} onGoTo={(t, id) => { setTab(t); if (t === 'events') setOpenEventId(id); if (t === 'items') setOpenItemId(id); }} />}
      {tab === 'items'     && <ItemsTab  admin={admin} openItemId={openItemId}  onOpened={()=>setOpenItemId(null)} />}
      {tab === 'events'    && <EventsTab admin={admin} openEventId={openEventId} onOpened={()=>setOpenEventId(null)} />}
      {tab === 'calendar'  && <CalendarTab
        onOpenDeployment={(id)=>{ setTab('events'); setOpenEventId(id); }}
        onOpenItem={(id)=>{ setTab('items'); setOpenItemId(id); }}
      />}

      {loginOpen && <AdminLoginModal onLogin={handleLogin} onClose={()=>setLoginOpen(false)} />}
      {manageOpen && isMaster && (
        <ManageTeamModal me={session} onClose={()=>setManageOpen(false)} />
      )}
      {scannerOpen && (
        <ScannerModal title="Scan QR"
          onClose={()=>setScannerOpen(false)}
          onScan={handleTopbarScan}
        />
      )}
      {stocktakeOpen && (
        <StocktakeFlow onClose={()=>setStocktakeOpen(false)} />
      )}
      <ToastHost />
      <ConfirmHost />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
