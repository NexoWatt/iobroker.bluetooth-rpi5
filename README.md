# ioBroker Adapter: bluetooth-rpi5 (BLE)

Ein **generischer Bluetooth Low Energy (BLE) Adapter** für **ioBroker** auf dem **Raspberry Pi 5**.
Er nutzt den eingebauten Bluetooth-Controller über **BlueZ (D-Bus)** und kann **mehrere Geräte** gleichzeitig verwalten.

> ⚠️ Fokus: **BLE / GATT** (z. B. Sensoren, Thermometer, Lampen, Schalter).  
> Classic Bluetooth / SPP (serielle Geräte) ist in dieser Version **nicht** abgedeckt.

## ✨ Features

- 🧭 **Admin-UI Gerätemanager**: Scan, Pair/Trust, Gerät zur Konfiguration hinzufügen
- 🔎 **Scan / Discovery** (BLE) optional über `commands.scan`
- 🔌 **Multi-Device**: mehrere Geräte per MAC-Adresse
- 📟 **RSSI / connected / lastSeen** pro Gerät
- 📥 **Read** von GATT Characteristics (Polling)
- 📤 **Write** in GATT Characteristics (ioBroker-State schreiben)
- 🔔 **Notifications** (StartNotify) falls vom Gerät unterstützt

## ✅ Voraussetzungen

- Raspberry Pi OS / Debian mit BlueZ:
  ```bash
  sudo apt update
  sudo apt install -y bluez
  sudo systemctl enable --now bluetooth
  ```
- ioBroker Benutzer muss Zugriff auf Bluetooth bekommen:
  ```bash
  sudo usermod -aG bluetooth iobroker
  sudo reboot
  ```

## 📦 Installation (aus GitHub)

1. Dieses Repo als eigenes GitHub-Repository anlegen (Code pushen).
2. Auf dem ioBroker Host installieren (Beispiel):
   ```bash
   cd /opt/iobroker
   iobroker stop
   iobroker install https://github.com/<DEIN_USER>/<DEIN_REPO>/archive/refs/heads/main.zip
   iobroker start
   ```

> Alternativ kannst du auch erst lokal als ZIP installieren und danach per GitHub verwalten.

## ⚙️ Konfiguration

In den Instanz-Einstellungen gibt es ein Feld **Devices JSON**. Dort trägst du ein JSON-Array ein.

### Beispiel `devicesJson`

```json
[
  {
    "id": "lamp1",
    "name": "Wohnzimmer Lampe",
    "address": "AA:BB:CC:DD:EE:FF",
    "connect": true,
    "gatt": [
      {
        "state": "power",
        "service": "ff10",
        "characteristic": "ff11",
        "mode": "rw",
        "format": "bool",
        "notify": true,
        "poll": 0
      },
      {
        "state": "brightness",
        "service": "ff10",
        "characteristic": "ff12",
        "mode": "rw",
        "format": "uint8",
        "notify": true,
        "poll": 0
      },
      {
        "state": "temperature",
        "service": "1809",
        "characteristic": "2a1c",
        "mode": "ro",
        "format": "int16le",
        "notify": false,
        "poll": 30
      }
    ]
  }
]
```

### Bedeutung der Felder

- `id`: eindeutige ID (wird Teil des ioBroker Objektpfads)
- `name`: Anzeigename
- `address`: Bluetooth MAC-Adresse
- `connect`: `true` → beim Start verbinden (mit Reconnect)

Pro GATT-Mapping:
- `state`: Name des ioBroker States (unter `devices.<id>.gatt.<state>`)
- `service`: Service UUID (16/32/128-bit; z. B. `1809` oder `00001809-0000-1000-8000-00805f9b34fb`)
- `characteristic`: Characteristic UUID
- `mode`: `ro` oder `rw`
- `format`: wie Werte kodiert werden (siehe Liste unten)
- `poll`: Polling-Intervall in Sekunden (`0` = aus)
- `notify`: `true` → `StartNotify()` versuchen

## 🧩 Unterstützte `format` Werte

- `utf8` / `string`
- `hex` (wird als „spaced hex“ dargestellt, z. B. `0a ff 10`)
- `base64`
- `bool`
- `uint8`, `int8`
- `uint16le`, `int16le`, `uint16be`, `int16be`
- `uint32le`, `int32le`, `uint32be`, `int32be`
- `floatle`, `floatbe`
- `doublele`, `doublebe`


## 🧭 Admin-UI: Geräte suchen & hinzufügen (kundenfreundlich)

In den Instanz-Einstellungen gibt es den Tab **Devices / Geräte**:

1. **Scan** → zeigt gefundene Geräte (Name, MAC, RSSI, Paired, Trusted)
2. Optional **Pair & Trust** (für stabile Verbindungen)
3. **Add** → Gerät wird automatisch ins **Devices JSON** übernommen

> Hinweis: Manche Geräte benötigen PIN/Passkey. In dem Fall kann Pairing ohne Agent fehlschlagen – dann bitte einmal per `bluetoothctl` koppeln und danach im Admin auf **Show known** klicken.


## 🔎 Geräte finden

1. **Empfohlen:** Admin → Instanz → Tab **Geräte** → **Scan**.
2. Alternativ: `bluetooth-rpi5.0.commands.scan` einmal auf **true** setzen.
3. Die Ergebnisse stehen in `bluetooth-rpi5.0.info.scanResults` (JSON).

Damit bekommst du MAC-Adresse + Name + RSSI.

## 🧠 GATT UUIDs herausfinden

Je nach Gerät brauchst du Service- und Characteristic-UUIDs. Praktische Tools:

- `bluetoothctl` (scan, connect, gatt menu)
- Smartphone Apps wie *nRF Connect* (zeigt Services/Characteristics sehr komfortabel)

## 🧯 Troubleshooting

- **BlueZ init failed / keine Berechtigung:**
  - Prüfe, ob `bluetooth` läuft: `systemctl status bluetooth`
  - Prüfe Gruppenmitgliedschaft: `groups iobroker`
- **Gerät wird nicht gefunden:**
  - `commands.scan` ausführen
  - Gerät in Pairing/Advertising Mode versetzen
- **StartNotify klappt nicht:**
  - nicht jede Characteristic unterstützt Notify (Flags)
  - nutze `poll` als Fallback

## 🗺️ Roadmap / Erweiterungen

- Pairing/Trust Management
- Optional Classic Bluetooth / RFCOMM
- UI-Assistent zum Import von GATT-Services

## Lizenz

MIT (siehe LICENSE)


### 🔐 Polkit / NotAuthorized

Wenn Scan/Pair/Trust im Log mit `NotAuthorized` / `AccessDenied` fehlschlägt, fehlt meist eine polkit-Regel für BlueZ.
Beispiel (erlaubt BlueZ D-Bus Aktionen für Nutzer in Gruppe `bluetooth`):

```bash
sudo tee /etc/polkit-1/rules.d/51-iobroker-bluez.rules >/dev/null <<'EOF'
polkit.addRule(function(action, subject) {
  if (action.id.indexOf('org.bluez') === 0 && subject.isInGroup('bluetooth')) {
    return polkit.Result.YES;
  }
});
EOF
```

Danach: neu anmelden oder reboot.

