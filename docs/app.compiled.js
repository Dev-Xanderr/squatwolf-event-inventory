/* eslint-disable */
const {
  useState,
  useEffect,
  useMemo,
  useRef
} = React;

// ---------- Supabase ----------
const SUPABASE_URL = 'https://jnqlhfehhqnhqscvwjxp.supabase.co';
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
    lock: (name, acquireTimeout, fn) => fn()
  }
});

// ---------- constants ----------
const CONDITIONS = [{
  value: 'good',
  label: 'Good'
}, {
  value: 'needs_cleaning',
  label: 'Needs Cleaning'
}, {
  value: 'needs_repair',
  label: 'Needs Repair'
}, {
  value: 'damaged',
  label: 'Damaged'
}];
const CLABEL = {
  good: 'Good',
  needs_cleaning: 'Needs Cleaning',
  needs_repair: 'Needs Repair',
  damaged: 'Damaged',
  retired: 'Retired'
};
const CATEGORIES = ['Audio', 'Signage', 'Furniture', 'Equipment', 'Comms', 'Other'];
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}
function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso),
    now = new Date();
  const opts = d.toDateString() === now.toDateString() ? {
    hour: '2-digit',
    minute: '2-digit'
  } : {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  };
  return d.toLocaleString(undefined, opts);
}
function actionLabel(a) {
  return {
    item_created: 'Item added',
    item_updated: 'Item updated',
    item_deleted: 'Item removed',
    assigned: 'Assigned to deployment',
    location_updated: 'Location updated',
    condition_changed: 'Condition changed',
    notes_updated: 'Notes updated',
    returned: 'Returned',
    photo_added: 'Photo added',
    photo_removed: 'Photo removed',
    repaired: 'Marked repaired',
    retired: 'Retired'
  }[a] || a;
}
function isVideo(m) {
  return (m || '').startsWith('video/');
}
function diffObj(before, after, fields) {
  const d = {};
  for (const f of fields) if (String(before[f] || '') !== String(after[f] || '')) d[f] = {
    from: before[f],
    to: after[f]
  };
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
  const m = String(text || '').match(UUID_RE);
  return m ? m[0] : null;
}
function qrSvgString(text) {
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({
    scalable: true,
    margin: 0
  });
}

// ---------- CSV helpers ----------
function toCsv(rows, headers) {
  const esc = v => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const out = [headers.join(',')];
  for (const r of rows) out.push(headers.map(h => esc(r[h])).join(','));
  return out.join('\r\n');
}
function parseCsv(text) {
  const rows = [];
  let row = [],
    cell = '',
    q = false,
    i = 0;
  const finishCell = () => {
    row.push(cell);
    cell = '';
  };
  const finishRow = () => {
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        q = false;
        i++;
        continue;
      }
      cell += c;
      i++;
      continue;
    }
    if (c === '"') {
      q = true;
      i++;
      continue;
    }
    if (c === ',') {
      finishCell();
      i++;
      continue;
    }
    if (c === '\r' && text[i + 1] === '\n') {
      finishCell();
      finishRow();
      i += 2;
      continue;
    }
    if (c === '\n' || c === '\r') {
      finishCell();
      finishRow();
      i++;
      continue;
    }
    cell += c;
    i++;
  }
  if (cell.length > 0 || row.length > 0) {
    finishCell();
    finishRow();
  }
  // strip trailing fully-empty rows
  while (rows.length && rows[rows.length - 1].every(s => s === '')) rows.pop();
  return rows;
}
function downloadFile(filename, content, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿' + content], {
    type: mime
  }); // BOM for Excel
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 0);
}

// ---------- toast / error reporting ----------
// Lightweight pub-sub so any component can fire a toast without prop-drilling.
function toast(msg, kind = 'info') {
  window.dispatchEvent(new CustomEvent('eit:toast', {
    detail: {
      msg,
      kind
    }
  }));
}
// Translate raw Supabase / Postgres errors into something a human at a venue
// can act on. Codes we know about today, fall back to message otherwise.
function friendlyError(err) {
  if (!err) return '';
  const code = err.code || err?.error_code;
  const msg = err.message || String(err);
  if (code === '42501' || /row-level security/i.test(msg)) return 'Your access changed. Refresh the page or sign in again.';
  if (code === '23505' || /duplicate key/i.test(msg)) return 'That already exists.';
  if (code === '23503' || /foreign key/i.test(msg)) return 'Linked to other records — remove those first.';
  if (/Sign-up restricted/i.test(msg)) return 'Sign-up is restricted to @squatwolf.com email addresses.';
  if (/Failed to fetch|NetworkError|networkError/i.test(msg)) return 'No connection — check your wifi and try again.';
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
    const fn = e => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', fn);
    return () => window.removeEventListener('beforeunload', fn);
  }, [busy]);
  const safeClose = () => {
    if (!busy) onClose?.();
  };
  return {
    safeClose
  };
}

// ---------- imperative confirm ----------
// Replaces window.confirm. Use:
//   if (!await confirm({ title, body, danger:true })) return;
// Brand-consistent and works inside iOS PWAs (where window.confirm misbehaves).
let _confirmHandler = null;
function confirm(opts) {
  return new Promise(resolve => {
    if (!_confirmHandler) {
      resolve(window.confirm(opts.body || opts.title || 'Are you sure?'));
      return;
    }
    _confirmHandler({
      ...opts,
      resolve
    });
  });
}
function ConfirmHost() {
  const [opts, setOpts] = useState(null);
  useEffect(() => {
    _confirmHandler = o => setOpts(o);
    return () => {
      _confirmHandler = null;
    };
  }, []);
  if (!opts) return null;
  function answer(v) {
    opts.resolve(v);
    setOpts(null);
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "backdrop",
    onClick: () => answer(false),
    style: {
      zIndex: 80
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "modal",
    onClick: e => e.stopPropagation(),
    style: {
      maxWidth: 380
    }
  }, /*#__PURE__*/React.createElement("h2", null, opts.title || 'Are you sure?'), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Manrope',sans-serif",
      fontSize: 14,
      color: '#EFEFEF',
      marginBottom: 14,
      lineHeight: 1.45
    }
  }, opts.body), /*#__PURE__*/React.createElement("div", {
    className: "actions"
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn ghost",
    onClick: () => answer(false)
  }, opts.cancelLabel || 'Cancel'), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: `btn ${opts.danger ? 'danger' : 'primary'}`,
    onClick: () => answer(true)
  }, opts.confirmLabel || (opts.danger ? 'Yes, do it' : 'Confirm')))));
}
function ToastHost() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const fn = e => {
      const id = Math.random().toString(36).slice(2);
      const next = {
        id,
        msg: e.detail.msg,
        kind: e.detail.kind || 'info'
      };
      setItems(prev => [...prev, next]);
      setTimeout(() => setItems(prev => prev.filter(t => t.id !== id)), next.kind === 'err' ? 6000 : 3500);
    };
    window.addEventListener('eit:toast', fn);
    return () => window.removeEventListener('eit:toast', fn);
  }, []);
  if (items.length === 0) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "toast-host"
  }, items.map(t => /*#__PURE__*/React.createElement("div", {
    key: t.id,
    className: `toast-item ${t.kind}`
  }, t.msg)));
}

// ---------- lightbox ----------
function Lightbox({
  att,
  onClose
}) {
  useEffect(() => {
    const fn = e => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);
  return /*#__PURE__*/React.createElement("div", {
    className: "lightbox",
    onClick: onClose
  }, /*#__PURE__*/React.createElement("button", {
    className: "lightbox-close",
    onClick: onClose
  }, "\u2715"), /*#__PURE__*/React.createElement("div", {
    className: "lightbox-inner",
    onClick: e => e.stopPropagation()
  }, isVideo(att.mime_type) ? /*#__PURE__*/React.createElement("video", {
    src: att.url,
    controls: true,
    autoPlay: true,
    style: {
      maxWidth: '100%',
      maxHeight: '80vh',
      borderRadius: 10
    }
  }) : /*#__PURE__*/React.createElement("img", {
    src: att.url,
    alt: att.original_name,
    style: {
      maxWidth: '100%',
      maxHeight: '80vh',
      borderRadius: 10,
      display: 'block'
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "lightbox-caption"
  }, att.original_name, " \xB7 ", att.uploaded_by, " \xB7 ", fmtTime(att.uploaded_at))));
}

// ---------- attachment strip ----------
function AttachmentStrip({
  itemId,
  eventItemId,
  adminName,
  isAdmin
}) {
  const [atts, setAtts] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const [uploading, setUp] = useState(false);
  const [err, setErr] = useState('');
  const filter = eventItemId ? q => q.eq('event_item_id', eventItemId) : q => q.eq('item_id', itemId).is('event_item_id', null);
  useEffect(() => {
    filter(sb.from('attachments').select('*')).order('uploaded_at').then(({
      data
    }) => setAtts(data || []));
  }, [itemId, eventItemId]);
  async function upload(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setErr('');
    setUp(true);
    for (const f of files) {
      const ext = f.name.split('.').pop().toLowerCase();
      const path = `${itemId}/${eventItemId || 'master'}/${Date.now()}.${ext}`;
      const {
        error: upErr
      } = await sb.storage.from('attachments').upload(path, f, {
        contentType: f.type
      });
      if (upErr) {
        setErr(friendlyError(upErr));
        continue;
      }
      const {
        data: {
          publicUrl
        }
      } = sb.storage.from('attachments').getPublicUrl(path);
      const row = {
        item_id: itemId,
        storage_path: path,
        original_name: f.name,
        mime_type: f.type,
        size: f.size,
        url: publicUrl,
        uploaded_by: adminName,
        uploaded_at: new Date().toISOString()
      };
      if (eventItemId) row.event_item_id = eventItemId;
      const {
        data: att
      } = await sb.from('attachments').insert(row).select().single();
      if (att) setAtts(prev => [...(prev || []), att]);
    }
    setUp(false);
    e.target.value = '';
  }
  async function remove(att) {
    if (!(await confirm({
      title: 'Remove photo?',
      body: `Remove "${att.original_name}"?`,
      danger: true,
      confirmLabel: 'Remove'
    }))) return;
    await sb.storage.from('attachments').remove([att.storage_path]);
    await sb.from('attachments').delete().eq('id', att.id);
    setAtts(prev => prev.filter(a => a.id !== att.id));
  }
  if (atts === null) return /*#__PURE__*/React.createElement("div", {
    className: "att-loading"
  }, "Loading\u2026");
  return /*#__PURE__*/React.createElement("div", {
    className: "att-strip"
  }, atts.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "att-thumbs"
  }, atts.map(att => /*#__PURE__*/React.createElement("div", {
    className: "att-thumb",
    key: att.id
  }, /*#__PURE__*/React.createElement("div", {
    className: "att-img-wrap",
    onClick: () => setLightbox(att)
  }, isVideo(att.mime_type) ? /*#__PURE__*/React.createElement("div", {
    className: "att-video-placeholder"
  }, "\u25B6") : /*#__PURE__*/React.createElement("img", {
    src: att.url,
    alt: att.original_name
  })), isAdmin && /*#__PURE__*/React.createElement("button", {
    className: "att-remove",
    onClick: () => remove(att)
  }, "\u2715")))), isAdmin && /*#__PURE__*/React.createElement("label", {
    className: `btn sm att-upload-btn ${uploading ? 'disabled' : ''}`
  }, uploading ? 'Uploading…' : atts.length ? '+ More photos' : '📷 Add photo', /*#__PURE__*/React.createElement("input", {
    type: "file",
    accept: "image/*,video/mp4,video/quicktime",
    multiple: true,
    capture: "environment",
    onChange: upload,
    disabled: uploading,
    style: {
      display: 'none'
    }
  })), err && /*#__PURE__*/React.createElement("div", {
    className: "err",
    style: {
      marginTop: 4
    }
  }, err), lightbox && /*#__PURE__*/React.createElement(Lightbox, {
    att: lightbox,
    onClose: () => setLightbox(null)
  }));
}

// ---------- history list ----------
function HistoryList({
  itemId,
  eventItemId
}) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    const q = eventItemId ? sb.from('history').select('*').eq('event_item_id', eventItemId) : sb.from('history').select('*').eq('item_id', itemId);
    q.order('changed_at', {
      ascending: false
    }).then(({
      data
    }) => setRows(data || []));
  }, [itemId, eventItemId]);
  if (rows === null) return /*#__PURE__*/React.createElement("div", {
    style: {
      color: '#888',
      fontSize: 13
    }
  }, "Loading\u2026");
  if (!rows.length) return /*#__PURE__*/React.createElement("div", {
    style: {
      color: '#888',
      fontSize: 13
    }
  }, "No history yet.");
  return /*#__PURE__*/React.createElement("div", {
    className: "history"
  }, rows.map(ev => /*#__PURE__*/React.createElement("div", {
    className: "event",
    key: ev.id
  }, /*#__PURE__*/React.createElement("div", {
    className: "head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "who"
  }, ev.changed_by), /*#__PURE__*/React.createElement("span", null, fmtTime(ev.changed_at))), /*#__PURE__*/React.createElement("div", {
    className: "action"
  }, actionLabel(ev.action)), /*#__PURE__*/React.createElement("div", {
    className: "changes"
  }, ev.changes && Object.keys(ev.changes).length > 0 && (typeof ev.changes === 'object' && ev.changes.note ? /*#__PURE__*/React.createElement("span", null, ev.changes.note) : Object.entries(ev.changes).map(([k, v]) => typeof v === 'object' && v.from !== undefined ? /*#__PURE__*/React.createElement("span", {
    className: "chg",
    key: k
  }, /*#__PURE__*/React.createElement("span", {
    className: "k"
  }, k, ":"), ' ', /*#__PURE__*/React.createElement("span", {
    className: "from"
  }, k === 'condition' ? CLABEL[v.from] || v.from : v.from || '—'), /*#__PURE__*/React.createElement("span", {
    className: "arrow"
  }, "\u2192"), /*#__PURE__*/React.createElement("span", {
    className: "to"
  }, k === 'condition' ? CLABEL[v.to] || v.to : v.to || '—')) : /*#__PURE__*/React.createElement("span", {
    className: "chg",
    key: k
  }, /*#__PURE__*/React.createElement("span", {
    className: "k"
  }, k, ":"), " ", String(v))))))));
}

// ---------- scan landing ----------
// Direct deep-link cold-load: when someone scans a QR sticker the very first
// thing they see is a focused, clean card — no tabs, no list, no flicker.
function ScanLanding({
  kind,
  id,
  onDismiss
}) {
  const [item, setItem] = useState(null);
  const [event, setEvent] = useState(null);
  const [eis, setEis] = useState([]); // event_items if kind === 'event'
  const [outAt, setOutAt] = useState(null); // event the item is currently out at
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (kind === 'item') {
          const {
            data,
            error
          } = await sb.from('items').select('*').eq('id', id).maybeSingle();
          if (cancelled) return;
          if (error) throw error;
          if (!data) {
            setErr('Item not found.');
            setLoading(false);
            return;
          }
          setItem(data);
          // is this item currently out somewhere?
          const {
            data: o
          } = await sb.from('event_items').select('current_location, status, events(id, name, event_date)').eq('item_id', id).eq('status', 'out').limit(1);
          if (!cancelled && o && o.length) setOutAt(o[0]);
        } else {
          const {
            data,
            error
          } = await sb.from('events').select('*').eq('id', id).maybeSingle();
          if (cancelled) return;
          if (error) throw error;
          if (!data) {
            setErr('Deployment not found.');
            setLoading(false);
            return;
          }
          setEvent(data);
          const {
            data: ei
          } = await sb.from('event_items').select('*, items(id, name, category, condition, storage_location)').eq('event_id', id).order('assigned_at');
          if (!cancelled) setEis(ei || []);
        }
      } catch (e) {
        if (!cancelled) setErr(friendlyError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, id]);
  return /*#__PURE__*/React.createElement("div", {
    className: "scan-landing"
  }, /*#__PURE__*/React.createElement("div", {
    className: "scan-landing-bar"
  }, /*#__PURE__*/React.createElement("span", {
    className: "brand"
  }, "SQUATWOLF"), /*#__PURE__*/React.createElement("span", {
    className: "spacer"
  })), /*#__PURE__*/React.createElement("div", {
    className: "scan-landing-body"
  }, loading && /*#__PURE__*/React.createElement("div", {
    className: "empty"
  }, "Loading\u2026"), err && !loading && /*#__PURE__*/React.createElement("div", {
    className: "scan-error"
  }, /*#__PURE__*/React.createElement("h2", null, "Couldn't find that"), /*#__PURE__*/React.createElement("div", {
    className: "scan-error-sub"
  }, err), /*#__PURE__*/React.createElement("button", {
    className: "btn primary",
    onClick: onDismiss
  }, "Open inventory")), !loading && !err && kind === 'item' && item && /*#__PURE__*/React.createElement("div", {
    className: "scan-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "scan-card-head"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "scan-card-kicker"
  }, "Scanned item"), /*#__PURE__*/React.createElement("h1", {
    className: "scan-card-title"
  }, item.name), /*#__PURE__*/React.createElement("div", {
    className: "scan-card-sub"
  }, item.category || '—', " \xB7 Stored at: ", item.storage_location || '—')), /*#__PURE__*/React.createElement("span", {
    className: `badge ${item.condition}`
  }, CLABEL[item.condition] || item.condition)), /*#__PURE__*/React.createElement("div", {
    className: "scan-card-status"
  }, item.condition === 'retired' ? /*#__PURE__*/React.createElement("div", {
    className: "scan-card-line muted"
  }, "This item is retired and out of service.") : outAt ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "scan-card-line"
  }, /*#__PURE__*/React.createElement("span", {
    className: "k"
  }, "Status"), /*#__PURE__*/React.createElement("span", {
    className: "v out"
  }, "Out at deployment")), /*#__PURE__*/React.createElement("div", {
    className: "scan-card-line"
  }, /*#__PURE__*/React.createElement("span", {
    className: "k"
  }, "Deployment"), /*#__PURE__*/React.createElement("span", {
    className: "v"
  }, outAt.events?.name || '—')), /*#__PURE__*/React.createElement("div", {
    className: "scan-card-line"
  }, /*#__PURE__*/React.createElement("span", {
    className: "k"
  }, "At"), /*#__PURE__*/React.createElement("span", {
    className: "v"
  }, outAt.current_location || '—'))) : /*#__PURE__*/React.createElement("div", {
    className: "scan-card-line"
  }, /*#__PURE__*/React.createElement("span", {
    className: "k"
  }, "Status"), /*#__PURE__*/React.createElement("span", {
    className: "v stored"
  }, "Stored \u2014 not on a deployment")), item.notes && /*#__PURE__*/React.createElement("div", {
    className: "scan-card-line"
  }, /*#__PURE__*/React.createElement("span", {
    className: "k"
  }, "Notes"), /*#__PURE__*/React.createElement("span", {
    className: "v"
  }, item.notes))), /*#__PURE__*/React.createElement(AttachmentStrip, {
    itemId: item.id,
    adminName: null,
    isAdmin: false
  }), /*#__PURE__*/React.createElement("div", {
    className: "actions",
    style: {
      marginTop: 18,
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement(LoginPrompt, {
    verb: "edit"
  }), /*#__PURE__*/React.createElement("button", {
    className: "btn primary",
    onClick: onDismiss
  }, "Open in app"))), !loading && !err && kind === 'event' && event && /*#__PURE__*/React.createElement("div", {
    className: "scan-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "scan-card-head"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "scan-card-kicker"
  }, "Deployment"), /*#__PURE__*/React.createElement("h1", {
    className: "scan-card-title"
  }, event.name), /*#__PURE__*/React.createElement("div", {
    className: "scan-card-sub"
  }, fmtDate(event.event_date), event.location ? ' · ' + event.location : ''))), /*#__PURE__*/React.createElement("div", {
    className: "scan-card-status"
  }, /*#__PURE__*/React.createElement("div", {
    className: "scan-card-line"
  }, /*#__PURE__*/React.createElement("span", {
    className: "k"
  }, "Total"), /*#__PURE__*/React.createElement("span", {
    className: "v"
  }, eis.length)), /*#__PURE__*/React.createElement("div", {
    className: "scan-card-line"
  }, /*#__PURE__*/React.createElement("span", {
    className: "k"
  }, "Out"), /*#__PURE__*/React.createElement("span", {
    className: "v out"
  }, eis.filter(e => e.status === 'out').length)), /*#__PURE__*/React.createElement("div", {
    className: "scan-card-line"
  }, /*#__PURE__*/React.createElement("span", {
    className: "k"
  }, "Returned"), /*#__PURE__*/React.createElement("span", {
    className: "v stored"
  }, eis.filter(e => e.status === 'returned').length))), /*#__PURE__*/React.createElement("div", {
    className: "section-label"
  }, "Items"), eis.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "empty"
  }, "No items assigned to this deployment.") : /*#__PURE__*/React.createElement("div", {
    className: "scan-item-list"
  }, eis.slice(0, 25).map(ei => /*#__PURE__*/React.createElement("div", {
    key: ei.id,
    className: "scan-item-row"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "scan-item-name"
  }, ei.items?.name || '—'), /*#__PURE__*/React.createElement("div", {
    className: "scan-item-sub"
  }, ei.current_location || '—')), /*#__PURE__*/React.createElement("span", {
    className: `badge ${ei.status === 'returned' ? 'status-returned' : 'status-out'}`
  }, ei.status === 'returned' ? 'Returned' : 'Out'))), eis.length > 25 && /*#__PURE__*/React.createElement("div", {
    className: "scan-item-sub",
    style: {
      padding: '6px 12px'
    }
  }, "+ ", eis.length - 25, " more \u2014 open in app to see all")), /*#__PURE__*/React.createElement("div", {
    className: "actions",
    style: {
      marginTop: 18,
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement(LoginPrompt, {
    verb: "manage"
  }), /*#__PURE__*/React.createElement("button", {
    className: "btn primary",
    onClick: onDismiss
  }, "Open in app")))));
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
function LoginPrompt({
  verb = 'edit'
}) {
  const [session, setSession] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('eit:session')) || null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    const fn = () => {
      try {
        setSession(JSON.parse(localStorage.getItem('eit:session')) || null);
      } catch {
        setSession(null);
      }
    };
    window.addEventListener('storage', fn);
    return () => window.removeEventListener('storage', fn);
  }, []);
  const isSignedIn = !!session;
  const isAdminLike = session?.role === 'admin' || session?.role === 'master';
  if (isAdminLike) return null; // shouldn't render — admins see real buttons
  if (isSignedIn) {
    return /*#__PURE__*/React.createElement("span", {
      className: "login-prompt no-action",
      title: "Edit access is granted by a master admin"
    }, /*#__PURE__*/React.createElement("span", {
      className: "login-prompt-dot"
    }, "\u25CF"), " Ask a master for edit access");
  }
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "login-prompt",
    onClick: requestLogin
  }, /*#__PURE__*/React.createElement("span", {
    className: "login-prompt-dot"
  }, "\u25CF"), " Log in to ", verb);
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
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    setTimeout(() => {
      o.stop();
      ctx.close();
    }, 90);
  } catch {/* silent */}
  try {
    navigator.vibrate?.(35);
  } catch {/* silent */}
}
function ScannerModal({
  onClose,
  onScan,
  title,
  mode = 'single',
  counter,
  lastScan,
  onUndoLast
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const lockRef = useRef(false);
  const [err, setErr] = useState('');
  const [flash, setFlash] = useState(false);
  const [manualOpen, setMan] = useState(false);
  const [manualVal, setManVal] = useState('');
  useEffect(() => {
    let cancelled = false;
    async function start() {
      if (!window.jsQR) {
        setErr('Scanner library not loaded — refresh the page.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: {
              ideal: 'environment'
            }
          },
          audio: false
        });
        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream;
        v.setAttribute('playsinline', 'true');
        await v.play().catch(() => {});
        const c = canvasRef.current;
        const ctx = c.getContext('2d', {
          willReadFrequently: true
        });
        const tick = () => {
          if (cancelled) return;
          if (!lockRef.current && v.readyState === 4 && v.videoWidth) {
            c.width = v.videoWidth;
            c.height = v.videoHeight;
            ctx.drawImage(v, 0, 0, c.width, c.height);
            const img = ctx.getImageData(0, 0, c.width, c.height);
            const code = window.jsQR(img.data, c.width, c.height, {
              inversionAttempts: 'dontInvert'
            });
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
                    setTimeout(() => {
                      lockRef.current = false;
                    }, 700);
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
        setErr(e.name === 'NotAllowedError' ? 'Camera permission denied. Allow camera access in your browser, or use Type code below.' : 'Camera unavailable: ' + (e.message || e.name));
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
    if (!id) {
      setErr('Not a valid code.');
      return;
    }
    setErr('');
    setManVal('');
    playBeep();
    setFlash(true);
    setTimeout(() => setFlash(false), 220);
    Promise.resolve(onScan(id)).finally(() => {
      if (mode === 'single') onClose();
    });
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "backdrop",
    onClick: onClose
  }, /*#__PURE__*/React.createElement("div", {
    className: "modal scanner-modal",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      marginBottom: 12,
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }, title || 'Scan QR'), mode === 'continuous' && counter != null && /*#__PURE__*/React.createElement("span", {
    className: "scanner-counter"
  }, counter)), /*#__PURE__*/React.createElement("div", {
    className: `scanner-frame${flash ? ' flash' : ''}`
  }, /*#__PURE__*/React.createElement("video", {
    ref: videoRef,
    muted: true,
    playsInline: true
  }), /*#__PURE__*/React.createElement("canvas", {
    ref: canvasRef,
    style: {
      display: 'none'
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "scanner-reticle"
  })), lastScan && mode === 'continuous' && /*#__PURE__*/React.createElement("div", {
    className: `scanner-toast ${lastScan.kind || 'ok'}`
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      minWidth: 0,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, lastScan.label), onUndoLast && lastScan.canUndo && /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "scanner-undo",
    onClick: onUndoLast
  }, "Undo")), err ? /*#__PURE__*/React.createElement("div", {
    className: "err",
    style: {
      marginTop: 10
    }
  }, err) : /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Azeret Mono',monospace",
      fontSize: 11,
      color: '#7A7A7A',
      marginTop: 10,
      letterSpacing: '0.04em',
      textTransform: 'uppercase'
    }
  }, mode === 'continuous' ? 'Keep scanning — modal stays open' : 'Point camera at item label'), !manualOpen && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8
    }
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "link-btn",
    onClick: () => setMan(true)
  }, "Type code manually instead")), manualOpen && /*#__PURE__*/React.createElement("form", {
    onSubmit: submitManual,
    style: {
      marginTop: 10,
      display: 'flex',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("input", {
    value: manualVal,
    onChange: e => setManVal(e.target.value),
    placeholder: "Paste code or full URL",
    style: {
      flex: 1,
      background: '#1a1a1a',
      border: '1px solid #2a2a2a',
      color: '#FAFAFA',
      padding: '10px 12px',
      fontFamily: "'Azeret Mono',monospace",
      fontSize: 12
    },
    autoFocus: true
  }), /*#__PURE__*/React.createElement("button", {
    type: "submit",
    className: "btn primary sm"
  }, "Submit")), /*#__PURE__*/React.createElement("div", {
    className: "actions"
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn ghost",
    onClick: onClose
  }, mode === 'continuous' ? 'Done' : 'Cancel'))));
}

// ---------- CSV import modal ----------
function CsvImportModal({
  admin,
  existingItems,
  onClose,
  onImported
}) {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState({
    done: 0,
    total: 0
  });
  const [err, setErr] = useState('');
  const {
    safeClose
  } = useUnloadGuard(saving, onClose);
  const VALID_COND = new Set(['good', 'needs_cleaning', 'needs_repair', 'damaged', 'retired']);
  const existingNames = new Map(); // lowercased name → existing item
  existingItems.forEach(it => existingNames.set(it.name.trim().toLowerCase(), it));
  function loadFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => setText(String(r.result || ''));
    r.readAsText(f);
  }
  function preview() {
    setErr('');
    if (!text.trim()) {
      setErr('Paste or upload a CSV first.');
      return;
    }
    let rows;
    try {
      rows = parseCsv(text);
    } catch (e) {
      setErr('Could not parse CSV: ' + e.message);
      return;
    }
    if (rows.length < 2) {
      setErr('CSV needs a header row and at least one data row.');
      return;
    }
    const headers = rows[0].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
    const required = ['name'];
    for (const r of required) {
      if (!headers.includes(r)) {
        setErr(`Missing required column: ${r}`);
        return;
      }
    }
    const colIdx = name => headers.indexOf(name);
    const idx = {
      name: colIdx('name'),
      category: colIdx('category'),
      storage_location: colIdx('storage_location') >= 0 ? colIdx('storage_location') : colIdx('storage'),
      condition: colIdx('condition'),
      notes: colIdx('notes')
    };
    const mappedRows = rows.slice(1).map(cells => {
      const get = i => i >= 0 ? (cells[i] || '').trim() : '';
      const name = get(idx.name);
      let category = get(idx.category);
      if (category && !CATEGORIES.includes(category)) {
        const found = CATEGORIES.find(c => c.toLowerCase() === category.toLowerCase());
        category = found || 'Other';
      } else if (!category) category = 'Other';
      let condition = (get(idx.condition) || 'good').toLowerCase().replace(/\s+/g, '_').replace('-', '_');
      if (!VALID_COND.has(condition)) condition = 'good';
      const mapped = {
        name,
        category,
        storage_location: get(idx.storage_location),
        condition,
        notes: get(idx.notes)
      };
      let status = 'add',
        reason = '';
      if (!name) {
        status = 'skip';
        reason = 'Missing name';
      } else if (existingNames.has(name.toLowerCase())) {
        status = 'skip';
        reason = 'Already exists';
      }
      return {
        raw: cells,
        mapped,
        status,
        reason
      };
    });
    setParsed({
      headers,
      rows: mappedRows
    });
  }
  async function performImport() {
    if (!parsed) return;
    const toAdd = parsed.rows.filter(r => r.status === 'add');
    setSaving(true);
    setErr('');
    setProgress({
      done: 0,
      total: toAdd.length
    });
    try {
      const now = new Date().toISOString();
      // chunk for safety on large imports
      const CHUNK = 50;
      let done = 0;
      for (let i = 0; i < toAdd.length; i += CHUNK) {
        const slice = toAdd.slice(i, i + CHUNK);
        const payload = slice.map(r => ({
          ...r.mapped,
          created_at: now,
          updated_at: now,
          updated_by: admin.name
        }));
        const {
          data,
          error
        } = await sb.from('items').insert(payload).select('id, name, storage_location');
        if (error) throw error;
        // history per row
        if (data && data.length) {
          await sb.from('history').insert(data.map(it => ({
            item_id: it.id,
            action: 'item_created',
            changes: {
              note: `Imported via CSV. Stored at: ${it.storage_location || '—'}`
            },
            changed_by: admin.name,
            changed_at: now
          })));
        }
        done += slice.length;
        setProgress({
          done,
          total: toAdd.length
        });
      }
      onImported();
      onClose();
    } catch (e) {
      setErr(friendlyError(e));
      setSaving(false);
    }
  }
  const addCount = parsed?.rows.filter(r => r.status === 'add').length || 0;
  const skipCount = parsed?.rows.filter(r => r.status === 'skip').length || 0;
  return /*#__PURE__*/React.createElement("div", {
    className: "backdrop",
    onClick: safeClose
  }, /*#__PURE__*/React.createElement("div", {
    className: "modal",
    onClick: e => e.stopPropagation(),
    style: {
      maxWidth: 760
    }
  }, /*#__PURE__*/React.createElement("h2", null, "Import items from CSV"), !parsed && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Azeret Mono',monospace",
      fontSize: 11,
      color: '#7A7A7A',
      marginBottom: 10,
      letterSpacing: '0.04em'
    }
  }, "Required column: ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: '#FAFAFA'
    }
  }, "name"), ". Optional: category, storage_location, condition, notes. Existing items (matched by name) are skipped \u2014 import only adds new rows."), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Upload CSV file"), /*#__PURE__*/React.createElement("input", {
    type: "file",
    accept: ".csv,text/csv,text/plain",
    onChange: loadFile
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "\u2026or paste CSV here"), /*#__PURE__*/React.createElement("textarea", {
    value: text,
    onChange: e => setText(e.target.value),
    rows: 8,
    placeholder: 'name,category,storage_location,condition,notes\nAudio mixer,Audio,Warehouse — Shelf A1,good,Channel 16'
  })), err && /*#__PURE__*/React.createElement("div", {
    className: "err"
  }, err), /*#__PURE__*/React.createElement("div", {
    className: "actions"
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn ghost",
    onClick: onClose
  }, "Cancel"), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn primary",
    onClick: preview,
    disabled: !text.trim()
  }, "Preview"))), parsed && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Azeret Mono',monospace",
      fontSize: 12,
      color: '#7A7A7A',
      marginBottom: 10,
      letterSpacing: '0.04em',
      textTransform: 'uppercase'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: '#5fcf7e'
    }
  }, addCount, " to add"), skipCount > 0 && /*#__PURE__*/React.createElement(React.Fragment, null, " \xB7 ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: '#d48a34'
    }
  }, skipCount, " skipped"))), /*#__PURE__*/React.createElement("div", {
    style: {
      maxHeight: 340,
      overflowY: 'auto',
      border: '1px solid #2a2a2a'
    }
  }, /*#__PURE__*/React.createElement("table", {
    className: "csv-preview"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", {
    style: {
      width: '8%'
    }
  }, "Status"), /*#__PURE__*/React.createElement("th", null, "Name"), /*#__PURE__*/React.createElement("th", null, "Category"), /*#__PURE__*/React.createElement("th", null, "Storage"), /*#__PURE__*/React.createElement("th", null, "Condition"), /*#__PURE__*/React.createElement("th", null, "Reason"))), /*#__PURE__*/React.createElement("tbody", null, parsed.rows.map((r, i) => /*#__PURE__*/React.createElement("tr", {
    key: i,
    className: r.status === 'skip' ? 'skip' : 'add'
  }, /*#__PURE__*/React.createElement("td", null, r.status === 'add' ? 'Add' : 'Skip'), /*#__PURE__*/React.createElement("td", null, r.mapped.name || /*#__PURE__*/React.createElement("em", {
    style: {
      color: '#888'
    }
  }, "\u2014")), /*#__PURE__*/React.createElement("td", null, r.mapped.category), /*#__PURE__*/React.createElement("td", null, r.mapped.storage_location || ''), /*#__PURE__*/React.createElement("td", null, CLABEL[r.mapped.condition] || r.mapped.condition), /*#__PURE__*/React.createElement("td", {
    style: {
      color: '#d48a34'
    }
  }, r.reason)))))), saving && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 10,
      fontFamily: "'Azeret Mono',monospace",
      fontSize: 12,
      color: '#d48a34'
    }
  }, "Importing ", progress.done, "/", progress.total, "\u2026"), err && /*#__PURE__*/React.createElement("div", {
    className: "err",
    style: {
      marginTop: 8
    }
  }, err), /*#__PURE__*/React.createElement("div", {
    className: "actions"
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn ghost",
    onClick: () => {
      setParsed(null);
      setErr('');
    },
    disabled: saving
  }, "Back"), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn primary",
    disabled: !addCount || saving,
    onClick: () => setConfirming(true)
  }, saving ? 'Importing…' : `Import ${addCount} item${addCount === 1 ? '' : 's'}`)), confirming && /*#__PURE__*/React.createElement("div", {
    className: "backdrop",
    onClick: () => !saving && setConfirming(false),
    style: {
      zIndex: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "modal",
    onClick: e => e.stopPropagation(),
    style: {
      maxWidth: 380
    }
  }, /*#__PURE__*/React.createElement("h2", null, "Are you sure?"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Manrope',sans-serif",
      fontSize: 14,
      color: '#EFEFEF',
      marginBottom: 14
    }
  }, "Add ", /*#__PURE__*/React.createElement("strong", null, addCount), " item", addCount === 1 ? '' : 's', " to the master inventory?", skipCount > 0 && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement("span", {
    style: {
      color: '#7A7A7A',
      fontFamily: "'Azeret Mono',monospace",
      fontSize: 12
    }
  }, skipCount, " row", skipCount === 1 ? '' : 's', " will be skipped."))), /*#__PURE__*/React.createElement("div", {
    className: "actions"
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn ghost",
    onClick: () => setConfirming(false),
    disabled: saving
  }, "Cancel"), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn primary",
    disabled: saving,
    onClick: () => {
      setConfirming(false);
      performImport();
    }
  }, saving ? 'Importing…' : 'Yes, import')))))));
}

// ---------- printable label sheet ----------
function LabelSheet({
  items,
  onClose
}) {
  const sheetRef = useRef(null);
  function doPrint() {
    window.print();
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "backdrop label-backdrop",
    onClick: onClose
  }, /*#__PURE__*/React.createElement("div", {
    className: "modal label-modal",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("h2", null, "Print labels"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Azeret Mono',monospace",
      fontSize: 11,
      color: '#7A7A7A',
      marginBottom: 12,
      letterSpacing: '0.04em',
      textTransform: 'uppercase'
    }
  }, items.length, " label", items.length === 1 ? '' : 's', " \xB7 use browser print \u2192 save as PDF or send to a label printer"), /*#__PURE__*/React.createElement("div", {
    className: "label-sheet",
    ref: sheetRef
  }, items.map(it => /*#__PURE__*/React.createElement("div", {
    className: "label",
    key: it.id
  }, /*#__PURE__*/React.createElement("div", {
    className: "label-qr",
    dangerouslySetInnerHTML: {
      __html: qrSvgString(itemUrl(it.id))
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "label-meta"
  }, /*#__PURE__*/React.createElement("div", {
    className: "label-name"
  }, it.name), /*#__PURE__*/React.createElement("div", {
    className: "label-sub"
  }, it.category || '—'), /*#__PURE__*/React.createElement("div", {
    className: "label-id"
  }, String(it.id).slice(0, 8)))))), /*#__PURE__*/React.createElement("div", {
    className: "actions no-print"
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn ghost",
    onClick: onClose
  }, "Close"), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn primary",
    onClick: doPrint
  }, "Print"))));
}

// ---------- admin login / request access ----------
function AdminLoginModal({
  onLogin,
  onClose
}) {
  const [mode, setMode] = useState('signin'); // 'signin' | 'request' | 'sent'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [sentEmail, setSentEmail] = useState('');
  async function signIn(e) {
    e.preventDefault();
    setErr('');
    setInfo('');
    setLoading(true);
    const {
      data,
      error
    } = await sb.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password
    });
    if (error) {
      setErr(error.message === 'Invalid login credentials' ? 'Email or password is incorrect.' : friendlyError(error));
      setLoading(false);
      return;
    }
    // Resolve role from admin_users; if not present, this is a pending account.
    const {
      data: row
    } = await sb.from('admin_users').select('*').eq('user_id', data.user.id).maybeSingle();
    onLogin({
      id: data.user.id,
      email: data.user.email,
      name: row?.name || data.user.user_metadata?.name || data.user.email,
      role: row?.role || null // null = signed in but pending approval
    });
  }
  async function requestAccess(e) {
    e.preventDefault();
    setErr('');
    setInfo('');
    setLoading(true);
    const trimmedEmail = email.trim().toLowerCase();
    if (!name.trim()) {
      setErr('Please enter your name.');
      setLoading(false);
      return;
    }
    if (!trimmedEmail.endsWith('@squatwolf.com')) {
      setErr('Sign-up is restricted to @squatwolf.com email addresses.');
      setLoading(false);
      return;
    }
    if (password.length < 8) {
      setErr('Password must be at least 8 characters.');
      setLoading(false);
      return;
    }
    const {
      data,
      error
    } = await sb.auth.signUp({
      email: trimmedEmail,
      password,
      options: {
        data: {
          name: name.trim()
        }
      }
    });
    if (error) {
      setErr(friendlyError(error));
      setLoading(false);
      return;
    }
    // If email confirmation is required, session is null until they confirm.
    if (!data.session) {
      setSentEmail(trimmedEmail);
      setMode('sent');
      setLoading(false);
      return;
    }
    // Otherwise they're signed in immediately; trigger has queued an admin_requests row.
    const {
      data: row
    } = await sb.from('admin_users').select('*').eq('user_id', data.user.id).maybeSingle();
    onLogin({
      id: data.user.id,
      email: data.user.email,
      name: row?.name || name.trim(),
      role: row?.role || null
    });
  }
  async function resetPassword() {
    setErr('');
    setInfo('');
    if (!email.trim()) {
      setErr('Enter your email first.');
      return;
    }
    const {
      error
    } = await sb.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: location.origin + location.pathname
    });
    if (error) {
      setErr(friendlyError(error));
      return;
    }
    setInfo('Password reset email sent. Check your inbox.');
  }

  // Inline @squatwolf.com domain validation for the Sign-up tab (3.6).
  // Empty field = no warning; once they've typed an @ we evaluate.
  const emailLooksWrong = mode === 'request' && email.includes('@') && !email.trim().toLowerCase().endsWith('@squatwolf.com');
  const submitDisabled = loading || mode === 'request' && (!email.trim() || !email.trim().toLowerCase().endsWith('@squatwolf.com') || !name.trim() || password.length < 8);
  if (mode === 'sent') {
    return /*#__PURE__*/React.createElement("div", {
      className: "backdrop",
      onClick: onClose
    }, /*#__PURE__*/React.createElement("div", {
      className: "modal",
      style: {
        maxWidth: 400
      },
      onClick: e => e.stopPropagation()
    }, /*#__PURE__*/React.createElement("h2", null, "Check your email"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontFamily: "'Manrope',sans-serif",
        fontSize: 14,
        color: '#EFEFEF',
        lineHeight: 1.5,
        marginBottom: 14
      }
    }, "We sent a confirmation link to ", /*#__PURE__*/React.createElement("strong", null, sentEmail), ". Click it to activate your account, then come back and sign in."), /*#__PURE__*/React.createElement("div", {
      style: {
        fontFamily: "'Azeret Mono',monospace",
        fontSize: 11,
        color: '#7A7A7A',
        marginBottom: 18,
        letterSpacing: '0.04em'
      }
    }, "Can't find it? Check your spam folder."), /*#__PURE__*/React.createElement("div", {
      className: "actions"
    }, /*#__PURE__*/React.createElement("button", {
      type: "button",
      className: "btn ghost",
      onClick: onClose
    }, "Close"), /*#__PURE__*/React.createElement("button", {
      type: "button",
      className: "btn primary",
      onClick: () => {
        setMode('signin');
        setErr('');
        setInfo('');
        setPassword('');
      }
    }, "Back to sign in"))));
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "backdrop",
    onClick: onClose
  }, /*#__PURE__*/React.createElement("form", {
    className: "modal",
    style: {
      maxWidth: 380
    },
    onClick: e => e.stopPropagation(),
    onSubmit: mode === 'signin' ? signIn : requestAccess
  }, /*#__PURE__*/React.createElement("h2", null, mode === 'signin' ? 'Sign in' : 'Sign up'), /*#__PURE__*/React.createElement("div", {
    className: "auth-tabs"
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: mode === 'signin' ? 'active' : '',
    onClick: () => {
      setMode('signin');
      setErr('');
      setInfo('');
    }
  }, "Sign in"), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: mode === 'request' ? 'active' : '',
    onClick: () => {
      setMode('request');
      setErr('');
      setInfo('');
    }
  }, "Sign up")), mode === 'request' && /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Your name"), /*#__PURE__*/React.createElement("input", {
    value: name,
    onChange: e => setName(e.target.value),
    placeholder: "e.g. Alex Martins",
    autoFocus: true,
    autoComplete: "name"
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Work email"), /*#__PURE__*/React.createElement("input", {
    type: "email",
    value: email,
    onChange: e => setEmail(e.target.value),
    autoFocus: mode === 'signin',
    autoComplete: "email",
    placeholder: "you@squatwolf.com",
    required: true,
    className: emailLooksWrong ? 'input-warn' : ''
  }), emailLooksWrong && /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Azeret Mono',monospace",
      fontSize: 11,
      color: '#d48a34',
      marginTop: 4,
      letterSpacing: '0.04em'
    }
  }, "\u26A0 Must be a @squatwolf.com address")), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Password", mode === 'request' ? ' (min 8 chars)' : ''), /*#__PURE__*/React.createElement("input", {
    type: "password",
    value: password,
    onChange: e => setPassword(e.target.value),
    autoComplete: mode === 'signin' ? 'current-password' : 'new-password',
    placeholder: mode === 'signin' ? 'Your password' : 'Create a password',
    required: true
  })), info && /*#__PURE__*/React.createElement("div", {
    className: "ok"
  }, info), err && /*#__PURE__*/React.createElement("div", {
    className: "err"
  }, err), /*#__PURE__*/React.createElement("div", {
    className: "actions",
    style: {
      justifyContent: 'space-between'
    }
  }, mode === 'signin' ? /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "link-btn",
    onClick: resetPassword
  }, "Forgot password?") : /*#__PURE__*/React.createElement("span", null), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn ghost",
    onClick: onClose
  }, "Cancel"), /*#__PURE__*/React.createElement("button", {
    type: "submit",
    className: "btn primary",
    disabled: submitDisabled
  }, loading ? '…' : mode === 'signin' ? 'Sign in' : 'Sign up')))));
}

// ---------- item form (master list) ----------
function ItemFormModal({
  initial,
  admin,
  onClose,
  onSaved
}) {
  const [name, setName] = useState(initial?.name || '');
  const [category, setCategory] = useState(initial?.category || 'Equipment');
  const [storageLocation, setStorage] = useState(initial?.storage_location || '');
  const [condition, setCondition] = useState(initial?.condition || 'good');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const isEdit = !!initial?.id;
  async function save(e) {
    e.preventDefault();
    if (!name.trim()) return setErr('Name required');
    setSaving(true);
    setErr('');
    const now = new Date().toISOString();
    const payload = {
      name: name.trim(),
      category,
      storage_location: storageLocation.trim(),
      condition,
      notes: notes.trim(),
      updated_at: now,
      updated_by: admin.name
    };
    try {
      if (isEdit) {
        const changes = diffObj(initial, payload, ['name', 'category', 'storage_location', 'condition', 'notes']);
        const {
          data,
          error
        } = await sb.from('items').update(payload).eq('id', initial.id).select().single();
        if (error) throw error;
        if (Object.keys(changes).length) await sb.from('history').insert({
          item_id: initial.id,
          action: 'item_updated',
          changes,
          changed_by: admin.name,
          changed_at: now
        });
        onSaved(data);
      } else {
        const {
          data,
          error
        } = await sb.from('items').insert({
          ...payload,
          created_at: now
        }).select().single();
        if (error) throw error;
        await sb.from('history').insert({
          item_id: data.id,
          action: 'item_created',
          changes: {
            note: `Added to master inventory. Stored at: ${storageLocation || '—'}`
          },
          changed_by: admin.name,
          changed_at: now
        });
        onSaved(data);
      }
      onClose();
    } catch (e) {
      setErr(friendlyError(e));
      setSaving(false);
    }
  }
  async function del() {
    if (!(await confirm({
      title: 'Delete this item?',
      body: `Delete "${initial.name}" from master inventory? This cannot be undone.`,
      danger: true,
      confirmLabel: 'Delete'
    }))) return;
    await sb.from('items').delete().eq('id', initial.id);
    onSaved(null);
    onClose();
  }
  async function setConditionAndLog(newCond, action, noteText) {
    setSaving(true);
    setErr('');
    const now = new Date().toISOString();
    try {
      const {
        data,
        error
      } = await sb.from('items').update({
        condition: newCond,
        updated_at: now,
        updated_by: admin.name
      }).eq('id', initial.id).select().single();
      if (error) throw error;
      await sb.from('history').insert({
        item_id: initial.id,
        action,
        changes: {
          note: noteText,
          from: initial.condition,
          to: newCond
        },
        changed_by: admin.name,
        changed_at: now
      });
      onSaved(data);
      onClose();
    } catch (e) {
      setErr(friendlyError(e));
      setSaving(false);
    }
  }
  async function markRepaired() {
    if (!(await confirm({
      title: 'Mark repaired?',
      body: `Set "${initial.name}" back to Good condition and back in service?`,
      confirmLabel: 'Mark repaired'
    }))) return;
    await setConditionAndLog('good', 'repaired', `Marked repaired (was ${CLABEL[initial.condition] || initial.condition})`);
  }
  async function retire() {
    if (!(await confirm({
      title: 'Retire this item?',
      body: `Retire "${initial.name}"? It will be hidden from new deployments. You can reactivate later if needed.`,
      danger: true,
      confirmLabel: 'Retire'
    }))) return;
    await setConditionAndLog('retired', 'retired', `Retired (was ${CLABEL[initial.condition] || initial.condition})`);
  }
  async function reactivate() {
    if (!(await confirm({
      title: 'Reactivate item?',
      body: `Bring "${initial.name}" back into service?`,
      confirmLabel: 'Reactivate'
    }))) return;
    await setConditionAndLog('good', 'repaired', 'Reactivated from retirement');
  }
  const isRetired = initial?.condition === 'retired';
  const needsAttention = ['needs_cleaning', 'needs_repair', 'damaged'].includes(initial?.condition);
  return /*#__PURE__*/React.createElement("div", {
    className: "backdrop",
    onClick: onClose
  }, /*#__PURE__*/React.createElement("form", {
    className: "modal",
    onClick: e => e.stopPropagation(),
    onSubmit: save
  }, /*#__PURE__*/React.createElement("h2", null, isEdit ? 'Edit item' : 'Add item to inventory'), isEdit && isRetired && /*#__PURE__*/React.createElement("div", {
    className: "status-banner retired-banner"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "status-banner-title"
  }, "Retired"), /*#__PURE__*/React.createElement("div", {
    className: "status-banner-sub"
  }, "Hidden from new deployments. Reactivate to use again.")), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn sm primary",
    onClick: reactivate,
    disabled: saving
  }, "Reactivate")), isEdit && needsAttention && /*#__PURE__*/React.createElement("div", {
    className: "status-banner attention-banner"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "status-banner-title"
  }, CLABEL[initial.condition]), /*#__PURE__*/React.createElement("div", {
    className: "status-banner-sub"
  }, "Mark repaired when fixed, or retire if it's beyond saving.")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn sm",
    onClick: markRepaired,
    disabled: saving
  }, "Mark repaired"))), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Name"), /*#__PURE__*/React.createElement("input", {
    value: name,
    onChange: e => setName(e.target.value),
    autoFocus: true
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Category"), /*#__PURE__*/React.createElement("select", {
    value: category,
    onChange: e => setCategory(e.target.value)
  }, CATEGORIES.map(c => /*#__PURE__*/React.createElement("option", {
    key: c
  }, c)))), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Storage location"), /*#__PURE__*/React.createElement("input", {
    value: storageLocation,
    onChange: e => setStorage(e.target.value),
    placeholder: "e.g. Warehouse \u2014 Shelf A1"
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Condition"), /*#__PURE__*/React.createElement("select", {
    value: condition,
    onChange: e => setCondition(e.target.value)
  }, CONDITIONS.map(c => /*#__PURE__*/React.createElement("option", {
    key: c.value,
    value: c.value
  }, c.label)))), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Notes"), /*#__PURE__*/React.createElement("textarea", {
    value: notes,
    onChange: e => setNotes(e.target.value),
    placeholder: "Anything worth noting"
  })), isEdit && /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Photos"), /*#__PURE__*/React.createElement(AttachmentStrip, {
    itemId: initial.id,
    adminName: admin.name,
    isAdmin: true
  })), /*#__PURE__*/React.createElement("div", {
    className: "err"
  }, err), /*#__PURE__*/React.createElement("div", {
    className: "actions"
  }, isEdit && /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn danger",
    onClick: del
  }, "Delete"), isEdit && !isRetired && /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn",
    onClick: retire,
    disabled: saving,
    title: "Take this item out of service"
  }, "Retire"), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn ghost",
    onClick: onClose
  }, "Cancel"), /*#__PURE__*/React.createElement("button", {
    type: "submit",
    className: "btn primary",
    disabled: saving
  }, saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add item'))));
}

// ---------- item detail modal (history across events) ----------
function ItemDetailModal({
  item,
  admin,
  onClose,
  onEdit
}) {
  const [history, setHistory] = useState(null);
  const [eventItems, setEventItems] = useState([]);
  const [showQr, setShowQr] = useState(false);
  useEffect(() => {
    sb.from('history').select('*').eq('item_id', item.id).order('changed_at', {
      ascending: false
    }).then(({
      data
    }) => setHistory(data || []));
    sb.from('event_items').select('*, events(name, event_date)').eq('item_id', item.id).order('assigned_at', {
      ascending: false
    }).then(({
      data
    }) => setEventItems(data || []));
  }, [item.id]);
  return /*#__PURE__*/React.createElement("div", {
    className: "backdrop",
    onClick: onClose
  }, /*#__PURE__*/React.createElement("div", {
    className: "modal",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0
    }
  }, item.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Azeret Mono',monospace",
      fontSize: 11,
      color: '#7A7A7A',
      marginTop: 2
    }
  }, item.category, " \xB7 ", item.storage_location || '—')), /*#__PURE__*/React.createElement("span", {
    className: `badge ${item.condition}`
  }, CLABEL[item.condition])), item.notes && /*#__PURE__*/React.createElement("div", {
    style: {
      background: '#1a1a1a',
      border: '1px solid #2a2a2a',
      padding: '8px 12px',
      fontSize: 13,
      marginBottom: 12,
      fontFamily: "'Manrope',sans-serif"
    }
  }, item.notes), /*#__PURE__*/React.createElement(AttachmentStrip, {
    itemId: item.id,
    adminName: admin?.name,
    isAdmin: !!admin
  }), eventItems.length > 0 && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "section-label"
  }, "Used in events"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6
    }
  }, eventItems.map(ei => /*#__PURE__*/React.createElement("div", {
    key: ei.id,
    style: {
      background: '#1a1a1a',
      border: '1px solid #2a2a2a',
      padding: '10px 12px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "'Barlow Condensed',sans-serif",
      fontSize: 16,
      letterSpacing: '0.04em',
      textTransform: 'uppercase'
    }
  }, ei.events?.name), /*#__PURE__*/React.createElement("span", {
    className: `badge ${ei.status === 'returned' ? 'status-returned' : 'status-out'}`
  }, ei.status === 'returned' ? 'Returned' : 'Out')), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Azeret Mono',monospace",
      fontSize: 11,
      color: '#7A7A7A',
      marginTop: 3
    }
  }, fmtDate(ei.events?.event_date)), ei.returned_at && /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Azeret Mono',monospace",
      fontSize: 11,
      color: '#7A7A7A'
    }
  }, "Returned ", fmtTime(ei.returned_at), " by ", ei.returned_by, " \xB7 ", CLABEL[ei.condition_on_return] || ei.condition_on_return))))), /*#__PURE__*/React.createElement("div", {
    className: "section-label"
  }, "Full history"), /*#__PURE__*/React.createElement(HistoryList, {
    itemId: item.id
  }), showQr && /*#__PURE__*/React.createElement("div", {
    style: {
      background: '#1a1a1a',
      border: '1px solid #2a2a2a',
      padding: 14,
      marginTop: 12,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "qr-block",
    style: {
      width: 200,
      height: 200,
      background: '#fff',
      padding: 8
    },
    dangerouslySetInnerHTML: {
      __html: qrSvgString(itemUrl(item.id))
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Azeret Mono',monospace",
      fontSize: 10,
      color: '#7A7A7A',
      letterSpacing: '0.06em',
      textTransform: 'uppercase'
    }
  }, String(item.id).slice(0, 8))), /*#__PURE__*/React.createElement("div", {
    className: "actions",
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn",
    onClick: () => setShowQr(s => !s)
  }, showQr ? 'Hide QR' : 'Show QR'), admin ? /*#__PURE__*/React.createElement("button", {
    className: "btn primary",
    onClick: onEdit
  }, "Edit item") : /*#__PURE__*/React.createElement(LoginPrompt, {
    verb: "edit"
  }), /*#__PURE__*/React.createElement("button", {
    className: "btn ghost",
    onClick: onClose
  }, "Close"))));
}

// ---------- event form ----------
function EventFormModal({
  admin,
  onClose,
  onSaved
}) {
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [location, setLoc] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  async function save(e) {
    e.preventDefault();
    if (!name.trim()) return setErr('Event name required');
    setSaving(true);
    const {
      data,
      error
    } = await sb.from('events').insert({
      name: name.trim(),
      event_date: date || null,
      location: location.trim()
    }).select().single();
    if (error) {
      setErr(friendlyError(error));
      setSaving(false);
      return;
    }
    onSaved(data);
    onClose();
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "backdrop",
    onClick: onClose
  }, /*#__PURE__*/React.createElement("form", {
    className: "modal",
    style: {
      maxWidth: 400
    },
    onClick: e => e.stopPropagation(),
    onSubmit: save
  }, /*#__PURE__*/React.createElement("h2", null, "New Deployment"), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Event name"), /*#__PURE__*/React.createElement("input", {
    value: name,
    onChange: e => setName(e.target.value),
    placeholder: "e.g. Al Wasl Volleyball Tournament",
    autoFocus: true
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Date"), /*#__PURE__*/React.createElement("input", {
    type: "date",
    value: date,
    onChange: e => setDate(e.target.value)
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Location / venue"), /*#__PURE__*/React.createElement("input", {
    value: location,
    onChange: e => setLoc(e.target.value),
    placeholder: "e.g. Al Wasl Sports Club"
  })), /*#__PURE__*/React.createElement("div", {
    className: "err"
  }, err), /*#__PURE__*/React.createElement("div", {
    className: "actions"
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn ghost",
    onClick: onClose
  }, "Cancel"), /*#__PURE__*/React.createElement("button", {
    type: "submit",
    className: "btn primary",
    disabled: saving
  }, saving ? 'Creating…' : 'Create event'))));
}

// ---------- assign items to event ----------
function AssignItemsModal({
  event,
  admin,
  existingItemIds,
  onClose,
  onAssigned
}) {
  const [items, setItems] = useState([]);
  const [activeOut, setActiveOut] = useState({}); // item_id → deployment name (checked out elsewhere)
  const [selected, setSelected] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const {
    safeClose
  } = useUnloadGuard(saving, onClose);
  useEffect(() => {
    sb.from('items').select('*').order('name').then(({
      data
    }) => setItems(data || []));
    // find items currently out at OTHER deployments
    sb.from('event_items').select('item_id, events(name)').eq('status', 'out').then(({
      data
    }) => {
      const m = {};
      (data || []).forEach(r => {
        // only block if it's a different deployment
        if (r.event_id !== event.id) m[r.item_id] = r.events?.name || 'another deployment';
      });
      setActiveOut(m);
    });
  }, []);

  // split items into available and unavailable for clear display
  // retired items are hidden from assignment entirely
  const matching = items.filter(it => !existingItemIds.has(it.id) && it.condition !== 'retired' && it.name.toLowerCase().includes(query.toLowerCase()));
  const available = matching.filter(it => !activeOut[it.id]);
  const unavailable = matching.filter(it => activeOut[it.id]);
  const NEEDS_FLAG = new Set(['needs_cleaning', 'needs_repair', 'damaged']);
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
      event_id: event.id,
      item_id,
      status: 'out',
      assigned_by: admin.name,
      assigned_at: now,
      updated_at: now,
      updated_by: admin.name
    }));
    const {
      data: eis,
      error: eiErr
    } = await sb.from('event_items').insert(eiPayload).select();
    if (eiErr) {
      toast(`Couldn't assign items: ${friendlyError(eiErr)}`, 'err');
      setSaving(false);
      return;
    }
    if (eis && eis.length) {
      const histPayload = eis.map(ei => ({
        item_id: ei.item_id,
        event_item_id: ei.id,
        event_id: event.id,
        action: 'assigned',
        changes: {
          note: `Assigned to deployment: ${event.name}`
        },
        changed_by: admin.name,
        changed_at: now
      }));
      const {
        error: histErr
      } = await sb.from('history').insert(histPayload);
      if (histErr) toast(`Items assigned, but history wasn't recorded: ${friendlyError(histErr)}`, 'err');
    }
    onAssigned();
    onClose();
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "backdrop",
    onClick: safeClose
  }, /*#__PURE__*/React.createElement("div", {
    className: "modal",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("h2", null, "Assign items"), /*#__PURE__*/React.createElement("input", {
    style: {
      marginBottom: 10,
      width: '100%',
      background: '#1a1a1a',
      border: '1px solid #2a2a2a',
      color: '#FAFAFA',
      padding: '10px 12px',
      outline: 'none',
      fontFamily: "'Azeret Mono',monospace",
      fontSize: 13
    },
    placeholder: "Search items\u2026",
    value: query,
    onChange: e => setQuery(e.target.value)
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      maxHeight: 340,
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
      gap: 6
    }
  }, available.length === 0 && unavailable.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      color: '#7A7A7A',
      fontFamily: "'Azeret Mono',monospace",
      fontSize: 12
    }
  }, "No items available."), available.map(it => {
    const flag = NEEDS_FLAG.has(it.condition);
    return /*#__PURE__*/React.createElement("label", {
      key: it.id,
      className: `check-row${selected.has(it.id) ? ' selected' : ''}${flag ? ' flagged' : ''}`
    }, /*#__PURE__*/React.createElement("input", {
      type: "checkbox",
      checked: selected.has(it.id),
      onChange: () => toggle(it.id),
      style: {
        accentColor: '#B93A32',
        width: 16,
        height: 16
      }
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontFamily: "'Barlow Condensed',sans-serif",
        fontSize: 17,
        letterSpacing: '0.04em',
        textTransform: 'uppercase'
      }
    }, it.name), /*#__PURE__*/React.createElement("div", {
      style: {
        fontFamily: "'Azeret Mono',monospace",
        fontSize: 11,
        color: '#7A7A7A'
      }
    }, it.category, " \xB7 ", it.storage_location || 'No storage set'), flag && /*#__PURE__*/React.createElement("div", {
      style: {
        fontFamily: "'Azeret Mono',monospace",
        fontSize: 10,
        color: '#d4a534',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        marginTop: 3
      }
    }, "\u26A0 Item needs attention before deployment")), /*#__PURE__*/React.createElement("span", {
      className: `badge ${it.condition}`
    }, CLABEL[it.condition]));
  }), unavailable.length > 0 && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Azeret Mono',monospace",
      fontSize: 10,
      color: '#7A7A7A',
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      marginTop: 6,
      marginBottom: 2
    }
  }, "Currently out \u2014 unavailable"), unavailable.map(it => /*#__PURE__*/React.createElement("div", {
    key: it.id,
    className: "check-row",
    style: {
      opacity: 0.45,
      cursor: 'not-allowed'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 16,
      height: 16,
      border: '1px solid #3a3a3a',
      flexShrink: 0
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Barlow Condensed',sans-serif",
      fontSize: 17,
      letterSpacing: '0.04em',
      textTransform: 'uppercase'
    }
  }, it.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Azeret Mono',monospace",
      fontSize: 11,
      color: '#d48a34'
    }
  }, "Out at: ", activeOut[it.id])), /*#__PURE__*/React.createElement("span", {
    className: "badge status-out"
  }, "Out"))))), selected.size > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Azeret Mono',monospace",
      fontSize: 12,
      color: '#B93A32',
      marginTop: 8
    }
  }, selected.size, " item", selected.size > 1 ? 's' : '', " selected"), /*#__PURE__*/React.createElement("div", {
    className: "actions",
    style: {
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn ghost",
    onClick: onClose
  }, "Cancel"), /*#__PURE__*/React.createElement("button", {
    className: "btn primary",
    disabled: !selected.size || saving,
    onClick: assign
  }, saving ? 'Assigning…' : `Assign ${selected.size || ''}`))));
}

// ---------- update event item modal ----------
function UpdateEventItemModal({
  eventItem,
  item,
  admin,
  onClose,
  onSaved
}) {
  const [location, setLocation] = useState(eventItem.current_location || '');
  const [condition, setCondition] = useState(eventItem.condition || item?.condition || 'good');
  const [notes, setNotes] = useState(eventItem.notes || '');
  const [returning, setReturning] = useState(false);
  const [retCondition, setRetCond] = useState(eventItem.condition || 'good');
  const [retLocation, setRetLoc] = useState(item?.storage_location || '');
  const [processedBy, setProcessed] = useState(admin.name);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setErr('');
    const now = new Date().toISOString();
    try {
      const payload = {
        current_location: location.trim(),
        condition,
        notes: notes.trim(),
        updated_at: now,
        updated_by: admin.name
      };
      if (returning) {
        payload.status = 'returned';
        payload.returned_by = processedBy.trim() || admin.name;
        payload.returned_at = now;
        payload.condition_on_return = retCondition;
        payload.current_location = retLocation.trim();
        // update master item condition on return
        await sb.from('items').update({
          condition: retCondition,
          updated_at: now,
          updated_by: admin.name
        }).eq('id', item.id);
      }
      const changes = diffObj(eventItem, payload, ['current_location', 'condition', 'notes']);
      const {
        data,
        error
      } = await sb.from('event_items').update(payload).eq('id', eventItem.id).select().single();
      if (error) throw error;
      const action = returning ? 'returned' : changes.current_location && Object.keys(changes).length === 1 ? 'location_updated' : changes.condition && Object.keys(changes).length === 1 ? 'condition_changed' : 'item_updated';
      if (returning || Object.keys(changes).length > 0) {
        await sb.from('history').insert({
          item_id: item.id,
          event_item_id: eventItem.id,
          event_id: eventItem.event_id,
          action,
          changes: returning ? {
            note: `Returned on ${new Date(now).toLocaleString()}. Sent to: ${retLocation.trim() || '—'}. Processed by: ${processedBy.trim() || admin.name}. Condition: ${CLABEL[retCondition] || retCondition}`
          } : changes,
          changed_by: admin.name,
          changed_at: now
        });
      }
      onSaved(data);
      onClose();
    } catch (e) {
      setErr(friendlyError(e));
      setSaving(false);
    }
  }
  async function removeFromEvent() {
    if (!(await confirm({
      title: 'Remove from event?',
      body: `Remove "${item?.name}" from this event? Its assignment record will be deleted.`,
      danger: true,
      confirmLabel: 'Remove'
    }))) return;
    await sb.from('event_items').delete().eq('id', eventItem.id);
    onSaved(null);
    onClose();
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "backdrop",
    onClick: onClose
  }, /*#__PURE__*/React.createElement("form", {
    className: "modal",
    onClick: e => e.stopPropagation(),
    onSubmit: save
  }, /*#__PURE__*/React.createElement("h2", null, item?.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Azeret Mono',monospace",
      fontSize: 11,
      color: '#7A7A7A',
      marginBottom: 14
    }
  }, item?.storage_location || '—', " \xB7 Assigned by ", eventItem.assigned_by), !returning && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Current location at event"), /*#__PURE__*/React.createElement("input", {
    value: location,
    onChange: e => setLocation(e.target.value),
    placeholder: "e.g. Main Stage",
    autoFocus: true
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Condition"), /*#__PURE__*/React.createElement("select", {
    value: condition,
    onChange: e => setCondition(e.target.value)
  }, CONDITIONS.map(c => /*#__PURE__*/React.createElement("option", {
    key: c.value,
    value: c.value
  }, c.label)))), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Notes"), /*#__PURE__*/React.createElement("textarea", {
    value: notes,
    onChange: e => setNotes(e.target.value),
    placeholder: "Anything relevant"
  }))), eventItem.status !== 'returned' && /*#__PURE__*/React.createElement("label", {
    className: "check-row",
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: returning,
    onChange: e => setReturning(e.target.checked),
    style: {
      accentColor: '#B93A32',
      width: 16,
      height: 16
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "'Azeret Mono',monospace",
      fontSize: 12,
      letterSpacing: '0.04em',
      textTransform: 'uppercase'
    }
  }, "Mark as returned")), returning && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Returned to (location sent)"), /*#__PURE__*/React.createElement("input", {
    value: retLocation,
    onChange: e => setRetLoc(e.target.value),
    placeholder: item?.storage_location || 'e.g. Warehouse — Shelf A1',
    autoFocus: true
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Processed by (who arranged transport)"), /*#__PURE__*/React.createElement("input", {
    value: processedBy,
    onChange: e => setProcessed(e.target.value),
    placeholder: "Name of person who called transport"
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Condition on return"), /*#__PURE__*/React.createElement("select", {
    value: retCondition,
    onChange: e => setRetCond(e.target.value)
  }, CONDITIONS.map(c => /*#__PURE__*/React.createElement("option", {
    key: c.value,
    value: c.value
  }, c.label)))), /*#__PURE__*/React.createElement("div", {
    style: {
      background: '#1a1a1a',
      border: '1px solid #2a2a2a',
      padding: '10px 12px',
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Azeret Mono',monospace",
      fontSize: 10,
      color: '#7A7A7A',
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      marginBottom: 6
    }
  }, "Return summary"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Azeret Mono',monospace",
      fontSize: 12,
      display: 'flex',
      flexDirection: 'column',
      gap: 4
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    style: {
      color: '#7A7A7A'
    }
  }, "Date: "), new Date().toLocaleString()), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    style: {
      color: '#7A7A7A'
    }
  }, "Returned to: "), retLocation || '—'), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    style: {
      color: '#7A7A7A'
    }
  }, "Processed by: "), processedBy || '—')))), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Photos"), /*#__PURE__*/React.createElement(AttachmentStrip, {
    itemId: item?.id,
    eventItemId: eventItem.id,
    adminName: admin.name,
    isAdmin: true
  })), /*#__PURE__*/React.createElement("div", {
    className: "err"
  }, err), /*#__PURE__*/React.createElement("div", {
    className: "actions"
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn danger",
    onClick: removeFromEvent
  }, "Remove"), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn ghost",
    onClick: onClose
  }, "Cancel"), /*#__PURE__*/React.createElement("button", {
    type: "submit",
    className: "btn primary",
    disabled: saving
  }, saving ? 'Saving…' : returning ? 'Mark returned' : 'Save'))));
}

// ---------- deployment manifest (printable) ----------
function ManifestView({
  event,
  eventItems,
  items,
  onClose
}) {
  function doPrint() {
    window.print();
  }
  const out = eventItems.filter(ei => ei.status === 'out');
  const returned = eventItems.filter(ei => ei.status === 'returned');
  const generatedAt = new Date();
  return /*#__PURE__*/React.createElement("div", {
    className: "backdrop label-backdrop",
    onClick: onClose
  }, /*#__PURE__*/React.createElement("div", {
    className: "modal manifest-modal",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    className: "actions no-print",
    style: {
      justifyContent: 'space-between',
      marginTop: 0,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0
    }
  }, "Deployment Manifest"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn ghost",
    onClick: onClose
  }, "Close"), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn primary",
    onClick: doPrint
  }, "Print / Save PDF"))), /*#__PURE__*/React.createElement("div", {
    className: "manifest-paper"
  }, /*#__PURE__*/React.createElement("div", {
    className: "manifest-head"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "manifest-brand"
  }, "SQUATWOLF"), /*#__PURE__*/React.createElement("div", {
    className: "manifest-title"
  }, event.name), /*#__PURE__*/React.createElement("div", {
    className: "manifest-sub"
  }, fmtDate(event.event_date), event.location ? ' · ' + event.location : ''), /*#__PURE__*/React.createElement("div", {
    className: "manifest-meta"
  }, "Generated ", generatedAt.toLocaleString())), /*#__PURE__*/React.createElement("div", {
    className: "manifest-qr",
    dangerouslySetInnerHTML: {
      __html: qrSvgString(eventUrl(event.id))
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: "manifest-stats"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    className: "manifest-stat-num"
  }, eventItems.length), " Total"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    className: "manifest-stat-num",
    style: {
      color: '#d48a34'
    }
  }, out.length), " Out"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    className: "manifest-stat-num",
    style: {
      color: '#5fcf7e'
    }
  }, returned.length), " Returned")), eventItems.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "empty",
    style: {
      marginTop: 14
    }
  }, "No items on this deployment.") : /*#__PURE__*/React.createElement("table", {
    className: "manifest-table"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", {
    style: {
      width: '4%'
    }
  }, "#"), /*#__PURE__*/React.createElement("th", null, "Item"), /*#__PURE__*/React.createElement("th", null, "Category"), /*#__PURE__*/React.createElement("th", null, "Condition"), /*#__PURE__*/React.createElement("th", null, "Status"), /*#__PURE__*/React.createElement("th", null, "Location"), /*#__PURE__*/React.createElement("th", null, "Notes"))), /*#__PURE__*/React.createElement("tbody", null, eventItems.map((ei, i) => {
    const it = items[ei.item_id];
    return /*#__PURE__*/React.createElement("tr", {
      key: ei.id
    }, /*#__PURE__*/React.createElement("td", null, i + 1), /*#__PURE__*/React.createElement("td", {
      className: "m-item-name"
    }, it?.name || '(missing)'), /*#__PURE__*/React.createElement("td", null, it?.category || '—'), /*#__PURE__*/React.createElement("td", null, CLABEL[ei.condition] || ei.condition || '—'), /*#__PURE__*/React.createElement("td", null, ei.status === 'returned' ? 'Returned' : 'Out'), /*#__PURE__*/React.createElement("td", null, ei.status === 'returned' ? `Sent to ${ei.current_location || '—'}` : ei.current_location || '—'), /*#__PURE__*/React.createElement("td", null, ei.status === 'returned' ? `By ${ei.returned_by || '—'} · ${fmtTime(ei.returned_at)}${ei.condition_on_return && ei.condition_on_return !== ei.condition ? ' · ' + (CLABEL[ei.condition_on_return] || ei.condition_on_return) : ''}` : ei.notes || ''));
  }))), /*#__PURE__*/React.createElement("div", {
    className: "manifest-foot"
  }, "Live link: ", eventUrl(event.id)))));
}

// ---------- bulk return modal ----------
function BulkReturnModal({
  event,
  eventItems,
  items,
  admin,
  onClose,
  onDone
}) {
  const outItems = useMemo(() => eventItems.filter(ei => ei.status === 'out'), [eventItems]);
  const [defaultLocation, setDefaultLocation] = useState('');
  const [defaultCondition, setDefaultCondition] = useState('good');
  const [processedBy, setProcessedBy] = useState(admin?.name || '');
  const [overrides, setOverrides] = useState({});
  const [selected, setSelected] = useState(() => new Set(outItems.map(ei => ei.id)));
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState({
    done: 0,
    total: 0
  });
  const [err, setErr] = useState('');
  const {
    safeClose
  } = useUnloadGuard(saving, onClose);
  function toggle(id) {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function setRowCondition(id, val) {
    setOverrides(prev => ({
      ...prev,
      [id]: val
    }));
  }
  async function performReturn() {
    setSaving(true);
    setErr('');
    const ids = Array.from(selected);
    setProgress({
      done: 0,
      total: ids.length
    });
    const now = new Date().toISOString();
    const procBy = (processedBy || admin?.name || '').trim();

    // Run all per-row updates in parallel (Promise.all) — typical 30-row return
    // drops from ~6s to <1s. Each row produces 3 writes (event_item, master item
    // mirror, history) as before, but they overlap network-wise instead of
    // queuing.
    try {
      const tasks = ids.map(async eiId => {
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
          updated_by: admin?.name || procBy
        };
        const {
          error: upErr
        } = await sb.from('event_items').update(payload).eq('id', eiId);
        if (upErr) throw upErr;

        // Fire master-item mirror + history insert in parallel
        await Promise.all([item ? sb.from('items').update({
          condition: cond,
          updated_at: now,
          updated_by: admin?.name || procBy
        }).eq('id', item.id) : Promise.resolve(), sb.from('history').insert({
          item_id: ei.item_id,
          event_item_id: eiId,
          event_id: event.id,
          action: 'returned',
          changes: {
            note: `Returned (bulk) on ${new Date(now).toLocaleString()}. Sent to: ${retLoc || '—'}. Processed by: ${procBy || '—'}. Condition: ${CLABEL[cond] || cond}`
          },
          changed_by: admin?.name || procBy,
          changed_at: now
        })]);
        setProgress(p => ({
          done: p.done + 1,
          total: p.total
        }));
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
    return /*#__PURE__*/React.createElement("div", {
      className: "backdrop",
      onClick: onClose
    }, /*#__PURE__*/React.createElement("div", {
      className: "modal",
      onClick: e => e.stopPropagation(),
      style: {
        maxWidth: 420
      }
    }, /*#__PURE__*/React.createElement("h2", null, "Return all"), /*#__PURE__*/React.createElement("div", {
      className: "empty",
      style: {
        padding: '24px 16px'
      }
    }, "No items currently out at this deployment."), /*#__PURE__*/React.createElement("div", {
      className: "actions"
    }, /*#__PURE__*/React.createElement("button", {
      className: "btn ghost",
      onClick: onClose
    }, "Close"))));
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "backdrop",
    onClick: safeClose
  }, /*#__PURE__*/React.createElement("div", {
    className: "modal",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("h2", null, "Return all from ", event.name), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 10,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "field",
    style: {
      margin: 0
    }
  }, /*#__PURE__*/React.createElement("label", null, "Return location (default)"), /*#__PURE__*/React.createElement("input", {
    value: defaultLocation,
    onChange: e => setDefaultLocation(e.target.value),
    placeholder: "e.g. Warehouse \u2014 Shelf A1"
  })), /*#__PURE__*/React.createElement("div", {
    className: "field",
    style: {
      margin: 0
    }
  }, /*#__PURE__*/React.createElement("label", null, "Default condition"), /*#__PURE__*/React.createElement("select", {
    value: defaultCondition,
    onChange: e => setDefaultCondition(e.target.value)
  }, CONDITIONS.map(c => /*#__PURE__*/React.createElement("option", {
    key: c.value,
    value: c.value
  }, c.label))))), /*#__PURE__*/React.createElement("div", {
    className: "field",
    style: {
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("label", null, "Processed by"), /*#__PURE__*/React.createElement("input", {
    value: processedBy,
    onChange: e => setProcessedBy(e.target.value),
    placeholder: "Who arranged transport"
  })), /*#__PURE__*/React.createElement("div", {
    className: "section-label",
    style: {
      marginTop: 0
    }
  }, selected.size, " of ", outItems.length, " selected", /*#__PURE__*/React.createElement("span", {
    style: {
      float: 'right'
    }
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "link-btn",
    onClick: () => setSelected(new Set(outItems.map(ei => ei.id)))
  }, "Select all"), ' · ', /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "link-btn",
    onClick: () => setSelected(new Set())
  }, "None"))), /*#__PURE__*/React.createElement("div", {
    style: {
      maxHeight: 340,
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
      gap: 6
    }
  }, outItems.map(ei => {
    const it = items[ei.item_id];
    const isSel = selected.has(ei.id);
    return /*#__PURE__*/React.createElement("label", {
      key: ei.id,
      className: `check-row${isSel ? ' selected' : ''}`
    }, /*#__PURE__*/React.createElement("input", {
      type: "checkbox",
      checked: isSel,
      onChange: () => toggle(ei.id),
      style: {
        accentColor: '#B93A32',
        width: 16,
        height: 16
      }
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontFamily: "'Barlow Condensed',sans-serif",
        fontSize: 16,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis'
      }
    }, it?.name || '—'), /*#__PURE__*/React.createElement("div", {
      style: {
        fontFamily: "'Azeret Mono',monospace",
        fontSize: 11,
        color: '#7A7A7A'
      }
    }, "At: ", ei.current_location || '—')), /*#__PURE__*/React.createElement("select", {
      value: overrides[ei.id] || defaultCondition,
      onChange: e => setRowCondition(ei.id, e.target.value),
      onClick: e => e.preventDefault(),
      style: {
        background: '#0e0e0e',
        border: '1px solid #2a2a2a',
        color: '#FAFAFA',
        padding: '4px 6px',
        fontSize: 11,
        fontFamily: "'Azeret Mono',monospace"
      }
    }, CONDITIONS.map(c => /*#__PURE__*/React.createElement("option", {
      key: c.value,
      value: c.value
    }, c.label))));
  })), err && /*#__PURE__*/React.createElement("div", {
    className: "err",
    style: {
      marginTop: 10
    }
  }, err), saving && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12,
      fontFamily: "'Azeret Mono',monospace",
      fontSize: 12,
      color: '#d48a34'
    }
  }, "Returning ", progress.done, "/", progress.total, "\u2026"), /*#__PURE__*/React.createElement("div", {
    className: "actions",
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn ghost",
    onClick: onClose,
    disabled: saving
  }, "Cancel"), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn primary",
    disabled: !selected.size || saving,
    onClick: () => setConfirming(true)
  }, saving ? 'Returning…' : `Return ${selected.size || ''}`)), confirming && /*#__PURE__*/React.createElement("div", {
    className: "backdrop",
    onClick: () => !saving && setConfirming(false),
    style: {
      zIndex: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "modal",
    onClick: e => e.stopPropagation(),
    style: {
      maxWidth: 380
    }
  }, /*#__PURE__*/React.createElement("h2", null, "Are you sure?"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Manrope',sans-serif",
      fontSize: 14,
      color: '#EFEFEF',
      marginBottom: 8
    }
  }, "Mark ", /*#__PURE__*/React.createElement("strong", null, selected.size), " item", selected.size === 1 ? '' : 's', " as returned from", ' ', /*#__PURE__*/React.createElement("strong", null, event.name), "?"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Azeret Mono',monospace",
      fontSize: 11,
      color: '#7A7A7A',
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
      marginBottom: 12
    }
  }, "Sent to: ", (defaultLocation || 'item storage location').trim() || '—', " \xB7 Processed by: ", processedBy || '—'), /*#__PURE__*/React.createElement("div", {
    className: "actions"
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn ghost",
    onClick: () => setConfirming(false),
    disabled: saving
  }, "Cancel"), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn primary",
    disabled: saving,
    onClick: () => {
      setConfirming(false);
      performReturn();
    }
  }, saving ? 'Returning…' : 'Yes, return all'))))));
}

// ---------- quick-condition row ----------
// One-tap mid-event condition change on a deployment item card. The 4 most
// common targets: Good · Cleaning · Repair · Damaged. Tap = write + history,
// no modal. Reserves the Update modal for everything else (notes, location, return).
function QuickConditionRow({
  ei,
  admin,
  onChanged
}) {
  const [busy, setBusy] = useState(false);
  const opts = [{
    v: 'good',
    short: 'Good',
    pill: 'good'
  }, {
    v: 'needs_cleaning',
    short: 'Clean',
    pill: 'needs_cleaning'
  }, {
    v: 'needs_repair',
    short: 'Repair',
    pill: 'needs_repair'
  }, {
    v: 'damaged',
    short: 'Damage',
    pill: 'damaged'
  }];
  async function set(newCond) {
    if (newCond === ei.condition || busy) return;
    setBusy(true);
    const now = new Date().toISOString();
    const {
      error
    } = await sb.from('event_items').update({
      condition: newCond,
      updated_at: now,
      updated_by: admin.name
    }).eq('id', ei.id);
    if (!error) {
      // Mirror onto master item too so dashboards reflect immediately.
      await sb.from('items').update({
        condition: newCond,
        updated_at: now,
        updated_by: admin.name
      }).eq('id', ei.item_id);
      await sb.from('history').insert({
        item_id: ei.item_id,
        event_item_id: ei.id,
        event_id: ei.event_id,
        action: 'condition_changed',
        changes: {
          condition: {
            from: ei.condition,
            to: newCond
          }
        },
        changed_by: admin.name,
        changed_at: now
      });
      onChanged?.();
    }
    setBusy(false);
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "quick-cond"
  }, /*#__PURE__*/React.createElement("span", {
    className: "quick-cond-label"
  }, "Quick set:"), opts.map(o => /*#__PURE__*/React.createElement("button", {
    key: o.v,
    type: "button",
    disabled: busy || o.v === ei.condition,
    className: `quick-cond-pill ${o.pill}${o.v === ei.condition ? ' selected' : ''}`,
    onClick: () => set(o.v)
  }, o.short)));
}

// ---------- event detail ----------
function EventDetail({
  event,
  admin,
  onBack
}) {
  const [eventItems, setEventItems] = useState([]);
  const [items, setItems] = useState({});
  const [assignOpen, setAssignOpen] = useState(false);
  const [updating, setUpdating] = useState(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [scanOpen, setScanOpen] = useState(false);
  const [scanMsg, setScanMsg] = useState('');
  const [scanLog, setScanLog] = useState([]); // continuous mode: [{ id, kind, label, canUndo }, ...]
  const [bulkOpen, setBulkOpen] = useState(false);
  const [manifestOpen, setManifest] = useState(false);
  async function load() {
    const {
      data: eis
    } = await sb.from('event_items').select('*').eq('event_id', event.id).order('assigned_at');
    if (!eis?.length) {
      setEventItems([]);
      return;
    }
    const itemIds = [...new Set(eis.map(e => e.item_id))];
    const {
      data: its
    } = await sb.from('items').select('*').in('id', itemIds);
    const map = {};
    (its || []).forEach(it => map[it.id] = it);
    setItems(map);
    setEventItems(eis);
  }
  useEffect(() => {
    load();
  }, [event.id]);
  const existingItemIds = new Set(eventItems.map(ei => ei.item_id));

  // Continuous-mode scan: stays open, accumulates a log, supports Undo of the
  // most recent successful assign. Returns silently — feedback flows via setScanLog.
  function pushScan(entry) {
    setScanLog(prev => [...prev, entry]);
  }
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
    const {
      data: master
    } = await sb.from('items').select('*').eq('id', itemId).maybeSingle();
    if (!master) {
      pushScan({
        id: itemId,
        kind: 'err',
        label: 'Unknown code — not in inventory',
        at: Date.now()
      });
      return;
    }
    if (master.condition === 'retired') {
      pushScan({
        id: itemId,
        kind: 'err',
        label: `"${master.name}" is retired`,
        at: Date.now()
      });
      return;
    }
    const {
      data: outAt
    } = await sb.from('event_items').select('event_id, events(name)').eq('item_id', itemId).eq('status', 'out').limit(1);
    const elsewhere = (outAt || []).find(r => r.event_id !== event.id);
    if (elsewhere) {
      pushScan({
        id: itemId,
        kind: 'err',
        label: `"${master.name}" is out at ${elsewhere.events?.name || 'another deployment'}`,
        at: Date.now()
      });
      return;
    }
    if (!admin) {
      pushScan({
        id: itemId,
        kind: 'err',
        label: 'Sign in as admin to assign',
        at: Date.now()
      });
      return;
    }
    const now = new Date().toISOString();
    const {
      data: ei,
      error
    } = await sb.from('event_items').insert({
      event_id: event.id,
      item_id: itemId,
      status: 'out',
      assigned_by: admin.name,
      assigned_at: now,
      updated_at: now,
      updated_by: admin.name
    }).select().single();
    if (error) {
      pushScan({
        id: itemId,
        kind: 'err',
        label: `Failed: ${error.message}`,
        at: Date.now()
      });
      return;
    }
    await sb.from('history').insert({
      item_id: itemId,
      event_item_id: ei.id,
      event_id: event.id,
      action: 'assigned',
      changes: {
        note: `Assigned to deployment via scan: ${event.name}`
      },
      changed_by: admin.name,
      changed_at: now
    });
    pushScan({
      id: itemId,
      kind: 'ok',
      label: `Added: ${master.name}`,
      eiId: ei.id,
      canUndo: true,
      at: Date.now()
    });
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
    setScanLog(prev => prev.map((s, i) => i === realIdx ? {
      ...s,
      canUndo: false,
      kind: 'undone',
      label: `Undone: ${s.label.replace(/^Added: /, '')}`
    } : s));
    load();
  }
  function closeScanner() {
    setScanOpen(false);
    setScanLog([]);
    if (scanLog.some(s => s.kind === 'ok')) setScanMsg(`Added ${scanLog.filter(s => s.kind === 'ok').length} item(s) via scan`);
  }
  const scanSuccessCount = scanLog.filter(s => s.kind === 'ok').length;
  const lastScanForToast = scanLog.length ? scanLog[scanLog.length - 1] : null;
  const filtered = eventItems.filter(ei => {
    const it = items[ei.item_id];
    if (!it) return false;
    if (filter === 'out' && ei.status !== 'out') return false;
    if (filter === 'returned' && ei.status !== 'returned') return false;
    if (query && !it.name.toLowerCase().includes(query.toLowerCase()) && !(ei.current_location || '').toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });
  const outCount = eventItems.filter(ei => ei.status === 'out').length;
  const returnedCount = eventItems.filter(ei => ei.status === 'returned').length;
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "back-bar"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn sm ghost",
    onClick: onBack
  }, "\u2190 Back"), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "ev-name"
  }, event.name), /*#__PURE__*/React.createElement("div", {
    className: "ev-sub"
  }, fmtDate(event.event_date), event.location ? ' · ' + event.location : '')), /*#__PURE__*/React.createElement("button", {
    className: "btn sm",
    onClick: () => setScanOpen(true)
  }, "\u229F Scan"), eventItems.length > 0 && /*#__PURE__*/React.createElement("button", {
    className: "btn sm",
    onClick: () => setManifest(true),
    title: "Printable manifest"
  }, "\u2399 Manifest"), admin && outCount > 0 && /*#__PURE__*/React.createElement("button", {
    className: "btn sm",
    onClick: () => setBulkOpen(true),
    title: "Return all out items"
  }, "\u21A9 Return all"), admin && /*#__PURE__*/React.createElement("button", {
    className: "btn sm primary",
    onClick: () => setAssignOpen(true)
  }, "+ Assign"), !admin && /*#__PURE__*/React.createElement(LoginPrompt, {
    verb: "manage"
  })), scanMsg && /*#__PURE__*/React.createElement("div", {
    style: {
      margin: '8px 14px 0',
      padding: '8px 12px',
      background: '#1a1a1a',
      border: '1px solid #2a2a2a',
      fontFamily: "'Azeret Mono',monospace",
      fontSize: 12,
      color: '#d48a34'
    }
  }, scanMsg), /*#__PURE__*/React.createElement("div", {
    className: "container"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10,
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "stat-box"
  }, /*#__PURE__*/React.createElement("div", {
    className: "stat-value"
  }, eventItems.length), /*#__PURE__*/React.createElement("div", {
    className: "stat-label"
  }, "Total")), /*#__PURE__*/React.createElement("div", {
    className: "stat-box"
  }, /*#__PURE__*/React.createElement("div", {
    className: "stat-value",
    style: {
      color: '#d4a534'
    }
  }, outCount), /*#__PURE__*/React.createElement("div", {
    className: "stat-label"
  }, "Out")), /*#__PURE__*/React.createElement("div", {
    className: "stat-box"
  }, /*#__PURE__*/React.createElement("div", {
    className: "stat-value",
    style: {
      color: '#5fcf7e'
    }
  }, returnedCount), /*#__PURE__*/React.createElement("div", {
    className: "stat-label"
  }, "Returned"))), /*#__PURE__*/React.createElement("div", {
    className: "controls"
  }, /*#__PURE__*/React.createElement("input", {
    className: "search",
    placeholder: "Search items\u2026",
    value: query,
    onChange: e => setQuery(e.target.value)
  }), /*#__PURE__*/React.createElement("select", {
    className: "filter",
    value: filter,
    onChange: e => setFilter(e.target.value)
  }, /*#__PURE__*/React.createElement("option", {
    value: "all"
  }, "All"), /*#__PURE__*/React.createElement("option", {
    value: "out"
  }, "Out"), /*#__PURE__*/React.createElement("option", {
    value: "returned"
  }, "Returned"))), filtered.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "empty"
  }, eventItems.length === 0 ? admin ? /*#__PURE__*/React.createElement(React.Fragment, null, "No items assigned yet. ", /*#__PURE__*/React.createElement("button", {
    className: "link-btn",
    onClick: () => setAssignOpen(true)
  }, "Assign items \u2192")) : 'No items assigned yet.' : 'No items match your filter.') : /*#__PURE__*/React.createElement("div", {
    className: "items"
  }, filtered.map(ei => {
    const it = items[ei.item_id];
    if (!it) return null;
    const cardClass = `item item-${ei.status === 'returned' ? 'returned' : 'out'}`;
    return /*#__PURE__*/React.createElement("div", {
      className: cardClass,
      key: ei.id
    }, /*#__PURE__*/React.createElement("div", {
      className: "row"
    }, /*#__PURE__*/React.createElement("div", {
      className: "name"
    }, it.name), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 6,
        alignItems: 'center'
      }
    }, /*#__PURE__*/React.createElement("span", {
      className: `badge ${ei.condition}`
    }, CLABEL[ei.condition]), /*#__PURE__*/React.createElement("span", {
      className: `badge ${ei.status === 'returned' ? 'status-returned' : 'status-out'}`
    }, ei.status === 'returned' ? 'Returned' : 'Out'))), /*#__PURE__*/React.createElement("div", {
      className: "fields"
    }, ei.status !== 'returned' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
      className: "k"
    }, "Location"), /*#__PURE__*/React.createElement("span", {
      className: "v"
    }, ei.current_location || '—')), /*#__PURE__*/React.createElement("span", {
      className: "k"
    }, "Storage"), /*#__PURE__*/React.createElement("span", {
      className: "v"
    }, it.storage_location || '—'), /*#__PURE__*/React.createElement("span", {
      className: "k"
    }, "Assigned by"), /*#__PURE__*/React.createElement("span", {
      className: "v"
    }, ei.assigned_by || '—'), ei.returned_at && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
      className: "k"
    }, "Return date"), /*#__PURE__*/React.createElement("span", {
      className: "v"
    }, fmtTime(ei.returned_at)), /*#__PURE__*/React.createElement("span", {
      className: "k"
    }, "Returned to"), /*#__PURE__*/React.createElement("span", {
      className: "v"
    }, ei.current_location || '—'), /*#__PURE__*/React.createElement("span", {
      className: "k"
    }, "Processed by"), /*#__PURE__*/React.createElement("span", {
      className: "v"
    }, ei.returned_by || '—'), /*#__PURE__*/React.createElement("span", {
      className: "k"
    }, "Return cond."), /*#__PURE__*/React.createElement("span", {
      className: "v"
    }, CLABEL[ei.condition_on_return] || ei.condition_on_return || '—')), !ei.returned_at && ei.current_location && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
      className: "k"
    }, "Location"), /*#__PURE__*/React.createElement("span", {
      className: "v"
    }, ei.current_location)), ei.notes && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
      className: "k"
    }, "Notes"), /*#__PURE__*/React.createElement("span", {
      className: "v"
    }, ei.notes))), /*#__PURE__*/React.createElement("div", {
      className: "meta"
    }, "Updated by ", ei.updated_by || '—', " \xB7 ", fmtTime(ei.updated_at)), admin && ei.status !== 'returned' && /*#__PURE__*/React.createElement(QuickConditionRow, {
      ei: ei,
      admin: admin,
      onChanged: load
    }), /*#__PURE__*/React.createElement("div", {
      className: "actions"
    }, admin && ei.status !== 'returned' && /*#__PURE__*/React.createElement("button", {
      className: "btn sm primary",
      onClick: () => setUpdating(ei)
    }, "Update"), admin && ei.status === 'returned' && /*#__PURE__*/React.createElement("button", {
      className: "btn sm",
      onClick: () => setUpdating(ei)
    }, "View")));
  }))), assignOpen && /*#__PURE__*/React.createElement(AssignItemsModal, {
    event: event,
    admin: admin,
    existingItemIds: existingItemIds,
    onClose: () => setAssignOpen(false),
    onAssigned: load
  }), updating && /*#__PURE__*/React.createElement(UpdateEventItemModal, {
    eventItem: updating,
    item: items[updating.item_id],
    admin: admin,
    onClose: () => setUpdating(null),
    onSaved: data => {
      load();
      setUpdating(null);
    }
  }), scanOpen && /*#__PURE__*/React.createElement(ScannerModal, {
    title: "Scan to assign / update",
    mode: "continuous",
    counter: scanSuccessCount,
    lastScan: lastScanForToast,
    onUndoLast: undoLastScan,
    onClose: closeScanner,
    onScan: handleScan
  }), bulkOpen && /*#__PURE__*/React.createElement(BulkReturnModal, {
    event: event,
    eventItems: eventItems,
    items: items,
    admin: admin,
    onClose: () => setBulkOpen(false),
    onDone: load
  }), manifestOpen && /*#__PURE__*/React.createElement(ManifestView, {
    event: event,
    eventItems: eventItems,
    items: items,
    onClose: () => setManifest(false)
  }));
}

// ---------- items tab (master list) ----------
function ItemsTab({
  admin,
  openItemId,
  onOpened
}) {
  const [items, setItems] = useState([]);
  const [outMap, setOutMap] = useState({}); // item_id → event name for checked-out items
  const [query, setQuery] = useState('');
  const [catFilter, setCat] = useState('all');
  const [condFilter, setCond] = useState('all');
  const [addOpen, setAddOpen] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [editing, setEditing] = useState(null);
  const [labelsOpen, setLabels] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanErr, setScanErr] = useState('');
  const [importOpen, setImport] = useState(false);
  function exportCsv() {
    const headers = ['name', 'category', 'storage_location', 'condition', 'notes', 'updated_at', 'updated_by'];
    const csv = toCsv(items, headers);
    const stamp = new Date().toISOString().slice(0, 10);
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
    sb.from('items').select('*').order('name').then(({
      data
    }) => setItems(data || []));
    // load which items are currently out and which deployment they're in
    sb.from('event_items').select('item_id, events(name)').eq('status', 'out').then(({
      data
    }) => {
      const m = {};
      (data || []).forEach(r => {
        m[r.item_id] = r.events?.name || 'Unknown';
      });
      setOutMap(m);
    });
  }, []);

  // realtime — items table
  useEffect(() => {
    const ch = sb.channel('items-master').on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'items'
    }, ({
      new: it
    }) => setItems(prev => [...prev, it].sort((a, b) => a.name.localeCompare(b.name)))).on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'items'
    }, ({
      new: it
    }) => setItems(prev => prev.map(p => p.id === it.id ? it : p))).on('postgres_changes', {
      event: 'DELETE',
      schema: 'public',
      table: 'items'
    }, ({
      old
    }) => setItems(prev => prev.filter(p => p.id !== old.id))).subscribe();
    return () => sb.removeChannel(ch);
  }, []);

  // realtime — keep out-status in sync when event_items change
  useEffect(() => {
    const ch = sb.channel('event-items-status').on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'event_items'
    }, () => {
      sb.from('event_items').select('item_id, events(name)').eq('status', 'out').then(({
        data
      }) => {
        const m = {};
        (data || []).forEach(r => {
          m[r.item_id] = r.events?.name || 'Unknown';
        });
        setOutMap(m);
      });
    }).subscribe();
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
    if (query && !it.name.toLowerCase().includes(query.toLowerCase()) && !(it.storage_location || '').toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });
  return /*#__PURE__*/React.createElement("div", {
    className: "container"
  }, /*#__PURE__*/React.createElement("div", {
    className: "controls"
  }, /*#__PURE__*/React.createElement("input", {
    className: "search",
    placeholder: "Search items\u2026",
    value: query,
    onChange: e => setQuery(e.target.value)
  }), /*#__PURE__*/React.createElement("select", {
    className: "filter",
    value: catFilter,
    onChange: e => setCat(e.target.value)
  }, /*#__PURE__*/React.createElement("option", {
    value: "all"
  }, "All categories"), CATEGORIES.map(c => /*#__PURE__*/React.createElement("option", {
    key: c,
    value: c
  }, c))), /*#__PURE__*/React.createElement("select", {
    className: "filter",
    value: condFilter,
    onChange: e => setCond(e.target.value)
  }, /*#__PURE__*/React.createElement("option", {
    value: "all"
  }, "All conditions"), CONDITIONS.map(c => /*#__PURE__*/React.createElement("option", {
    key: c.value,
    value: c.value
  }, c.label)), /*#__PURE__*/React.createElement("option", {
    value: "retired"
  }, "Retired (hidden)")), admin && /*#__PURE__*/React.createElement("button", {
    className: "btn primary",
    onClick: () => setAddOpen(true)
  }, "+ Add item"), /*#__PURE__*/React.createElement("button", {
    className: "btn",
    onClick: () => setScanOpen(true),
    title: "Scan QR"
  }, "\u229F Scan"), admin && items.length > 0 && /*#__PURE__*/React.createElement("button", {
    className: "btn",
    onClick: () => setLabels(true),
    title: "Print labels"
  }, "\u2399 Labels"), items.length > 0 && /*#__PURE__*/React.createElement("button", {
    className: "btn",
    onClick: exportCsv,
    title: "Download CSV"
  }, "\u2193 Export"), admin && /*#__PURE__*/React.createElement("button", {
    className: "btn",
    onClick: () => setImport(true),
    title: "Bulk add from CSV"
  }, "\u2191 Import"), !admin && /*#__PURE__*/React.createElement(LoginPrompt, {
    verb: "add or edit items"
  })), scanErr && /*#__PURE__*/React.createElement("div", {
    className: "err",
    style: {
      marginBottom: 8
    }
  }, scanErr), filtered.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "empty"
  }, items.length === 0 ? admin ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", null, "No items yet \u2014 let's get the inventory started."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      flexWrap: 'wrap',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn primary",
    onClick: () => setAddOpen(true)
  }, "+ Add your first item"), /*#__PURE__*/React.createElement("button", {
    className: "btn",
    onClick: () => setImport(true)
  }, "\u2191 Import from CSV"))) : 'No items in inventory yet.' : 'No items match your filters.') : /*#__PURE__*/React.createElement("div", {
    className: "items"
  }, filtered.map(it => /*#__PURE__*/React.createElement("div", {
    className: `item clickable${outMap[it.id] ? ' item-out' : ''}${it.condition === 'retired' ? ' item-retired' : ''}${['damaged', 'needs_repair', 'needs_cleaning'].includes(it.condition) ? ' item-attention' : ''}`,
    key: it.id,
    onClick: () => setViewing(it)
  }, /*#__PURE__*/React.createElement("div", {
    className: "row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "name"
  }, it.name), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 5,
      alignItems: 'center',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: `badge ${outMap[it.id] ? 'status-out' : 'status-stored'}`
  }, outMap[it.id] ? 'Out' : 'Stored'), /*#__PURE__*/React.createElement("span", {
    className: `badge ${it.condition}`
  }, CLABEL[it.condition]))), /*#__PURE__*/React.createElement("div", {
    className: "fields"
  }, /*#__PURE__*/React.createElement("span", {
    className: "k"
  }, "Category"), /*#__PURE__*/React.createElement("span", {
    className: "v"
  }, it.category || '—'), /*#__PURE__*/React.createElement("span", {
    className: "k"
  }, "Stored at"), /*#__PURE__*/React.createElement("span", {
    className: "v"
  }, it.storage_location || '—'), outMap[it.id] && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
    className: "k"
  }, "In use for"), /*#__PURE__*/React.createElement("span", {
    className: "v",
    style: {
      color: '#d48a34'
    }
  }, outMap[it.id])), it.notes && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
    className: "k"
  }, "Notes"), /*#__PURE__*/React.createElement("span", {
    className: "v"
  }, it.notes))), /*#__PURE__*/React.createElement("div", {
    className: "meta"
  }, "Updated by ", it.updated_by || '—', " \xB7 ", fmtTime(it.updated_at))))), addOpen && /*#__PURE__*/React.createElement(ItemFormModal, {
    admin: admin,
    onClose: () => setAddOpen(false),
    onSaved: it => {
      if (it) setItems(prev => [...prev, it].sort((a, b) => a.name.localeCompare(b.name)));
    }
  }), viewing && /*#__PURE__*/React.createElement(ItemDetailModal, {
    item: viewing,
    admin: admin,
    onClose: () => setViewing(null),
    onEdit: () => {
      setEditing(viewing);
      setViewing(null);
    }
  }), editing && /*#__PURE__*/React.createElement(ItemFormModal, {
    initial: editing,
    admin: admin,
    onClose: () => setEditing(null),
    onSaved: it => {
      if (it) setItems(prev => prev.map(p => p.id === it.id ? it : p));else setItems(prev => prev.filter(p => p.id !== editing.id));
      setEditing(null);
    }
  }), labelsOpen && /*#__PURE__*/React.createElement(LabelSheet, {
    items: items,
    onClose: () => setLabels(false)
  }), scanOpen && /*#__PURE__*/React.createElement(ScannerModal, {
    title: "Scan item QR",
    onClose: () => setScanOpen(false),
    onScan: id => {
      setScanOpen(false);
      setScanErr('');
      const it = items.find(x => x.id === id);
      if (it) setViewing(it);else setScanErr('Scanned QR doesn’t match any item in inventory.');
    }
  }), importOpen && /*#__PURE__*/React.createElement(CsvImportModal, {
    admin: admin,
    existingItems: items,
    onClose: () => setImport(false),
    onImported: () => {
      // realtime sub will refresh the list, but force a reload for snappy feedback
      sb.from('items').select('*').order('name').then(({
        data
      }) => setItems(data || []));
    }
  }));
}

// ---------- dashboard tab ----------
const OVERDUE_DAYS = 7;
function DashboardTab({
  admin,
  onGoTo
}) {
  const [items, setItems] = useState(null);
  const [outRows, setOut] = useState([]); // event_items rows with status='out' + joined event
  const [allEis, setAllEis] = useState([]); // every event_item (used for "never used" calc)
  const [recent, setRecent] = useState([]);
  const [viewing, setViewing] = useState(null);
  async function load() {
    try {
      const [itemsRes, outRes, allRes, hist] = await Promise.all([sb.from('items').select('*').order('name'), sb.from('event_items').select('*, events(id, name, event_date)').eq('status', 'out'), sb.from('event_items').select('item_id'), sb.from('history').select('*').order('changed_at', {
        ascending: false
      }).limit(8)]);
      // any individual sub-query error -> surface but keep what we got
      const errs = [itemsRes.error, outRes.error, allRes.error, hist.error].filter(Boolean);
      if (errs.length) toast(`Couldn't load all dashboard data: ${friendlyError(errs[0])}`, 'err');
      setItems(itemsRes.data || []);
      setOut(outRes.data || []);
      setAllEis(allRes.data || []);
      setRecent(hist.data || []);
    } catch (e) {
      toast(`Couldn't load dashboard: ${friendlyError(e)}`, 'err');
      setItems([]);
      setOut([]);
      setAllEis([]);
      setRecent([]); // unblock UI from "Loading…"
    }
  }
  useEffect(() => {
    load();
  }, []);

  // realtime — anything changes, reload
  useEffect(() => {
    const ch = sb.channel('dashboard').on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'items'
    }, load).on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'event_items'
    }, load).on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'history'
    }, load).subscribe();
    return () => sb.removeChannel(ch);
  }, []);
  if (items === null) return /*#__PURE__*/React.createElement("div", {
    className: "container"
  }, /*#__PURE__*/React.createElement("div", {
    className: "empty"
  }, "Loading\u2026"));
  const itemMap = {};
  items.forEach(it => itemMap[it.id] = it);

  // Currently out — group by deployment
  const outByEvent = {};
  outRows.forEach(r => {
    const eid = r.events?.id || r.event_id;
    if (!outByEvent[eid]) outByEvent[eid] = {
      event: r.events,
      rows: []
    };
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
  const needsAttention = items.filter(it => it.condition === 'damaged' || it.condition === 'needs_repair' || it.condition === 'needs_cleaning');

  // Items never assigned — id not in any event_item row
  const everUsed = new Set(allEis.map(e => e.item_id));
  const neverUsed = items.filter(it => !everUsed.has(it.id));
  const totalItems = items.length;
  const totalOut = outRows.length;
  const totalDeploys = new Set(allEis.map(e => e.event_id)).size; // distinct deployments that ever had items

  return /*#__PURE__*/React.createElement("div", {
    className: "container"
  }, /*#__PURE__*/React.createElement("div", {
    className: "kpi-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "stat-box"
  }, /*#__PURE__*/React.createElement("div", {
    className: "stat-value"
  }, totalItems), /*#__PURE__*/React.createElement("div", {
    className: "stat-label"
  }, "Total items")), /*#__PURE__*/React.createElement("div", {
    className: `stat-box${totalOut > 0 ? ' alert' : ''}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "stat-value"
  }, totalOut), /*#__PURE__*/React.createElement("div", {
    className: "stat-label"
  }, "Currently out")), /*#__PURE__*/React.createElement("div", {
    className: `stat-box${overdue.length > 0 ? ' alert danger' : ''}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "stat-value"
  }, overdue.length), /*#__PURE__*/React.createElement("div", {
    className: "stat-label"
  }, "Overdue")), /*#__PURE__*/React.createElement("div", {
    className: `stat-box${needsAttention.length > 0 ? ' alert' : ''}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "stat-value"
  }, needsAttention.length), /*#__PURE__*/React.createElement("div", {
    className: "stat-label"
  }, "Needs attention"))), /*#__PURE__*/React.createElement(DashSection, {
    title: `Overdue (> ${OVERDUE_DAYS} days)`,
    emptyText: "ALL CLEAR \u2014 NOTHING OVERDUE",
    allClear: true
  }, overdue.length > 0 && overdue.map(r => {
    const it = itemMap[r.item_id];
    const days = r.events?.event_date ? Math.floor((Date.now() - new Date(r.events.event_date).getTime()) / (24 * 3600 * 1000)) : null;
    return /*#__PURE__*/React.createElement("div", {
      className: "dash-row",
      key: r.id,
      onClick: () => it && setViewing(it)
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "dash-row-name"
    }, it?.name || '(missing item)'), /*#__PURE__*/React.createElement("div", {
      className: "dash-row-sub"
    }, "Out at ", r.events?.name || '—', " \xB7 ", days != null ? `${days}d past event` : '—')), /*#__PURE__*/React.createElement("span", {
      className: "badge status-out"
    }, "Out"));
  })), /*#__PURE__*/React.createElement(DashSection, {
    title: "Needs attention",
    emptyText: "ALL CLEAR \u2014 EVERYTHING IN GOOD CONDITION",
    allClear: true
  }, needsAttention.map(it => /*#__PURE__*/React.createElement("div", {
    className: "dash-row",
    key: it.id,
    onClick: () => setViewing(it)
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "dash-row-name"
  }, it.name), /*#__PURE__*/React.createElement("div", {
    className: "dash-row-sub"
  }, it.category || '—', " \xB7 ", it.storage_location || 'No storage set')), /*#__PURE__*/React.createElement("span", {
    className: `badge ${it.condition}`
  }, CLABEL[it.condition])))), /*#__PURE__*/React.createElement(DashSection, {
    title: "Currently out",
    emptyText: "ALL CLEAR \u2014 NOTHING CHECKED OUT",
    allClear: true
  }, outDeployments.map(({
    event,
    rows
  }) => /*#__PURE__*/React.createElement("div", {
    className: "dash-group",
    key: event?.id || Math.random()
  }, /*#__PURE__*/React.createElement("div", {
    className: "dash-group-head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "dash-group-name"
  }, event?.name || '(unknown deployment)'), /*#__PURE__*/React.createElement("span", {
    className: "dash-group-count"
  }, rows.length)), rows.map(r => {
    const it = itemMap[r.item_id];
    return /*#__PURE__*/React.createElement("div", {
      className: "dash-row",
      key: r.id,
      onClick: () => it && setViewing(it)
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "dash-row-name"
    }, it?.name || '(missing item)'), /*#__PURE__*/React.createElement("div", {
      className: "dash-row-sub"
    }, "At: ", r.current_location || '—')), /*#__PURE__*/React.createElement("span", {
      className: `badge ${r.condition || 'good'}`
    }, CLABEL[r.condition] || r.condition || '—'));
  })))), neverUsed.length > 0 && /*#__PURE__*/React.createElement(DashSection, {
    title: "Never assigned",
    emptyText: ""
  }, neverUsed.slice(0, 12).map(it => /*#__PURE__*/React.createElement("div", {
    className: "dash-row",
    key: it.id,
    onClick: () => setViewing(it)
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "dash-row-name"
  }, it.name), /*#__PURE__*/React.createElement("div", {
    className: "dash-row-sub"
  }, it.category || '—', " \xB7 ", it.storage_location || 'No storage set')), /*#__PURE__*/React.createElement("span", {
    className: `badge ${it.condition}`
  }, CLABEL[it.condition]))), neverUsed.length > 12 && /*#__PURE__*/React.createElement("div", {
    className: "dash-row-sub",
    style: {
      padding: '4px 12px'
    }
  }, "+ ", neverUsed.length - 12, " more")), /*#__PURE__*/React.createElement(DashSection, {
    title: "Recent activity",
    emptyText: "No activity yet."
  }, recent.map(ev => /*#__PURE__*/React.createElement("div", {
    className: "dash-row",
    key: ev.id,
    onClick: () => {
      const it = itemMap[ev.item_id];
      if (it) setViewing(it);
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "dash-row-name",
    style: {
      fontSize: 14
    }
  }, actionLabel(ev.action), itemMap[ev.item_id] ? ` · ${itemMap[ev.item_id].name}` : ''), /*#__PURE__*/React.createElement("div", {
    className: "dash-row-sub"
  }, ev.changed_by, " \xB7 ", fmtTime(ev.changed_at)))))), viewing && /*#__PURE__*/React.createElement(ItemDetailModal, {
    item: viewing,
    admin: admin,
    onClose: () => setViewing(null),
    onEdit: () => setViewing(null)
  }));
}
function DashSection({
  title,
  emptyText,
  allClear,
  children
}) {
  const arr = React.Children.toArray(children).filter(Boolean);
  return /*#__PURE__*/React.createElement("div", {
    className: "dash-section"
  }, /*#__PURE__*/React.createElement("div", {
    className: "dash-section-head"
  }, title), arr.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: `dash-empty${allClear ? ' allclear' : ''}`
  }, emptyText) : /*#__PURE__*/React.createElement("div", {
    className: "dash-list"
  }, arr));
}

// ---------- events tab ----------
function EventsTab({
  admin,
  openEventId,
  onOpened
}) {
  const [events, setEvents] = useState([]);
  const [selected, setSelected] = useState(null);
  const [newOpen, setNewOpen] = useState(false);
  useEffect(() => {
    sb.from('events').select('*').order('event_date', {
      ascending: false,
      nullsFirst: true
    }).then(({
      data
    }) => setEvents(data || []));
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
    return /*#__PURE__*/React.createElement(EventDetail, {
      event: selected,
      admin: admin,
      onBack: () => setSelected(null)
    });
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "container"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 12,
      display: 'flex',
      gap: 8,
      alignItems: 'center'
    }
  }, admin ? /*#__PURE__*/React.createElement("button", {
    className: "btn primary",
    onClick: () => setNewOpen(true)
  }, "+ New deployment") : /*#__PURE__*/React.createElement(LoginPrompt, {
    verb: "create deployments"
  })), events.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "empty"
  }, admin ? /*#__PURE__*/React.createElement(React.Fragment, null, "No deployments yet. ", /*#__PURE__*/React.createElement("button", {
    className: "link-btn",
    onClick: () => setNewOpen(true)
  }, "Create one \u2192")) : 'No deployments yet.') : /*#__PURE__*/React.createElement("div", {
    className: "items"
  }, events.map(ev => /*#__PURE__*/React.createElement("div", {
    className: "item clickable",
    key: ev.id,
    onClick: () => setSelected(ev)
  }, /*#__PURE__*/React.createElement("div", {
    className: "row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "name"
  }, ev.name), /*#__PURE__*/React.createElement("span", {
    className: "meta"
  }, fmtDate(ev.event_date))), ev.location && /*#__PURE__*/React.createElement("div", {
    className: "meta"
  }, ev.location), /*#__PURE__*/React.createElement("div", {
    className: "meta"
  }, "Tap to view \u2192")))), newOpen && /*#__PURE__*/React.createElement(EventFormModal, {
    admin: admin,
    onClose: () => setNewOpen(false),
    onSaved: ev => {
      setEvents(prev => [ev, ...prev]);
      setSelected(ev);
    }
  }));
}

// ---------- manage team (masters only) ----------
function ManageTeamModal({
  me,
  onClose
}) {
  const [admins, setAdmins] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(null); // { kind, id }

  async function load() {
    setLoading(true);
    setErr('');
    const [a, r] = await Promise.all([sb.from('admin_users').select('*').order('added_at'), sb.from('admin_requests').select('*').eq('status', 'pending').order('requested_at')]);
    if (a.error) setErr(friendlyError(a.error));
    setAdmins(a.data || []);
    setRequests(r.data || []);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  // Realtime — keep the team list fresh while open
  useEffect(() => {
    const ch = sb.channel('team-mgmt').on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'admin_users'
    }, load).on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'admin_requests'
    }, load).subscribe();
    return () => sb.removeChannel(ch);
  }, []);
  const masterCount = admins.filter(a => a.role === 'master').length;
  async function approve(req, asRole) {
    setBusy({
      kind: 'approve',
      id: req.id
    });
    setErr('');
    const now = new Date().toISOString();
    try {
      const {
        error: insErr
      } = await sb.from('admin_users').insert({
        user_id: req.user_id,
        email: req.email,
        name: req.name || req.email,
        role: asRole,
        added_by: me.id
      });
      if (insErr) throw insErr;
      const {
        error: upErr
      } = await sb.from('admin_requests').update({
        status: 'approved',
        reviewed_by: me.id,
        reviewed_at: now
      }).eq('id', req.id);
      if (upErr) throw upErr;
      load();
    } catch (e) {
      setErr(friendlyError(e));
    }
    setBusy(null);
  }
  async function deny(req) {
    if (!(await confirm({
      title: 'Deny request?',
      body: `Deny access for ${req.email}? They can request again later.`,
      danger: true,
      confirmLabel: 'Deny'
    }))) return;
    setBusy({
      kind: 'deny',
      id: req.id
    });
    setErr('');
    const now = new Date().toISOString();
    const {
      error
    } = await sb.from('admin_requests').update({
      status: 'denied',
      reviewed_by: me.id,
      reviewed_at: now
    }).eq('id', req.id);
    if (error) setErr(friendlyError(error));
    load();
    setBusy(null);
  }
  async function changeRole(user, newRole) {
    // Self-demote out of master is only allowed if another master exists
    if (user.user_id === me.id && user.role === 'master' && newRole !== 'master') {
      if (masterCount <= 1) {
        setErr("You're the only master — promote someone else first.");
        return;
      }
      if (!(await confirm({
        title: 'Demote yourself?',
        body: `Set your own role to ${newRole}? You'll lose team management. Make sure another Master is in place first.`,
        danger: true,
        confirmLabel: 'Demote me'
      }))) return;
    } else if (newRole === 'master') {
      if (!(await confirm({
        title: 'Promote to Master?',
        body: `${user.email} will be able to add, remove and change other admins.`,
        confirmLabel: 'Promote'
      }))) return;
    } else if (newRole === 'admin') {
      if (!(await confirm({
        title: 'Set role to Admin?',
        body: `${user.email} will get full edit access on inventory and deployments.`,
        confirmLabel: 'Set Admin'
      }))) return;
    } else if (newRole === 'viewer') {
      if (!(await confirm({
        title: 'Set role to Viewer?',
        body: `${user.email} will lose edit access. They'll keep read access.`,
        confirmLabel: 'Set Viewer'
      }))) return;
    }
    setBusy({
      kind: 'role',
      id: user.user_id
    });
    setErr('');
    const {
      error
    } = await sb.from('admin_users').update({
      role: newRole
    }).eq('user_id', user.user_id);
    if (error) setErr(friendlyError(error));
    load();
    setBusy(null);
  }
  async function remove(user) {
    if (user.role === 'master' && masterCount <= 1) {
      setErr("Can't remove the last master.");
      return;
    }
    if (!(await confirm({
      title: 'Remove from team?',
      body: `${user.email} will lose all access. They'll need to be re-approved if they want back in.`,
      danger: true,
      confirmLabel: 'Remove'
    }))) return;
    setBusy({
      kind: 'remove',
      id: user.user_id
    });
    setErr('');
    const {
      error
    } = await sb.from('admin_users').delete().eq('user_id', user.user_id);
    if (error) setErr(friendlyError(error));
    load();
    setBusy(null);
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "backdrop",
    onClick: onClose
  }, /*#__PURE__*/React.createElement("div", {
    className: "modal",
    onClick: e => e.stopPropagation(),
    style: {
      maxWidth: 640
    }
  }, /*#__PURE__*/React.createElement("h2", null, "Manage team"), /*#__PURE__*/React.createElement("div", {
    className: "role-legend"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    className: "role-pill viewer"
  }, "Viewer"), /*#__PURE__*/React.createElement("span", null, "Read-only \u2014 can browse, scan, export")), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    className: "role-pill admin"
  }, "Admin"), /*#__PURE__*/React.createElement("span", null, "Full edit on inventory and deployments")), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    className: "role-pill master"
  }, "Master"), /*#__PURE__*/React.createElement("span", null, "Everything an Admin does, plus team management"))), err && /*#__PURE__*/React.createElement("div", {
    className: "err",
    style: {
      marginBottom: 10
    }
  }, err), /*#__PURE__*/React.createElement("div", {
    className: "section-label",
    style: {
      marginTop: 0
    }
  }, "Pending requests ", requests.length > 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      color: '#d48a34'
    }
  }, "\xB7 ", requests.length)), loading ? /*#__PURE__*/React.createElement("div", {
    className: "empty",
    style: {
      padding: 18
    }
  }, "Loading\u2026") : requests.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "empty",
    style: {
      padding: 18
    }
  }, "No pending requests.") : /*#__PURE__*/React.createElement("div", {
    className: "team-list"
  }, requests.map(req => /*#__PURE__*/React.createElement("div", {
    className: "team-row",
    key: req.id
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "team-name"
  }, req.name || req.email), /*#__PURE__*/React.createElement("div", {
    className: "team-sub"
  }, req.email, " \xB7 requested ", fmtTime(req.requested_at))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn sm danger",
    disabled: busy,
    onClick: () => deny(req)
  }, "Deny"), /*#__PURE__*/React.createElement("button", {
    className: "btn sm",
    disabled: busy,
    onClick: () => approve(req, 'viewer')
  }, "Approve \xB7 Viewer"), /*#__PURE__*/React.createElement("button", {
    className: "btn sm",
    disabled: busy,
    onClick: () => approve(req, 'admin')
  }, "Approve \xB7 Admin"), /*#__PURE__*/React.createElement("button", {
    className: "btn sm primary",
    disabled: busy,
    onClick: () => approve(req, 'master')
  }, "Approve \xB7 Master"))))), /*#__PURE__*/React.createElement("div", {
    className: "section-label"
  }, "Team members (", admins.length, ")", /*#__PURE__*/React.createElement("span", {
    style: {
      color: '#7A7A7A',
      fontFamily: "'Azeret Mono',monospace",
      fontSize: 10,
      letterSpacing: '0.06em',
      float: 'right'
    }
  }, admins.filter(a => a.role === 'master').length, "M \xB7 ", admins.filter(a => a.role === 'admin').length, "A \xB7 ", admins.filter(a => a.role === 'viewer').length, "V")), admins.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "empty",
    style: {
      padding: 18
    }
  }, "No team members yet.") : /*#__PURE__*/React.createElement("div", {
    className: "team-list"
  }, admins.map(u => {
    const isMe = u.user_id === me.id;
    return /*#__PURE__*/React.createElement("div", {
      className: "team-row",
      key: u.user_id
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "team-name"
    }, u.name || u.email, isMe && /*#__PURE__*/React.createElement("span", {
      className: "team-self"
    }, " (you)")), /*#__PURE__*/React.createElement("div", {
      className: "team-sub"
    }, u.email, " \xB7 added ", fmtTime(u.added_at))), /*#__PURE__*/React.createElement("span", {
      className: `role-pill ${u.role}`,
      style: {
        marginRight: 6
      }
    }, u.role), /*#__PURE__*/React.createElement("select", {
      className: "role-select",
      value: u.role,
      disabled: busy || isMe && u.role === 'master' && masterCount <= 1,
      onChange: e => e.target.value !== u.role && changeRole(u, e.target.value)
    }, /*#__PURE__*/React.createElement("option", {
      value: "viewer"
    }, "Viewer"), /*#__PURE__*/React.createElement("option", {
      value: "admin"
    }, "Admin"), /*#__PURE__*/React.createElement("option", {
      value: "master"
    }, "Master")), /*#__PURE__*/React.createElement("button", {
      className: "btn sm danger",
      disabled: busy || u.role === 'master' && masterCount <= 1,
      onClick: () => remove(u)
    }, "Remove"));
  })), /*#__PURE__*/React.createElement("div", {
    className: "actions"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn ghost",
    onClick: onClose
  }, "Close"))));
}

// ---------- sign-in gate (shown when no session) ----------
// With reads now locked behind RLS, an unauth visitor would see an empty
// "Loading…" forever. Replace it with a focused sign-in card.
function SignInGate({
  onLoginRequest,
  deepLinkLabel
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "signin-gate"
  }, /*#__PURE__*/React.createElement("div", {
    className: "signin-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "signin-brand"
  }, "SQUATWOLF"), /*#__PURE__*/React.createElement("div", {
    className: "signin-title"
  }, "Event Inventory"), /*#__PURE__*/React.createElement("div", {
    className: "signin-sub"
  }, deepLinkLabel ? deepLinkLabel : 'Internal tool — sign in to continue.'), /*#__PURE__*/React.createElement("button", {
    className: "btn primary signin-cta",
    onClick: onLoginRequest
  }, "Sign in"), /*#__PURE__*/React.createElement("div", {
    className: "signin-foot"
  }, "Access is approved by a master admin. If you don't have an account, contact your team lead.")));
}

// ---------- viewer welcome banner ----------
// One-time, per-user, dismissible explainer for new Viewers so they know
// they're allowed to browse and what to ask for if they need to edit.
function ViewerWelcomeBanner({
  userId
}) {
  const key = `eit:viewer-welcome:${userId}`;
  const [show, setShow] = useState(() => !localStorage.getItem(key));
  if (!show) return null;
  function dismiss() {
    localStorage.setItem(key, '1');
    setShow(false);
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "viewer-welcome"
  }, /*#__PURE__*/React.createElement("div", {
    className: "viewer-welcome-body"
  }, /*#__PURE__*/React.createElement("strong", null, "Welcome to the inventory."), ' ', "You can browse all items, deployments, and history, scan QR codes, and export the manifest. Editing (adding, returning, marking damaged) is reserved for Admins \u2014 ask a master to bump your role if you need it."), /*#__PURE__*/React.createElement("button", {
    className: "viewer-welcome-x",
    onClick: dismiss,
    "aria-label": "Dismiss"
  }, "\u2715"));
}

// ---------- main app ----------
function App() {
  // session: any signed-in user (admin OR pending). admin: only approved roles.
  // The rest of the app gates on `admin` so writes are blocked when pending.
  const [session, setSession] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('eit:session')) || null;
    } catch {
      return null;
    }
  });
  const admin = session && (session.role === 'admin' || session.role === 'master') ? session : null;
  const isMaster = session?.role === 'master';
  const isViewer = session?.role === 'viewer';
  const isPending = session && !session.role;
  const [tab, setTab] = useState('dashboard'); // 'dashboard' | 'items' | 'events'
  const [loginOpen, setLoginOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [openItemId, setOpenItemId] = useState(null);
  const [openEventId, setOpenEventId] = useState(null);
  const [landing, setLanding] = useState(null); // { kind: 'item'|'event', id } | null
  const [online, setOnline] = useState(() => typeof navigator !== 'undefined' ? navigator.onLine : true);
  useEffect(() => {
    const on = () => {
      setOnline(true);
      toast('Back online', 'ok');
    };
    const off = () => {
      setOnline(false);
      toast('You’re offline — changes won’t save until you reconnect', 'err');
    };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // deep-links: ?item=<uuid> or ?event=<uuid>
  // Show a focused ScanLanding card first; only enter the full app when dismissed.
  // We strip the param immediately so a refresh doesn't keep the landing pinned;
  // the `landing` state survives the sign-in gate if needed.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const itemId = params.get('item');
    const eventId = params.get('event');
    if (itemId && parseScanned(itemId)) setLanding({
      kind: 'item',
      id: parseScanned(itemId)
    });
    if (eventId && parseScanned(eventId)) setLanding({
      kind: 'event',
      id: parseScanned(eventId)
    });
    if (itemId || eventId) {
      const url = new URL(location.href);
      url.searchParams.delete('item');
      url.searchParams.delete('event');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);
  function dismissLanding() {
    if (!landing) return;
    if (landing.kind === 'item') {
      setTab('items');
      setOpenItemId(landing.id);
    }
    if (landing.kind === 'event') {
      setTab('events');
      setOpenEventId(landing.id);
    }
    setLanding(null);
  }

  // Resolve role from admin_users for any active session — handles refresh,
  // master approving us in another tab, etc.
  async function resolveSession(authUser) {
    if (!authUser) return null;
    const {
      data: row
    } = await sb.from('admin_users').select('*').eq('user_id', authUser.id).maybeSingle();
    return {
      id: authUser.id,
      email: authUser.email,
      name: row?.name || authUser.user_metadata?.name || authUser.email,
      role: row?.role || null // null = signed in but not approved yet
    };
  }
  function persistSession(s) {
    if (s) localStorage.setItem('eit:session', JSON.stringify(s));else localStorage.removeItem('eit:session');
    // legacy key cleanup
    localStorage.removeItem('eit:admin');
  }
  useEffect(() => {
    sb.auth.getSession().then(async ({
      data: {
        session: s
      }
    }) => {
      const next = await resolveSession(s?.user);
      setSession(next);
      persistSession(next);
    });
    const {
      data: sub
    } = sb.auth.onAuthStateChange(async (_, s) => {
      const next = await resolveSession(s?.user);
      setSession(next);
      persistSession(next);
    });
    return () => sub?.subscription?.unsubscribe?.();
  }, []);

  // Realtime: react when our admin_users row changes (master approves us, etc.)
  useEffect(() => {
    if (!session?.id) return;
    const ch = sb.channel('admin_users_self').on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'admin_users',
      filter: `user_id=eq.${session.id}`
    }, async () => {
      const {
        data: {
          user
        }
      } = await sb.auth.getUser();
      const next = await resolveSession(user);
      setSession(next);
      persistSession(next);
    }).subscribe();
    return () => sb.removeChannel(ch);
  }, [session?.id]);

  // global "log in" request from inline prompts
  useEffect(() => {
    const fn = () => setLoginOpen(true);
    window.addEventListener('eit:request-login', fn);
    return () => window.removeEventListener('eit:request-login', fn);
  }, []);
  function handleLogin(data) {
    setSession(data);
    persistSession(data);
    setLoginOpen(false);
  }
  function logout() {
    sb.auth.signOut();
    setSession(null);
    persistSession(null);
  }

  // No session — show the sign-in gate. If they hit a QR deep-link, mention it.
  if (!session) {
    return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(SignInGate, {
      onLoginRequest: () => setLoginOpen(true),
      deepLinkLabel: landing ? `You scanned a ${landing.kind === 'item' ? 'product' : 'deployment'} QR — sign in to view it.` : null
    }), loginOpen && /*#__PURE__*/React.createElement(AdminLoginModal, {
      onLogin: handleLogin,
      onClose: () => setLoginOpen(false)
    }), /*#__PURE__*/React.createElement(ToastHost, null), /*#__PURE__*/React.createElement(ConfirmHost, null));
  }

  // While the scan landing is up, render only that — no tabs, no chrome.
  if (landing) {
    return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(ScanLanding, {
      kind: landing.kind,
      id: landing.id,
      onDismiss: dismissLanding
    }), loginOpen && /*#__PURE__*/React.createElement(AdminLoginModal, {
      onLogin: handleLogin,
      onClose: () => setLoginOpen(false)
    }), /*#__PURE__*/React.createElement(ToastHost, null), /*#__PURE__*/React.createElement(ConfirmHost, null));
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "app"
  }, /*#__PURE__*/React.createElement("div", {
    className: "topbar"
  }, /*#__PURE__*/React.createElement("span", {
    className: "brand"
  }, "SQUATWOLF"), /*#__PURE__*/React.createElement("span", {
    className: "spacer"
  }), /*#__PURE__*/React.createElement("div", {
    className: "topbar-mode"
  }, session.role === 'master' && /*#__PURE__*/React.createElement("span", {
    className: "role-pill master"
  }, "Master", /*#__PURE__*/React.createElement("span", {
    className: "role-name"
  }, " \xB7 ", session.name)), session.role === 'admin' && /*#__PURE__*/React.createElement("span", {
    className: "role-pill admin"
  }, "Admin", /*#__PURE__*/React.createElement("span", {
    className: "role-name"
  }, " \xB7 ", session.name)), session.role === 'viewer' && /*#__PURE__*/React.createElement("span", {
    className: "role-pill viewer"
  }, "Viewer", /*#__PURE__*/React.createElement("span", {
    className: "role-name"
  }, " \xB7 ", session.name)), !session.role && /*#__PURE__*/React.createElement("span", {
    className: "role-pill pending"
  }, "Pending", /*#__PURE__*/React.createElement("span", {
    className: "role-name"
  }, " \xB7 ", session.name)), isMaster && /*#__PURE__*/React.createElement("button", {
    className: "btn sm",
    onClick: () => setManageOpen(true),
    title: "Manage team"
  }, "\u2699 Team"), /*#__PURE__*/React.createElement("button", {
    className: "btn sm ghost",
    onClick: logout,
    title: "Log out"
  }, "\u21BA"))), !online && /*#__PURE__*/React.createElement("div", {
    className: "offline-banner"
  }, "\u25CF Offline \u2014 changes won't save until you reconnect."), isPending && /*#__PURE__*/React.createElement("div", {
    className: "pending-banner"
  }, "Your access is pending approval. You can browse the inventory but can't edit yet."), isViewer && /*#__PURE__*/React.createElement(ViewerWelcomeBanner, {
    userId: session.id
  }), /*#__PURE__*/React.createElement("div", {
    className: "tabs"
  }, [['dashboard', 'Dashboard'], ['items', 'Items'], ['events', 'Deployments']].map(([key, label]) => /*#__PURE__*/React.createElement("button", {
    key: key,
    onClick: () => setTab(key),
    className: tab === key ? 'active' : ''
  }, label))), tab === 'dashboard' && /*#__PURE__*/React.createElement(DashboardTab, {
    admin: admin
  }), tab === 'items' && /*#__PURE__*/React.createElement(ItemsTab, {
    admin: admin,
    openItemId: openItemId,
    onOpened: () => setOpenItemId(null)
  }), tab === 'events' && /*#__PURE__*/React.createElement(EventsTab, {
    admin: admin,
    openEventId: openEventId,
    onOpened: () => setOpenEventId(null)
  }), loginOpen && /*#__PURE__*/React.createElement(AdminLoginModal, {
    onLogin: handleLogin,
    onClose: () => setLoginOpen(false)
  }), manageOpen && isMaster && /*#__PURE__*/React.createElement(ManageTeamModal, {
    me: session,
    onClose: () => setManageOpen(false)
  }), /*#__PURE__*/React.createElement(ToastHost, null), /*#__PURE__*/React.createElement(ConfirmHost, null));
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));

//# sourceMappingURL=app.compiled.js.map