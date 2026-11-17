import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, Check, ShieldCheck, X } from 'lucide-react';
import { PinPad } from '../system/PinPad';

type SecurityStatus = {
  enabled: boolean;
  pin_length: number | null;
  attempts_remaining: number;
  lockout_remaining_secs: number;
};
type Mode = 'set' | 'change' | 'remove' | null;
type Step = 'current' | 'new' | 'confirm';

const PIN_LENGTHS = Array.from({ length: 9 }, (_, index) => index + 4);

function PinTiles({ length, value }: { length: number; value: string }) {
  return (
    <div className="hc-pin-tiles" role="group" aria-label={`Введено ${value.length} из ${length} цифр`}>
      {Array.from({ length }, (_, index) => (
        <span key={index} className={`hc-pin-tile ${index < value.length ? 'is-filled' : ''}`} />
      ))}
    </div>
  );
}

export function ShellSecuritySettings({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [step, setStep] = useState<Step>('new');
  const [pin, setPin] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [pendingPin, setPendingPin] = useState('');
  const [newLength, setNewLength] = useState(6);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const reduced = Boolean(useReducedMotion());

  useEffect(() => {
    void invoke<SecurityStatus>('shell_security_status').then((value) => {
      setStatus(value);
      if (value.pin_length) setNewLength(value.pin_length);
    }).catch(() => setError('Не удалось загрузить параметры безопасности.'));
  }, []);

  const begin = (nextMode: Exclude<Mode, null>) => {
    setMode(nextMode);
    setStep(nextMode === 'set' ? 'new' : 'current');
    setPin('');
    setCurrentPin('');
    setPendingPin('');
    setError(null);
    setSuccess(null);
  };

  const targetLength = step === 'current' ? (status?.pin_length ?? 4) : newLength;
  const title = mode === 'remove'
    ? 'Подтвердите удаление'
    : step === 'current'
      ? 'Текущий PIN-код'
      : step === 'new'
        ? 'Новый PIN-код'
        : step === 'confirm'
          ? 'Повторите PIN-код'
          : 'PIN-код обновлён';

  const enterPin = (next: string) => {
    if (busy || next.length > targetLength) return;
    setPin(next);
    setError(null);
    if (next.length !== targetLength || !mode) return;

    setBusy(true);
    void (async () => {
      if (step === 'current' && mode === 'change') {
        const valid = await invoke<boolean>('shell_security_verify_pin', { pin: next });
        if (!valid) throw new Error('Неверный текущий PIN-код.');
        setCurrentPin(next);
        setPin('');
        setStep('new');
        return;
      }

      if (step === 'current' && mode === 'remove') {
        await invoke('shell_security_remove_pin', { currentPin: next });
        setStatus({ enabled: false, pin_length: null });
        window.dispatchEvent(new Event('homecloud:security-changed'));
        setMode(null);
        setPin('');
        setSuccess('PIN-код удалён.');
        return;
      }

      if (step === 'new') {
        setPendingPin(next);
        setPin('');
        setStep('confirm');
        return;
      }

      if (step === 'confirm') {
        if (next !== pendingPin) {
          setPin('');
          setError('PIN-коды не совпадают. Повторите ввод.');
          return;
        }
        if (mode === 'set') {
          await invoke('shell_security_set_pin', { pin: next, pinLength: newLength });
        } else if (mode === 'change') {
          await invoke('shell_security_change_pin', {
            currentPin,
            newPin: next,
            pinLength: newLength,
          });
        }
        setStatus({ enabled: true, pin_length: newLength });
        window.dispatchEvent(new Event('homecloud:security-changed'));
        setMode(null);
        setPin('');
        setSuccess(mode === 'set' ? 'PIN-код установлен.' : 'PIN-код изменён.');
      }
    })().catch(async (reason: unknown) => {
      setPin('');
      setError(reason instanceof Error ? reason.message : String(reason));
      try {
        const latest = await invoke<SecurityStatus>('shell_security_status');
        setStatus(latest);
        if (latest.lockout_remaining_secs > 0) {
          window.dispatchEvent(new Event('homecloud:security-lockout'));
        }
      } catch {
        // Preserve the original verification error if status cannot be loaded.
      }
    }).finally(() => setBusy(false));
  };

  const cancelFlow = () => {
    setMode(null);
    setPin('');
    setCurrentPin('');
    setPendingPin('');
    setError(null);
    setSuccess(null);
  };

  return (
    <motion.div
      className="hc-security-layer"
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0.08 : 0.18 }}
      onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}
    >
      <motion.section
        className="hc-security-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hc-security-title"
        initial={{ opacity: 0, y: reduced ? 0 : 14, scale: reduced ? 1 : 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: reduced ? 0 : 8, scale: reduced ? 1 : 0.985 }}
        transition={{ duration: reduced ? 0.08 : 0.2 }}
      >
        <header className="hc-security-header">
          <span className="hc-security-header__icon"><ShieldCheck size={21} /></span>
          <div><h2 id="hc-security-title">Безопасность</h2><p>Защита интерфейса HomeCloud</p></div>
          <button type="button" className="hc-security-close" onClick={onClose} aria-label="Закрыть"><X size={19} /></button>
        </header>

        {status === null && !error ? <p className="hc-security-state">Загрузка параметров безопасности…</p> : null}

        {status && !mode && (
          <div className="hc-security-options">
            {success && <p className="hc-security-success"><Check size={16} />{success}</p>}
            {!status.enabled ? (
              <>
                <p>PIN-код не установлен. Экран блокировки пока не требует подтверждения.</p>
                <button type="button" className="hc-security-action hc-security-action--primary" onClick={() => begin('set')}>Задать PIN-код</button>
              </>
            ) : (
              <>
                <p>PIN-код установлен · {status.pin_length} цифр</p>
                <button type="button" className="hc-security-action hc-security-action--primary" onClick={() => begin('change')}>Сменить PIN-код</button>
                <button type="button" className="hc-security-action hc-security-action--danger" onClick={() => begin('remove')}>Удалить PIN-код</button>
              </>
            )}
          </div>
        )}

        {mode && (
          <div className="hc-security-entry">
            <div className="hc-security-entry__heading">
              <button type="button" className="hc-security-back" onClick={cancelFlow} disabled={busy} aria-label="Назад"><ArrowLeft size={17} /></button>
              <div><strong>{title}</strong><small>{step === 'current' ? 'Введите действующий PIN-код' : step === 'new' ? 'Выберите новый PIN-код' : step === 'confirm' ? 'Для подтверждения введите его ещё раз' : ' '}</small></div>
            </div>

            {step === 'new' && (
              <label className="hc-security-length">Длина PIN-кода
                <select value={newLength} onChange={(event) => { setNewLength(Number(event.target.value)); setPin(''); setError(null); }}>
                  {PIN_LENGTHS.map((length) => <option key={length} value={length}>{length} цифр</option>)}
                </select>
              </label>
            )}

            <PinTiles length={targetLength} value={pin} />
            <PinPad value={pin} onChange={enterPin} disabled={busy} />
            {busy && <p className="hc-security-feedback" role="status">Проверка…</p>}
          </div>
        )}

        {error && <p className="hc-security-error" role="alert">{error}</p>}
        <footer className="hc-security-footer">
          {mode ? <button type="button" onClick={cancelFlow} disabled={busy}>Отмена</button> : <button type="button" onClick={onClose}>Закрыть</button>}
        </footer>
      </motion.section>
    </motion.div>
  );
}
