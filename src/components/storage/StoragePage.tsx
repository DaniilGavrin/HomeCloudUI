import { useState } from 'react';
import { HcssStoragePage } from './HcssStoragePage';
import { LegacyStoragePage } from './LegacyStoragePage';
import '../../styles/storage.css';

/** HC Storage Service is canonical; Backend Storage Manager remains opt-in for compatibility. */
export function StoragePage() {
  const [mode, setMode] = useState<'hcss' | 'legacy'>('hcss');
  return <div className="hc-storage-shell">
    <nav className="hc-storage-shell__switch" aria-label="Источник хранилищ">
      <button type="button" className={mode === 'hcss' ? 'hc-storage-shell__tab hc-storage-shell__tab--active' : 'hc-storage-shell__tab'}
        aria-current={mode === 'hcss' ? 'page' : undefined}
        onClick={() => setMode('hcss')}>HC Storage Service</button>
      <button type="button" className={mode === 'legacy' ? 'hc-storage-shell__tab hc-storage-shell__tab--active' : 'hc-storage-shell__tab'}
        aria-current={mode === 'legacy' ? 'page' : undefined}
        onClick={() => setMode('legacy')}>Storage Manager · совместимость</button>
    </nav>
    <div className="hc-storage-shell__content">
      {mode === 'hcss' ? <HcssStoragePage /> : <LegacyStoragePage />}
    </div>
  </div>;
}
