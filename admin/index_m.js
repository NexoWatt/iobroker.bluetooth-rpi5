/*global systemDictionary, translateAll, sendTo, M */
'use strict';

let gOnChange = null;
let cfgDevices = [];
let lastScan = [];

function toast(message, classes) {
  try {
    M.toast({html: message, classes: classes || ''});
  } catch (e) {
    // ignore
    console.log(message);
  }
}

function safeJsonParse(str, fallback) {
  try {
    const v = JSON.parse(str);
    return v;
  } catch {
    return fallback;
  }
}

function normalizeMac(mac) {
  return String(mac || '').trim().toUpperCase();
}

function slugifyId(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32) || 'device';
}

function ensureUniqueId(base) {
  const existing = new Set(cfgDevices.map(d => String(d.id || '').toLowerCase()));
  let id = base;
  let i = 2;
  while (existing.has(String(id).toLowerCase())) {
    id = `${base}_${i++}`;
  }
  return id;
}

function syncJsonTextarea() {
  const txt = JSON.stringify(cfgDevices, null, 2);
  $('#devicesJson').val(txt);
  M.textareaAutoResize($('#devicesJson'));
  if (gOnChange) gOnChange();
}

function renderCfgTable() {
  const $tbody = $('#cfgTable tbody');
  $tbody.empty();

  for (const dev of cfgDevices) {
    const id = String(dev.id || '');
    const name = String(dev.name || '');
    const address = normalizeMac(dev.address);
    const connect = Boolean(dev.connect);

    const $tr = $('<tr></tr>');

    const $id = $(`<input type="text" class="bt-mono" value="${id}" />`);
    $id.on('change keyup', () => {
      dev.id = slugifyId($id.val());
      renderCfgTable();
      syncJsonTextarea();
    });

    const $name = $(`<input type="text" value="${name}" />`);
    $name.on('change keyup', () => {
      dev.name = $name.val();
      syncJsonTextarea();
    });

    const $addr = $(`<input type="text" class="bt-mono" value="${address}" />`);
    $addr.on('change keyup', () => {
      dev.address = normalizeMac($addr.val());
      syncJsonTextarea();
    });

    const $chk = $(`<label><input type="checkbox" ${connect ? 'checked' : ''} /><span></span></label>`);
    $chk.find('input').on('change', () => {
      dev.connect = $chk.find('input').prop('checked');
      syncJsonTextarea();
    });

    const $btnRemove = $('<a class="waves-effect waves-light btn-small red"><i class="material-icons">delete</i></a>');
    $btnRemove.on('click', () => {
      cfgDevices = cfgDevices.filter(d => d !== dev);
      renderCfgTable();
      syncJsonTextarea();
    });

    $tr.append($('<td></td>').append($id));
    $tr.append($('<td></td>').append($name));
    $tr.append($('<td></td>').append($addr));
    $tr.append($('<td style="width:120px;"></td>').append($chk));
    $tr.append($('<td style="width:80px;"></td>').append($btnRemove));
    $tbody.append($tr);
  }
}

function renderScanTable() {
  const $tbody = $('#scanTable tbody');
  $tbody.empty();

  for (const d of lastScan) {
    const name = String(d.name || '');
    const address = normalizeMac(d.address);
    const rssi = (typeof d.rssi === 'number') ? d.rssi : '';
    const paired = Boolean(d.paired);
    const trusted = Boolean(d.trusted);

    const $tr = $('<tr></tr>');

    const $btnPairTrust = $('<a class="waves-effect waves-light btn-small"><i class="material-icons left">link</i><span class="translate" data-lang="pair_trust">Pair & trust</span></a>');
    const $btnAdd = $('<a class="waves-effect waves-light btn-small green"><i class="material-icons left">add</i><span class="translate" data-lang="add">Add</span></a>');
    const $btnPairAdd = $('<a class="waves-effect waves-light btn-small teal"><i class="material-icons left">playlist_add</i><span class="translate" data-lang="pair_add">Pair & add</span></a>');

    $btnPairTrust.on('click', () => pairDevice(address, true));
    $btnAdd.on('click', () => addDeviceFromScan(d));
    $btnPairAdd.on('click', async () => {
      const ok = await pairDevice(address, true);
      if (ok) addDeviceFromScan(d);
    });

    const $actions = $('<div style="display:flex; gap:8px; flex-wrap:wrap;"></div>');
    $actions.append($btnPairTrust, $btnAdd, $btnPairAdd);

    $tr.append($('<td></td>').text(name));
    $tr.append($('<td class="bt-mono"></td>').text(address));
    $tr.append($('<td></td>').text(rssi));
    $tr.append($('<td></td>').text(paired ? '✓' : ''));
    $tr.append($('<td></td>').text(trusted ? '✓' : ''));
    $tr.append($('<td></td>').append($actions));
    $tbody.append($tr);
  }

  translateAll();
}

function addDeviceFromScan(d) {
  const address = normalizeMac(d.address);
  if (!address) return;

  // avoid duplicates by address
  const exists = cfgDevices.some(x => normalizeMac(x.address) === address);
  if (exists) {
    toast(`Already in config: ${address}`, 'orange');
    return;
  }

  const baseId = slugifyId(d.name || address.replace(/:/g, '').slice(-6));
  const id = ensureUniqueId(baseId);
  const name = String(d.name || `BLE ${address}`);

  cfgDevices.push({
    id,
    name,
    address,
    connect: true,
    gatt: []
  });

  renderCfgTable();
  syncJsonTextarea();
  toast(`Added: ${name} (${address})`, 'green');
}

function sendToAsync(command, message) {
  return new Promise((resolve) => {
    sendTo(null, command, message, (res) => resolve(res));
  });
}

async function scanNow() {
  const duration = parseInt($('#scanDurationSec').val() || '15', 10);
  toast('Scanning ...', 'blue');

  const res = await sendToAsync('scan', {durationSec: duration});
  if (res && res.error) {
    toast(res.error, 'red');
    return;
  }

  lastScan = Array.isArray(res?.devices) ? res.devices : [];
  renderScanTable();
  toast(`Found: ${lastScan.length}`, 'green');
}

async function pairDevice(address, trust) {
  toast(`Pairing ${address} ...`, 'blue');
  const res = await sendToAsync('pair', {address, trust: Boolean(trust)});
  if (res && res.error) {
    toast(res.error, 'red');
    return false;
  }
  toast(`Paired: ${address}`, 'green');

  // refresh scan list status
  const info = await sendToAsync('deviceInfo', {address});
  if (info && !info.error) {
    lastScan = lastScan.map(d => normalizeMac(d.address) === address ? {...d, ...info.device} : d);
    renderScanTable();
  }
  return true;
}

// Called by admin
function load(settings, onChange) {
  gOnChange = onChange;

  if (!settings) return;

  // init inputs with .value class
  $('.value').each(function () {
    const $key = $(this);
    const id = $key.attr('id');
    if (!id) return;

    if ($key.attr('type') === 'checkbox') {
      $key.prop('checked', settings[id]);
    } else {
      $key.val(settings[id]);
    }

    $key.on('change keyup', () => onChange());
  });

  // tabs
  $('.tabs').tabs();

  // devices
  cfgDevices = safeJsonParse(settings.devicesJson || '[]', []);
  if (!Array.isArray(cfgDevices)) cfgDevices = [];

  renderCfgTable();
  syncJsonTextarea();

  // when user edits raw JSON, try to re-parse
  $('#devicesJson').on('change keyup', () => {
    const parsed = safeJsonParse($('#devicesJson').val() || '[]', null);
    if (parsed && Array.isArray(parsed)) {
      cfgDevices = parsed;
      renderCfgTable();
      if (gOnChange) gOnChange();
    }
  });

  $('#btnScan').on('click', scanNow);

  // translate
  translateAll();

  // init materialize labels
  M.updateTextFields();
}

// Called by admin
function save(callback) {
  const obj = {};

  $('.value').each(function () {
    const $this = $(this);
    const id = $this.attr('id');
    if (!id) return;

    if ($this.attr('type') === 'checkbox') {
      obj[id] = $this.prop('checked');
    } else if ($this.attr('type') === 'number') {
      obj[id] = parseFloat($this.val());
    } else {
      obj[id] = $this.val();
    }
  });

  // Ensure devicesJson is valid JSON
  const parsed = safeJsonParse($('#devicesJson').val() || '[]', null);
  if (!parsed || !Array.isArray(parsed)) {
    toast('devicesJson is not valid JSON array', 'red');
    callback(null);
    return;
  }

  obj.devicesJson = JSON.stringify(parsed, null, 2);
  callback(obj);
}
