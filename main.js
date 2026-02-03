'use strict';

const utils = require('@iobroker/adapter-core');

const { BlueZ } = require('./lib/bluez/BlueZ');
const { parseDevicesConfig } = require('./lib/config');
const { decodeValue, encodeValue, inferIoBrokerType } = require('./lib/format');

class BluetoothRpi5 extends utils.Adapter {
  constructor(options = {}) {
    super({
      ...options,
      name: 'bluetooth-rpi5',
    });

    this.on('ready', this.onReady.bind(this));
    this.on('stateChange', this.onStateChange.bind(this));
    this.on('unload', this.onUnload.bind(this));

    /** @type {BlueZ|null} */
    this.bluez = null;

    /** @type {Map<string, any>} */
    this.devices = new Map();

    /** @type {Map<string, {deviceId: string, mapping: any}>} */
    this.writeMap = new Map();

    /** @type {Set<NodeJS.Timeout>} */
    this.timers = new Set();
  }

  async onReady() {
    // Clean start
    this.setState('info.connection', false, true);

    // Adapter-level objects
    await this._ensureAdapterObjects();

    // Subscriptions
    this.subscribeStates('commands.*');
    this.subscribeStates('devices.*');

    // Parse devices config
    const deviceConfigs = parseDevicesConfig(this.config.devicesJson, this.log);
    if (deviceConfigs.length === 0) {
      this.log.warn('No devices configured (devicesJson is empty or invalid). You can still use commands.scan to discover devices.');
    }

    // Create ioBroker objects for configured devices
    for (const dev of deviceConfigs) {
      await this._ensureDeviceObjects(dev);
      this.devices.set(dev.id, {
        config: dev,
        bluezDevice: null,
        pollingTimers: [],
        mappingByKey: new Map(),
      });
    }

    // Init BlueZ
    try {
      this.bluez = new BlueZ({
        adapter: this.config.adapter || 'hci0',
        log: this.log,
      });
      await this.bluez.init();
      this.setState('info.connection', true, true);
    } catch (e) {
      this.log.error(`BlueZ init failed: ${e.message}`);
      this.log.error('Hint: Make sure BlueZ is installed and the ioBroker user has permissions (group "bluetooth").');
      return;
    }

    // Optional scan on start
    if (this.config.scanOnStart) {
      await this._performScan();
    }

    // Auto-connect configured devices
    for (const [deviceId, ctx] of this.devices) {
      if (ctx.config.connect) {
        this._scheduleConnect(deviceId, 0);
      }
    }
  }

  async _ensureAdapterObjects() {
    // Commands
    await this.setObjectNotExistsAsync('commands', {
      type: 'channel',
      common: { name: 'Commands' },
      native: {},
    });

    await this.setObjectNotExistsAsync('commands.scan', {
      type: 'state',
      common: {
        name: 'Start BLE scan',
        type: 'boolean',
        role: 'button',
        read: true,
        write: true,
        def: false,
      },
      native: {},
    });

    // Info
    await this.setObjectNotExistsAsync('info.scanResults', {
      type: 'state',
      common: {
        name: 'Scan results (JSON)',
        type: 'string',
        role: 'json',
        read: true,
        write: false,
        def: '[]',
      },
      native: {},
    });

    await this.setObjectNotExistsAsync('info.lastScan', {
      type: 'state',
      common: {
        name: 'Last scan timestamp (ISO)',
        type: 'string',
        role: 'date',
        read: true,
        write: false,
        def: '',
      },
      native: {},
    });
  }

  async _ensureDeviceObjects(dev) {
    const base = `devices.${dev.id}`;

    await this.setObjectNotExistsAsync('devices', {
      type: 'channel',
      common: { name: 'Devices' },
      native: {},
    });

    await this.setObjectNotExistsAsync(base, {
      type: 'channel',
      common: { name: dev.name },
      native: { address: dev.address },
    });

    await this.setObjectNotExistsAsync(`${base}.info`, {
      type: 'channel',
      common: { name: 'Info' },
      native: {},
    });

    await this.setObjectNotExistsAsync(`${base}.info.address`, {
      type: 'state',
      common: {
        name: 'MAC address',
        type: 'string',
        role: 'info.address',
        read: true,
        write: false,
      },
      native: {},
    });

    await this.setObjectNotExistsAsync(`${base}.info.name`, {
      type: 'state',
      common: {
        name: 'Name',
        type: 'string',
        role: 'info.name',
        read: true,
        write: false,
      },
      native: {},
    });

    await this.setObjectNotExistsAsync(`${base}.info.connected`, {
      type: 'state',
      common: {
        name: 'Connected',
        type: 'boolean',
        role: 'indicator.connected',
        read: true,
        write: false,
        def: false,
      },
      native: {},
    });

    await this.setObjectNotExistsAsync(`${base}.info.rssi`, {
      type: 'state',
      common: {
        name: 'RSSI (dBm)',
        type: 'number',
        role: 'value.rssi',
        read: true,
        write: false,
      },
      native: {},
    });

    await this.setObjectNotExistsAsync(`${base}.info.lastSeen`, {
      type: 'state',
      common: {
        name: 'Last seen (ISO)',
        type: 'string',
        role: 'date',
        read: true,
        write: false,
      },
      native: {},
    });

    await this.setStateAsync(`${base}.info.address`, dev.address, true);
    await this.setStateAsync(`${base}.info.name`, dev.name, true);

    // GATT channel
    await this.setObjectNotExistsAsync(`${base}.gatt`, {
      type: 'channel',
      common: { name: 'GATT' },
      native: {},
    });

    // Create gatt mapping states
    for (const mapping of dev.gatt || []) {
      const stateId = `${base}.gatt.${mapping.state}`;
      const typeInfo = inferIoBrokerType(mapping.format);

      await this.setObjectNotExistsAsync(stateId, {
        type: 'state',
        common: {
          name: mapping.state,
          type: typeInfo.type,
          role: typeInfo.role,
          read: true,
          write: mapping.mode === 'rw',
        },
        native: {
          service: mapping.service,
          characteristic: mapping.characteristic,
          format: mapping.format,
          mode: mapping.mode,
          poll: mapping.poll,
          notify: mapping.notify,
        },
      });

      // Remember which states are writeable
      if (mapping.mode === 'rw') {
        const fullId = `${this.namespace}.${stateId}`;
        this.writeMap.set(fullId, { deviceId: dev.id, mapping });
      }
    }
  }

  _scheduleConnect(deviceId, delayMs) {
    const timer = setTimeout(() => {
      this._connectDevice(deviceId).catch(e => {
        this.log.warn(`[${deviceId}] connect cycle failed: ${e.message}`);
      });
    }, delayMs);
    timer.unref();
    this.timers.add(timer);
  }

  async _connectDevice(deviceId) {
    if (!this.bluez) return;
    const ctx = this.devices.get(deviceId);
    if (!ctx) return;

    // Clear previous polling timers (if any)
    for (const t of ctx.pollingTimers) {
      clearInterval(t);
    }
    ctx.pollingTimers = [];
    ctx.mappingByKey = new Map();

    const address = ctx.config.address;
    this.log.info(`[${deviceId}] Connecting to ${address} ...`);

    try {
      const dev = await this.bluez.connectDevice(address, { timeoutMs: 30000 });
      ctx.bluezDevice = dev;

      // Update basic device info
      const info = await dev.getInfo();
      await this.setStateAsync(`devices.${deviceId}.info.connected`, Boolean(info.connected), true);
      if (typeof info.rssi === 'number') {
        await this.setStateAsync(`devices.${deviceId}.info.rssi`, info.rssi, true);
      }
      await this.setStateAsync(`devices.${deviceId}.info.lastSeen`, new Date().toISOString(), true);

      // Events
      dev.on('connected', async (connected) => {
        await this.setStateAsync(`devices.${deviceId}.info.connected`, Boolean(connected), true);
        await this.setStateAsync(`devices.${deviceId}.info.lastSeen`, new Date().toISOString(), true);

        if (!connected) {
          this.log.warn(`[${deviceId}] Disconnected -> scheduling reconnect`);
          this._scheduleConnect(deviceId, Math.max(5, Number(this.config.reconnectIntervalSec || 30)) * 1000);
        }
      });

      dev.on('rssi', async (rssi) => {
        await this.setStateAsync(`devices.${deviceId}.info.rssi`, rssi, true);
        await this.setStateAsync(`devices.${deviceId}.info.lastSeen`, new Date().toISOString(), true);
      });

      dev.on('notify', async ({ serviceUuid, charUuid, value }) => {
        const key = `${String(serviceUuid).toLowerCase()}/${String(charUuid).toLowerCase()}`;
        const mapping = ctx.mappingByKey.get(key);
        if (!mapping) return;

        const decoded = decodeValue(mapping.format, value);
        await this.setStateAsync(`devices.${deviceId}.gatt.${mapping.state}`, decoded, true);
        await this.setStateAsync(`devices.${deviceId}.info.lastSeen`, new Date().toISOString(), true);
      });

      // Build mapping index and setup polling/notify
      for (const mapping of ctx.config.gatt || []) {
        const key = `${String(mapping.service).toLowerCase()}/${String(mapping.characteristic).toLowerCase()}`;
        ctx.mappingByKey.set(key, mapping);

        // Initial read
        await this._readAndUpdate(deviceId, mapping).catch(e => {
          this.log.debug(`[${deviceId}] initial read failed (${mapping.state}): ${e.message}`);
        });

        // Notifications
        if (mapping.notify) {
          try {
            await dev.startNotify(mapping.service, mapping.characteristic);
            this.log.info(`[${deviceId}] Notifications enabled for ${mapping.state}`);
          } catch (e) {
            this.log.warn(`[${deviceId}] StartNotify failed for ${mapping.state}: ${e.message}`);
          }
        }

        // Polling
        const poll = Number(mapping.poll || 0);
        if (poll > 0) {
          const t = setInterval(() => {
            this._readAndUpdate(deviceId, mapping).catch(e => {
              this.log.debug(`[${deviceId}] poll read failed (${mapping.state}): ${e.message}`);
            });
          }, poll * 1000);
          t.unref();
          ctx.pollingTimers.push(t);
        }
      }

      this.log.info(`[${deviceId}] Connected and ready (${ctx.config.gatt?.length || 0} mappings)`);
    } catch (e) {
      ctx.bluezDevice = null;
      await this.setStateAsync(`devices.${deviceId}.info.connected`, false, true);
      this.log.warn(`[${deviceId}] Connect failed: ${e.message}`);

      // Retry
      this._scheduleConnect(deviceId, Math.max(5, Number(this.config.reconnectIntervalSec || 30)) * 1000);
    }
  }

  async _readAndUpdate(deviceId, mapping) {
    const ctx = this.devices.get(deviceId);
    if (!ctx || !ctx.bluezDevice) return;

    const buf = await ctx.bluezDevice.readCharacteristic(mapping.service, mapping.characteristic);
    const decoded = decodeValue(mapping.format, buf);

    await this.setStateAsync(`devices.${deviceId}.gatt.${mapping.state}`, decoded, true);
    await this.setStateAsync(`devices.${deviceId}.info.lastSeen`, new Date().toISOString(), true);
  }

  async _performScan() {
    if (!this.bluez) return;

    const duration = Math.max(1, Number(this.config.scanDurationSec || 15));
    this.log.info(`Scanning for BLE devices for ${duration}s ...`);

    try {
      await this.bluez.startDiscovery({ durationSec: duration, transport: 'le' });
      await new Promise(r => setTimeout(r, duration * 1000));
      await this.bluez.stopDiscovery();
    } catch (e) {
      this.log.warn(`Scan error: ${e.message}`);
    }

    const devices = await this.bluez.listDevices();
    const compact = devices
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
      .map(d => ({
        address: d.address,
        name: d.name,
        rssi: d.rssi,
        connected: d.connected,
      }));

    await this.setStateAsync('info.scanResults', JSON.stringify(compact, null, 2), true);
    await this.setStateAsync('info.lastScan', new Date().toISOString(), true);

    this.log.info(`Scan complete: ${compact.length} device(s)`);
  }

  async onStateChange(id, state) {
    if (!state) return;

    // Handle commands
    if (id === `${this.namespace}.commands.scan`) {
      if (!state.ack && state.val === true) {
        await this._performScan();
        // reset button
        await this.setStateAsync('commands.scan', false, true);
      }
      return;
    }

    // Ignore acknowledged updates
    if (state.ack) return;

    // Handle writes to mapped GATT states
    const write = this.writeMap.get(id);
    if (!write) return;

    const ctx = this.devices.get(write.deviceId);
    if (!ctx) return;

    const mapping = write.mapping;

    if (!ctx.bluezDevice) {
      this.log.warn(`[${write.deviceId}] Write requested but device not connected -> scheduling connect`);
      this._scheduleConnect(write.deviceId, 0);
      return;
    }

    try {
      const buf = encodeValue(mapping.format, state.val);
      await ctx.bluezDevice.writeCharacteristic(mapping.service, mapping.characteristic, buf);

      // Ack the state
      await this.setStateAsync(id.replace(`${this.namespace}.`, ''), state.val, true);

      // Optionally read back
      await this._readAndUpdate(write.deviceId, mapping).catch(() => undefined);
    } catch (e) {
      this.log.error(`[${write.deviceId}] Write failed for ${mapping.state}: ${e.message}`);
    }
  }

  async onUnload(callback) {
    try {
      // Clear global timers
      for (const t of this.timers) {
        clearTimeout(t);
      }
      this.timers.clear();

      // Stop device polling and disconnect
      for (const [deviceId, ctx] of this.devices) {
        for (const t of ctx.pollingTimers || []) {
          clearInterval(t);
        }
        ctx.pollingTimers = [];

        if (ctx.bluezDevice) {
          try {
            await ctx.bluezDevice.disconnect();
          } catch {
            // ignore
          }
        }
        await this.setStateAsync(`devices.${deviceId}.info.connected`, false, true).catch(() => undefined);
      }

      if (this.bluez) {
        await this.bluez.close();
      }
    } catch {
      // ignore
    } finally {
      callback();
    }
  }
}

// If started as module, return factory
if (module.parent) {
  module.exports = (options) => new BluetoothRpi5(options);
} else {
  // Otherwise start directly
  new BluetoothRpi5();
}
