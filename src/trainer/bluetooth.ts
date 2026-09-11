import { decodeFeatures, decodeIndoorBikeData, decodePowerRange, type Telemetry } from './ftms';
export type DeviceSnapshot = {
  status: 'offline' | 'connecting' | 'connected' | 'error';
  name: string;
  message: string;
  telemetry: Telemetry;
  services: string[];
  log: string[];
  features?: ReturnType<typeof decodeFeatures>;
  range?: ReturnType<typeof decodePowerRange>;
  canReconnect?: boolean;
};
const rememberedKey = 'bikesim.trainer.id';
const restoreKey = 'bikesim.trainer.restore';
function stored(storage: 'localStorage' | 'sessionStorage', key: string, value?: string) {
  try {
    if (value !== undefined) globalThis[storage].setItem(key, value);
    return globalThis[storage].getItem(key);
  } catch {
    return null;
  }
}
const initial = (): DeviceSnapshot => ({
  status: 'offline',
  name: 'KICKR CORE 2',
  message: 'Pair your trainer to read live power and cadence.',
  telemetry: { receivedAt: 0 },
  services: [],
  log: [],
});
/** Deliberately has no write method. Read-only means no load/control commands. */
export class BluetoothTrainer {
  snapshot = initial();
  private listeners = new Set<() => void>();
  private device?: BluetoothDevice;
  private data?: BluetoothRemoteGATTCharacteristic;
  private remembered?: BluetoothDevice;
  private generation = 0;
  private restored = false;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  getPilotDevice(mode: 'erg' | 'sim' = 'erg') {
    if (import.meta.env.VITE_TRAINER_CONTROL !== 'pilot')
      throw new Error('Control is disabled in this build.');
    if (
      !this.device ||
      this.snapshot.status !== 'connected' ||
      !(mode === 'sim' ? this.snapshot.features?.simulation : this.snapshot.features?.erg) ||
      !this.snapshot.range
    )
      throw new Error(
        `Connect a ${mode.toUpperCase()}-capable trainer with a known power range first.`,
      );
    return {
      device: this.device,
      range: this.snapshot.range,
      telemetry: () => this.snapshot.telemetry,
    };
  }
  private update(patch: Partial<DeviceSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  private log(message: string) {
    this.update({
      log: [`${new Date().toLocaleTimeString()} · ${message}`, ...this.snapshot.log].slice(0, 60),
    });
  }
  private notification = (event: Event) => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (!value) return;
    try {
      const decoded = decodeIndoorBikeData(value),
        now = performance.now();
      const telemetry = { ...this.snapshot.telemetry, ...decoded, receivedAt: now };
      if (decoded.power !== undefined) telemetry.powerAt = now;
      if (decoded.cadence !== undefined) telemetry.cadenceAt = now;
      if (decoded.speed !== undefined) telemetry.speedAt = now;
      this.update({ telemetry });
    } catch (e) {
      this.log((e as Error).message);
    }
  };
  private disconnected = () => {
    this.update({
      status: 'offline',
      telemetry: { receivedAt: 0 },
      message: 'Trainer disconnected. Reconnect deliberately when ready.',
    });
    this.log('Bluetooth disconnected. Telemetry is unavailable.');
  };
  async restore() {
    if (this.restored) return;
    this.restored = true;
    if (stored('sessionStorage', restoreKey) === '1') await this.connect('restore');
  }
  async connect(mode: 'pair' | 'reconnect' | 'restore' = 'pair') {
    if (this.snapshot.status === 'connecting' || this.snapshot.status === 'connected') return;
    if (!navigator.bluetooth) {
      this.update({
        status: 'error',
        message: 'Open http://localhost:5186 in Chrome on this Mac to use Bluetooth.',
      });
      return;
    }
    const generation = ++this.generation;
    this.cleanup();
    this.update({
      ...initial(),
      status: 'connecting',
      message:
        mode === 'pair'
          ? 'Choose your KICKR in the browser pairing window.'
          : 'Restoring the trainer connection for telemetry only…',
    });
    let selected: BluetoothDevice | undefined;
    const current = () => {
      if (generation !== this.generation) {
        selected?.gatt?.disconnect();
        throw new Error('Connection attempt cancelled');
      }
    };
    try {
      if (mode !== 'pair') {
        const bluetooth = navigator.bluetooth as Bluetooth & {
          getDevices?: () => Promise<BluetoothDevice[]>;
        };
        const devices = this.remembered
          ? [this.remembered]
          : ((await bluetooth.getDevices?.()) ?? []);
        current();
        selected =
          devices.find((device) => device.id === stored('localStorage', rememberedKey)) ??
          this.remembered;
        if (!selected)
          throw new Error(
            'Chrome could not restore the saved Bluetooth permission. Click Pair KICKR via Bluetooth to reconnect.',
          );
      } else
        selected = await navigator.bluetooth.requestDevice({
          filters: [{ namePrefix: 'KICKR' }, { namePrefix: 'Wahoo' }, { services: [0x1826] }],
          optionalServices: [0x1826],
        });
      current();
      this.device = selected;
      this.remembered = selected;
      this.device.addEventListener('gattserverdisconnected', this.disconnected);
      const server = await this.device.gatt?.connect();
      current();
      if (!server) throw new Error('The selected device has no Bluetooth GATT server.');
      const service = await server.getPrimaryService(0x1826);
      current();
      const characteristics = await service.getCharacteristics();
      current();
      this.update({
        name: this.device.name || 'Selected trainer',
        services: characteristics.map((c) => c.uuid),
      });
      this.log(`Discovered ${characteristics.length} FTMS characteristics. Read-only session.`);
      for (const [uuid, decoder, key] of [
        [0x2acc, decodeFeatures, 'features'],
        [0x2ad8, decodePowerRange, 'range'],
      ] as const) {
        try {
          const c = await service.getCharacteristic(uuid);
          const value = await c.readValue();
          current();
          this.update({ [key]: decoder(value) });
        } catch (e) {
          this.log(`Optional ${uuid.toString(16)} read: ${(e as Error).message}`);
        }
      }
      this.data = await service.getCharacteristic(0x2ad2);
      current();
      this.data.addEventListener('characteristicvaluechanged', this.notification);
      await this.data.startNotifications();
      current();
      stored('localStorage', rememberedKey, this.device.id);
      stored('sessionStorage', restoreKey, '1');
      this.update({
        status: 'connected',
        canReconnect: true,
        message:
          'Reading telemetry only. Pedal gently to see live power. Resistance stays under your existing setup.',
      });
      this.log('Indoor Bike Data notifications enabled. Control point untouched.');
    } catch (e) {
      if (generation !== this.generation) return;
      this.cleanup();
      const error = e as Error;
      this.update({
        status: 'error',
        canReconnect: !!this.remembered,
        message:
          error.name === 'NotFoundError'
            ? 'No trainer selected. Check that the KICKR is awake and nearby, then try again.'
            : error.message,
      });
      this.log(`Connection failed: ${error.message}`);
    }
  }
  disconnect() {
    ++this.generation;
    stored('sessionStorage', restoreKey, '0');
    this.cleanup();
    this.update({
      status: 'offline',
      telemetry: { receivedAt: 0 },
      canReconnect: !!this.remembered,
      message: 'Trainer disconnected. Use Reconnect to resume telemetry.',
    });
  }
  private cleanup() {
    this.data?.removeEventListener('characteristicvaluechanged', this.notification);
    this.device?.removeEventListener('gattserverdisconnected', this.disconnected);
    this.device?.gatt?.disconnect();
    this.data = undefined;
    this.device = undefined;
  }
}
export const trainer = new BluetoothTrainer();
if (import.meta.hot) import.meta.hot.dispose(() => trainer.disconnect());
