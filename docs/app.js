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

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
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
    repaired:'Marked repaired', retired:'Retired' }[a] || a;
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
      if (upErr) { setErr(upErr.message); continue; }
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
    if (!window.confirm(`Remove "${att.original_name}"?`)) return;
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
        if (!cancelled) setErr(e.message || String(e));
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
        <button className="btn sm ghost" onClick={onDismiss}>Open inventory →</button>
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
function LoginPrompt({ verb = 'edit' }) {
  return (
    <button type="button" className="login-prompt" onClick={requestLogin}>
      <span className="login-prompt-dot">●</span> Log in to {verb}
    </button>
  );
}

// ---------- QR scanner modal ----------
function ScannerModal({ onClose, onScan, title }) {
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef    = useRef(null);
  const lockRef   = useRef(false);
  const [err, setErr] = useState('');

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
          if (cancelled || lockRef.current) return;
          if (v.readyState === 4 && v.videoWidth) {
            c.width  = v.videoWidth;
            c.height = v.videoHeight;
            ctx.drawImage(v, 0, 0, c.width, c.height);
            const img = ctx.getImageData(0, 0, c.width, c.height);
            const code = window.jsQR(img.data, c.width, c.height, { inversionAttempts: 'dontInvert' });
            if (code && code.data) {
              const id = parseScanned(code.data);
              if (id) {
                lockRef.current = true;
                onScan(id);
                return;
              }
            }
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch (e) {
        setErr(e.name === 'NotAllowedError'
          ? 'Camera permission denied. Allow camera access and try again.'
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

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal scanner-modal" onClick={e => e.stopPropagation()}>
        <h2>{title || 'Scan QR'}</h2>
        <div className="scanner-frame">
          <video ref={videoRef} muted playsInline />
          <canvas ref={canvasRef} style={{display:'none'}} />
          <div className="scanner-reticle" />
        </div>
        {err
          ? <div className="err" style={{marginTop:10}}>{err}</div>
          : <div style={{fontFamily:"'Azeret Mono',monospace",fontSize:11,color:'#7A7A7A',marginTop:10,letterSpacing:'0.04em',textTransform:'uppercase'}}>
              Point camera at item label
            </div>
        }
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ---------- CSV import modal ----------
function CsvImportModal({ admin, existingItems, onClose, onImported }) {
  const [text, setText]         = useState('');
  const [parsed, setParsed]     = useState(null);   // { headers, rows: [{raw, mapped, status, reason}] }
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [err, setErr]           = useState('');

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
      setErr(e.message || String(e));
      setSaving(false);
    }
  }

  const addCount  = parsed?.rows.filter((r) => r.status === 'add').length || 0;
  const skipCount = parsed?.rows.filter((r) => r.status === 'skip').length || 0;

  return (
    <div className="backdrop" onClick={onClose}>
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
  const [mode, setMode] = useState('signin'); // 'signin' | 'request'
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [name, setName]         = useState('');
  const [err, setErr]           = useState('');
  const [info, setInfo]         = useState('');
  const [loading, setLoading]   = useState(false);

  async function signIn(e) {
    e.preventDefault(); setErr(''); setInfo(''); setLoading(true);
    const { data, error } = await sb.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) {
      setErr(error.message === 'Invalid login credentials'
        ? 'Email or password is incorrect.'
        : error.message);
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
    if (!name.trim()) { setErr('Please enter your name.'); setLoading(false); return; }
    if (password.length < 8) { setErr('Password must be at least 8 characters.'); setLoading(false); return; }
    const { data, error } = await sb.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: { data: { name: name.trim() } },
    });
    if (error) { setErr(error.message); setLoading(false); return; }
    // If email confirmation is required, session is null until they confirm.
    if (!data.session) {
      setInfo('Account created. Check your email for a confirmation link, then sign in. Once confirmed, a master admin will approve your access.');
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
    if (error) { setErr(error.message); return; }
    setInfo('Password reset email sent. Check your inbox.');
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <form className="modal" style={{maxWidth:380}} onClick={e=>e.stopPropagation()}
        onSubmit={mode === 'signin' ? signIn : requestAccess}>
        <h2>{mode === 'signin' ? 'Sign in' : 'Request access'}</h2>

        <div className="auth-tabs">
          <button type="button" className={mode==='signin' ? 'active' : ''} onClick={()=>{setMode('signin'); setErr(''); setInfo('');}}>
            Sign in
          </button>
          <button type="button" className={mode==='request' ? 'active' : ''} onClick={()=>{setMode('request'); setErr(''); setInfo('');}}>
            Request access
          </button>
        </div>

        {mode === 'request' && (
          <div className="field"><label>Your name</label>
            <input value={name} onChange={e=>setName(e.target.value)}
              placeholder="e.g. Alex Martins" autoFocus autoComplete="name" />
          </div>
        )}
        <div className="field"><label>Work email</label>
          <input type="email" value={email} onChange={e=>setEmail(e.target.value)}
            autoFocus={mode==='signin'} autoComplete="email"
            placeholder="you@squatwolf.com" required />
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
            <button type="submit" className="btn primary" disabled={loading}>
              {loading ? '…' : (mode==='signin' ? 'Sign in' : 'Request access')}
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
    } catch(e) { setErr(e.message); setSaving(false); }
  }

  async function del() {
    if (!window.confirm(`Delete "${initial.name}" from master inventory? This cannot be undone.`)) return;
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
    } catch(e) { setErr(e.message); setSaving(false); }
  }

  async function markRepaired() {
    if (!window.confirm(`Mark "${initial.name}" as repaired and back in service?`)) return;
    await setConditionAndLog('good', 'repaired', `Marked repaired (was ${CLABEL[initial.condition]||initial.condition})`);
  }
  async function retire() {
    if (!window.confirm(`Retire "${initial.name}"? It will be hidden from new deployments and you'll need to reactivate it to use again.`)) return;
    await setConditionAndLog('retired', 'retired', `Retired (was ${CLABEL[initial.condition]||initial.condition})`);
  }
  async function reactivate() {
    if (!window.confirm(`Bring "${initial.name}" back into service?`)) return;
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
          {admin
            ? <button className="btn primary" onClick={onEdit}>Edit item</button>
            : <LoginPrompt verb="edit" />}
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ---------- event form ----------
function EventFormModal({ admin, onClose, onSaved }) {
  const [name, setName]     = useState('');
  const [date, setDate]     = useState('');
  const [location, setLoc]  = useState('');
  const [err, setErr]       = useState('');
  const [saving, setSaving] = useState(false);

  async function save(e) {
    e.preventDefault();
    if (!name.trim()) return setErr('Event name required');
    setSaving(true);
    const { data, error } = await sb.from('events').insert({
      name: name.trim(), event_date: date || null, location: location.trim(),
    }).select().single();
    if (error) { setErr(error.message); setSaving(false); return; }
    onSaved(data); onClose();
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <form className="modal" style={{maxWidth:400}} onClick={e=>e.stopPropagation()} onSubmit={save}>
        <h2>New Deployment</h2>
        <div className="field"><label>Event name</label>
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Al Wasl Volleyball Tournament" autoFocus />
        </div>
        <div className="field"><label>Date</label>
          <input type="date" value={date} onChange={e=>setDate(e.target.value)} />
        </div>
        <div className="field"><label>Location / venue</label>
          <input value={location} onChange={e=>setLoc(e.target.value)} placeholder="e.g. Al Wasl Sports Club" />
        </div>
        <div className="err">{err}</div>
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={saving}>{saving?'Creating…':'Create event'}</button>
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
    for (const item_id of selected) {
      const { data: ei } = await sb.from('event_items').insert({
        event_id: event.id, item_id, status: 'out',
        assigned_by: admin.name, assigned_at: now,
        updated_at: now, updated_by: admin.name,
      }).select().single();
      if (ei) {
        await sb.from('history').insert({
          item_id, event_item_id: ei.id, event_id: event.id,
          action: 'assigned', changes: { note: `Assigned to deployment: ${event.name}` },
          changed_by: admin.name, changed_at: now,
        });
      }
    }
    onAssigned(); onClose();
  }

  return (
    <div className="backdrop" onClick={onClose}>
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
    } catch(e) { setErr(e.message); setSaving(false); }
  }

  async function removeFromEvent() {
    if (!window.confirm(`Remove "${item?.name}" from this event?`)) return;
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
  // per-row condition overrides — keyed by event_item id; falls back to defaultCondition
  const [overrides, setOverrides] = useState({});
  // selection — start with all selected
  const [selected, setSelected] = useState(() => new Set(outItems.map(ei => ei.id)));
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [err, setErr] = useState('');

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
    try {
      for (const eiId of ids) {
        const ei = outItems.find(x => x.id === eiId);
        if (!ei) continue;
        const item = items[ei.item_id];
        const cond = overrides[eiId] || defaultCondition;
        const retLoc = (defaultLocation || item?.storage_location || '').trim();
        const procBy = (processedBy || admin?.name || '').trim();

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

        // mirror condition onto master item
        if (item) {
          await sb.from('items').update({
            condition: cond, updated_at: now, updated_by: admin?.name || procBy,
          }).eq('id', item.id);
        }

        await sb.from('history').insert({
          item_id: ei.item_id, event_item_id: eiId, event_id: event.id,
          action: 'returned',
          changes: { note: `Returned (bulk) on ${new Date(now).toLocaleString()}. Sent to: ${retLoc||'—'}. Processed by: ${procBy||'—'}. Condition: ${CLABEL[cond]||cond}` },
          changed_by: admin?.name || procBy, changed_at: now,
        });

        setProgress(p => ({ done: p.done + 1, total: p.total }));
      }
      onDone();
      onClose();
    } catch (e) {
      setErr(e.message || String(e));
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
    <div className="backdrop" onClick={onClose}>
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
  const [bulkOpen, setBulkOpen]     = useState(false);
  const [manifestOpen, setManifest] = useState(false);

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

  async function handleScan(itemId) {
    setScanOpen(false); setScanMsg('');
    // already on this deployment? open update
    const existing = eventItems.find(ei => ei.item_id === itemId);
    if (existing) {
      setUpdating(existing);
      return;
    }
    // fetch master item to verify it exists
    const { data: master } = await sb.from('items').select('*').eq('id', itemId).maybeSingle();
    if (!master) { setScanMsg('Scanned QR doesn’t match any item in inventory.'); return; }
    // check it's not out at another deployment
    const { data: outAt } = await sb.from('event_items')
      .select('event_id, events(name)').eq('item_id', itemId).eq('status', 'out').limit(1);
    const elsewhere = (outAt||[]).find(r => r.event_id !== event.id);
    if (elsewhere) {
      setScanMsg(`"${master.name}" is currently out at: ${elsewhere.events?.name||'another deployment'}.`);
      return;
    }
    if (!admin) { setScanMsg('Log in as admin to assign items.'); return; }
    // assign
    const now = new Date().toISOString();
    const { data: ei } = await sb.from('event_items').insert({
      event_id: event.id, item_id: itemId, status: 'out',
      assigned_by: admin.name, assigned_at: now, updated_at: now, updated_by: admin.name,
    }).select().single();
    if (ei) {
      await sb.from('history').insert({
        item_id: itemId, event_item_id: ei.id, event_id: event.id,
        action: 'assigned',
        changes: { note: `Assigned to deployment via scan: ${event.name}` },
        changed_by: admin.name, changed_at: now,
      });
      setScanMsg(`Assigned: ${master.name}`);
      load();
    }
  }

  const filtered = eventItems.filter(ei => {
    const it = items[ei.item_id];
    if (!it) return false;
    if (filter === 'out' && ei.status !== 'out') return false;
    if (filter === 'returned' && ei.status !== 'returned') return false;
    if (query && !it.name.toLowerCase().includes(query.toLowerCase()) &&
        !(ei.current_location||'').toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  const outCount      = eventItems.filter(ei=>ei.status==='out').length;
  const returnedCount = eventItems.filter(ei=>ei.status==='returned').length;

  return (
    <div>
      <div className="back-bar">
        <button className="btn sm ghost" onClick={onBack}>← Back</button>
        <div style={{flex:1,overflow:'hidden'}}>
          <div className="ev-name">{event.name}</div>
          <div className="ev-sub">{fmtDate(event.event_date)}{event.location ? ' · '+event.location : ''}</div>
        </div>
        <button className="btn sm" onClick={()=>setScanOpen(true)}>⊟ Scan</button>
        {eventItems.length > 0 && (
          <button className="btn sm" onClick={()=>setManifest(true)} title="Printable manifest">⎙ Manifest</button>
        )}
        {admin && outCount > 0 && (
          <button className="btn sm" onClick={()=>setBulkOpen(true)} title="Return all out items">↩ Return all</button>
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


      <div className="container">
        {/* stats */}
        <div style={{display:'flex',gap:10,marginBottom:12}}>
          <div className="stat-box">
            <div className="stat-value">{eventItems.length}</div>
            <div className="stat-label">Total</div>
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
              return (
                <div className="item" key={ei.id}>
                  <div className="row">
                    <div className="name">{it.name}</div>
                    <div style={{display:'flex',gap:6,alignItems:'center'}}>
                      <span className={`badge ${ei.condition}`}>{CLABEL[ei.condition]}</span>
                      <span className={`badge ${ei.status==='returned'?'status-returned':'status-out'}`}>
                        {ei.status==='returned'?'Returned':'Out'}
                      </span>
                    </div>
                  </div>
                  <div className="fields">
                    {ei.status !== 'returned' && <><span className="k">Location</span><span className="v">{ei.current_location||'—'}</span></>}
                    <span className="k">Storage</span><span className="v">{it.storage_location||'—'}</span>
                    <span className="k">Assigned by</span><span className="v">{ei.assigned_by||'—'}</span>
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
                  <div className="actions">
                    {admin && ei.status !== 'returned' && (
                      <button className="btn sm primary" onClick={()=>setUpdating(ei)}>Update</button>
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
          onClose={()=>setScanOpen(false)} onScan={handleScan} />
      )}
      {bulkOpen && (
        <BulkReturnModal event={event} eventItems={eventItems} items={items} admin={admin}
          onClose={()=>setBulkOpen(false)} onDone={load} />
      )}
      {manifestOpen && (
        <ManifestView event={event} eventItems={eventItems} items={items}
          onClose={()=>setManifest(false)} />
      )}
    </div>
  );
}

// ---------- items tab (master list) ----------
function ItemsTab({ admin, openItemId, onOpened }) {
  const [items, setItems]       = useState([]);
  const [outMap, setOutMap]     = useState({}); // item_id → event name for checked-out items
  const [query, setQuery]       = useState('');
  const [catFilter, setCat]     = useState('all');
  const [condFilter, setCond]   = useState('all');
  const [addOpen, setAddOpen]   = useState(false);
  const [viewing, setViewing]   = useState(null);
  const [editing, setEditing]   = useState(null);
  const [labelsOpen, setLabels] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanErr, setScanErr]   = useState('');
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

  const filtered = items.filter(it => {
    if (catFilter !== 'all' && it.category !== catFilter) return false;
    // Hide retired items unless the user explicitly filters for them.
    if (condFilter === 'retired') {
      if (it.condition !== 'retired') return false;
    } else {
      if (it.condition === 'retired') return false;
      if (condFilter !== 'all' && it.condition !== condFilter) return false;
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
        <select className="filter" value={condFilter} onChange={e=>setCond(e.target.value)}>
          <option value="all">All conditions</option>
          {CONDITIONS.map(c=><option key={c.value} value={c.value}>{c.label}</option>)}
          <option value="retired">Retired (hidden)</option>
        </select>
        {admin && <button className="btn primary" onClick={()=>setAddOpen(true)}>+ Add item</button>}
        <button className="btn" onClick={()=>setScanOpen(true)} title="Scan QR">⊟ Scan</button>
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
      {scanErr && <div className="err" style={{marginBottom:8}}>{scanErr}</div>}

      {filtered.length === 0 ? (
        <div className="empty">
          {items.length === 0
            ? (admin ? 'No items yet.' : 'No items in inventory yet.')
            : 'No items match your filters.'}
        </div>
      ) : (
        <div className="items">
          {filtered.map(it => (
            <div className="item clickable" key={it.id} onClick={()=>setViewing(it)}>
              <div className="row">
                <div className="name">{it.name}</div>
                <div style={{display:'flex',gap:5,alignItems:'center',flexShrink:0}}>
                  <span className={`badge ${outMap[it.id] ? 'status-out' : 'status-stored'}`}>
                    {outMap[it.id] ? 'Out' : 'Stored'}
                  </span>
                  <span className={`badge ${it.condition}`}>{CLABEL[it.condition]}</span>
                </div>
              </div>
              <div className="fields">
                <span className="k">Category</span><span className="v">{it.category||'—'}</span>
                <span className="k">Stored at</span><span className="v">{it.storage_location||'—'}</span>
                {outMap[it.id] && <><span className="k">In use for</span><span className="v" style={{color:'#d48a34'}}>{outMap[it.id]}</span></>}
                {it.notes && <><span className="k">Notes</span><span className="v">{it.notes}</span></>}
              </div>
              <div className="meta">Updated by {it.updated_by||'—'} · {fmtTime(it.updated_at)}</div>
            </div>
          ))}
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
      {scanOpen && (
        <ScannerModal title="Scan item QR"
          onClose={()=>setScanOpen(false)}
          onScan={(id) => {
            setScanOpen(false); setScanErr('');
            const it = items.find(x => x.id === id);
            if (it) setViewing(it);
            else setScanErr('Scanned QR doesn’t match any item in inventory.');
          }}
        />
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
  const [items, setItems]   = useState(null);
  const [outRows, setOut]   = useState([]);  // event_items rows with status='out' + joined event
  const [allEis, setAllEis] = useState([]);  // every event_item (used for "never used" calc)
  const [recent, setRecent] = useState([]);
  const [viewing, setViewing] = useState(null);

  async function load() {
    const [itemsRes, outRes, allRes, hist] = await Promise.all([
      sb.from('items').select('*').order('name'),
      sb.from('event_items').select('*, events(id, name, event_date)').eq('status','out'),
      sb.from('event_items').select('item_id'),
      sb.from('history').select('*').order('changed_at', { ascending: false }).limit(8),
    ]);
    setItems(itemsRes.data || []);
    setOut(outRes.data || []);
    setAllEis(allRes.data || []);
    setRecent(hist.data || []);
  }
  useEffect(() => { load(); }, []);

  // realtime — anything changes, reload
  useEffect(() => {
    const ch = sb.channel('dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_items' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'history' }, load)
      .subscribe();
    return () => sb.removeChannel(ch);
  }, []);

  if (items === null) return <div className="container"><div className="empty">Loading…</div></div>;

  const itemMap = {};
  items.forEach(it => itemMap[it.id] = it);

  // Currently out — group by deployment
  const outByEvent = {};
  outRows.forEach(r => {
    const eid = r.events?.id || r.event_id;
    if (!outByEvent[eid]) outByEvent[eid] = { event: r.events, rows: [] };
    outByEvent[eid].rows.push(r);
  });
  const outDeployments = Object.values(outByEvent);

  // Overdue — out and event_date older than OVERDUE_DAYS
  const cutoff = Date.now() - OVERDUE_DAYS * 24 * 3600 * 1000;
  const overdue = outRows.filter(r => {
    const d = r.events?.event_date ? new Date(r.events.event_date).getTime() : null;
    return d !== null && d < cutoff;
  });

  // Needs attention — items in damaged / needs_repair / needs_cleaning
  const needsAttention = items.filter(it =>
    it.condition === 'damaged' || it.condition === 'needs_repair' || it.condition === 'needs_cleaning'
  );

  // Items never assigned — id not in any event_item row
  const everUsed = new Set(allEis.map(e => e.item_id));
  const neverUsed = items.filter(it => !everUsed.has(it.id));

  const totalItems   = items.length;
  const totalOut     = outRows.length;
  const totalDeploys = new Set(allEis.map(e => e.event_id)).size; // distinct deployments that ever had items

  return (
    <div className="container">
      {/* top KPI row */}
      <div className="kpi-row">
        <div className="stat-box"><div className="stat-value">{totalItems}</div><div className="stat-label">Total items</div></div>
        <div className="stat-box"><div className="stat-value" style={{color:'#d48a34'}}>{totalOut}</div><div className="stat-label">Currently out</div></div>
        <div className="stat-box"><div className="stat-value" style={{color:'#e87070'}}>{overdue.length}</div><div className="stat-label">Overdue</div></div>
        <div className="stat-box"><div className="stat-value" style={{color:'#d4a534'}}>{needsAttention.length}</div><div className="stat-label">Needs attention</div></div>
      </div>

      {/* Overdue */}
      <DashSection
        title={`Overdue (> ${OVERDUE_DAYS} days)`}
        emptyText="Nothing overdue. 🎯"
        emoji=""
      >
        {overdue.length > 0 && overdue.map(r => {
          const it = itemMap[r.item_id];
          const days = r.events?.event_date
            ? Math.floor((Date.now() - new Date(r.events.event_date).getTime())/(24*3600*1000))
            : null;
          return (
            <div className="dash-row" key={r.id} onClick={()=>it && setViewing(it)}>
              <div style={{flex:1,minWidth:0}}>
                <div className="dash-row-name">{it?.name || '(missing item)'}</div>
                <div className="dash-row-sub">Out at {r.events?.name||'—'} · {days!=null?`${days}d past event`:'—'}</div>
              </div>
              <span className="badge status-out">Out</span>
            </div>
          );
        })}
      </DashSection>

      {/* Needs attention */}
      <DashSection
        title="Needs attention"
        emptyText="All items in good condition."
      >
        {needsAttention.map(it => (
          <div className="dash-row" key={it.id} onClick={()=>setViewing(it)}>
            <div style={{flex:1,minWidth:0}}>
              <div className="dash-row-name">{it.name}</div>
              <div className="dash-row-sub">{it.category||'—'} · {it.storage_location||'No storage set'}</div>
            </div>
            <span className={`badge ${it.condition}`}>{CLABEL[it.condition]}</span>
          </div>
        ))}
      </DashSection>

      {/* Currently out — by deployment */}
      <DashSection
        title="Currently out"
        emptyText="Nothing checked out."
      >
        {outDeployments.map(({event, rows}) => (
          <div className="dash-group" key={event?.id || Math.random()}>
            <div className="dash-group-head">
              <span className="dash-group-name">{event?.name || '(unknown deployment)'}</span>
              <span className="dash-group-count">{rows.length}</span>
            </div>
            {rows.map(r => {
              const it = itemMap[r.item_id];
              return (
                <div className="dash-row" key={r.id} onClick={()=>it && setViewing(it)}>
                  <div style={{flex:1,minWidth:0}}>
                    <div className="dash-row-name">{it?.name || '(missing item)'}</div>
                    <div className="dash-row-sub">At: {r.current_location||'—'}</div>
                  </div>
                  <span className={`badge ${r.condition||'good'}`}>{CLABEL[r.condition]||r.condition||'—'}</span>
                </div>
              );
            })}
          </div>
        ))}
      </DashSection>

      {/* Never used */}
      {neverUsed.length > 0 && (
        <DashSection title="Never assigned" emptyText="">
          {neverUsed.slice(0, 12).map(it => (
            <div className="dash-row" key={it.id} onClick={()=>setViewing(it)}>
              <div style={{flex:1,minWidth:0}}>
                <div className="dash-row-name">{it.name}</div>
                <div className="dash-row-sub">{it.category||'—'} · {it.storage_location||'No storage set'}</div>
              </div>
              <span className={`badge ${it.condition}`}>{CLABEL[it.condition]}</span>
            </div>
          ))}
          {neverUsed.length > 12 && (
            <div className="dash-row-sub" style={{padding:'4px 12px'}}>
              + {neverUsed.length - 12} more
            </div>
          )}
        </DashSection>
      )}

      {/* Recent activity */}
      <DashSection title="Recent activity" emptyText="No activity yet.">
        {recent.map(ev => (
          <div className="dash-row" key={ev.id} onClick={()=>{
            const it = itemMap[ev.item_id]; if (it) setViewing(it);
          }}>
            <div style={{flex:1,minWidth:0}}>
              <div className="dash-row-name" style={{fontSize:14}}>
                {actionLabel(ev.action)}{itemMap[ev.item_id] ? ` · ${itemMap[ev.item_id].name}` : ''}
              </div>
              <div className="dash-row-sub">{ev.changed_by} · {fmtTime(ev.changed_at)}</div>
            </div>
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

function DashSection({ title, emptyText, children }) {
  const arr = React.Children.toArray(children).filter(Boolean);
  return (
    <div className="dash-section">
      <div className="dash-section-head">{title}</div>
      {arr.length === 0
        ? <div className="dash-empty">{emptyText}</div>
        : <div className="dash-list">{arr}</div>}
    </div>
  );
}

// ---------- events tab ----------
function EventsTab({ admin, openEventId, onOpened }) {
  const [events, setEvents]     = useState([]);
  const [selected, setSelected] = useState(null);
  const [newOpen, setNewOpen]   = useState(false);

  useEffect(() => {
    sb.from('events').select('*').order('event_date', { ascending: false, nullsFirst: true })
      .then(({ data }) => setEvents(data || []));
  }, []);

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
      <div style={{marginBottom:12, display:'flex', gap:8, alignItems:'center'}}>
        {admin
          ? <button className="btn primary" onClick={()=>setNewOpen(true)}>+ New deployment</button>
          : <LoginPrompt verb="create deployments" />}
      </div>
      {events.length === 0 ? (
        <div className="empty">
          {admin ? <>No deployments yet. <button className="link-btn" onClick={()=>setNewOpen(true)}>Create one →</button></>
            : 'No deployments yet.'}
        </div>
      ) : (
        <div className="items">
          {events.map(ev => (
            <div className="item clickable" key={ev.id} onClick={()=>setSelected(ev)}>
              <div className="row">
                <div className="name">{ev.name}</div>
                <span className="meta">{fmtDate(ev.event_date)}</span>
              </div>
              {ev.location && <div className="meta">{ev.location}</div>}
              <div className="meta">Tap to view →</div>
            </div>
          ))}
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
    if (a.error) setErr(a.error.message);
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
    } catch(e) { setErr(e.message); }
    setBusy(null);
  }

  async function deny(req) {
    if (!window.confirm(`Deny access for ${req.email}?`)) return;
    setBusy({ kind:'deny', id:req.id }); setErr('');
    const now = new Date().toISOString();
    const { error } = await sb.from('admin_requests').update({
      status: 'denied', reviewed_by: me.id, reviewed_at: now,
    }).eq('id', req.id);
    if (error) setErr(error.message);
    load(); setBusy(null);
  }

  async function changeRole(user, newRole) {
    if (user.user_id === me.id && user.role === 'master' && newRole === 'admin') {
      // Allow self-demote only if there's another master left
      if (masterCount <= 1) {
        setErr("You're the only master — promote someone else first.");
        return;
      }
      if (!window.confirm("Demote yourself to Admin? You'll lose team management.")) return;
    } else if (newRole === 'master') {
      if (!window.confirm(`Promote ${user.email} to Master? They'll be able to add and remove other admins.`)) return;
    } else {
      if (!window.confirm(`Demote ${user.email} to Admin?`)) return;
    }
    setBusy({ kind:'role', id:user.user_id }); setErr('');
    const { error } = await sb.from('admin_users').update({ role: newRole }).eq('user_id', user.user_id);
    if (error) setErr(error.message);
    load(); setBusy(null);
  }

  async function remove(user) {
    if (user.role === 'master' && masterCount <= 1) {
      setErr("Can't remove the last master.");
      return;
    }
    if (!window.confirm(`Remove ${user.email} from the team? They'll lose all admin access.`)) return;
    setBusy({ kind:'remove', id:user.user_id }); setErr('');
    const { error } = await sb.from('admin_users').delete().eq('user_id', user.user_id);
    if (error) setErr(error.message);
    load(); setBusy(null);
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:640}}>
        <h2>Manage team</h2>

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
                      <button className="btn sm" disabled={busy} onClick={()=>deny(req)}>Deny</button>
                      <button className="btn sm" disabled={busy} onClick={()=>approve(req,'admin')}>Approve as Admin</button>
                      <button className="btn sm primary" disabled={busy} onClick={()=>approve(req,'master')}>Approve as Master</button>
                    </div>
                  </div>
                ))}
              </div>
        }

        <div className="section-label">Team members ({admins.length})</div>
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
                    <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                      {u.role === 'admin'
                        ? <button className="btn sm" disabled={busy} onClick={()=>changeRole(u,'master')}>Promote</button>
                        : <button className="btn sm" disabled={busy || (isMe && masterCount<=1)} onClick={()=>changeRole(u,'admin')}>Demote</button>
                      }
                      <button className="btn sm danger" disabled={busy || (u.role==='master' && masterCount<=1)} onClick={()=>remove(u)}>Remove</button>
                    </div>
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

// ---------- main app ----------
function App() {
  // session: any signed-in user (admin OR pending). admin: only approved roles.
  // The rest of the app gates on `admin` so writes are blocked when pending.
  const [session, setSession]   = useState(() => {
    try { return JSON.parse(localStorage.getItem('eit:session')) || null; } catch { return null; }
  });
  const admin = session && (session.role === 'admin' || session.role === 'master') ? session : null;
  const isMaster = session?.role === 'master';
  const isPending = session && !session.role;

  const [tab, setTab]           = useState('dashboard'); // 'dashboard' | 'items' | 'events'
  const [loginOpen, setLoginOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [openItemId, setOpenItemId]   = useState(null);
  const [openEventId, setOpenEventId] = useState(null);
  const [landing, setLanding]         = useState(null);  // { kind: 'item'|'event', id } | null

  // deep-links: ?item=<uuid> or ?event=<uuid>
  // Show a focused ScanLanding card first; only enter the full app when dismissed.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const itemId  = params.get('item');
    const eventId = params.get('event');
    if (itemId  && parseScanned(itemId))  setLanding({ kind: 'item',  id: parseScanned(itemId)  });
    if (eventId && parseScanned(eventId)) setLanding({ kind: 'event', id: parseScanned(eventId) });
    // strip the params so a refresh doesn't keep the landing pinned
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

  // While the scan landing is up, render only that — no tabs, no chrome.
  // The login modal still works on top so admins can log in from the landing.
  if (landing) {
    return (
      <>
        <ScanLanding kind={landing.kind} id={landing.id} onDismiss={dismissLanding} />
        {loginOpen && <AdminLoginModal onLogin={handleLogin} onClose={()=>setLoginOpen(false)} />}
      </>
    );
  }

  return (
    <div className="app">
      {/* top bar */}
      <div className="topbar">
        <span className="brand">SQUATWOLF</span>
        <span className="spacer" />
        {session
          ? <div className="topbar-mode">
              {session.role === 'master' && <span className="role-pill master">Master · {session.name}</span>}
              {session.role === 'admin'  && <span className="role-pill admin">Admin · {session.name}</span>}
              {!session.role             && <span className="role-pill pending">Pending · {session.name}</span>}
              {isMaster && (
                <button className="btn sm" onClick={()=>setManageOpen(true)} title="Manage team">⚙ Team</button>
              )}
              <button className="btn sm ghost" onClick={logout} title="Log out">↺</button>
            </div>
          : <div className="topbar-mode">
              <span className="role-pill guest">View only</span>
              <button className="btn sm" onClick={()=>setLoginOpen(true)}>Log in</button>
            </div>
        }
      </div>
      {isPending && (
        <div className="pending-banner">
          Your access is pending approval. You can browse the inventory but can't edit yet.
        </div>
      )}

      {/* tabs */}
      <div className="tabs">
        {[['dashboard','Dashboard'],['items','Items'],['events','Deployments']].map(([key,label]) => (
          <button key={key} onClick={()=>setTab(key)} className={tab===key?'active':''}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && <DashboardTab admin={admin} />}
      {tab === 'items'     && <ItemsTab  admin={admin} openItemId={openItemId}  onOpened={()=>setOpenItemId(null)} />}
      {tab === 'events'    && <EventsTab admin={admin} openEventId={openEventId} onOpened={()=>setOpenEventId(null)} />}

      {loginOpen && <AdminLoginModal onLogin={handleLogin} onClose={()=>setLoginOpen(false)} />}
      {manageOpen && isMaster && (
        <ManageTeamModal me={session} onClose={()=>setManageOpen(false)} />
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
