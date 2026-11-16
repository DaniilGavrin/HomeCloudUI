import { useEffect, useState } from 'react';
import type { RegisteredDevice } from '../../hooks/useHomeCloudDeviceRegistry';
import { Tv } from 'lucide-react';
import { useHomeCloudMediaRooms, sendMediaControl, refreshMediaRooms, type MediaControlRequest } from '../../hooks/useHomeCloudMediaRooms';

type TvDevicePanelProps = {
  device: RegisteredDevice;
  backendName: string;
  busy: boolean;
  onRefresh: () => void;
  onOpenExplorer: () => void;
};

function clock(positionMs: number): string {
  const seconds = Math.floor(Math.max(0, positionMs) / 1000);
  return `${Math.floor(seconds / 3600).toString().padStart(2, '0')}:${Math.floor(seconds % 3600 / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

const MAX_SEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function TvDevicePanel({ device, backendName, busy, onRefresh, onOpenExplorer }: TvDevicePanelProps) {
  const { snapshot, error } = useHomeCloudMediaRooms(device.server_id);
  const room = snapshot.rooms.find(item => item.target.device_id === device.device_id) ?? null;
  const [commandBusy, setCommandBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [commandError, setCommandError] = useState(false);
  const [volumeDraft, setVolumeDraft] = useState(50);
  const ready = device.online && snapshot.phase === 'ready' && room?.room_state === 'ACTIVE' && room.tv_attach === 'READY';
  const canSeek = ready && ['PLAYING', 'PAUSED', 'BUFFERING', 'ENDED'].includes(room?.playback_state ?? '');

  useEffect(() => {
    if (room?.volume != null) setVolumeDraft(room.volume);
  }, [room?.volume, room?.playback_id, room?.generation]);

  useEffect(() => {
    setNotice(null);
  }, [room?.room_id, room?.playback_id, room?.generation, device.server_id]);

  async function send(action: MediaControlRequest['action'], extra: Partial<MediaControlRequest> = {}) {
    if (!room || commandBusy || (action !== 'stop' && !device.online)) return;
    setCommandBusy(true);
    setNotice(null);
    try {
      const result = await sendMediaControl({
        serverId: device.server_id,
        deviceId: device.device_id,
        roomId: room.room_id,
        playbackId: room.playback_id,
        generation: room.generation,
        action,
        ...extra,
      });
      setCommandError(false);
      const outcome = String(result.command_status ?? result.status ?? 'accepted');
      setNotice(action === 'stop'
        ? 'Запрос на остановку отправлен. Если телевизор временно недоступен, результат подтвердится после восстановления связи.'
        : `Запрос отправлен. Ожидаем подтверждение телевизора (${outcome}).`);
    } catch (cause) {
      setCommandError(true);
      setNotice(`Не удалось выполнить «${action}»: ${String(cause)}`);
    } finally {
      setCommandBusy(false);
    }
  }

  async function refreshRooms() {
    setCommandBusy(true);
    setNotice(null);
    try {
      await refreshMediaRooms(device.server_id);
      setCommandError(false);
      setNotice('Запрос на обновление состояния отправлен.');
    } catch (cause) {
      setCommandError(true);
      setNotice(`Не удалось запросить комнаты: ${String(cause)}`);
    } finally { setCommandBusy(false); }
  }

  const playback = room?.playback_state ?? '—';
  const playAction: MediaControlRequest['action'] =
    playback === 'PLAYING' ? 'pause' : playback === 'PAUSED' ? 'resume' : 'play';
  const playLabel = playback === 'PLAYING' ? 'Пауза' : playback === 'PAUSED' ? 'Продолжить' : 'Воспроизвести';
  const seek = (delta: number) => {
    if (!room || !canSeek) return;
    const target = Math.min(MAX_SEEK_MS, Math.max(0, room.position_ms + delta));
    void send('seek', { positionMs: target });
  };

  return (
    <section className="hc-tv-device homecloud-glass" aria-label="Карточка телевизора">
      <div className="hc-tv-device__heading">
        <span className="hc-tv-device__icon" aria-hidden="true">
          <Tv size={38} strokeWidth={1.6} aria-hidden="true" />
        </span>
        <div>
          
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
          <strong>{device.online ? 'Подключено' : 'Соединение отсутствует'}</strong>
        </div>
        <div>
          <span>Состояние воспроизведения</span>
          <strong>{snapshot.phase === 'ready' ? 'Актуально' : snapshot.phase === 'loading' ? 'Синхронизация…' : snapshot.phase === 'offline' ? 'Нет соединения с сервером' : 'Ошибка синхронизации'}</strong>
        </div>
      </div>

      <div className="hc-tv-device__actions">
        <button type="button" className="hc-tv-device__action hc-tv-device__action--primary" onClick={onOpenExplorer}>
          Открыть проводник
        </button>
        <button type="button" className="hc-tv-device__action" disabled={busy} onClick={onRefresh}>
          {busy ? 'Обновление…' : 'Обновить устройства'}
        </button>
        <button type="button" className="hc-tv-device__action" disabled={commandBusy || snapshot.phase === 'offline'} onClick={() => void refreshRooms()}>
          Обновить медиакомнаты
        </button>
      </div>

      {(error || snapshot.error) && <p className="hc-tv-device__error" role="alert">{error || snapshot.error}</p>}

      {snapshot.phase === 'ready' && !room && (
        <div className="hc-tv-device__empty" role="status">
          <strong>Активной медиакомнаты нет</strong>
          <p>Чтобы запустить файл, открой «Проводник», выбери медиафайл и нажми «Воспроизвести на TV». Управление воспроизведением доступно здесь.</p>
        </div>
      )}

      {snapshot.phase === 'ready' && room && (
        <div className="hc-tv-remote" aria-label="Пульт медиакомнаты">
          <div className="hc-tv-remote__title">
            <div>
              <h4>{room.playback_state === 'PLAYING' ? 'Воспроизведение' : room.playback_state === 'PAUSED' ? 'Пауза' : room.playback_state === 'BUFFERING' ? 'Загрузка' : room.playback_state === 'ENDED' ? 'Завершено' : 'Ожидание'}</h4>
            </div>
            <span className="hc-tv-remote__position" aria-label="Позиция воспроизведения">{clock(room.position_ms)}</span>
          </div>
          <div className="hc-tv-remote__controls">
            <button type="button" disabled={!canSeek || commandBusy} onClick={() => seek(-10000)} title="Назад 10 секунд">−10 с</button>
            <button type="button" className="hc-tv-remote__play" disabled={!ready || commandBusy} onClick={() => void send(playAction)}>{playLabel}</button>
            <button type="button" disabled={!canSeek || commandBusy} onClick={() => seek(10000)} title="Вперёд 10 секунд">+10 с</button>
            <button type="button" className="hc-tv-remote__stop" disabled={snapshot.phase !== 'ready' || commandBusy} onClick={() => { if (window.confirm('Остановить воспроизведение на телевизоре?')) void send('stop'); }}>Остановить</button>
          </div>
          <div className="hc-tv-remote__volume">
            <label htmlFor="hc-tv-volume">Громкость <strong>{volumeDraft}%</strong></label>
            <input id="hc-tv-volume" type="range" min={0} max={100} step={1} value={volumeDraft}
              onChange={e => setVolumeDraft(Number(e.target.value))} disabled={!ready || commandBusy}/>
            <button type="button" disabled={!ready || commandBusy || room.volume === volumeDraft} onClick={() => void send('volume', { volume: volumeDraft })}>Применить</button>
            <button type="button" disabled={!ready || commandBusy} onClick={() => void send('mute', { muted: !(room.muted ?? false) })}>
              {room.muted ? 'Включить звук' : 'Без звука'}
            </button>
          </div>
        </div>
      )}

      {notice && <p role="status" className={commandError ? 'hc-tv-device__error' : 'hc-tv-device__notice'}>{notice}</p>}
      <p className="hc-tv-device__hint">
        Состояние воспроизведения и позиция обновляются автоматически.
      </p>
    </section>
  );
}
