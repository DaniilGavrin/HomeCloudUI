import { useCallback, useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { AnimatePresence, MotionConfig } from 'motion/react';
import { ShellLockScreen } from './components/system/ShellLockScreen';
import { ShellPowerMenu } from './components/system/ShellPowerMenu';
import { ShellLayout } from './components/shell/ShellLayout';
import './styles/shell-layout.css';
import './App.css';
import './styles/shell.css';

const LOCK_KEY = 'homecloud:shell-locked';

type SecurityStatus = { enabled: boolean; pin_length: number | null };

function wasLocked(): boolean {
  try {
    return window.sessionStorage.getItem(LOCK_KEY) === '1';
  } catch {
    return false;
  }
}

function App() {
  const [locked, setLocked] = useState(wasLocked);
  const [powerOpen, setPowerOpen] = useState(false);
  const [powerError, setPowerError] = useState<string | null>(null);
  const [security, setSecurity] = useState<SecurityStatus | null>(null);
  const [securityError, setSecurityError] = useState<string | null>(null);

  const refreshSecurity = useCallback(async () => {
    try {
      const status = await invoke<SecurityStatus>('shell_security_status');
      setSecurity(status);
      setSecurityError(null);
    } catch {
      setSecurity(null);
      setSecurityError('Не удалось загрузить параметры безопасности.');
    }
  }, []);

  useEffect(() => {
    void refreshSecurity();
    const onSecurityChanged = () => void refreshSecurity();
    window.addEventListener('homecloud:security-changed', onSecurityChanged);
    return () => window.removeEventListener('homecloud:security-changed', onSecurityChanged);
  }, [refreshSecurity]);

  const verifyPin = useCallback((pin: string) =>
    invoke<boolean>('shell_security_verify_pin', { pin }), []);

  const lockShell = useCallback(() => {
    try {
      window.sessionStorage.setItem(LOCK_KEY, '1');
    } catch {
      // Session storage is optional; in-memory lock still works.
    }
    setPowerOpen(false);
    setPowerError(null);
    setLocked(true);
  }, []);

  const unlockShell = useCallback(() => {
    try {
      window.sessionStorage.removeItem(LOCK_KEY);
    } catch {
      // Continue even if session storage is unavailable.
    }
    setLocked(false);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || !event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) {
        return;
      }

      // Avoid intercepting uppercase F/G when typing in an input in future screens.
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable="true"]')) {
        return;
      }

      if (event.code === 'KeyG') {
        event.preventDefault();
        if (!locked) lockShell();
      } else if (event.code === 'KeyF') {
        event.preventDefault();
        if (!locked) {
          setPowerError(null);
          setPowerOpen((value) => !value);
        }
      }
    };

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !locked) {
        setPowerOpen(false);
        setPowerError(null);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keydown', onEscape);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keydown', onEscape);
    };
  }, [locked, lockShell]);

  const restartShell = () => {
    // Reloads only the WebView/React shell; Rust WebSocket stays alive.
    window.location.reload();
  };

  const powerOffShell = async () => {
    try {
      await getCurrentWindow().close();
    } catch (error) {
      setPowerError(`Не удалось закрыть оболочку: ${String(error)}`);
    }
  };

  return (
      <MotionConfig reducedMotion="user">
        <main className="homecloud-screen h-screen w-screen">
          {/* Основной рабочий стол HomeCloud */}
          <ShellLayout onLock={lockShell} onOpenPower={() => { setPowerError(null); setPowerOpen(true); }} />

          {/* Меню питания поверх рабочего стола */}
          <AnimatePresence initial={false}>
            {!locked && powerOpen && (
                <ShellPowerMenu
                    key="homecloud-power"
                    onDismiss={() => {
                      setPowerOpen(false);
                      setPowerError(null);
                    }}
                    onLock={lockShell}
                    onRestart={restartShell}
                    onPowerOff={() => void powerOffShell()}
                    error={powerError}
                />
            )}
          </AnimatePresence>

          {/* Экран блокировки поверх всей оболочки */}
          <AnimatePresence initial={false}>
            {locked && (
                <ShellLockScreen
                    key="homecloud-lock"
                    securityReady={security !== null}
                    securityError={securityError}
                    pinLength={security?.enabled ? security.pin_length : null}
                    onVerify={verifyPin}
                    onUnlock={unlockShell}
                />
            )}
          </AnimatePresence>
        </main>
      </MotionConfig>
  );
}

export default App;
