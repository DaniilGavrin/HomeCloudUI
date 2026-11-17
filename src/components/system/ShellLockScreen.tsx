import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, Check, Cloud, Lock, LockKeyhole, Unlock } from 'lucide-react';
import { PinPad } from './PinPad';

type VerifyResult = {
  valid: boolean;
  attemptsRemaining: number;
  lockoutRemainingSecs: number;
};

type Props = {
  securityReady: boolean;
  securityError?: string | null;
  pinLength: number | null;
  attemptsRemaining: number;
  lockoutRemainingSecs: number;
  onVerify: (pin: string) => Promise<VerifyResult>;
  onRefreshSecurity: () => Promise<void>;
  onUnlock: () => void;
};

const wait = (duration: number) => new Promise((resolve) => window.setTimeout(resolve, duration));

function formatCountdown(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remainder = (seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}

export function ShellLockScreen({
  securityReady,
  securityError,
  pinLength,
  attemptsRemaining,
  lockoutRemainingSecs,
  onVerify,
  onRefreshSecurity,
  onUnlock,
}: Props) {
  const [now, setNow] = useState(() => new Date());
  const [entryOpen, setEntryOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [phase, setPhase] = useState<'idle' | 'checking' | 'accepted' | 'rejected'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [remainingAttempts, setRemainingAttempts] = useState(attemptsRemaining);
  const [lockoutRemaining, setLockoutRemaining] = useState(lockoutRemainingSecs);
  const reducedMotion = Boolean(useReducedMotion());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => setRemainingAttempts(attemptsRemaining), [attemptsRemaining]);
  useEffect(() => setLockoutRemaining(lockoutRemainingSecs), [lockoutRemainingSecs]);

  useEffect(() => {
    if (lockoutRemaining <= 0) return;
    const timer = window.setInterval(() => {
      setLockoutRemaining((value) => {
        if (value <= 1) {
          window.clearInterval(timer);
          void onRefreshSecurity();
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [lockoutRemaining > 0, onRefreshSecurity]);

  const time = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const date = new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(now);

  const reveal = (delay: number, distance = 12) => ({
    initial: { opacity: 0, y: reducedMotion ? 0 : distance },
    animate: { opacity: 1, y: 0 },
    transition: { duration: reducedMotion ? 0.1 : 0.48, delay: reducedMotion ? 0 : delay, ease: 'easeOut' as const },
  });

  const submitPin = useCallback(async (value: string) => {
    if (pinLength === null || value.length !== pinLength || phase !== 'idle' || lockoutRemaining > 0) return;
    setPin(value);
    setError(null);
    setPhase('checking');

    try {
      const result = await onVerify(value);
      setRemainingAttempts(result.attemptsRemaining);
      if (result.valid) {
        setPhase('accepted');
        await wait(reducedMotion ? 120 : 820);
        onUnlock();
        return;
      }

      setPhase('rejected');
      setError(result.lockoutRemainingSecs > 0
        ? 'Лимит попыток исчерпан. Панель заблокирована.'
        : 'PIN-код не подходит. Попробуйте ещё раз.');
      if (result.lockoutRemainingSecs > 0) {
        setLockoutRemaining(result.lockoutRemainingSecs);
        setEntryOpen(false);
        return;
      }
      await wait(reducedMotion ? 100 : 720);
      setPin('');
      setPhase('idle');
    } catch (reason: unknown) {
      setPhase('rejected');
      setError(typeof reason === 'string' ? reason : 'Не удалось проверить PIN-код.');
      await wait(reducedMotion ? 100 : 650);
      try {
        await onRefreshSecurity();
      } catch {
        // Keep the lock screen active if the status refresh is temporarily unavailable.
      }
      setPin('');
      setPhase('idle');
    }
  }, [lockoutRemaining, onRefreshSecurity, onUnlock, onVerify, phase, pinLength, reducedMotion]);

  const handlePinChange = useCallback((next: string) => {
    if (phase !== 'idle' || lockoutRemaining > 0 || pinLength === null) return;
    if (next.length < pin.length) {
      setPin(next);
      setError(null);
      return;
    }
    if (next.length > pinLength) return;
    setPin(next);
    if (next.length === pinLength) void submitPin(next);
  }, [lockoutRemaining, phase, pin, pinLength, submitPin]);

  useEffect(() => {
    if (!entryOpen || lockoutRemaining > 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey || phase !== 'idle') return;
      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        if (pin.length < (pinLength ?? 0)) handlePinChange(pin + event.key);
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        handlePinChange(pin.slice(0, -1));
      } else if (event.key === 'Escape') {
        event.preventDefault();
        setEntryOpen(false);
        setPin('');
        setError(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [entryOpen, handlePinChange, lockoutRemaining, phase, pin, pinLength]);

  const openEntry = () => {
    if (!securityReady || lockoutRemaining > 0) return;
    if (pinLength === null) {
      onUnlock();
      return;
    }
    setPin('');
    setError(null);
    setPhase('idle');
    setEntryOpen(true);
  };

  return (
    <motion.section
      className="hc-lock-screen"
      role="dialog"
      aria-modal="true"
      aria-label="Экран блокировки HomeCloud"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: reducedMotion ? 0.09 : 0.27, ease: 'easeIn' } }}
      transition={{ duration: reducedMotion ? 0.1 : 0.37, ease: 'easeOut' }}
    >
      <motion.div
        className="hc-lock-orbit hc-lock-orbit-one"
        aria-hidden="true"
        initial={{ opacity: 0 }}
        animate={reducedMotion ? { opacity: 1 } : { opacity: [0.35, 1, 0.5, 1] }}
        transition={reducedMotion ? { duration: 0.1 } : { duration: 9, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="hc-lock-orbit hc-lock-orbit-two"
        aria-hidden="true"
        initial={{ opacity: 0 }}
        animate={reducedMotion ? { opacity: 1 } : { opacity: [0.7, 0.25, 0.85, 0.7] }}
        transition={reducedMotion ? { duration: 0.1 } : { duration: 11, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div className="hc-lock-content">
        <motion.div className="hc-lock-brand" {...reveal(0.08, -12)}>
          <Cloud size={22} strokeWidth={1.7} aria-hidden="true" /> <span>HomeCloud</span>
        </motion.div>

        <AnimatePresence mode="wait">
          <motion.div
            key={time}
            className="hc-lock-time"
            aria-label={`Время: ${time}`}
            initial={{ opacity: 0, y: reducedMotion ? 0 : 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reducedMotion ? 0 : -10 }}
            transition={{ duration: reducedMotion ? 0.08 : 0.3, ease: 'easeOut' }}
          >
            {time}
          </motion.div>
        </AnimatePresence>
        <motion.div className="hc-lock-date" {...reveal(0.22, 16)}>{date}</motion.div>
        <motion.div className="hc-lock-status" {...reveal(0.29, 12)}>
          <Lock size={17} strokeWidth={1.7} aria-hidden="true" /> Интерфейс заблокирован
        </motion.div>
        {!securityReady ? (
          <p className="hc-lock-message" role="status">{securityError ?? 'Загрузка параметров безопасности…'}</p>
        ) : (
          <motion.button
            className="hc-lock-unlock"
            type="button"
            onClick={openEntry}
            disabled={lockoutRemaining > 0}
            autoFocus
            initial={{ opacity: 0, y: reducedMotion ? 0 : 16, scale: reducedMotion ? 1 : 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: reducedMotion ? 0.1 : 0.4, delay: reducedMotion ? 0 : 0.33, ease: 'easeOut' }}
            whileHover={reducedMotion ? undefined : { y: -3, scale: 1.035 }}
            whileTap={reducedMotion ? undefined : { scale: 0.965 }}
          >
            <Unlock size={18} strokeWidth={1.7} aria-hidden="true" /> Разблокировать
            <ArrowLeft size={17} strokeWidth={1.7} className="hc-lock-unlock-arrow" aria-hidden="true" />
          </motion.button>
        )}
      </div>

      <AnimatePresence>
        {lockoutRemaining > 0 && (
          <motion.div
            className="hc-lockout-screen"
            role="dialog"
            aria-modal="true"
            aria-label="Панель временно заблокирована"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reducedMotion ? 0.08 : 0.24 }}
          >
            <motion.div
              className="hc-lockout-content"
              initial={{ opacity: 0, y: reducedMotion ? 0 : 24, scale: reducedMotion ? 1 : 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: reducedMotion ? 0.1 : 0.45, ease: 'easeOut' }}
            >
              <motion.div
                className="hc-lockout-icon"
                animate={reducedMotion ? undefined : { scale: [1, 1.06, 1], opacity: [0.85, 1, 0.85] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
              >
                <LockKeyhole size={46} strokeWidth={1.5} />
              </motion.div>
              <p className="hc-lockout-eyebrow">HomeCloud Security</p>
              <h1>Панель заблокирована</h1>
              <p className="hc-lockout-description">
                Превышено количество попыток ввода PIN-кода. Все действия временно недоступны.
              </p>
              <div className="hc-lockout-countdown" aria-live="off">{formatCountdown(lockoutRemaining)}</div>
              <p className="hc-lockout-caption">Повторная попытка будет доступна через</p>
              <div className="hc-lockout-progress" aria-hidden="true">
                <motion.span
                  initial={{ scaleX: 1 }}
                  animate={{ scaleX: lockoutRemaining / 600 }}
                  transition={{ duration: 0.35, ease: 'linear' }}
                />
              </div>
              <p className="hc-lockout-attempts">3 неверных попытки · Защита активна</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {entryOpen && lockoutRemaining <= 0 && (
          <motion.div
            className="hc-lock-entry-layer"
            role="dialog"
            aria-modal="true"
            aria-label="Ввод PIN-кода"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reducedMotion ? 0.08 : 0.2 }}
          >
            <motion.div className="hc-lock-entry-backdrop" />
            <motion.section
              className="hc-lock-entry-panel"
              initial={{ opacity: 0, y: reducedMotion ? 0 : 28, scale: reducedMotion ? 1 : 0.96 }}
              animate={{
                opacity: 1,
                y: 0,
                scale: 1,
                x: phase === 'rejected' && !reducedMotion ? [0, -13, 12, -9, 7, 0] : 0,
              }}
              exit={{ opacity: 0, y: reducedMotion ? 0 : 18, scale: reducedMotion ? 1 : 0.98 }}
              transition={{ duration: reducedMotion ? 0.1 : 0.36, ease: 'easeOut' }}
            >
              <header className="hc-lock-entry-header">
                <div>
                  <p>HOMECloud · SECURITY</p>
                  <h2>Подтвердите личность</h2>
                  <span>Введите PIN-код для доступа к панели</span>
                </div>
                <button
                  type="button"
                  className="hc-lock-entry-close"
                  onClick={() => { setEntryOpen(false); setPin(''); setError(null); }}
                  aria-label="Вернуться на экран блокировки"
                  disabled={phase === 'checking' || phase === 'accepted'}
                >
                  <ArrowLeft size={21} />
                </button>
              </header>

              <AnimatePresence mode="wait">
                {phase === 'accepted' ? (
                  <motion.div
                    key="accepted"
                    className="hc-pin-success"
                    initial={{ opacity: 0, scale: 0.45, rotate: -18 }}
                    animate={{ opacity: 1, scale: 1, rotate: 0 }}
                    exit={{ opacity: 0, scale: 0.7 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 18 }}
                  >
                    <Check size={58} strokeWidth={2.2} />
                    <strong>Доступ разрешён</strong>
                  </motion.div>
                ) : (
                  <motion.div
                    key="entry"
                    className="hc-lock-entry-body"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.78, rotateX: 72, y: -18, filter: 'blur(7px)' }}
                    transition={{ duration: reducedMotion ? 0.08 : 0.38, ease: 'easeInOut' }}
                    style={{ transformPerspective: 900, transformOrigin: 'center center' }}
                  >
                    <div className={`hc-pin-tiles hc-pin-tiles--large ${phase === 'rejected' ? 'is-rejected' : ''}`} role="group" aria-label={`Введено ${pin.length} из ${pinLength ?? 0} цифр`}>
                      {Array.from({ length: pinLength ?? 0 }, (_, index) => (
                        <motion.span
                          key={index}
                          className={`hc-pin-tile ${index < pin.length ? 'is-filled' : ''}`}
                          initial={false}
                          animate={phase === 'rejected'
                            ? { backgroundColor: 'rgba(255, 76, 105, .25)', borderColor: 'rgba(255, 105, 130, .95)', color: '#ffd8df' }
                            : { backgroundColor: index < pin.length ? 'rgba(112, 222, 255, .2)' : 'rgba(255,255,255,.045)', borderColor: index < pin.length ? 'rgba(125,225,255,.95)' : 'rgba(196,225,255,.38)', color: '#f4fbff' }}
                          transition={{ duration: reducedMotion ? 0.08 : 0.18 }}
                        >
                          <AnimatePresence initial={false} mode="popLayout">
                            {pin[index] && (
                              <motion.span
                                key={`${index}-${pin[index]}`}
                                initial={{ opacity: 0, y: 13, scale: 0.65, rotateX: -35 }}
                                animate={{ opacity: 1, y: 0, scale: 1, rotateX: 0 }}
                                exit={{ opacity: 0, y: -12, scale: 0.55, rotateX: 35 }}
                                transition={{ duration: reducedMotion ? 0.06 : 0.2, ease: 'easeOut' }}
                                style={{ display: 'inline-block', transformPerspective: 500 }}
                              >
                                {pin[index]}
                              </motion.span>
                            )}
                          </AnimatePresence>
                        </motion.span>
                      ))}
                    </div>
                    <PinPad value={pin} onChange={handlePinChange} onBackspace={() => handlePinChange(pin.slice(0, -1))} maxLength={pinLength ?? 12} disabled={phase !== 'idle'} />
                    <div className={`hc-lock-entry-feedback ${phase === 'rejected' ? 'is-error' : ''}`} role="status" aria-live="polite">
                      {phase === 'checking'
                        ? 'Проверяем PIN-код…'
                        : error ?? (remainingAttempts < 3 ? `Осталось попыток: ${remainingAttempts}` : ' ')}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
