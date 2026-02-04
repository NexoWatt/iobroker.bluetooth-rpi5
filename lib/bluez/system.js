'use strict';

const { systemBus } = require('dbus-next');

const BLUEZ_SERVICE = 'org.bluez';
const DBUS_OBJECT_MANAGER = 'org.freedesktop.DBus.ObjectManager';

function unwrapVariant(v) {
  if (v && typeof v === 'object' && 'value' in v) return v.value;
  return v;
}

/**
 * List available BlueZ adapters (hci0, hci1, ...). This works without creating a full BlueZ instance.
 * @param {{log?: {debug?:Function, info?:Function, warn?:Function, error?:Function}}} [opts]
 */
async function listAdapters(opts = {}) {
  const log = opts.log || console;
  const bus = systemBus();
  try {
    const root = await bus.getProxyObject(BLUEZ_SERVICE, '/');
    const objectManager = root.getInterface(DBUS_OBJECT_MANAGER);
    const managed = await objectManager.GetManagedObjects();

    const adapters = [];
    const entries = managed instanceof Map ? managed.entries() : Object.entries(managed);
    for (const [path, ifaces] of entries) {
      const ifMap = ifaces instanceof Map ? ifaces : new Map(Object.entries(ifaces || {}));
      if (!ifMap.has('org.bluez.Adapter1')) continue;

      const props = ifMap.get('org.bluez.Adapter1');
      const pMap = props instanceof Map ? props : new Map(Object.entries(props || {}));

      const id = String(path).split('/').pop(); // hci0
      adapters.push({
        id,
        path,
        address: unwrapVariant(pMap.get('Address')),
        name: unwrapVariant(pMap.get('Name')),
        alias: unwrapVariant(pMap.get('Alias')),
        powered: Boolean(unwrapVariant(pMap.get('Powered'))),
        discovering: Boolean(unwrapVariant(pMap.get('Discovering'))),
        discoverable: Boolean(unwrapVariant(pMap.get('Discoverable'))),
      });
    }

    adapters.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    return adapters;
  } catch (e) {
    log && log.debug && log.debug(`listAdapters failed: ${e.message}`);
    throw e;
  } finally {
    try {
      bus.disconnect();
    } catch {
      // ignore
    }
  }
}

module.exports = { listAdapters };
