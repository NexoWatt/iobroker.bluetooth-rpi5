/*global systemDictionary */
'use strict';

systemDictionary = {
  "title": {"en": "Bluetooth (BLE) - Raspberry Pi 5", "de": "Bluetooth (BLE) - Raspberry Pi 5"},
  "subtitle": {
    "en": "Scan, pair/trust and manage multiple BLE devices via BlueZ (D-Bus).", 
    "de": "Scannen, koppeln/vertrauen und mehrere BLE-Geräte verwalten (BlueZ D-Bus)."
  },

  "tab_general": {"en": "General", "de": "Allgemein"},
  "tab_devices": {"en": "Devices", "de": "Geräte"},

  "general_settings": {"en": "General settings", "de": "Allgemeine Einstellungen"},
  "bluetooth_adapter_select": {"en": "Bluetooth adapter", "de": "Bluetooth-Adapter"},
  "adapter_hint": {
    "en": "Select the installed Bluetooth controller (e.g. hci0). No manual typing required.",
    "de": "Wählen Sie den installierten Bluetooth-Controller (z. B. hci0). Keine manuelle Eingabe nötig."
  },
  "refresh": {"en": "Refresh", "de": "Aktualisieren"},

  "scan_on_start": {"en": "Scan on start", "de": "Beim Start scannen"},
  "scan_duration": {"en": "Scan duration (seconds)", "de": "Scan-Dauer (Sekunden)"},
  "reconnect_interval": {"en": "Reconnect interval (seconds)", "de": "Wiederverbindungsintervall (Sekunden)"},
  "polkit_hint": {
    "en": "If scan/pair actions fail with \"Not authorized\", you likely need a Polkit rule to allow the ioBroker user/group to access BlueZ D-Bus.",
    "de": "Wenn Scan-/Koppel-Aktionen mit \"Nicht autorisiert\" fehlschlagen, benötigen Sie vermutlich eine Polkit-Regel, damit der ioBroker-Benutzer/die Gruppe auf den BlueZ D-Bus zugreifen darf."
  },

  "device_discovery": {"en": "Device discovery", "de": "Geräte suchen"},
  "transport": {"en": "Transport", "de": "Transport"},
  "filter": {"en": "Filter (name / MAC)", "de": "Filter (Name / MAC)"},
  "scan": {"en": "Scan", "de": "Scannen"},
  "scan_hint": {
    "en": "Like on a smartphone: click Scan, choose a device from the list, and it will be paired/trusted automatically when possible.",
    "de": "Wie beim Smartphone: Scannen klicken, Gerät aus der Liste wählen – Kopplung/Vertrauen erfolgt automatisch, sofern möglich."
  },
  "warn_pairing": {
    "en": "For devices requiring PIN/Passkey, pairing may need bluetoothctl.",
    "de": "Bei Geräten mit PIN/Passkey kann die Kopplung bluetoothctl erfordern."
  },

  "configured_devices": {"en": "Configured devices", "de": "Konfigurierte Geräte"},
  "configured_hint": {
    "en": "Devices are added from the scan list. No manual MAC entry required.",
    "de": "Geräte werden aus der Scan-Liste hinzugefügt. Keine manuelle MAC-Eingabe nötig."
  },

  "id": {"en": "ID", "de": "ID"},
  "name": {"en": "Name", "de": "Name"},
  "address": {"en": "Address", "de": "Adresse"},
  "rssi": {"en": "RSSI", "de": "RSSI"},
  "status": {"en": "Status", "de": "Status"},
  "actions": {"en": "Actions", "de": "Aktionen"},
  "add": {"en": "Add", "de": "Hinzufügen"},
  "connect": {"en": "Auto", "de": "Auto"},
  "remove": {"en": "Remove", "de": "Entfernen"}
};
