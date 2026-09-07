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
};
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
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
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
    this.log('Disconnected. No control commands were sent.');
  };
  async connect() {
    if (this.snapshot.status === 'connecting' || this.snapshot.status === 'connected') return;
    if (!navigator.bluetooth) {
      this.update({
        status: 'error',
        message: 'Open http://localhost:5186 in Chrome on this Mac to use Bluetooth.',
      });
      return;
    }
    this.disconnect();
    this.update({
      ...initial(),
      status: 'connecting',
      message: 'Choose your KICKR in the browser pairing window.',
    });
    try {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'KICKR' }, { namePrefix: 'Wahoo' }, { services: [0x1826] }],
        optionalServices: [0x1826],
      });
      this.device.addEventListener('gattserverdisconnected', this.disconnected);
      const server = await this.device.gatt?.connect();
      if (!server) throw new Error('The selected device has no Bluetooth GATT server.');
      const service = await server.getPrimaryService(0x1826);
      const characteristics = await service.getCharacteristics();
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
          this.update({ [key]: decoder(value) });
        } catch (e) {
          this.log(`Optional ${uuid.toString(16)} read: ${(e as Error).message}`);
        }
      }
      this.data = await service.getCharacteristic(0x2ad2);
      this.data.addEventListener('characteristicvaluechanged', this.notification);
      await this.data.startNotifications();
      this.update({
        status: 'connected',
        message:
          'Reading telemetry only. Pedal gently to see live power. Resistance stays under your existing setup.',
      });
      this.log('Indoor Bike Data notifications enabled. Control point untouched.');
    } catch (e) {
      this.disconnect();
      const error = e as Error;
      this.update({
        status: 'error',
        message:
          error.name === 'NotFoundError'
            ? 'No trainer selected. Check that the KICKR is awake and nearby, then try again.'
            : error.message,
      });
      this.log(`Connection failed: ${error.message}`);
    }
  }
  disconnect() {
    this.data?.removeEventListener('characteristicvaluechanged', this.notification);
    this.device?.removeEventListener('gattserverdisconnected', this.disconnected);
    this.device?.gatt?.disconnect();
    this.data = undefined;
    this.device = undefined;
    this.update({ status: 'offline', telemetry: { receivedAt: 0 } });
  }
}
export const trainer = new BluetoothTrainer();
