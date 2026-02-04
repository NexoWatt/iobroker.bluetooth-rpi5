/*global systemDictionary */
'use strict';

systemDictionary = {
  "bluetooth_adapter": {"en": "Bluetooth adapter (e.g. hci0)", "de": "Bluetooth-Adapter (z.B. hci0)"},
  "scan_on_start": {"en": "Scan on start", "de": "Beim Start scannen"},
  "scan_duration": {"en": "Scan duration (seconds)", "de": "Scan-Dauer (Sekunden)"},
  "reconnect_interval": {"en": "Reconnect interval (seconds)", "de": "Reconnect-Intervall (Sekunden)"},

  "tab_general": {"en": "General", "de": "Allgemein"},
  "tab_devices": {"en": "Devices", "de": "Geräte"},

  "device_discovery": {"en": "Device discovery", "de": "Geräte suchen"},
  "scan": {"en": "Scan", "de": "Scannen"},
  "scan_hint": {"en": "Scans via BlueZ on the ioBroker host.", "de": "Scan über BlueZ auf dem ioBroker-Host."},
  "scan_results": {"en": "Scan results", "de": "Scan-Ergebnisse"},
  "rssi": {"en": "RSSI", "de": "RSSI"},
  "paired": {"en": "Paired", "de": "Gekoppelt"},
  "trusted": {"en": "Trusted", "de": "Vertraut"},
  "actions": {"en": "Actions", "de": "Aktionen"},
  "pair": {"en": "Pair", "de": "Koppeln"},
  "pair_trust": {"en": "Pair & trust", "de": "Koppeln & vertrauen"},
  "add": {"en": "Add", "de": "Hinzufügen"},
  "pair_add": {"en": "Pair & add", "de": "Koppeln & hinzufügen"},

  "configured_devices": {"en": "Configured devices", "de": "Konfigurierte Geräte"},
  "id": {"en": "ID", "de": "ID"},
  "name": {"en": "Name", "de": "Name"},
  "address": {"en": "Address", "de": "Adresse"},
  "connect": {"en": "Auto connect", "de": "Automatisch verbinden"},
  "remove": {"en": "Remove", "de": "Entfernen"},

  "advanced_json": {"en": "Advanced: devices JSON", "de": "Erweitert: Geräte-JSON"},
  "devices_json_help": {
    "en": "You can edit the raw JSON. The table above updates it automatically.",
    "de": "Du kannst das rohe JSON bearbeiten. Die Tabelle oben aktualisiert es automatisch."
  },

  "warn_pairing": {
    "en": "Pairing works best for 'Just Works' devices. If a PIN/passkey is required, use bluetoothctl.",
    "de": "Pairing klappt am besten bei 'Just Works' Geräten. Wenn PIN/Passkey nötig ist, nutze bluetoothctl."
  }
};
