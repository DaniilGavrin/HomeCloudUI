import type { RegisteredDevice } from '../../hooks/useHomeCloudDeviceRegistry';

type TvDevicePanelProps = {
  device: RegisteredDevice;
  backendName: string;
  busy: boolean;
  onRefresh: () => void;
  onOpenMedia: () => void;
};

/**
 * TV Device Card V1 intentionally displays *registry* state only.
 * Playback state and remote controls require media.rooms.snapshot/control
 * plus a verified room_id/playback_id/generation in a separate change.
 */
export function TvDevicePanel({
  device, backendName, busy, onRefresh, onOpenMedia,
}: TvDevicePanelProps) {
  return (
    <section className="hc-tv-device homecloud-glass" aria-label="Карточка телевизора">
      <div className="hc-tv-device__heading">
        <span className="hc-tv-device__icon" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="38" height="38" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="6" width="26" height="18" rx="3"/>
            <path d="M12 28h8m-4-4v4M7 10h18"/>
          </svg>
        </span>
        <div>
          <span className="hc-tv-device__eyebrow">HomeCloud · TV Device</span>
          <h3>Телевизор / медиаплеер</h3>
          <p>{backendName}</p>
        </div>
        <span className={device.online ? 'hc-device-online' : 'hc-device-online hc-device-online--offline'} role="status">
          <i/>{device.online ? 'Online' : 'Offline'}
        </span>
      </div>

      <div className="hc-tv-device__facts">
        <div>
          <span>Подключение</span>
          <strong>{device.online ? 'WebSocket-клиент подключён' : 'Соединение отсутствует'}</strong>
        </div>
        <div>
          <span>Воспроизведение</span>
          <strong>Состояние комнаты не загружено</strong>
        </div>
      </div>

      <div className="hc-tv-device__actions">
        <button type="button" className="hc-tv-device__action hc-tv-device__action--primary" onClick={onOpenMedia}>
          Перейти в мультимедиа
        </button>
        <button type="button" className="hc-tv-device__action" disabled={busy} onClick={onRefresh}>
          {busy ? 'Обновление…' : 'Обновить список устройств'}
        </button>
      </div>

      <p className="hc-tv-device__hint">
        Online подтверждает наличие клиента на Backend, но не состояние фильма.
        Пульт Play/Pause/Seek и громкость появятся после интеграции медиакомнат
        через <code>media.rooms.*</code>; фиктивные команды не отправляются.
      </p>
    </section>
  );
}
