/*global systemDictionary, translateAll, sendTo, M */
'use strict';

let gOnChange = null;

/** @type {Array<any>} */
let cfgDevices = [];
/** @type {Array<any>} */
let lastList = [];
let autoScanDone = false;

function toast(message, classes) {
  try {
    M.toast({ html: message, classes: classes || '' });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log(message);
  }
}

function safeJsonParse(str, fallback) {
  try {
    return JSON.parse(str);
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

function setBusy(isBusy) {
  $('#scanProgress').css('display', isBusy ? 'block' : 'none');
  $('#btnScan').toggleClass('disabled', Boolean(isBusy));
}

function syncHiddenJson() {
  $('#devicesJson').val(JSON.stringify(cfgDevices, null, 2));
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

    // ID (read-only)
    $tr.append($('<td class="bt-mono"></td>').text(id));

    // Name (editable)
    const $name = $(`<input type="text" value="${name}"/>`);
    $name.on('change keyup', () => {
      dev.name = $name.val();
      syncHiddenJson();
    });
    $tr.append($('<td></td>').append($name));

    // Address (read-only)
    $tr.append($('<td class="bt-mono"></td>').text(address));

    // Auto-connect
    const $chk = $(`<label><input type="checkbox" ${connect ? 'checked' : ''}/><span></span></label>`);
    $chk.find('input').on('change', () => {
      dev.connect = $chk.find('input').prop('checked');
      syncHiddenJson();
    });
    $tr.append($('<td style="width:80px;"></td>').append($chk));

    // Remove
    const $btnRemove = $('<a class="waves-effect waves-light btn-small red"><i class="material-icons">delete</i></a>');
    $btnRemove.on('click', () => {
      cfgDevices = cfgDevices.filter(d => d !== dev);
      renderCfgTable();
      syncHiddenJson();
    });
    $tr.append($('<td style="width:80px;"></td>').append($btnRemove));

    $tbody.append($tr);
  }
}

function mkChip(text, color) {
  const c = color ? ` ${color}` : '';
  return $(`<div class="chip bt-chip${c}">${text}</div>`);
}

function deviceMatchesFilter(d, filterLower) {
  if (!filterLower) return true;
  const name = String(d.name || '').toLowerCase();
  const addr = normalizeMac(d.address).toLowerCase();
  return name.includes(filterLower) || addr.includes(filterLower);
}

function renderScanTable() {
  const $tbody = $('#scanTable tbody');
  $tbody.empty();

  const filterLower = String($('#scanFilter').val() || '').trim().toLowerCase();

  const list = (Array.isArray(lastList) ? lastList : [])
    .filter(d => normalizeMac(d.address))
    .filter(d => deviceMatchesFilter(d, filterLower))
    .sort((a, b) => {
      const ra = typeof a.rssi === 'number' ? a.rssi : -999;
      const rb = typeof b.rssi === 'number' ? b.rssi : -999;
      return rb - ra;
    });

  for (const d of list) {
    const name = String(d.name || d.alias || 'Unknown');
    const address = normalizeMac(d.address);
    const rssi = typeof d.rssi === 'number' ? d.rssi : '';
    const paired = Boolean(d.paired);
    const trusted = Boolean(d.trusted);
    const connected = Boolean(d.connected);

    const $tr = $('<tr></tr>');
    $tr.append($('<td></td>').text(name));
    $tr.append($('<td class="bt-mono"></td>').text(address));
    $tr.append($('<td></td>').text(rssi));

    const $status = $('<td></td>');
    if (connected) $status.append(mkChip('Connected', 'green white-text'));
    if (paired) $status.append(mkChip('Paired', 'blue white-text'));
    if (trusted) $status.append(mkChip('Trusted', 'teal white-text'));
    if (!connected && !paired && !trusted) $status.append(mkChip('New', 'grey lighten-2'));
    $tr.append($status);

    const $btn = $('<a class="waves-effect waves-light btn-small green"><i class="material-icons left">add</i><span class="translate" data-lang="add">Add</span></a>');
    $btn.on('click', () => addFlow(d));
    const $actions = $('<div class="bt-actions"></div>').append($btn);
    $tr.append($('<td></td>').append($actions));

    $tbody.append($tr);
  }

  translateAll();
}

function sendToAsync(command, message) {
  return new Promise((resolve) => {
    try {
      sendTo(null, command, message || {}, (res) => resolve(res));
    } catch (e) {
      resolve({ error: e && e.message ? e.message : String(e) });
    }
  });
}

async function refreshAdapters() {
  const $sel = $('#adapter');
  $sel.empty();

  const res = await sendToAsync('listAdapters', {});
  const adapters = Array.isArray(res?.adapters) ? res.adapters : [];

  // Fallback: still allow manual value if list not available
  if (!adapters.length) {
    const current = String($sel.data('current') || $sel.val() || 'hci0');
    $sel.append(`<option value="${current}">${current}</option>`);
    $sel.val(current);
    M.FormSelect.init($sel.get(0));
    toast(res?.error ? res.error : 'No adapters found. Is Bluetooth/BlueZ installed?', 'orange');
    return;
  }

  const currentValue = String($sel.data('current') || '').trim() || String($('#adapter').val() || '').trim();

  for (const a of adapters) {
    const id = String(a.id || '').trim();
    const address = String(a.address || '').trim();
    const alias = String(a.alias || '').trim();
    const powered = a.powered === false ? ' (off)' : '';
    const label = `${id}${powered}${alias ? ' — ' + alias : ''}${address ? ' — ' + address : ''}`;
    $sel.append(`<option value="${id}">${label}</option>`);
  }

  const exists = adapters.some(a => String(a.id) === currentValue);
  const valueToSet = exists ? currentValue : String(adapters[0].id);
  $sel.val(valueToSet);
  M.FormSelect.init($sel.get(0));
  M.updateTextFields();

  // If we changed it implicitly, reflect in hidden state and notify admin
  if (valueToSet !== currentValue) {
    if (gOnChange) gOnChange();
  }
}

async function scanNow() {
  setBusy(true);
  try {
    const duration = Math.max(3, parseInt($('#scanDurationSec').val() || '15', 10));
    const transport = String($('#scanTransport').val() || 'le');

    toast('Scanning ...', 'blue');
    const res = await sendToAsync('scan', { durationSec: duration, transport });
    if (res?.error) {
      toast(res.error, 'red');
      return;
    }

    lastList = Array.isArray(res?.devices) ? res.devices : [];
    renderScanTable();
    toast(`Found: ${lastList.length}`, 'green');
  } finally {
    setBusy(false);
  }
}

function addToConfigFromDevice(d) {
  const address = normalizeMac(d.address);
  if (!address) return;

  // avoid duplicates by address
  const exists = cfgDevices.some(x => normalizeMac(x.address) === address);
  if (exists) {
    toast(`Already configured: ${address}`, 'orange');
    return;
  }

  const baseId = slugifyId(d.name || address.replace(/:/g, '').slice(-6));
  const id = ensureUniqueId(baseId);
  const name = String(d.name || d.alias || `BLE ${address}`);

  cfgDevices.push({
    id,
    name,
    address,
    connect: true,
    gatt: []
  });

  renderCfgTable();
  syncHiddenJson();
  toast(`Added: ${name}`, 'green');
}

async function addFlow(d) {
  const address = normalizeMac(d.address);
  if (!address) return;

  // Smartphone-like: try to pair+trust automatically if needed.
  if (!d.paired) {
    toast(`Pairing ${address} ...`, 'blue');
    const pr = await sendToAsync('pair', { address, trust: true });
    if (pr?.error) {
      // Some BLE devices do not support bonding - still allow adding.
      toast(`Pairing not possible (${pr.error}). Adding anyway.`, 'orange');
    } else {
      d.paired = true;
      d.trusted = true;
    }
  } else if (!d.trusted) {
    const tr = await sendToAsync('trust', { address, trusted: true });
    if (tr?.error) {
      toast(`Trust failed: ${tr.error}`, 'orange');
    } else {
      d.trusted = true;
    }
  }

  addToConfigFromDevice(d);

  // Refresh row status (best effort)
  const info = await sendToAsync('deviceInfo', { address });
  if (!info?.error && info?.device) {
    lastList = lastList.map(x => normalizeMac(x.address) === address ? { ...x, ...info.device } : x);
    renderScanTable();
  }
}

// Called by admin
function load(settings, onChange) {
  gOnChange = onChange;
  if (!settings) return;

  // init tabs + auto-scan once when user opens the Devices tab (smartphone-like)
  const tabsElem = document.querySelector('.tabs');
  if (tabsElem) {
    M.Tabs.init(tabsElem, {
      onShow: (tab) => {
        if (tab && tab.id === 'tab-devices' && !autoScanDone) {
          autoScanDone = true;
          // slight delay so UI is fully rendered
          setTimeout(() => scanNow().catch(() => undefined), 150);
        }
      }
    });
  }

  // Load scalar settings
  $('#scanDurationSec').val(settings.scanDurationSec);
  $('#reconnectIntervalSec').val(settings.reconnectIntervalSec);
  $('#scanOnStart').prop('checked', Boolean(settings.scanOnStart));

  // Adapter selection: store current first, then populate options via sendTo
  $('#adapter').data('current', settings.adapter || 'hci0');

  // Devices config
  cfgDevices = safeJsonParse(settings.devicesJson || '[]', []);
  if (!Array.isArray(cfgDevices)) cfgDevices = [];
  syncHiddenJson();
  renderCfgTable();

  // Init transport select
  M.FormSelect.init($('#scanTransport').get(0));

  // Handlers
  $('#btnRefreshAdapters').on('click', refreshAdapters);
  $('#btnScan').on('click', scanNow);
  $('#scanFilter').on('change keyup', renderScanTable);

  // Change detection
  $('#scanDurationSec, #reconnectIntervalSec').on('change keyup', () => onChange());
  $('#scanOnStart').on('change', () => onChange());
  $('#adapter').on('change', () => onChange());

  // Translate + UI init
  translateAll();
  M.updateTextFields();

  // Load adapter list
  refreshAdapters().catch(() => undefined);
}

// Called by admin
function save(callback) {
  const obj = {
    adapter: String($('#adapter').val() || 'hci0'),
    scanOnStart: Boolean($('#scanOnStart').prop('checked')),
    scanDurationSec: Math.max(3, parseInt($('#scanDurationSec').val() || '15', 10)),
    reconnectIntervalSec: Math.max(5, parseInt($('#reconnectIntervalSec').val() || '30', 10)),
    devicesJson: JSON.stringify(cfgDevices, null, 2)
  };
  callback(obj);
}
