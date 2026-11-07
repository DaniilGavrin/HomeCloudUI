import { useEffect, useState } from 'react';
import type { RegisteredDevice } from '../../hooks/useHomeCloudDeviceRegistry';
import { useHomeCloudMediaRooms, sendMediaControl, refreshMediaRooms, type MediaControlRequest } from '../../hooks/useHomeCloudMediaRooms';

type TvDevicePanelProps = {
  device: RegisteredDevice;
  backendName: string;
  busy: boolean;
  onRefresh: () => void;
  onOpenMedia: () => void;
};

function clock(positionMs: number): string {
  const seconds = Math.floor(Math.max(0, positionMs) / 1000);
  return `${Math.floor(seconds / 3600).toString().padStart(2, '0')}:${Math.floor(seconds % 3600 / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

const MAX_SEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function TvDevicePanel({ device, backendName, busy, onRefresh, onOpenMedia }: TvDevicePanelProps) {
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
        ? 'Backend закрыл медиакомнату и отправил закрытие Gateway и TV. При потере связи с TV физическое завершение подтвердится только после восстановления соединения.'
        : `Команда «${action}» принята Backend (${outcome}). Ожидаем подтверждённое состояние TV.`);
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
      setNotice('Запрос обновления медиакомнат отправлен.');
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
          <span>Состояние медиакомнат</span>
          <strong>{snapshot.phase === 'ready' ? 'Синхронизировано с Backend' : snapshot.phase === 'loading' ? 'Синхронизация…' : snapshot.phase === 'offline' ? 'Backend Offline' : 'Ошибка синхронизации'}</strong>
        </div>
      </div>

      <div className="hc-tv-device__actions">
        <button type="button" className="hc-tv-device__action hc-tv-device__action--primary" onClick={onOpenMedia}>
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
          <p>Комнаты создаёт Backend. Для запуска файла из HC Storage Service открой «Проводник», выбери медиафайл, затем «Воспроизвести на TV». Управление текущей комнатой остаётся здесь.</p>
        </div>
      )}

      {snapshot.phase === 'ready' && room && (
        <div className="hc-tv-remote" aria-label="Пульт медиакомнаты">
          <div className="hc-tv-remote__title">
            <div>
              <span>КОМНАТА · {room.room_id}</span>
              <h4>{room.playback_state}</h4>
              <p>Комната: {room.room_state} · TV attach: {room.tv_attach}</p>
            </div>
            <span className="hc-tv-remote__position" aria-label="Позиция воспроизведения">{clock(room.position_ms)}</span>
          </div>
          <div className="hc-tv-remote__controls">
            <button type="button" disabled={!canSeek || commandBusy} onClick={() => seek(-10000)} title="Назад 10 секунд">−10 с</button>
            <button type="button" className="hc-tv-remote__play" disabled={!ready || commandBusy} onClick={() => void send(playAction)}>{playLabel}</button>
            <button type="button" disabled={!canSeek || commandBusy} onClick={() => seek(10000)} title="Вперёд 10 секунд">+10 с</button>
            <button type="button" className="hc-tv-remote__stop" disabled={snapshot.phase !== 'ready' || commandBusy} onClick={() => { if (window.confirm('Полностью остановить медиакомнату, поток Gateway и воспроизведение на телевизоре?')) void send('stop'); }}>Полный стоп</button>
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
          <p className="hc-tv-remote__status" role="status">
            {room.control_status ? `Последняя команда: ${room.control_action ?? '—'} · ${room.control_status}${room.control_error_code ? ` · ${room.control_error_code}` : ''}` : 'Команд пока не было'}
          </p>
          {room.seek_target_ms != null && <p className="hc-tv-remote__status">Запрошенная перемотка: {clock(room.seek_target_ms)}. Текущая позиция TV: {clock(room.position_ms)}.</p>}
        </div>
      )}

      {notice && <p role="status" className={commandError ? 'hc-tv-device__error' : 'hc-tv-device__notice'}>{notice}</p>}
      <p className="hc-tv-device__hint">
        Команды отправляются через управляющий WebSocket Backend. Принятие команды не доказывает её выполнение.
        PLAYING/PAUSED и позиция отображаются из отчётов TV в медиакомнате; передача данных идёт через Media Gateway.
      </p>
    </section>
  );
}
