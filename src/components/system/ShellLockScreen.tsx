import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ShellIcon } from './ShellIcon';

type Props = { onUnlock: () => void };

export function ShellLockScreen({ onUnlock }: Props) {
  const [now, setNow] = useState(() => new Date());
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
          <ShellIcon name="cloud" /> <span>HomeCloud</span>
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
          <ShellIcon name="lock" /> Оболочка заблокирована
        </motion.div>
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
          <ShellIcon name="unlock" /> Разблокировать
          <ShellIcon name="arrow" className="hc-lock-unlock-arrow" />
        </motion.button>
      </div>
      <motion.div className="hc-lock-caption" {...reveal(0.42, 5)}>
        Блокировка интерфейса · Без PIN-кода в текущей версии
      </motion.div>
    </motion.section>
  );
}
