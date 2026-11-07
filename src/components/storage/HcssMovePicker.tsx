import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  type HcssDirectoryItem, type HcssListResponse,
  folderCrumbs, pathIsDirectChild,
} from './hcssModel';

type MovePickerProps = {
  serverId: string;
  storageNodeId: string;
  rootKind: 'disk' | 'folder';
  rootId: string;
  sourcePath: string;
  sourceName: string;
  initialFolder: string;
  disabled: boolean;
  onMove: (destinationPath: string) => void;
  onCancel: () => void;
};

/** Choose an existing destination directory without copying file bytes to UI. */
export function HcssMovePicker({
  serverId, storageNodeId, rootKind, rootId,
  sourcePath, sourceName, initialFolder, disabled, onMove, onCancel,
}: MovePickerProps) {
  const [directory, setDirectory] = useState(initialFolder);
  const currentDirectory = useRef(directory);
  currentDirectory.current = directory;
  const [folders, setFolders] = useState<HcssDirectoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setFolders([]);
    setNextCursor('');
    setError('');
    setLoading(true);
    void invoke<HcssListResponse>('homecloud_hcss_browse', {
      serverId, storageNodeId, rootKind, rootId, path: directory,
    }).then(result => {
      if (!active) return;
      if (result.root?.kind !== rootKind || result.root?.id !== rootId ||
          result.path !== directory || !Array.isArray(result.items)) {
        throw new Error('HC SS вернул другой каталог назначения');
      }
      setFolders(result.items.filter(item =>
        item.kind === 'folder' && pathIsDirectChild(directory, item)));
      setNextCursor(result.next_cursor ?? '');
    }).catch(reason => {
      if (active) setError(String(reason));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [serverId, storageNodeId, rootKind, rootId, directory]);

  async function loadMore() {
    if (!nextCursor || loadingMore || disabled) return;
    const path = directory;
    const cursor = nextCursor;
    setLoadingMore(true);
    setError('');
    try {
      const result = await invoke<HcssListResponse>('homecloud_hcss_browse', {
        serverId, storageNodeId, rootKind, rootId, path, cursor,
      });
      if (currentDirectory.current !== path) return;
      if (result.root?.kind !== rootKind || result.root?.id !== rootId ||
          result.path !== path || !Array.isArray(result.items)) {
        throw new Error('HC SS вернул другой каталог назначения');
      }
      setFolders(previous => [...previous, ...result.items.filter(item =>
        item.kind === 'folder' && pathIsDirectChild(path, item))]);
      setNextCursor(result.next_cursor ?? '');
    } catch (reason) {
      if (currentDirectory.current === path) setError(String(reason));
    } finally {
      if (currentDirectory.current === path) setLoadingMore(false);
    }
  }

  const destinationPath = directory ? `${directory}/${sourceName}` : sourceName;
  const sameDirectory = destinationPath === sourcePath;

  return <section className="hc-hcss__move-picker homecloud-glass" aria-label="Выбор папки назначения">
    <h4>Переместить «{sourceName}»</h4>
    <p>Папка назначения: <strong>{directory || 'Корень'}</strong></p>
    <nav className="hc-hcss__breadcrumbs" aria-label="Папка назначения">
      {folderCrumbs(directory).map((crumb, index) => <button key={crumb.path}
        type="button" aria-current={crumb.path === directory ? 'page' : undefined}
        disabled={disabled || loading || crumb.path === directory}
        onClick={() => setDirectory(crumb.path)}>
        {index ? '/ ' : ''}{crumb.label}
      </button>)}
    </nav>
    {loading ? <p role="status">Загружаем папки…</p> : <>
      {folders.length === 0 && <p>В этом каталоге нет вложенных папок.</p>}
      <div className="hc-hcss__files">
        {folders.map(item => <button key={item.path} type="button"
          className="hc-storage__file-row homecloud-glass"
          disabled={disabled || loadingMore}
          onClick={() => setDirectory(item.path)}>
          <span className="hc-storage__file-icon" aria-hidden="true">▤</span>
          <span className="hc-storage__file-text"><strong>{item.name}</strong></span>
          <span>Открыть ›</span>
        </button>)}
      </div>
      {nextCursor && <button type="button" className="hc-storage__button"
        disabled={disabled || loadingMore} onClick={() => void loadMore()}>
        {loadingMore ? 'Загружаем…' : 'Показать ещё папки'}
      </button>}
    </>}
    {error && <p className="hc-hcss__error" role="alert">{error}</p>}
    {sameDirectory && <p>Выбери другую папку для перемещения.</p>}
    <div className="hc-hcss__actions">
      <button className="hc-storage__button hc-storage__button--primary" type="button"
        disabled={disabled || loading || loadingMore || Boolean(error) || sameDirectory}
        onClick={() => onMove(destinationPath)}>Переместить сюда</button>
      <button className="hc-storage__button" type="button" disabled={disabled}
        onClick={onCancel}>Отмена</button>
    </div>
  </section>;
}
