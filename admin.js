
(() => {
'use strict';

const cfg = window.AN_CONFIG || {};
const db = window.supabase && cfg.SUPABASE_URL && cfg.SUPABASE_PUBLISHABLE_KEY
  ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY)
  : null;

const $ = id => document.getElementById(id);
let savedSettings = {};
let googleToken = null;
let canvas = null;
let history = [];
let historyIndex = -1;
let restoring = false;
let editorBackground = '#f7f1e9';

const msg = (t, c = '') => {
  const e = $('admin-message');
  if (e) {
    e.textContent = t;
    e.className = 'form-message ' + c;
  }
};

const editorMsg = t => {
  const e = $('editor-status');
  if (e) e.textContent = t;
};

function esc(v) {
  return String(v ?? '');
}

function statusClass(s) {
  return ['pending', 'confirmed', 'cancelled', 'completed'].includes(s)
    ? s : 'pending';
}

/* AUTENTIFICARE */

async function session() {
  const { data } = await db.auth.getSession();
  return data.session;
}

async function requireAdmin() {
  const s = await session();

  if (!s) {
    $('login-panel').hidden = false;
    $('dashboard').hidden = true;
    return false;
  }

  $('login-panel').hidden = true;
  $('dashboard').hidden = false;
  return true;
}

$('login-form').addEventListener('submit', async e => {
  e.preventDefault();

  if (!db) {
    $('login-message').textContent = 'Supabase nu este configurat.';
    return;
  }

  const fd = new FormData(e.currentTarget);
  $('login-message').textContent = 'Se autentifică...';

  const { error } = await db.auth.signInWithPassword({
    email: String(fd.get('email')),
    password: String(fd.get('password'))
  });

  if (error) {
    $('login-message').textContent =
      'Autentificare nereușită: ' + error.message;
    return;
  }

  $('login-message').textContent = '';
  await load();
});

$('logout').onclick = async () => {
  if (db) await db.auth.signOut();
  location.reload();
};

/* PROGRAMĂRI */

async function loadBookings() {
  const { data, error } = await db
    .from('bookings')
    .select('*')
    .order('booking_date', { ascending: false })
    .order('booking_time', { ascending: false });

  const body = $('booking-rows');
  body.innerHTML = '';

  if (error) {
    body.innerHTML =
      `<tr><td colspan="8">Nu pot încărca programările: ${esc(error.message)}</td></tr>`;
    return;
  }

  if (!data?.length) {
    body.innerHTML =
      '<tr><td colspan="8">Nu există programări.</td></tr>';
    return;
  }

  data.forEach(b => {
    const tr = document.createElement('tr');
    const contact =
      `${esc(b.social_platform || '')} ${esc(b.social_username || '')}`.trim();

    tr.innerHTML = `
      <td>${esc(b.booking_date)}</td>
      <td>${esc(String(b.booking_time || '').slice(0, 5))}</td>
      <td>${esc(b.client_name)}</td>
      <td>${contact}</td>
      <td>${esc(b.email)}</td>
      <td>${esc(b.service)}</td>
      <td><span class="status ${statusClass(b.status)}">${esc(b.status)}</span></td>
      <td>
        <button class="small-action" data-action="confirm" data-id="${esc(b.id)}">Confirmă</button>
        <button class="small-action" data-action="cancel" data-id="${esc(b.id)}">Anulează</button>
        <button class="small-action" data-action="delete" data-id="${esc(b.id)}">Șterge</button>
      </td>`;

    body.appendChild(tr);
  });

  body.querySelectorAll('button').forEach(btn => {
    btn.onclick = () =>
      bookingAction(btn.dataset.action, btn.dataset.id);
  });
}

async function bookingAction(action, id) {
  if (action === 'delete' &&
      !confirm('Ștergi definitiv această programare?')) return;

  const { data: b, error: readError } = await db
    .from('bookings')
    .select('*')
    .eq('id', id)
    .single();

  if (readError) {
    msg('Nu am putut găsi programarea: ' + readError.message, 'error');
    return;
  }

  if (action === 'delete') {
    const { error } = await db.from('bookings').delete().eq('id', id);

    if (error) {
      msg('Nu am putut șterge programarea: ' + error.message, 'error');
      return;
    }

    if (b.google_event_id) await deleteGoogleEvent(b.google_event_id);

    msg('Programarea a fost ștearsă.', 'success');
    await loadBookings();
    return;
  }

  const newStatus = action === 'confirm' ? 'confirmed' : 'cancelled';

  const { error } = await db
    .from('bookings')
    .update({ status: newStatus })
    .eq('id', id);

  if (error) {
    msg('Nu am putut actualiza programarea: ' + error.message, 'error');
    return;
  }

  if (newStatus === 'confirmed') {
    if (googleToken && b.google_event_id == null) {
      const eventId = await createGoogleEvent(b);

      if (eventId) {
        await db.from('bookings')
          .update({ google_event_id: eventId })
          .eq('id', id);
      }
    }
  } else if (newStatus === 'cancelled' && b.google_event_id) {
    await deleteGoogleEvent(b.google_event_id);

    await db.from('bookings')
      .update({ google_event_id: null })
      .eq('id', id);
  }

  msg(
    newStatus === 'confirmed'
      ? 'Programarea a fost confirmată.'
      : 'Programarea a fost anulată.',
    'success'
  );

  await loadBookings();
}

/* SERVICII */

async function loadServices() {
  const { data, error } = await db
    .from('site_services')
    .select('*')
    .order('sort_order');

  const host = $('service-items');
  host.innerHTML = '';

  if (error) {
    host.textContent = error.message;
    return;
  }

  (data || []).forEach(s => {
    const r = document.createElement('div');
    r.className = 'item-row';

    r.innerHTML = `
      <strong>${esc(s.name)}</strong> — ${esc(s.price)}
      <button class="small-action">Șterge</button>`;

    r.querySelector('button').onclick = async () => {
      if (!confirm('Ștergi serviciul?')) return;

      const { error } = await db
        .from('site_services')
        .delete()
        .eq('id', s.id);

      if (error) msg(error.message, 'error');
      else {
        msg('Serviciul a fost șters.', 'success');
        loadServices();
      }
    };

    host.appendChild(r);
  });
}

$('service-form').onsubmit = async e => {
  e.preventDefault();

  const fd = new FormData(e.currentTarget);

  const { error } = await db.from('site_services').insert({
    name: String(fd.get('name')).trim(),
    description: String(fd.get('description')).trim(),
    price: String(fd.get('price')).trim(),
    active: true,
    sort_order: Date.now()
  });

  if (error) {
    msg('Nu am putut adăuga serviciul: ' + error.message, 'error');
  } else {
    e.currentTarget.reset();
    msg('Serviciul a fost adăugat.', 'success');
    loadServices();
  }
};

/* FOTOGRAFII */

async function compress(file) {
  if (!file) return null;

  try {
    const bmp = await createImageBitmap(file);
    const max = 1600;
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));

    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);

    c.getContext('2d').drawImage(
      bmp, 0, 0, c.width, c.height
    );

    const blob = await new Promise(resolve =>
      c.toBlob(resolve, 'image/webp', 0.82)
    );

    return blob
      ? new File(
          [blob],
          file.name.replace(/\.[^.]+$/i, '.webp'),
          { type: 'image/webp' }
        )
      : file;
  } catch {
    return file;
  }
}

$('photo-form').onsubmit = async e => {
  e.preventDefault();

  const fd = new FormData(e.currentTarget);
  const file = fd.get('photo');

  if (!file?.size) {
    msg('Alege o fotografie.', 'error');
    return;
  }

  const f = await compress(file);
  const path =
    `gallery/${Date.now()}-${f.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`;

  const up = await db.storage
    .from('andreea-nails')
    .upload(path, f, {
      upsert: false,
      contentType: f.type
    });

  if (up.error) {
    msg('Nu am putut încărca fotografia: ' + up.error.message, 'error');
    return;
  }

  const { error } = await db.from('site_gallery').insert({
    image_path: path,
    caption: String(fd.get('caption') || '').trim() || null,
    sort_order: Date.now()
  });

  if (error) {
    await db.storage.from('andreea-nails').remove([path]);
    msg('Fotografia a fost încărcată, dar nu am putut salva în galerie: ' + error.message, 'error');
    return;
  }

  e.currentTarget.reset();
  msg('Fotografia a fost adăugată.', 'success');
  loadGalleryAdmin();
};

async function loadGalleryAdmin() {
  const { data, error } = await db
    .from('site_gallery')
    .select('*')
    .order('sort_order');

  const host = $('photo-items');
  host.innerHTML = '';

  if (error) {
    host.textContent = error.message;
    return;
  }

  (data || []).forEach(g => {
    const r = document.createElement('div');
    r.className = 'item-row';

    r.innerHTML = `
      <strong>${esc(g.caption || 'Fotografie')}</strong>
      <button class="small-action">Șterge</button>`;

    r.querySelector('button').onclick = async () => {
      if (!confirm('Ștergi fotografia?')) return;

      const a = await db.storage
        .from('andreea-nails')
        .remove([g.image_path]);

      if (a.error) {
        msg('Nu am putut șterge fișierul: ' + a.error.message, 'error');
        return;
      }

      const { error } = await db
        .from('site_gallery')
        .delete()
        .eq('id', g.id);

      if (error) msg(error.message, 'error');
      else {
        msg('Fotografia a fost ștearsă.', 'success');
        loadGalleryAdmin();
      }
    };

    host.appendChild(r);
  });
}

/* ORE DISPONIBILE */

async function loadHours() {
  const { data, error } = await db
    .from('site_date_availability')
    .select('*')
    .gte('booking_date', new Date().toISOString().slice(0, 10))
    .order('booking_date')
    .order('slot_time');

  const host = $('hours-list');
  host.innerHTML = '';

  if (error) {
    host.textContent = error.message;
    return;
  }

  (data || []).forEach(x => {
    const r = document.createElement('div');
    r.className = 'item-row';

    r.innerHTML = `
      ${esc(x.booking_date)} · ${esc(String(x.slot_time).slice(0, 5))}
      <button class="small-action">Șterge</button>`;

    r.querySelector('button').onclick = async () => {
      const { error } = await db
        .from('site_date_availability')
        .delete()
        .eq('booking_date', x.booking_date)
        .eq('slot_time', x.slot_time);

      if (error) {
        msg('Nu pot șterge ora: ' + error.message, 'error');
      } else {
        msg('Ora a fost ștearsă.', 'success');
        loadHours();
      }
    };

    host.appendChild(r);
  });
}

$('hours-form').onsubmit = async e => {
  e.preventDefault();

  const fd = new FormData(e.currentTarget);
  const date = String(fd.get('date'));
  const time = String(fd.get('time'));

  const { error } = await db
    .from('site_date_availability')
    .upsert(
      { booking_date: date, slot_time: time },
      { onConflict: 'booking_date,slot_time' }
    );

  if (error) {
    msg('Nu am putut adăuga ora: ' + error.message, 'error');
  } else {
    msg('Ora a fost adăugată.', 'success');
    e.currentTarget.reset();
    loadHours();
  }
};

/* ZILE BLOCATE */

async function loadBlocked() {
  const { data, error } = await db
    .from('blocked_dates')
    .select('*')
    .gte('booking_date', new Date().toISOString().slice(0, 10))
    .order('booking_date');

  const host = $('blocked-items');
  host.innerHTML = '';

  if (error) {
    host.textContent = error.message;
    return;
  }

  (data || []).forEach(x => {
    const r = document.createElement('div');
    r.className = 'item-row';

    r.innerHTML = `
      ${esc(x.booking_date)}${x.reason ? ' · ' + esc(x.reason) : ''}
      <button class="small-action">Deblochează</button>`;

    r.querySelector('button').onclick = async () => {
      const { error } = await db
        .from('blocked_dates')
        .delete()
        .eq('booking_date', x.booking_date);

      if (error) {
        msg('Nu pot debloca ziua: ' + error.message, 'error');
      } else {
        msg('Ziua a fost deblocată.', 'success');
        loadBlocked();
      }
    };

    host.appendChild(r);
  });
}

$('blocked-form').onsubmit = async e => {
  e.preventDefault();

  const fd = new FormData(e.currentTarget);

  const { error } = await db.from('blocked_dates').upsert({
    booking_date: String(fd.get('date')),
    reason: String(fd.get('reason') || '').trim() || null
  }, {
    onConflict: 'booking_date'
  });

  if (error) {
    msg('Nu am putut bloca ziua: ' + error.message, 'error');
  } else {
    msg('Ziua a fost blocată.', 'success');
    e.currentTarget.reset();
    loadBlocked();
  }
};

/* PERSONALIZARE DESIGN */

function fillCustom(s) {
  const f = $('custom-form');

  [
    'theme', 'hero_title', 'hero_description', 'hero_quote',
    'booking_title', 'booking_description',
    'services_title', 'services_description',
    'gallery_title', 'gallery_description',
    'contact_title', 'contact_note', 'hero_button',
    'hero_note', 'instagram', 'facebook',
    'primary_color', 'accent_color',
    'background_color', 'text_color',
    'font_family', 'decorative_text'
  ].forEach(k => {
    if (f.elements[k] && s[k] !== undefined) {
      f.elements[k].value = s[k];
    }
  });

  if (f.elements.decorations) {
    f.elements.decorations.checked = s.decorations !== false;
  }

  updatePreview();
}

function updatePreview() {
  const f = $('custom-form');
  const p = $('custom-preview');

  p.style.background = f.elements.background_color.value;
  p.style.color = f.elements.text_color.value;
  p.style.borderColor = f.elements.accent_color.value;

  p.innerHTML = `
    <strong style="color:${esc(f.elements.primary_color.value)}">
      ${esc(f.elements.hero_title.value || 'Frumusețea stă în detalii.')}
    </strong>
    <small>${esc(f.elements.hero_quote.value || 'Frumusețea ta, prioritatea mea! ♡')}</small>`;
}

[
  'primary_color', 'accent_color', 'background_color',
  'text_color', 'hero_title', 'hero_quote'
].forEach(k => {
  const e = $('custom-form').elements[k];
  if (e) e.addEventListener('input', updatePreview);
});

$('custom-form').onsubmit = async e => {
  e.preventDefault();

  const fd = new FormData(e.currentTarget);
  const file = fd.get('background_image');

  let bg = savedSettings.background_image || null;

  if (file?.size) {
    const f = await compress(file);
    const path =
      `background/${Date.now()}-${f.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`;

    const up = await db.storage
      .from('andreea-nails')
      .upload(path, f, {
        upsert: false,
        contentType: f.type
      });

    if (up.error) {
      msg('Nu am putut încărca fundalul: ' + up.error.message, 'error');
      return;
    }

    bg = db.storage.from('andreea-nails').getPublicUrl(path).data.publicUrl;
  }

  const settings = { ...savedSettings };

  for (const [k, v] of fd.entries()) {
    if (k !== 'background_image') settings[k] = v;
  }

  settings.decorations = fd.get('decorations') === 'on';
  settings.background_image = bg;

  const { error } = await db.from('site_customization').upsert({
    id: 1,
    settings,
    updated_at: new Date().toISOString()
  });

  if (error) {
    msg('Nu am putut salva designul: ' + error.message, 'error');
    return;
  }

  savedSettings = settings;
  msg('Designul a fost salvat.', 'success');
};

async function loadCustom() {
  const { data, error } = await db
    .from('site_customization')
    .select('settings')
    .eq('id', 1)
    .maybeSingle();

  if (error) {
    msg('Nu pot încărca personalizarea: ' + error.message, 'error');
    return;
  }

  savedSettings = data?.settings || {};
  fillCustom(savedSettings);
}

/* EDITOR VIZUAL */

function initVisualEditor() {
  if (!window.fabric || !$('design-canvas')) {
    editorMsg('Nu s-a încărcat biblioteca editorului. Reîncarcă pagina.');
    return;
  }

  canvas = new fabric.Canvas('design-canvas', {
    width: 1200,
    height: 700,
    backgroundColor: editorBackground,
    preserveObjectStacking: true,
    selection: true,
    allowTouchScrolling: true
  });

  canvas.setDimensions({
    width: 1200,
    height: 700
  });

  canvas.on('selection:created', updateEditorControls);
  canvas.on('selection:updated', updateEditorControls);
  canvas.on('selection:cleared', updateEditorControls);

  canvas.on('object:modified', saveHistory);
  canvas.on('object:added', () => {
    if (!restoring) {
      refreshLayers();
      saveHistory();
    }
  });

  canvas.on('object:removed', () => {
    if (!restoring) {
      refreshLayers();
      saveHistory();
    }
  });

  $('editor-add-text').onclick = addText;
  $('editor-add-rect').onclick = addRectangle;
  $('editor-add-circle').onclick = addCircle;

  $('editor-upload').onclick = () => $('editor-file').click();
  $('editor-file').onchange = uploadEditorFiles;

  $('editor-duplicate').onclick = duplicateObject;
  $('editor-delete').onclick = deleteObject;
  $('editor-undo').onclick = undoEditor;
  $('editor-redo').onclick = redoEditor;

  $('editor-clear').onclick = clearEditor;
  $('editor-save').onclick = () => saveVisualDesign(false);
  $('editor-publish').onclick = () => saveVisualDesign(true);

  $('editor-text').oninput = updateSelectedText;
  $('editor-color').oninput = updateSelectedColor;
  $('editor-font-size').onchange = updateSelectedFontSize;
  $('editor-font-family').onchange = updateSelectedFont;
  $('editor-opacity').oninput = updateSelectedOpacity;
  $('editor-angle').oninput = updateSelectedAngle;

  $('editor-bring-front').onclick = () => {
    const o = canvas.getActiveObject();
    if (!o) return;
    canvas.bringToFront(o);
    canvas.requestRenderAll();
    refreshLayers();
    saveHistory();
  };

  $('editor-send-back').onclick = () => {
    const o = canvas.getActiveObject();
    if (!o) return;
    canvas.sendToBack(o);
    canvas.requestRenderAll();
    refreshLayers();
    saveHistory();
  };

  $('editor-lock').onclick = toggleLock;
  $('editor-set-background').onclick = setEditorBackground;

  canvas.on('mouse:up', refreshLayers);

  loadVisualDesign();
}

function addText() {
  const text = new fabric.IText('Scrie textul aici', {
    left: 150,
    top: 150,
    fontFamily: 'DM Sans',
    fontSize: 42,
    fill: '#987448',
    editable: true
  });

  canvas.add(text);
  canvas.setActiveObject(text);
  canvas.requestRenderAll();
  updateEditorControls();
}

function addRectangle() {
  const shape = new fabric.Rect({
    left: 150,
    top: 150,
    width: 250,
    height: 140,
    fill: '#c69b5a',
    rx: 12,
    ry: 12
  });

  canvas.add(shape);
  canvas.setActiveObject(shape);
  canvas.requestRenderAll();
}

function addCircle() {
  const shape = new fabric.Circle({
    left: 180,
    top: 160,
    radius: 65,
    fill: '#d9c2a1'
  });

  canvas.add(shape);
  canvas.setActiveObject(shape);
  canvas.requestRenderAll();
}

async function uploadEditorFiles(e) {
  const files = Array.from(e.target.files || []);

  if (!files.length) return;

  for (const file of files) {
    if (file.type.startsWith('video/')) {
      editorMsg('Videoclipurile pot fi încărcate în etapa de integrare media, dar nu pot fi editate ca imagini în acest editor.');
      continue;
    }

    if (
      !file.type.startsWith('image/') &&
      !file.name.toLowerCase().endsWith('.svg')
    ) {
      editorMsg('Acest format nu este acceptat momentan în editor.');
      continue;
    }

    editorMsg('Se încarcă: ' + file.name);

    const path =
      `editor/${Date.now()}-${Math.random().toString(36).slice(2)}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`;

    const up = await db.storage
      .from('andreea-nails')
      .upload(path, file, {
        upsert: false,
        contentType: file.type || 'image/svg+xml'
      });

    if (up.error) {
      editorMsg('Eroare la încărcare: ' + up.error.message);
      continue;
    }

    const url = db.storage
      .from('andreea-nails')
      .getPublicUrl(path).data.publicUrl;

    if (file.name.toLowerCase().endsWith('.svg')) {
      fabric.loadSVGFromURL(url, (objects, options) => {
        if (!objects?.length) {
          editorMsg('Nu am putut deschide fișierul SVG.');
          return;
        }

        const svg = fabric.util.groupSVGElements(objects, options);
        svg.set({
          left: 100,
          top: 100,
          scaleX: Math.min(1, 350 / (svg.width || 350)),
          scaleY: Math.min(1, 350 / (svg.height || 350))
        });

        canvas.add(svg);
        canvas.setActiveObject(svg);
        canvas.requestRenderAll();
        editorMsg('Elementul SVG a fost adăugat.');
      });
    } else {
      fabric.Image.fromURL(url, img => {
        if (!img) {
          editorMsg('Nu am putut deschide imaginea.');
          return;
        }

        const max = 450;
        const scale = Math.min(
          1,
          max / Math.max(img.width, img.height)
        );

        img.set({
          left: 100,
          top: 100,
          scaleX: scale,
          scaleY: scale
        });

        canvas.add(img);
        canvas.setActiveObject(img);
        canvas.requestRenderAll();
        editorMsg('Elementul a fost încărcat și adăugat.');
      }, {
        crossOrigin: 'anonymous'
      });
    }
  }

  e.target.value = '';
}

function selectedObject() {
  return canvas?.getActiveObject();
}

function updateEditorControls() {
  const o = selectedObject();
  if (!o) return;

  $('editor-text').value =
    typeof o.text === 'string' ? o.text : '';

  $('editor-color').value =
    typeof o.fill === 'string' && /^#[0-9a-f]{6}$/i.test(o.fill)
      ? o.fill
      : '#987448';

  $('editor-font-size').value = o.fontSize || 36;
  $('editor-font-family').value = o.fontFamily || 'DM Sans';
  $('editor-opacity').value = Math.round((o.opacity ?? 1) * 100);
  $('editor-angle').value = o.angle || 0;
}

function updateSelectedText() {
  const o = selectedObject();
  if (!o || typeof o.text !== 'string') return;

  o.set('text', $('editor-text').value);
  canvas.requestRenderAll();
  saveHistory();
}

function updateSelectedColor() {
  const o = selectedObject();
  if (!o) return;

  o.set('fill', $('editor-color').value);
  canvas.requestRenderAll();
  saveHistory();
}

function updateSelectedFontSize() {
  const o = selectedObject();
  if (!o || typeof o.text !== 'string') return;

  o.set('fontSize', Number($('editor-font-size').value) || 36);
  canvas.requestRenderAll();
  saveHistory();
}

function updateSelectedFont() {
  const o = selectedObject();
  if (!o || typeof o.text !== 'string') return;

  o.set('fontFamily', $('editor-font-family').value);
  canvas.requestRenderAll();
  saveHistory();
}

function updateSelectedOpacity() {
  const o = selectedObject();
  if (!o) return;

  o.set('opacity', Number($('editor-opacity').value) / 100);
  canvas.requestRenderAll();
  saveHistory();
}

function updateSelectedAngle() {
  const o = selectedObject();
  if (!o) return;

  o.set('angle', Number($('editor-angle').value));
  canvas.requestRenderAll();
  saveHistory();
}

function duplicateObject() {
  const o = selectedObject();
  if (!o) {
    editorMsg('Selectează mai întâi un element.');
    return;
  }

  o.clone(clone => {
    clone.set({
      left: (o.left || 0) + 25,
      top: (o.top || 0) + 25
    });

    canvas.add(clone);
    canvas.setActiveObject(clone);
    canvas.requestRenderAll();
  });
}

function deleteObject() {
  const o = selectedObject();
  if (!o) return;

  canvas.remove(o);
  canvas.discardActiveObject();
  canvas.requestRenderAll();
  refreshLayers();
}

function toggleLock() {
  const o = selectedObject();
  if (!o) return;

  const locked = !o.lockMovementX;

  o.set({
    lockMovementX: locked,
    lockMovementY: locked,
    lockScalingX: locked,
    lockScalingY: locked,
    lockRotation: locked,
    hasControls: !locked,
    selectable: true
  });

  canvas.requestRenderAll();
  editorMsg(locked ? 'Element blocat.' : 'Element deblocat.');
}

function setEditorBackground() {
  editorBackground = $('editor-background').value;
  canvas.setBackgroundColor(editorBackground, canvas.renderAll.bind(canvas));
  saveHistory();
}

function clearEditor() {
  if (!confirm('Golești întreaga pagină din editor?')) return;

  canvas.clear();
  canvas.setBackgroundColor(editorBackground, canvas.renderAll.bind(canvas));
  refreshLayers();
  saveHistory();
}

function refreshLayers() {
  if (!canvas) return;

  const host = $('editor-layers');
  host.innerHTML = '';

  const objects = canvas.getObjects().slice().reverse();

  if (!objects.length) {
    host.innerHTML = '<p class="editor-help">Nu există elemente.</p>';
    return;
  }

  objects.forEach((o, index) => {
    const row = document.createElement('div');
    row.className = 'editor-layer';

    const name = o.type === 'i-text' || o.type === 'textbox'
      ? (o.text || 'Text').slice(0, 25)
      : o.type === 'image'
        ? 'Imagine'
        : o.type === 'group'
          ? 'Element grafic'
          : o.type;

    const label = document.createElement('span');
    label.textContent = `${index + 1}. ${name}`;

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Selectează';

    button.onclick = () => {
      canvas.setActiveObject(o);
      canvas.requestRenderAll();
      updateEditorControls();
    };

    row.append(label, button);
    host.appendChild(row);
  });
}

/* ISTORIC EDITARE */

function saveHistory() {
  if (!canvas || restoring) return;

  const json = JSON.stringify(canvas.toJSON(['selectable']));
  const previous = history[historyIndex];

  if (previous === json) return;

  history = history.slice(0, historyIndex + 1);
  history.push(json);

  if (history.length > 30) history.shift();

  historyIndex = history.length - 1;
  refreshLayers();
}

function restoreHistory(index) {
  if (index < 0 || index >= history.length) return;

  restoring = true;

  canvas.loadFromJSON(history[index], () => {
    canvas.requestRenderAll();
    restoring = false;
    historyIndex = index;
    refreshLayers();
    editorMsg('Modificare restaurată.');
  });
}

function undoEditor() {
  if (historyIndex > 0) restoreHistory(historyIndex - 1);
}

function redoEditor() {
  if (historyIndex < history.length - 1) {
    restoreHistory(historyIndex + 1);
  }
}

/* SALVARE ȘI ÎNCĂRCARE */

async function loadVisualDesign() {
  const design = savedSettings.visual_design;

  if (!design || !design.canvas) {
    canvas.setBackgroundColor(editorBackground, canvas.renderAll.bind(canvas));
    saveHistory();
    editorMsg('Editor pregătit. Adaugă primul element.');
    return;
  }

  restoring = true;

  canvas.loadFromJSON(design.canvas, () => {
    editorBackground = design.background || '#f7f1e9';
    canvas.setBackgroundColor(
      editorBackground,
      canvas.renderAll.bind(canvas)
    );

    canvas.requestRenderAll();
    restoring = false;

    history = [];
    historyIndex = -1;
    saveHistory();
    refreshLayers();

    editorMsg('Designul salvat a fost încărcat.');
  });
}

async function saveVisualDesign(publish) {
  if (!db || !canvas) return;

  editorMsg('Se salvează designul...');

  const design = {
    canvas: canvas.toJSON(['selectable']),
    background: editorBackground,
    published: !!publish,
    updated_at: new Date().toISOString()
  };

  const settings = {
    ...savedSettings,
    visual_design: design
  };

  const { error } = await db.from('site_customization').upsert({
    id: 1,
    settings,
    updated_at: new Date().toISOString()
  });

  if (error) {
    editorMsg('Nu am putut salva: ' + error.message);
    return;
  }

  savedSettings = settings;

  editorMsg(
    publish
      ? 'Design salvat ca publicat. Urmează conectarea lui la pagina publică.'
      : 'Schița a fost salvată cu succes.'
  );
}

/* GOOGLE CALENDAR */

function getGoogleClientId() {
  return localStorage.getItem('andreea_google_client_id') || '';
}

$('google-client-form').onsubmit = e => {
  e.preventDefault();

  const id = $('google-client-id').value.trim();

  localStorage.setItem('andreea_google_client_id', id);
  $('google-status').textContent =
    'Client ID salvat pe acest dispozitiv.';
};

$('google-client-id').value = getGoogleClientId();

$('google-connect').onclick = () => {
  const clientId = getGoogleClientId();

  if (!clientId) {
    $('google-status').textContent = 'Introdu mai întâi Client ID.';
    return;
  }

  if (!window.google?.accounts?.oauth2) {
    $('google-status').textContent =
      'Google Identity Services nu s-a încărcat încă.';
    return;
  }

  const client = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: 'https://www.googleapis.com/auth/calendar.events',

    callback: r => {
      if (r.error) {
        $('google-status').textContent = 'Autorizarea a eșuat.';
        return;
      }

      googleToken = r.access_token;
      $('google-status').textContent =
        'Google Calendar conectat în această sesiune.';
    }
  });

  client.requestAccessToken({ prompt: 'consent' });
};

async function createGoogleEvent(b) {
  if (!googleToken) return null;

  const start =
    `${b.booking_date}T${String(b.booking_time).slice(0, 5)}:00`;

  const d = new Date(start);
  const end = new Date(d.getTime() + 60 * 60 * 1000);

  const body = {
    summary: `Andreea Nails — ${b.client_name}`,
    description:
      `Serviciu: ${b.service}\n` +
      `Contact: ${b.social_platform || ''} ${b.social_username || ''}\n` +
      `E-mail: ${b.email || ''}\n` +
      `Observații: ${b.notes || ''}`,
    start: { dateTime: start },
    end: { dateTime: end }
  };

  const r = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + googleToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }
  );

  if (!r.ok) {
    console.warn('Google Calendar event error', await r.text());
    return null;
  }

  return (await r.json()).id;
}

async function deleteGoogleEvent(id) {
  if (!googleToken || !id) return;

  await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events/' +
    encodeURIComponent(id),
    {
      method: 'DELETE',
      headers: {
        Authorization: 'Bearer ' + googleToken
      }
    }
  );
}

/* PORNIRE */

async function load() {
  if (!db) {
    $('login-message').textContent = 'Supabase nu este configurat.';
    return;
  }

  if (!(await requireAdmin())) return;

  await Promise.all([
    loadBookings(),
    loadServices(),
    loadGalleryAdmin(),
    loadHours(),
    loadBlocked(),
    loadCustom()
  ]);

  initVisualEditor();
}

load();

})();
