'use strict';

const { systemBus, Variant, DBusError } = require('dbus-next');
const { Interface, method } = require('dbus-next').interface;
const EventEmitter = require('node:events');

const BLUEZ_SERVICE = 'org.bluez';
const DBUS_PROPERTIES = 'org.freedesktop.DBus.Properties';
const DBUS_OBJECT_MANAGER = 'org.freedesktop.DBus.ObjectManager';

/**
 * @param {any} dict
 * @returns {Array<[string, any]>}
 */
function entries(dict) {
  if (!dict) return [];
  if (dict instanceof Map) return [...dict.entries()];
  return Object.entries(dict);
}

/**
 * @param {any} v
 * @returns {any}
 */
function unwrapVariant(v) {
  if (v && typeof v === 'object' && 'value' in v) return v.value;
  return v;
}

/**
 * Helper: create an empty a{sv} map.
 * BlueZ methods typically accept a{sv} options.
 */
function emptyOptionsMap() {
  return new Map();
}

/**
 * @typedef {Object} BlueZOptions
 * @property {string} adapter   Adapter name like "hci0" or object path.
 * @property {{debug: Function, info: Function, warn: Function, error: Function}} log
 */

class BlueZ extends EventEmitter {
  /**
   * @param {BlueZOptions} opts
   */
  constructor(opts) {
    super();
    this._log = opts.log;
    this._adapter = opts.adapter || 'hci0';

    this.bus = null;
    this.objectManager = null;

    this.adapterPath = null;
    this.adapterIface = null;
    this.adapterProps = null;

    this._discoveryActive = false;

    // Pairing agent
    this._agentPath = '/iobroker/bluetooth-rpi5/agent';
    this._agentRegistered = false;
  }

  async init() {
    this.bus = systemBus();

    const root = await this.bus.getProxyObject(BLUEZ_SERVICE, '/');
    this.objectManager = root.getInterface(DBUS_OBJECT_MANAGER);

    const managed = await this.objectManager.GetManagedObjects();
    this.adapterPath = this._resolveAdapterPath(managed, this._adapter);

    if (!this.adapterPath) {
      throw new Error(`BlueZ adapter not found: ${this._adapter}`);
    }

    const adapterObj = await this.bus.getProxyObject(BLUEZ_SERVICE, this.adapterPath);
    this.adapterIface = adapterObj.getInterface('org.bluez.Adapter1');
    this.adapterProps = adapterObj.getInterface(DBUS_PROPERTIES);

    this._log.info(`Using BlueZ adapter: ${this.adapterPath}`);
  }

  /**
   * @param {any} managed
   * @param {string} adapter
   */
  _resolveAdapterPath(managed, adapter) {
    if (!adapter) return null;
    const a = String(adapter).trim();

    // If full object path is provided
    if (a.startsWith('/org/bluez/')) {
      // Validate
      const iface = this._getInterfaceProps(managed, a, 'org.bluez.Adapter1');
      return iface ? a : null;
    }

    // Assume "hci0" -> "/org/bluez/hci0"
    const path = `/org/bluez/${a}`;
    const iface = this._getInterfaceProps(managed, path, 'org.bluez.Adapter1');
    return iface ? path : null;
  }

  /**
   * @param {any} managed
   * @param {string} path
   * @param {string} iface
   */
  _getInterfaceProps(managed, path, iface) {
    for (const [objPath, ifaces] of entries(managed)) {
      if (objPath !== path) continue;
      for (const [iname, props] of entries(ifaces)) {
        if (iname === iface) return props;
      }
    }
    return null;
  }

  /**
   * @returns {Promise<any>}
   */
  async getManagedObjects() {
    if (!this.objectManager) throw new Error('BlueZ not initialized');
    return this.objectManager.GetManagedObjects();
  }

  /**
   * Returns a list of known devices for the selected adapter.
   * @returns {Promise<Array<{path: string, address: string, name?: string, rssi?: number, connected?: boolean}>>}
   */
  async listDevices() {
    const managed = await this.getManagedObjects();
    const devices = [];
    for (const [path, ifaces] of entries(managed)) {
      if (!path.startsWith(`${this.adapterPath}/dev_`)) continue;
      for (const [iname, props] of entries(ifaces)) {
        if (iname !== 'org.bluez.Device1') continue;
        const address = unwrapVariant(props.Address);
        const name = unwrapVariant(props.Name) || unwrapVariant(props.Alias);
        const rssi = unwrapVariant(props.RSSI);
        const connected = unwrapVariant(props.Connected);
        const paired = unwrapVariant(props.Paired);
        const trusted = unwrapVariant(props.Trusted);
        devices.push({
          path,
          address,
          name,
          rssi: typeof rssi === 'number' ? rssi : undefined,
          connected: typeof connected === 'boolean' ? connected : undefined,
          paired: typeof paired === 'boolean' ? paired : Boolean(paired),
          trusted: typeof trusted === 'boolean' ? trusted : Boolean(trusted),
        });
      }
    }
    return devices;
  }

  /**
   * Returns detailed device info by address.
   * @param {string} address
   * @param {{timeoutMs?: number, scan?: boolean}} [opts]
   */
  async getDeviceInfo(address, opts = {}) {
    const timeoutMs = Number(opts.timeoutMs || 20000);
    const scan = opts.scan !== false;

    let path = await this.findDevicePath(address);
    if (!path && scan) {
      path = await this.waitForDevicePath(address, { timeoutMs, scan: true });
    }
    if (!path) throw new Error(`Device not found: ${address}`);

    const obj = await this.bus.getProxyObject(BLUEZ_SERVICE, path);
    const props = obj.getInterface(DBUS_PROPERTIES);
    const all = await props.GetAll('org.bluez.Device1');
    return {
      address: unwrapVariant(all.Address),
      name: unwrapVariant(all.Name) || unwrapVariant(all.Alias),
      alias: unwrapVariant(all.Alias),
      rssi: typeof unwrapVariant(all.RSSI) === 'number' ? unwrapVariant(all.RSSI) : undefined,
      connected: Boolean(unwrapVariant(all.Connected)),
      paired: Boolean(unwrapVariant(all.Paired)),
      trusted: Boolean(unwrapVariant(all.Trusted)),
      servicesResolved: Boolean(unwrapVariant(all.ServicesResolved)),
    };
  }

  /**
   * Pair device and optionally set Trusted.
   * Note: Works best for "Just Works" pairing. PIN/Passkey devices may require bluetoothctl.
   * @param {string} address
   * @param {{trust?: boolean, timeoutMs?: number}} [opts]
   */
  async pairDevice(address, opts = {}) {
    const timeoutMs = Number(opts.timeoutMs || 30000);
    const trust = opts.trust !== false;

    await this._ensureAgent();

    const path = await this.waitForDevicePath(address, { timeoutMs, scan: true });
    if (!path) throw new Error(`Device not found (discovery timeout): ${address}`);

    const obj = await this.bus.getProxyObject(BLUEZ_SERVICE, path);
    const devIface = obj.getInterface('org.bluez.Device1');
    const propsIface = obj.getInterface(DBUS_PROPERTIES);

    // Pair
    try {
      await devIface.Pair();
    } catch (e) {
      // Already paired
      if (!/AlreadyExists|already exists|Already Paired|already paired/i.test(String(e.message || ''))) {
        throw e;
      }
    }

    if (trust) {
      await propsIface.Set('org.bluez.Device1', 'Trusted', new Variant('b', true));
    }
  }

  /**
   * Trust/untrust a device.
   * @param {string} address
   * @param {boolean} trusted
   */
  async setTrusted(address, trusted) {
    const path = await this.findDevicePath(address);
    if (!path) throw new Error(`Device not found: ${address}`);
    const obj = await this.bus.getProxyObject(BLUEZ_SERVICE, path);
    const propsIface = obj.getInterface(DBUS_PROPERTIES);
    await propsIface.Set('org.bluez.Device1', 'Trusted', new Variant('b', Boolean(trusted)));
  }

  /**
   * Remove a device from the adapter (forgets it).
   * @param {string} address
   */
  async removeDevice(address) {
    if (!this.adapterIface) throw new Error('BlueZ not initialized');
    const path = await this.findDevicePath(address);
    if (!path) throw new Error(`Device not found: ${address}`);
    if (typeof this.adapterIface.RemoveDevice !== 'function') {
      throw new Error('BlueZ Adapter1.RemoveDevice not available');
    }
    await this.adapterIface.RemoveDevice(path);
  }

  async _ensureAgent() {
    if (!this.bus) throw new Error('BlueZ not initialized');
    if (this._agentRegistered) return;

    // Export an Agent1 object
    const agent = new BlueZAgent(this._log);
    this.bus.export(this._agentPath, agent);

    const bluezObj = await this.bus.getProxyObject(BLUEZ_SERVICE, '/org/bluez');
    const agentManager = bluezObj.getInterface('org.bluez.AgentManager1');

    try {
      await agentManager.RegisterAgent(this._agentPath, 'NoInputNoOutput');
    } catch (e) {
      // If already registered by another instance, keep going
      this._log.debug(`RegisterAgent failed (ignored): ${e.message}`);
    }

    try {
      await agentManager.RequestDefaultAgent(this._agentPath);
    } catch (e) {
      // Not fatal
      this._log.debug(`RequestDefaultAgent failed (ignored): ${e.message}`);
    }

    this._agentRegistered = true;
    this._log.info('BlueZ pairing agent registered (NoInputNoOutput)');
  }

  /**
   * Tries to find a device object path for a given MAC address.
   * @param {string} address
   * @returns {Promise<string|null>}
   */
  async findDevicePath(address) {
    const addr = String(address || '').trim().toUpperCase();
    if (!addr) return null;

    const managed = await this.getManagedObjects();
    for (const [path, ifaces] of entries(managed)) {
      if (!path.startsWith(`${this.adapterPath}/dev_`)) continue;
      for (const [iname, props] of entries(ifaces)) {
        if (iname !== 'org.bluez.Device1') continue;
        const a = String(unwrapVariant(props.Address) || '').toUpperCase();
        if (a === addr) return path;
      }
    }
    return null;
  }

  /**
   * Starts discovery. If durationSec is given, discovery will be stopped automatically.
   * @param {{durationSec?: number, transport?: 'le'|'bredr'|'auto'}} [opts]
   */
  async startDiscovery(opts = {}) {
    if (!this.adapterIface) throw new Error('BlueZ not initialized');
    if (this._discoveryActive) return;

    // Optional discovery filter
    try {
      if (typeof this.adapterIface.SetDiscoveryFilter === 'function') {
        const filter = new Map();
        if (opts.transport && opts.transport !== 'auto') {
          filter.set('Transport', new Variant('s', opts.transport));
        }
        // DuplicateData=false reduces noise
        filter.set('DuplicateData', new Variant('b', false));
        await this.adapterIface.SetDiscoveryFilter(filter);
      }
    } catch (e) {
      // Not fatal
      this._log.debug(`SetDiscoveryFilter failed (ignored): ${e.message}`);
    }

    await this.adapterIface.StartDiscovery();
    this._discoveryActive = true;
    this._log.info('Bluetooth discovery started');

    const duration = Number(opts.durationSec || 0);
    if (duration > 0) {
      setTimeout(() => {
        this.stopDiscovery().catch(() => undefined);
      }, duration * 1000).unref();
    }
  }

  async stopDiscovery() {
    if (!this.adapterIface) return;
    if (!this._discoveryActive) return;
    try {
      await this.adapterIface.StopDiscovery();
    } catch (e) {
      // ignore
    }
    this._discoveryActive = false;
    this._log.info('Bluetooth discovery stopped');
  }

  /**
   * Waits until a device is known by address (after discovery).
   * @param {string} address
   * @param {{timeoutMs?: number, scan?: boolean}} [opts]
   * @returns {Promise<string|null>} device object path
   */
  async waitForDevicePath(address, opts = {}) {
    const timeoutMs = Number(opts.timeoutMs || 30000);
    const scan = opts.scan !== false; // default true

    if (scan) {
      await this.startDiscovery({ durationSec: Math.ceil(timeoutMs / 1000), transport: 'le' });
    }

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const path = await this.findDevicePath(address);
      if (path) return path;
      await new Promise(r => setTimeout(r, 1000));
    }

    return null;
  }

  /**
   * Connects a device by address and returns a BlueZDevice instance.
   * @param {string} address
   * @param {{timeoutMs?: number}} [opts]
   */
  async connectDevice(address, opts = {}) {
    const timeoutMs = Number(opts.timeoutMs || 30000);
    const path = await this.waitForDevicePath(address, { timeoutMs, scan: true });
    if (!path) {
      throw new Error(`Device not found (discovery timeout): ${address}`);
    }

    const dev = new BlueZDevice({
      bus: this.bus,
      devicePath: path,
      log: this._log,
      getManagedObjects: () => this.getManagedObjects(),
    });

    await dev.init();
    await dev.connect({ timeoutMs });
    return dev;
  }

  async close() {
    try {
      await this.stopDiscovery();
    } catch {
      // ignore
    }

    if (this.bus) {
      try {
        this.bus.disconnect();
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Minimal BlueZ Agent1 implementation for "Just Works" pairing.
 * For devices requiring PIN/Passkey, pairing should be done via bluetoothctl.
 */
class BlueZAgent extends Interface {
  constructor(log) {
    super('org.bluez.Agent1');
    this._log = log;
  }

  Release() {
    this._log.debug('Agent1.Release');
  }

  RequestPinCode(device) {
    this._log.warn(`Agent1.RequestPinCode not supported for ${device}`);
    throw new DBusError('org.bluez.Error.Rejected', 'PIN code not supported');
  }

  DisplayPinCode(_device, _pincode) {
    // nothing
  }

  RequestPasskey(device) {
    this._log.warn(`Agent1.RequestPasskey not supported for ${device}`);
    throw new DBusError('org.bluez.Error.Rejected', 'Passkey not supported');
  }

  DisplayPasskey(_device, _passkey, _entered) {
    // nothing
  }

  RequestConfirmation(device, passkey) {
    this._log.info(`Agent1.RequestConfirmation ${device} passkey=${passkey} -> auto-accept`);
    // auto-accept
  }

  RequestAuthorization(device) {
    this._log.info(`Agent1.RequestAuthorization ${device} -> auto-accept`);
  }

  AuthorizeService(device, uuid) {
    this._log.info(`Agent1.AuthorizeService ${device} uuid=${uuid} -> auto-accept`);
  }

  Cancel() {
    this._log.debug('Agent1.Cancel');
  }
}

BlueZAgent.prototype.Release = method({ inSignature: '', outSignature: '' })(BlueZAgent.prototype.Release);
BlueZAgent.prototype.RequestPinCode = method({ inSignature: 'o', outSignature: 's' })(BlueZAgent.prototype.RequestPinCode);
BlueZAgent.prototype.DisplayPinCode = method({ inSignature: 'os', outSignature: '' })(BlueZAgent.prototype.DisplayPinCode);
BlueZAgent.prototype.RequestPasskey = method({ inSignature: 'o', outSignature: 'u' })(BlueZAgent.prototype.RequestPasskey);
BlueZAgent.prototype.DisplayPasskey = method({ inSignature: 'ouq', outSignature: '' })(BlueZAgent.prototype.DisplayPasskey);
BlueZAgent.prototype.RequestConfirmation = method({ inSignature: 'ou', outSignature: '' })(BlueZAgent.prototype.RequestConfirmation);
BlueZAgent.prototype.RequestAuthorization = method({ inSignature: 'o', outSignature: '' })(BlueZAgent.prototype.RequestAuthorization);
BlueZAgent.prototype.AuthorizeService = method({ inSignature: 'os', outSignature: '' })(BlueZAgent.prototype.AuthorizeService);
BlueZAgent.prototype.Cancel = method({ inSignature: '', outSignature: '' })(BlueZAgent.prototype.Cancel);

class BlueZDevice extends EventEmitter {
  /**
   * @param {{bus: any, devicePath: string, log: any, getManagedObjects: Function}} opts
   */
  constructor(opts) {
    super();
    this._log = opts.log;
    this.bus = opts.bus;
    this.devicePath = opts.devicePath;
    this._getManagedObjects = opts.getManagedObjects;

    this.deviceObj = null;
    this.deviceIface = null;
    this.deviceProps = null;

    /** @type {Map<string, {path: string, serviceUuid: string, charUuid: string}>} */
    this._charIndex = new Map();
    /** @type {Map<string, any>} */
    this._charPropsIfaces = new Map();

    this._connected = false;
    this._rssi = undefined;
  }

  async init() {
    this.deviceObj = await this.bus.getProxyObject(BLUEZ_SERVICE, this.devicePath);
    this.deviceIface = this.deviceObj.getInterface('org.bluez.Device1');
    this.deviceProps = this.deviceObj.getInterface(DBUS_PROPERTIES);

    // listen for connection / RSSI updates
    this.deviceProps.on('PropertiesChanged', (iface, changed, _invalidated) => {
      if (iface !== 'org.bluez.Device1') return;

      const get = (name) => {
        if (changed instanceof Map) return changed.get(name);
        return changed ? changed[name] : undefined;
      };

      const connectedV = get('Connected');
      if (connectedV !== undefined) {
        const val = Boolean(unwrapVariant(connectedV));
        this._connected = val;
        this.emit('connected', val);
      }

      const rssiV = get('RSSI');
      if (rssiV !== undefined) {
        const val = unwrapVariant(rssiV);
        if (typeof val === 'number') {
          this._rssi = val;
          this.emit('rssi', val);
        }
      }
    });

    // initial snapshot
    try {
      const all = await this.deviceProps.GetAll('org.bluez.Device1');
      this._connected = Boolean(unwrapVariant(all.Connected));
      const rssi = unwrapVariant(all.RSSI);
      if (typeof rssi === 'number') this._rssi = rssi;
    } catch {
      // ignore
    }
  }

  /**
   * @returns {Promise<{address?: string, name?: string, alias?: string, connected: boolean, rssi?: number, paired?: boolean, servicesResolved?: boolean}>}
   */
  async getInfo() {
    const all = await this.deviceProps.GetAll('org.bluez.Device1');
    return {
      address: unwrapVariant(all.Address),
      name: unwrapVariant(all.Name),
      alias: unwrapVariant(all.Alias),
      connected: Boolean(unwrapVariant(all.Connected)),
      rssi: typeof unwrapVariant(all.RSSI) === 'number' ? unwrapVariant(all.RSSI) : undefined,
      paired: Boolean(unwrapVariant(all.Paired)),
      servicesResolved: Boolean(unwrapVariant(all.ServicesResolved)),
    };
  }

  /**
   * @param {{timeoutMs?: number}} [opts]
   */
  async connect(opts = {}) {
    const timeoutMs = Number(opts.timeoutMs || 30000);

    try {
      await this.deviceIface.Connect();
    } catch (e) {
      // Already connected -> ignore
      if (!/AlreadyConnected|already connected/i.test(String(e.message || ''))) {
        throw e;
      }
    }

    // Wait until services are resolved
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const info = await this.getInfo();
      if (info.connected && info.servicesResolved) {
        this._connected = true;
        break;
      }
      await new Promise(r => setTimeout(r, 300));
    }

    await this.refreshGatt();
  }

  async disconnect() {
    try {
      await this.deviceIface.Disconnect();
    } catch {
      // ignore
    }
  }

  /**
   * Builds a lookup table for services/characteristics for this device.
   */
  async refreshGatt() {
    const managed = await this._getManagedObjects();

    /** @type {Map<string, string>} */
    const serviceUuidByPath = new Map();

    // 1) gather services
    for (const [path, ifaces] of entries(managed)) {
      if (!path.startsWith(`${this.devicePath}/`)) continue;
      for (const [iname, props] of entries(ifaces)) {
        if (iname !== 'org.bluez.GattService1') continue;
        const uuid = String(unwrapVariant(props.UUID) || '').toLowerCase();
        serviceUuidByPath.set(path, uuid);
      }
    }

    // 2) gather characteristics
    this._charIndex.clear();
    for (const [path, ifaces] of entries(managed)) {
      if (!path.startsWith(`${this.devicePath}/`)) continue;
      for (const [iname, props] of entries(ifaces)) {
        if (iname !== 'org.bluez.GattCharacteristic1') continue;
        const charUuid = String(unwrapVariant(props.UUID) || '').toLowerCase();
        const servicePath = String(unwrapVariant(props.Service) || '');
        const serviceUuid = String(serviceUuidByPath.get(servicePath) || '').toLowerCase();
        if (!charUuid || !serviceUuid) continue;

        const key = `${serviceUuid}/${charUuid}`;
        this._charIndex.set(key, { path, serviceUuid, charUuid });
      }
    }

    this._log.debug(`GATT refreshed for ${this.devicePath}: ${this._charIndex.size} characteristics indexed`);
  }

  /**
   * @param {string} serviceUuid normalized 128-bit uuid (lowercase)
   * @param {string} charUuid normalized 128-bit uuid (lowercase)
   */
  _charKey(serviceUuid, charUuid) {
    return `${String(serviceUuid).toLowerCase()}/${String(charUuid).toLowerCase()}`;
  }

  /**
   * Returns the object path for a characteristic.
   * @param {string} serviceUuid
   * @param {string} charUuid
   */
  getCharacteristicPath(serviceUuid, charUuid) {
    const key = this._charKey(serviceUuid, charUuid);
    const hit = this._charIndex.get(key);
    return hit ? hit.path : null;
  }

  /**
   * @param {string} serviceUuid
   * @param {string} charUuid
   * @returns {Promise<Buffer>}
   */
  async readCharacteristic(serviceUuid, charUuid) {
    const path = this.getCharacteristicPath(serviceUuid, charUuid);
    if (!path) throw new Error(`Characteristic not found: ${serviceUuid}/${charUuid}`);

    const obj = await this.bus.getProxyObject(BLUEZ_SERVICE, path);
    const iface = obj.getInterface('org.bluez.GattCharacteristic1');

    const valueArr = await iface.ReadValue(emptyOptionsMap());
    return Buffer.from(valueArr);
  }

  /**
   * @param {string} serviceUuid
   * @param {string} charUuid
   * @param {Buffer} buffer
   */
  async writeCharacteristic(serviceUuid, charUuid, buffer) {
    const path = this.getCharacteristicPath(serviceUuid, charUuid);
    if (!path) throw new Error(`Characteristic not found: ${serviceUuid}/${charUuid}`);

    const obj = await this.bus.getProxyObject(BLUEZ_SERVICE, path);
    const iface = obj.getInterface('org.bluez.GattCharacteristic1');

    const arr = Array.from(buffer);
    await iface.WriteValue(arr, emptyOptionsMap());
  }

  /**
   * Starts notifications for a characteristic and emits "notify" events.
   * @param {string} serviceUuid
   * @param {string} charUuid
   */
  async startNotify(serviceUuid, charUuid) {
    const path = this.getCharacteristicPath(serviceUuid, charUuid);
    if (!path) throw new Error(`Characteristic not found: ${serviceUuid}/${charUuid}`);

    const obj = await this.bus.getProxyObject(BLUEZ_SERVICE, path);
    const charIface = obj.getInterface('org.bluez.GattCharacteristic1');
    const propsIface = obj.getInterface(DBUS_PROPERTIES);

    // Only attach once per characteristic
    if (!this._charPropsIfaces.has(path)) {
      propsIface.on('PropertiesChanged', (iface, changed, _invalidated) => {
        if (iface !== 'org.bluez.GattCharacteristic1') return;

        const get = (name) => {
          if (changed instanceof Map) return changed.get(name);
          return changed ? changed[name] : undefined;
        };

        const valV = get('Value');
        if (valV !== undefined) {
          const arr = unwrapVariant(valV);
          if (arr) {
            const buf = Buffer.from(arr);
            this.emit('notify', { serviceUuid, charUuid, value: buf });
          }
        }
      });
      this._charPropsIfaces.set(path, propsIface);
    }

    await charIface.StartNotify();
  }
}

module.exports = {
  BlueZ,
  BlueZDevice,
};
