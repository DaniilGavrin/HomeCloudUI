import { useEffect, useRef } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import type { Transition } from 'motion/react';
import { ShellIcon } from './ShellIcon';

type Props = {
  onDismiss: () => void;
  onLock: () => void;
  onRestart: () => void;
  onPowerOff: () => void;
  error: string | null;
};

export function ShellPowerMenu({ onDismiss, onLock, onRestart, onPowerOff, error }: Props) {
  const lockButtonRef = useRef<HTMLButtonElement>(null);
  const reducedMotion = Boolean(useReducedMotion());

  useEffect(() => {
    lockButtonRef.current?.focus();
  }, []);

  const panelTransition: Transition = reducedMotion
    ? { duration: 0.12 }
    : { type: 'spring', stiffness: 420, damping: 34, mass: 0.88 };

  const panelInitial = {
    opacity: 0,
    y: reducedMotion ? 0 : 20,
    scale: reducedMotion ? 1 : 0.945,
  };
  const panelExit = {
    opacity: 0,
    y: reducedMotion ? 0 : 9,
    scale: reducedMotion ? 1 : 0.975,
    transition: { duration: reducedMotion ? 0.08 : 0.18, ease: 'easeIn' as const },
  };

  const itemInitial = { opacity: 0, y: reducedMotion ? 0 : 10 };
  const itemAnimate = { opacity: 1, y: 0 };
  const actionMotion = {
    whileHover: reducedMotion ? undefined : { x: 4, scale: 1.012 },
    whileTap: reducedMotion ? undefined : { scale: 0.975 },
  };

  return (
    <div className="hc-power-layer">
      <motion.div
        className="hc-power-backdrop"
        aria-hidden="true"
        onClick={onDismiss}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reducedMotion ? 0.09 : 0.23, ease: 'easeOut' }}
      />

      <motion.section
        className="hc-power-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Питание HomeCloud"
        initial={panelInitial}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={panelExit}
        transition={panelTransition}
      >
        <motion.header
          className="hc-power-header"
          initial={{ opacity: 0, y: reducedMotion ? 0 : 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reducedMotion ? 0.1 : 0.25, delay: reducedMotion ? 0 : 0.07 }}
        >
          <div className="hc-power-symbol"><ShellIcon name="power" /></div>
          <div className="hc-power-heading">
            <h2>Питание</h2>
            <p>Управление оболочкой HomeCloud</p>
          </div>
          <motion.button
            type="button"
            className="hc-power-dismiss"
            onClick={onDismiss}
            aria-label="Закрыть меню"
            whileHover={reducedMotion ? undefined : { rotate: 90, scale: 1.12 }}
            whileTap={reducedMotion ? undefined : { scale: 0.9 }}
          >
            <ShellIcon name="close" />
          </motion.button>
        </motion.header>

        <div className="hc-power-actions">
          <motion.button
            ref={lockButtonRef}
            type="button"
            className="hc-power-action"
            onClick={onLock}
            initial={itemInitial}
            animate={itemAnimate}
            transition={{ duration: reducedMotion ? 0.08 : 0.26, delay: reducedMotion ? 0 : 0.12 }}
            {...actionMotion}
          >
            <span className="hc-power-action-icon"><ShellIcon name="lock" /></span>
            <span className="hc-power-action-text">
              <strong>Заблокировать</strong>
              <small>Экран блокировки HomeCloud</small>
            </span>
            <ShellIcon name="arrow" className="hc-power-chevron" />
          </motion.button>

          <motion.button
            type="button"
            className="hc-power-action"
            onClick={onRestart}
            initial={itemInitial}
            animate={itemAnimate}
            transition={{ duration: reducedMotion ? 0.08 : 0.26, delay: reducedMotion ? 0 : 0.17 }}
            {...actionMotion}
          >
            <span className="hc-power-action-icon"><ShellIcon name="restart" /></span>
            <span className="hc-power-action-text">
              <strong>Перезагрузить оболочку</strong>
              <small>Перезагрузить интерфейс, не отключая сервер</small>
            </span>
            <ShellIcon name="arrow" className="hc-power-chevron" />
          </motion.button>

          <div className="hc-power-separator" />

          <motion.button
            type="button"
            className="hc-power-action hc-power-action-danger"
            onClick={onPowerOff}
            initial={itemInitial}
            animate={itemAnimate}
            transition={{ duration: reducedMotion ? 0.08 : 0.26, delay: reducedMotion ? 0 : 0.22 }}
            {...actionMotion}
          >
            <span className="hc-power-action-icon"><ShellIcon name="power" /></span>
            <span className="hc-power-action-text">
              <strong>Выключить питание</strong>
              <small>Закрыть приложение HomeCloud</small>
            </span>
            <ShellIcon name="arrow" className="hc-power-chevron" />
          </motion.button>
        </div>
        {error && (
          <motion.p
            className="hc-power-error"
            role="alert"
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
          >
            {error}
          </motion.p>
        )}
        <motion.footer
          className="hc-power-footer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: reducedMotion ? 0.08 : 0.2, delay: reducedMotion ? 0 : 0.25 }}
        >
          <kbd>Shift</kbd> + <kbd>F</kbd> — меню питания <span>·</span> <kbd>Esc</kbd> — закрыть
        </motion.footer>
      </motion.section>
    </div>
  );
}
