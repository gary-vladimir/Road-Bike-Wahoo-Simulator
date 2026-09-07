import { afterEach, describe, expect, it, vi } from 'vitest';
import { BluetoothTrainer } from '../../src/trainer/bluetooth';
function storage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, value),
  };
}
afterEach(() => vi.unstubAllGlobals());
describe('remembered telemetry connection', () => {
  it('explains unsupported permission restoration without opening a chooser or sending commands', async () => {
    const local = storage(),
      session = storage();
    local.setItem('bikesim.trainer.id', 'previous-trainer');
    session.setItem('bikesim.trainer.restore', '1');
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', session);
    const requestDevice = vi.fn();
    vi.stubGlobal('navigator', { bluetooth: { requestDevice } });
    const trainer = new BluetoothTrainer();
    await trainer.restore();
    expect(trainer.snapshot.status).toBe('error');
    expect(trainer.snapshot.message).toContain('Click Pair KICKR');
    expect(requestDevice).not.toHaveBeenCalled();
  });
  it('does not reconnect an intentionally disconnected session', async () => {
    const local = storage(),
      session = storage();
    local.setItem('bikesim.trainer.id', 'previous-trainer');
    session.setItem('bikesim.trainer.restore', '0');
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', session);
    const getDevices = vi.fn();
    vi.stubGlobal('navigator', { bluetooth: { getDevices } });
    await new BluetoothTrainer().restore();
    expect(getDevices).not.toHaveBeenCalled();
  });
  it('cannot revive a connection that the user cancelled while permission lookup was pending', async () => {
    const local = storage(),
      session = storage();
    local.setItem('bikesim.trainer.id', 'previous-trainer');
    session.setItem('bikesim.trainer.restore', '1');
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', session);
    let resolve!: (devices: unknown[]) => void;
    vi.stubGlobal('navigator', {
      bluetooth: {
        getDevices: () =>
          new Promise((done) => {
            resolve = done;
          }),
      },
    });
    const trainer = new BluetoothTrainer(),
      restoring = trainer.restore();
    trainer.disconnect();
    const connect = vi.fn();
    resolve([{ id: 'previous-trainer', gatt: { connect } }]);
    await restoring;
    expect(connect).not.toHaveBeenCalled();
    expect(trainer.snapshot.status).toBe('offline');
  });
});
