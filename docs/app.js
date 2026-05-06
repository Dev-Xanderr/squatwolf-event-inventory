/* eslint-disable */
const { useState, useEffect, useMemo, useRef } = React;

// ---------- Supabase ----------
const SUPABASE_URL      = 'https://jnqlhfehhqnhqscvwjxp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpucWxoZmVoaHFuaHFzY3Z3anhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzMjU0OTcsImV4cCI6MjA5MTkwMTQ5N30.oBknXVFJZhpaBujHUH1MVW-UbKb_tBPCX6gwY8RYCsE';
const ADMIN_EMAIL       = 'admin@squatwolf.admin';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// ---------- constants ----------
const CONDITIONS = [
  { value: 'good',           label: 'Good' },
  { value: 'needs_cleaning', label: 'Needs Cleaning' },
  { value: 'needs_repair',   label: 'Needs Repair' },
  { value: 'damaged',        label: 'Damaged' },
];
const CLABEL = { good: 'Good', needs_cleaning: 'Needs Cleaning', needs_repair: 'Needs Repair', damaged: 'Damaged' };
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
    notes_updated:'Notes updated', returned:'Returned', photo_added:'Photo added', photo_removed:'Photo removed' }[a] || a;
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

// ---------- admin login ----------
function AdminLoginModal({ onLogin, onClose }) {
  const [password, setPassword] = useState('');
  const [err, setErr]           = useState('');
  const [loading, setLoading]   = useState(false);
  async function submit(e) {
    e.preventDefault(); setErr(''); setLoading(true);
    const { data, error } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password });
    if (error) { setErr('Wrong password'); setLoading(false); return; }
    onLogin({ token: data.session.access_token, id: data.user.id, name: 'Admin' });
  }
  return (
    <div className="backdrop" onClick={onClose}>
      <form className="modal" style={{maxWidth:320}} onClick={e=>e.stopPropagation()} onSubmit={submit}>
        <h2>Admin Login</h2>
        <div className="field"><label>Password</label>
          <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
            autoFocus autoComplete="current-password" placeholder="Enter admin password" />
        </div>
        <div className="err">{err}</div>
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={loading}>{loading?'…':'Log in'}</button>
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

  return (
    <div className="backdrop" onClick={onClose}>
      <form className="modal" onClick={e=>e.stopPropagation()} onSubmit={save}>
        <h2>{isEdit ? 'Edit item' : 'Add item to inventory'}</h2>
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
          {admin && <button className="btn primary" onClick={onEdit}>Edit item</button>}
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
  const matching = items.filter(it =>
    !existingItemIds.has(it.id) &&
    it.name.toLowerCase().includes(query.toLowerCase())
  );
  const available   = matching.filter(it => !activeOut[it.id]);
  const unavailable = matching.filter(it =>  activeOut[it.id]);

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
          {available.map(it => (
            <label key={it.id} className={`check-row${selected.has(it.id)?' selected':''}`}>
              <input type="checkbox" checked={selected.has(it.id)} onChange={()=>toggle(it.id)} style={{accentColor:'#B93A32',width:16,height:16}} />
              <div style={{flex:1}}>
                <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:17,letterSpacing:'0.04em',textTransform:'uppercase'}}>{it.name}</div>
                <div style={{fontFamily:"'Azeret Mono',monospace",fontSize:11,color:'#7A7A7A'}}>{it.category} · {it.storage_location||'No storage set'}</div>
              </div>
              <span className={`badge ${it.condition}`}>{CLABEL[it.condition]}</span>
            </label>
          ))}

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
        {admin && <button className="btn sm primary" onClick={()=>setAssignOpen(true)}>+ Assign</button>}
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
    if (condFilter !== 'all' && it.condition !== condFilter) return false;
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
        </select>
        {admin && <button className="btn primary" onClick={()=>setAddOpen(true)}>+ Add item</button>}
        <button className="btn" onClick={()=>setScanOpen(true)} title="Scan QR">⊟ Scan</button>
        {admin && items.length > 0 && (
          <button className="btn" onClick={()=>setLabels(true)} title="Print labels">⎙ Labels</button>
        )}
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
    </div>
  );
}

// ---------- events tab ----------
function EventsTab({ admin }) {
  const [events, setEvents]     = useState([]);
  const [selected, setSelected] = useState(null);
  const [newOpen, setNewOpen]   = useState(false);

  useEffect(() => {
    sb.from('events').select('*').order('event_date', { ascending: false, nullsFirst: true })
      .then(({ data }) => setEvents(data || []));
  }, []);

  if (selected) {
    return <EventDetail event={selected} admin={admin} onBack={()=>setSelected(null)} />;
  }

  return (
    <div className="container">
      {admin && (
        <div style={{marginBottom:12}}>
          <button className="btn primary" onClick={()=>setNewOpen(true)}>+ New deployment</button>
        </div>
      )}
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

// ---------- main app ----------
function App() {
  const [admin, setAdmin]       = useState(() => {
    try { return JSON.parse(localStorage.getItem('eit:admin')) || null; } catch { return null; }
  });
  const [tab, setTab]           = useState('items'); // 'items' | 'events'
  const [loginOpen, setLoginOpen] = useState(false);
  const [openItemId, setOpenItemId] = useState(null);

  // deep-link: ?item=<uuid> opens the item on the items tab
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get('item');
    if (id && parseScanned(id)) {
      setTab('items');
      setOpenItemId(parseScanned(id));
      // strip the param so a refresh doesn't keep popping the modal
      const url = new URL(location.href);
      url.searchParams.delete('item');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  useEffect(() => {
    sb.auth.getSession().then(({ data: { session } }) => {
      if (!session) { setAdmin(null); localStorage.removeItem('eit:admin'); }
    });
    sb.auth.onAuthStateChange((_, session) => {
      if (!session) { setAdmin(null); localStorage.removeItem('eit:admin'); }
    });
  }, []);

  function handleLogin(data) {
    const a = { token: data.token, id: data.id, name: data.name };
    setAdmin(a); localStorage.setItem('eit:admin', JSON.stringify(a));
    setLoginOpen(false);
  }
  function logout() {
    sb.auth.signOut(); setAdmin(null); localStorage.removeItem('eit:admin');
  }

  return (
    <div className="app">
      {/* top bar */}
      <div className="topbar">
        <span className="brand">SQUATWOLF</span>
        <span className="spacer" />
        {admin
          ? <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span style={{fontFamily:"'Azeret Mono',monospace",fontSize:11,color:'#B93A32',letterSpacing:'0.04em',textTransform:'uppercase'}}>{admin.name}</span>
              <button className="btn sm ghost" onClick={logout} title="Log out">↺</button>
            </div>
          : <button className="btn sm" onClick={()=>setLoginOpen(true)}>Admin Login</button>
        }
      </div>

      {/* tabs */}
      <div className="tabs">
        {[['items','Items'],['events','Deployments']].map(([key,label]) => (
          <button key={key} onClick={()=>setTab(key)} className={tab===key?'active':''}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'items'  && <ItemsTab  admin={admin} openItemId={openItemId} onOpened={()=>setOpenItemId(null)} />}
      {tab === 'events' && <EventsTab admin={admin} />}

      {loginOpen && <AdminLoginModal onLogin={handleLogin} onClose={()=>setLoginOpen(false)} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
