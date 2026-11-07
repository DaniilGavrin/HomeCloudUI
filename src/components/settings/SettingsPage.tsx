import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useHomeCloudPool, type PoolServer, type ServerPoolInput } from '../../hooks/useHomeCloudPool';
import '../../styles/settings.css';

type Screen = 'home' | 'pool' | 'form' | 'delete';
const EMPTY: ServerPoolInput = { name: '', ipv4: '', ipv6: '' };

function Icon({ type }: { type: 'server' | 'plus' | 'back' | 'edit' | 'delete' | 'refresh' | 'arrow' }) {
  const paths: Record<string, string> = {
    server: 'M4 4h16v7H4zM4 14h16v7H4zM8 7.5h.01M8 17.5h.01',
    plus: 'M12 5v14M5 12h14', back: 'M15 18l-6-6 6-6', edit: 'M12 20h9M4 16v4h4L19 9l-4-4L4 16z',
    delete: 'M4 7h16M10 11v7M14 11v7M6 7l1 14h10l1-14M9 7V4h6v3',
    refresh: 'M20 11a8 8 0 0 0-14-5L3 9m0-5v5h5M4 13a8 8 0 0 0 14 5l3-3m0 5v-5h-5',
    arrow: 'M5 12h14m-6-6 6 6-6 6',
  };
  return <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[type]}/></svg>;
}

export function SettingsPage() {
  const pool = useHomeCloudPool();
  const [screen, setScreen] = useState<Screen>('home');
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<ServerPoolInput>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const reduced = Boolean(useReducedMotion());
  const returnFocus = useRef<HTMLButtonElement>(null);
  const selected = pool.snapshot.servers.find(s => s.id === editing) ?? null;
  const deleting = pool.snapshot.servers.find(s => s.id === confirmId) ?? null;

  const back = () => {
    if (busy) return;
    setActionError(null);
    if (screen === 'home') return;
    setScreen(screen === 'pool' ? 'home' : 'pool');
  };
  useEffect(() => {
    if (screen === 'home') return;
    const handler = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' && ev.key !== 'Backspace') return;
      if (ev.target instanceof HTMLElement && ev.target.closest('input, textarea, [contenteditable="true"]')) return;
      ev.preventDefault();
      if (!busy) setScreen(s => s === 'pool' ? 'home' : 'pool');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [screen, busy]);
  const openForm = (server?: PoolServer) => {
    setEditing(server?.id ?? null);
    setForm(server ? { name: server.name, ipv4: server.ipv4 ?? '', ipv6: server.ipv6 ?? '' } : EMPTY);
    setActionError(null);
    setScreen('form');
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setActionError(null);
    try {
      if (editing) await pool.update(editing, form);
      else await pool.add(form);
      setScreen('pool');
    } catch (e) { setActionError(String(e)); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!deleting || busy) return;
    setBusy(true); setActionError(null);
    try { await pool.remove(deleting.id); setScreen('pool'); setConfirmId(null); }
    catch (e) { setActionError(String(e)); }
    finally { setBusy(false); }
  };

  return <section className="hc-settings homecloud-glass" aria-label="Настройки HomeCloud">
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={screen} className="hc-settings__view" initial={{ opacity: 0, x: reduced ? 0 : 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: reduced ? 0 : -12 }} transition={{ duration: reduced ? .08 : .19 }}>
        {screen === 'home' ? <>
          <header className="hc-settings__header"><div><span className="hc-settings__eyebrow">HomeCloud · System</span><h2>Настройки</h2><p>Управление подключениями и параметрами оболочки</p></div></header>
          <div className="hc-settings__tiles">
            <button type="button" className="hc-settings__tile homecloud-glass" onClick={() => setScreen('pool')} ref={returnFocus}>
              <span className="hc-settings__tile-icon"><Icon type="server" /></span><span><strong>Пул серверов</strong><small>Подключения HomeCloudBackend · {pool.snapshot.servers.length} в пуле</small></span><Icon type="arrow" />
            </button>
          </div>
        </> : screen === 'pool' ? <>
          <header className="hc-settings__header"><div className="hc-settings__heading"><button className="hc-settings__back" onClick={back} aria-label="Назад к настройкам"><Icon type="back" /></button><div><span className="hc-settings__eyebrow">Настройки · Connections</span><h2>Пул серверов</h2><p>Добавляй серверы по IPv4 или IPv6. Порт фиксирован: 8080.</p></div></div>
            <button type="button" className="hc-settings__button hc-settings__button--accent" onClick={() => openForm()}><Icon type="plus" /> Добавить сервер</button>
          </header>
          {(pool.error || actionError) && <p className="hc-settings__error" role="alert">{pool.error || actionError}</p>}
          <div className="hc-settings__list">{pool.snapshot.servers.map(s => {
            const phase = s.phase;
            const online = phase === 'ready';
            return <article key={s.id} className="hc-settings__server homecloud-glass">
              <span className="hc-settings__tile-icon"><Icon type="server" /></span>
              <div className="hc-settings__identity"><strong>{s.name}</strong><small>{[s.ipv4, s.ipv6].filter(Boolean).join(' · ')}</small></div>
              <span className={`hc-settings__status ${online ? 'is-online' : phase === 'connecting' || phase === 'loading' ? 'is-connecting' : 'is-offline'}`}><i />{online ? 'Online' : phase === 'connecting' || phase === 'loading' ? 'Connecting' : phase === 'error' ? 'Ошибка данных' : 'Offline'}</span>
              <div className="hc-settings__server-actions"><button type="button" title="Изменить" aria-label={`Изменить ${s.name}`} onClick={() => openForm(s)}><Icon type="edit" /></button>
                {<button type="button" title="Удалить" aria-label={`Удалить ${s.name}`} onClick={() => {setConfirmId(s.id); setActionError(null); setScreen('delete');}}><Icon type="delete" /></button>}
              </div>
            </article>;
          })}</div>
        </> : screen === 'form' ? <>
          <header className="hc-settings__header"><div className="hc-settings__heading"><button className="hc-settings__back" onClick={back} aria-label="Назад к пулу серверов"><Icon type="back" /></button><div><span className="hc-settings__eyebrow">Настройки · Пул серверов</span><h2>{editing ? 'Изменить сервер' : 'Добавить сервер'}</h2><p>{editing ? selected?.name : 'Новое подключение HomeCloudBackend'}</p></div></div></header>
          <form onSubmit={event => void submit(event)} className="hc-settings__form homecloud-glass">
            <label>Название сервера<input required maxLength={64} autoFocus placeholder="Например, Сервер в гостиной" value={form.name} onChange={e => setForm(v => ({...v,name:e.target.value}))}/></label>
            <div className="hc-settings__form-pair"><label>IPv4-адрес<input inputMode="decimal" placeholder="192.168.1.100" value={form.ipv4 ?? ''} onChange={e => setForm(v => ({...v,ipv4:e.target.value}))}/></label>
              <label>IPv6-адрес<input placeholder="2001:db8::10" value={form.ipv6 ?? ''} onChange={e => setForm(v => ({...v,ipv6:e.target.value}))}/></label></div>
            <p className="hc-settings__help">Укажи хотя бы один адрес. Если заданы оба, HomeCloud пробует IPv4, затем IPv6. Порт и путь подключения: <code>8080/ws</code>.</p>
            {actionError && <p className="hc-settings__error" role="alert">{actionError}</p>}
            <div className="hc-settings__form-actions"><button type="button" className="hc-settings__button" disabled={busy} onClick={back}>Отмена</button><button type="submit" className="hc-settings__button hc-settings__button--accent" disabled={busy}>{busy ? 'Сохранение…' : 'Сохранить'}</button></div>
          </form>
        </> : <>
          <header className="hc-settings__header"><div className="hc-settings__heading"><button className="hc-settings__back" onClick={back} aria-label="Назад к пулу"><Icon type="back" /></button><div><span className="hc-settings__eyebrow">Пул серверов</span><h2>Удаление сервера</h2></div></div></header>
          <div className="hc-settings__form homecloud-glass"><h3>Удалить «{deleting?.name ?? 'Сервер'}»?</h3><p>Подключение будет остановлено, а сервер удалён из пула и раздела «Серверы». Сам Go Backend не затрагивается.</p>
            {actionError && <p className="hc-settings__error" role="alert">{actionError}</p>}
            <div className="hc-settings__form-actions"><button type="button" className="hc-settings__button" disabled={busy} onClick={back}>Отмена</button><button type="button" className="hc-settings__button hc-settings__button--danger" disabled={busy} onClick={() => void remove()}>{busy ? 'Удаление…' : 'Удалить сервер'}</button></div>
          </div>
        </>}
      </motion.div>
    </AnimatePresence>
  </section>;
}
