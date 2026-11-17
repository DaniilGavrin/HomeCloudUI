import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Cloud, Lock, Unlock } from 'lucide-react';
import { PinPad } from './PinPad';

type Props = {
  securityReady: boolean;
  securityError?: string | null;
  pinLength: number | null;
  onVerify: (pin: string) => Promise<boolean>;
  onUnlock: () => void;
};

export function ShellLockScreen({ securityReady, securityError, pinLength, onVerify, onUnlock }: Props) {
  const [now, setNow] = useState(() => new Date());
  const [pin, setPin] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reducedMotion = Boolean(useReducedMotion());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15000);
    return () => window.clearInterval(timer);
  }, []);

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

  const enterDigit = (next: string) => {
    setPin(next);
    setError(null);
    if (pinLength !== null && next.length === pinLength) {
      setVerifying(true);
      void onVerify(next).then((valid) => {
        if (valid) {
          onUnlock();
          return;
        }
        setPin('');
        setError('Неверный PIN-код. Попробуйте ещё раз.');
      }).catch(() => {
        setPin('');
        setError('Не удалось проверить PIN-код. Попробуйте ещё раз.');
      }).finally(() => setVerifying(false));
    }
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
        ) : pinLength !== null ? (
          <motion.div className="hc-lock-pin" {...reveal(0.33, 12)}>
            <p className="hc-lock-pin__title">Введите PIN-код</p>
            <div className="hc-pin-tiles" role="group" aria-label={`Введено ${pin.length} из ${pinLength} цифр`}>
              {Array.from({ length: pinLength }, (_, index) => (
                <span key={index} className={`hc-pin-tile ${index < pin.length ? 'is-filled' : ''}`} />
              ))}
            </div>
            <PinPad value={pin} onChange={enterDigit} disabled={verifying} />
            <p className="hc-lock-message" role="status" aria-live="polite">
              {verifying ? 'Проверка…' : error ?? ' '}
            </p>
          </motion.div>
        ) : (
          <motion.button
            className="hc-lock-unlock"
            type="button"
            onClick={onUnlock}
            autoFocus
            initial={{ opacity: 0, y: reducedMotion ? 0 : 16, scale: reducedMotion ? 1 : 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: reducedMotion ? 0.1 : 0.4, delay: reducedMotion ? 0 : 0.33, ease: 'easeOut' }}
            whileHover={reducedMotion ? undefined : { y: -3, scale: 1.035 }}
            whileTap={reducedMotion ? undefined : { scale: 0.965 }}
          >
            <Unlock size={18} strokeWidth={1.7} aria-hidden="true" /> Разблокировать
          </motion.button>
        )}
      </div>
    </motion.section>
  );
}
