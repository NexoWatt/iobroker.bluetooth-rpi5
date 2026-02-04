/* global M, sendTo, systemDictionary */
'use strict';

let g_onChange = null;
let g_configuredDevices = [];
let g_lastScanResults = [];
let g_pendingAdd = null; // {address,name}

function toast(text, classes) {
  try {
    M.toast({ html: text, classes: classes || '' });
  } catch (e) {
    // fallback
    console.log(text);
  }
}

function sanitizeId(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 32);
}

function uniqueDeviceId(base, devices) {
  let id = sanitizeId(base);
  if (!id) id = 'device';
  const exists = (x) => devices.some(d => String(d.id || '').toLowerCase() === String(x).toLowerCase());
  if (!exists(id)) return id;
  let n = 2;
  while (exists(`${id}_${n}`) && n < 1000) n++;
  return `${id}_${n}`;
}

function parseDevicesJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return { devices: [], error: null };
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) {
      return { devices: [], error: 'Devices JSON must be an array' };
    }
    // Basic normalization
    const devices = v.map(d => ({
      id: d.id,
      name: d.name,
      address: d.address,
      connect: Boolean(d.connect),
      gatt: Array.isArray(d.gatt) ? d.gatt : []
    }));
    return { devices, error: null };
  } catch (e) {
    return { devices: [], error: e.message || String(e) };
  }
}

function writeDevicesJson(devices) {
  const txt = JSON.stringify(devices, null, 2);
  $('#devicesJson').val(txt);
  try { M.textareaAutoResize($('#devicesJson')); } catch { /* ignore */ }
  $('#devicesJson').trigger('change');
}

function renderConfiguredDevices() {
  const tbody = $('#configuredDevicesBody');
  tbody.empty();

  if (!g_configuredDevices.length) {
    tbody.append(`<tr><td colspan="5"><span class="small-help translate">No devices configured</span></td></tr>`);
    if (typeof window.translateAll === 'function') window.translateAll();
    return;
  }

  for (const dev of g_configuredDevices) {
    const id = String(dev.id || '');
    const name = String(dev.name || '');
    const address = String(dev.address || '');
    const connect = Boolean(dev.connect);

    const row = $(
      `<tr>
        <td class="mono">${escapeHtml(id)}</td>
        <td>${escapeHtml(name)}</td>
        <td class="mono">${escapeHtml(address)}</td>
        <td>${connect ? '<i class="material-icons">check</i>' : ''}</td>
        <td class="table-actions">
          <a class="btn-small red waves-effect" data-action="remove" data-id="${escapeAttr(id)}"><i class="material-icons">delete</i></a>
        </td>
      </tr>`
    );
    tbody.append(row);
  }

  tbody.find('a[data-action="remove"]').off('click').on('click', function () {
    const id = $(this).data('id');
    removeConfiguredDevice(id);
  });
}

function renderScanResults() {
  const tbody = $('#scanResultsBody');
  tbody.empty();

  if (!g_lastScanResults.length) {
    $('#scanEmptyHint').show();
    return;
  }
  $('#scanEmptyHint').hide();

  for (const d of g_lastScanResults) {
    const name = d.name || d.alias || '';
    const address = d.address || '';
    const rssi = (typeof d.rssi === 'number') ? d.rssi : '';
    const paired = Boolean(d.paired);
    const trusted = Boolean(d.trusted);

    const actions = [];
    actions.push(`<a class="btn-small waves-effect" data-action="pairTrust" data-address="${escapeAttr(address)}" title="Pair & Trust"><i class="material-icons">link</i></a>`);
    actions.push(`<a class="btn-small waves-effect" data-action="trust" data-address="${escapeAttr(address)}" title="Trust"><i class="material-icons">verified_user</i></a>`);
    actions.push(`<a class="btn-small waves-effect" data-action="add" data-name="${escapeAttr(name)}" data-address="${escapeAttr(address)}" title="Add"><i class="material-icons">add</i></a>`);
    actions.push(`<a class="btn-small waves-effect" data-action="pairAdd" data-name="${escapeAttr(name)}" data-address="${escapeAttr(address)}" title="Pair & Add"><i class="material-icons">playlist_add</i></a>`);
    actions.push(`<a class="btn-small red waves-effect" data-action="removeBluez" data-address="${escapeAttr(address)}" title="Remove"><i class="material-icons">delete</i></a>`);

    const row = $(
      `<tr>
        <td>${escapeHtml(name)}</td>
        <td class="mono">${escapeHtml(address)}</td>
        <td>${escapeHtml(String(rssi))}</td>
        <td>${paired ? '<i class="material-icons">check</i>' : ''}</td>
        <td>${trusted ? '<i class="material-icons">check</i>' : ''}</td>
        <td class="table-actions">${actions.join('')}</td>
      </tr>`
    );

    tbody.append(row);
  }

  tbody.find('a[data-action]').off('click').on('click', async function () {
    const action = $(this).data('action');
    const address = $(this).data('address');
    const name = $(this).data('name');

    if (!address) return;

    if (action === 'pairTrust') {
      await doPairTrust(address);
    } else if (action === 'trust') {
      await doTrust(address);
    } else if (action === 'add') {
      openAddModal({ address, name });
    } else if (action === 'pairAdd') {
      await doPairTrust(address);
      openAddModal({ address, name });
    } else if (action === 'removeBluez') {
      await doRemoveBluez(address);
    }
  });
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/\s/g, '&#032;');
}

function setScanBusy(busy, text) {
  if (busy) {
    $('#scanProgress').show();
    $('#btnScan').addClass('disabled');
    $('#btnListKnown').addClass('disabled');
  } else {
    $('#scanProgress').hide();
    $('#btnScan').removeClass('disabled');
    $('#btnListKnown').removeClass('disabled');
  }
  $('#scanStatus').text(text || '');
}

function sendCmd(command, message, timeoutMs) {
  timeoutMs = timeoutMs || 65000;
  return new Promise((resolve, reject) => {
    let done = false;
    const t = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error('Timeout'));
    }, timeoutMs);

    try {
      sendTo(null, command, message || {}, (resp) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve(resp);
      });
    } catch (e) {
      if (done) return;
      done = true;
      clearTimeout(t);
      reject(e);
    }
  });
}

async function doScan() {
  const durationSec = Math.max(1, parseInt($('#scanDurationSec').val() || '15', 10));
  const transport = $('#scanTransport').val() || 'le';

  setScanBusy(true, `Scanning ${durationSec}s...`);
  try {
    const resp = await sendCmd('scan', { durationSec, transport }, Math.max(20000, durationSec * 1000 + 20000));
    if (!resp || resp.ok !== true) throw new Error((resp && resp.error) || 'Scan failed');

    g_lastScanResults = Array.isArray(resp.result) ? resp.result : [];
    renderScanResults();
    toast(`Scan done: ${g_lastScanResults.length} device(s)`);
  } catch (e) {
    toast(`Scan error: ${e.message}`, 'red');
    console.error(e);
  } finally {
    setScanBusy(false, '');
  }
}

async function doListKnown() {
  setScanBusy(true, 'Loading...');
  try {
    const resp = await sendCmd('listKnown', {}, 20000);
    if (!resp || resp.ok !== true) throw new Error((resp && resp.error) || 'Failed');

    g_lastScanResults = Array.isArray(resp.result) ? resp.result : [];
    renderScanResults();
    toast(`Known devices: ${g_lastScanResults.length}`);
  } catch (e) {
    toast(`Error: ${e.message}`, 'red');
  } finally {
    setScanBusy(false, '');
  }
}

async function doPairTrust(address) {
  setScanBusy(true, `Pairing ${address}...`);
  try {
    const resp = await sendCmd('pairTrust', { address }, 70000);
    if (!resp || resp.ok !== true) throw new Error((resp && resp.error) || 'Pair/Trust failed');
    toast('Paired & trusted');
    await doListKnown();
  } catch (e) {
    toast(`Pair/Trust error: ${e.message}`, 'red');
  } finally {
    setScanBusy(false, '');
  }
}

async function doTrust(address) {
  setScanBusy(true, `Trusting ${address}...`);
  try {
    const resp = await sendCmd('trust', { address }, 25000);
    if (!resp || resp.ok !== true) throw new Error((resp && resp.error) || 'Trust failed');
    toast('Trusted');
    await doListKnown();
  } catch (e) {
    toast(`Trust error: ${e.message}`, 'red');
  } finally {
    setScanBusy(false, '');
  }
}

async function doRemoveBluez(address) {
  setScanBusy(true, `Removing ${address}...`);
  try {
    const resp = await sendCmd('removeDevice', { address }, 25000);
    if (!resp || resp.ok !== true) throw new Error((resp && resp.error) || 'Remove failed');
    toast(resp.result && resp.result.removed ? 'Removed' : 'Not removed');
    await doListKnown();
  } catch (e) {
    toast(`Remove error: ${e.message}`, 'red');
  } finally {
    setScanBusy(false, '');
  }
}

function removeConfiguredDevice(id) {
  const before = g_configuredDevices.length;
  g_configuredDevices = g_configuredDevices.filter(d => String(d.id) !== String(id));
  if (g_configuredDevices.length === before) return;

  writeDevicesJson(g_configuredDevices);
  renderConfiguredDevices();
  toast('Removed from config');

  if (typeof g_onChange === 'function') g_onChange();
}

function openAddModal({ address, name }) {
  const base = name ? name : address;
  const id = uniqueDeviceId(base, g_configuredDevices);

  g_pendingAdd = { address, name };

  $('#addDeviceId').val(id);
  $('#addDeviceName').val(name || address);
  $('#addDeviceAddress').val(address);
  $('#addDeviceAutoConnect').prop('checked', true);

  // Update labels
  M.updateTextFields();

  const modalElem = document.getElementById('modalAddDevice');
  const inst = M.Modal.getInstance(modalElem);
  inst.open();
}

function confirmAddModal() {
  if (!g_pendingAdd) return;

  const id = sanitizeId($('#addDeviceId').val());
  const name = String($('#addDeviceName').val() || '').trim();
  const address = String($('#addDeviceAddress').val() || '').trim();
  const connect = Boolean($('#addDeviceAutoConnect').prop('checked'));

  if (!id) {
    toast('ID is required', 'red');
    return;
  }
  if (!address) {
    toast('Address is required', 'red');
    return;
  }

  // Ensure unique id
  const fixedId = uniqueDeviceId(id, g_configuredDevices);

  g_configuredDevices.push({
    id: fixedId,
    name: name || address,
    address: address,
    connect: connect,
    gatt: []
  });

  writeDevicesJson(g_configuredDevices);
  renderConfiguredDevices();
  toast('Added to config');

  if (typeof g_onChange === 'function') g_onChange();

  g_pendingAdd = null;

  const modalElem = document.getElementById('modalAddDevice');
  const inst = M.Modal.getInstance(modalElem);
  inst.close();
}

function syncConfiguredDevicesFromTextarea() {
  const { devices, error } = parseDevicesJson($('#devicesJson').val());
  if (error) {
    // do not overwrite list; just show hint in console
    console.warn('Devices JSON parse error:', error);
    return;
  }
  g_configuredDevices = devices;
  renderConfiguredDevices();
}

function initUiHandlers() {
  $('#btnScan').on('click', (e) => {
    e.preventDefault();
    if ($('#btnScan').hasClass('disabled')) return;
    doScan();
  });

  $('#btnListKnown').on('click', (e) => {
    e.preventDefault();
    if ($('#btnListKnown').hasClass('disabled')) return;
    doListKnown();
  });

  $('#devicesJson').on('keyup change', function () {
    syncConfiguredDevicesFromTextarea();
  });

  $('#btnConfirmAddDevice').on('click', (e) => {
    e.preventDefault();
    confirmAddModal();
  });
}

// ioBroker will call this function
function load(settings, onChange) {
  g_onChange = onChange;

  // Defaults
  settings = settings || {};
  if (settings.adapter === undefined) settings.adapter = 'hci0';
  if (settings.scanOnStart === undefined) settings.scanOnStart = true;
  if (settings.scanDurationSec === undefined) settings.scanDurationSec = 15;
  if (settings.reconnectIntervalSec === undefined) settings.reconnectIntervalSec = 30;
  if (settings.devicesJson === undefined) settings.devicesJson = '[]';

  // Set values
  $('#adapter').val(settings.adapter);
  $('#scanDurationSec').val(settings.scanDurationSec);
  $('#scanOnStart').prop('checked', !!settings.scanOnStart);
  $('#reconnectIntervalSec').val(settings.reconnectIntervalSec);
  $('#devicesJson').val(settings.devicesJson);

  // Initialize materialize widgets
  try {
    M.Tabs.init(document.querySelectorAll('.tabs'));
    M.Collapsible.init(document.querySelectorAll('.collapsible'));
    M.Modal.init(document.querySelectorAll('.modal'));
    M.FormSelect.init(document.querySelectorAll('select'));
    M.updateTextFields();
    M.textareaAutoResize($('#devicesJson'));
  } catch (e) {
    console.warn(e);
  }

  // Change tracking
  $('.value').off('change keyup').on('change keyup', function () {
    if (typeof onChange === 'function') onChange();
  });

  // Parse and render configured devices
  const parsed = parseDevicesJson(settings.devicesJson);
  if (parsed.error) {
    toast(`Devices JSON error: ${parsed.error}`, 'red');
    g_configuredDevices = [];
  } else {
    g_configuredDevices = parsed.devices;
  }
  renderConfiguredDevices();
  renderScanResults();

  initUiHandlers();
}

// ioBroker will call this function
function save(callback) {
  // Ensure textarea -> list is in sync
  syncConfiguredDevicesFromTextarea();
  // Ensure devicesJson is properly formatted (pretty JSON)
  writeDevicesJson(g_configuredDevices);

  const obj = {};
  $('.value').each(function () {
    const $this = $(this);
    const id = this.id;
    if (!id) return;

    if ($this.attr('type') === 'checkbox') {
      obj[id] = $this.prop('checked');
    } else {
      obj[id] = $this.val();
    }
  });

  callback(obj);
}

// Make load/save global
window.load = load;
window.save = save;
