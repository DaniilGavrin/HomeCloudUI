import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useHomeCloudPool } from '../../hooks/useHomeCloudPool';
import { useHomeCloudConnection } from '../../hooks/useHomeCloudConnection';
import {
  type HcssAgent, type HcssDirectoryItem, type HcssListResponse,
  filesystemVolumes, folderCrumbs, formatBytes, formatModified,
  isBrowsableRoot, pathIsDirectChild, rootKey,
} from './hcssModel';

type AgentResponse = { agents: HcssAgent[] };

export function HcssStoragePage() {
  const { snapshot: pool } = useHomeCloudPool();
  const connection = useHomeCloudConnection();
  const [serverId, setServerId] = useState('primary');
  const [agents, setAgents] = useState<HcssAgent[]>([]);
  const [nodeId, setNodeId] = useState('');
  const [rootId, setRootId] = useState('');
  const [folder, setFolder] = useState('');
  const [items, setItems] = useState<HcssDirectoryItem[]>([]);
  const [file, setFile] = useState<HcssDirectoryItem | null>(null);
  const [filter, setFilter] = useState('');
  const [reload, setReload] = useState(0);
  const [browseReload, setBrowseReload] = useState(0);
  const [catalogPhase, setCatalogPhase] = useState<'offline' | 'loading' | 'ready' | 'error'>('offline');
  const [browsePhase, setBrowsePhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [catalogError, setCatalogError] = useState('');
  const [browseError, setBrowseError] = useState('');
  const [partial, setPartial] = useState(false);
  const [nextCursor, setNextCursor] = useState('');
  const [moreLoading, setMoreLoading] = useState(false);
  const [moreError, setMoreError] = useState('');
  // Direct Tailnet management credential is deliberately memory-only.
  const [fileEndpoint, setFileEndpoint] = useState('');
  const [fileToken, setFileToken] = useState('');
  const [fileBusy, setFileBusy] = useState(false);
  const [fileError, setFileError] = useState('');
  const [fileNotice, setFileNotice] = useState('');
  const [fileProgress, setFileProgress] = useState<{role:string;completed_bytes:number;total_bytes:number}|null>(null);
  const [directoryName, setDirectoryName] = useState('');
  const [renameName, setRenameName] = useState('');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const backend = pool.servers.find(s => s.id === serverId);
  const online = serverId === 'primary' ? connection.phase === 'online' : backend?.phase === 'ready';
  const agent = agents.find(a => a.storage_node_id === nodeId) ?? null;
  const roots = agent?.roots ?? [];
  const root = roots.find(r => rootKey(r) === rootId && isBrowsableRoot(r)) ?? null;
  const volumes = filesystemVolumes(agent?.volumes);
  const blockDevices = agent?.volumes?.filter(v => v.kind === 'block') ?? [];
  const visible = useMemo(() => {
    const q = filter.trim().toLocaleLowerCase('ru-RU');
    return items.filter(item => pathIsDirectChild(folder, item) && (!q || item.name.toLocaleLowerCase('ru-RU').includes(q)));
  }, [items, folder, filter]);
  const filesCount = items.filter(v => v.kind === 'file').length;
  const fileConnected = Boolean(fileEndpoint.trim() && fileToken.trim());
  const selectionKey=JSON.stringify([serverId,nodeId,rootId,folder]);
  const liveSelection=useRef(selectionKey);
  liveSelection.current=selectionKey;
  useEffect(() => {
    let active=true;let stop:(()=>void)|undefined;
    void listen<{role:string;completed_bytes:number;total_bytes:number}>('homecloud:hcss-transfer-progress',ev=>{
      if(active)setFileProgress(ev.payload);
    }).then(fn=>{if(active)stop=fn;else fn();}).catch(()=>{});
    return ()=>{active=false;stop?.();};
  }, []);
  const dirsCount = items.filter(v => v.kind === 'folder').length;

  useEffect(() => {
    if (pool.servers.length && !pool.servers.some(s => s.id === serverId)) {
      setServerId(pool.servers.find(s => s.phase === 'ready')?.id ?? pool.servers[0].id);
    }
  }, [pool.servers, serverId]);

  // Each Backend has its own isolated agent registry. Never mix entries across servers.
  useEffect(() => {
    let active = true;
    setAgents([]); setNodeId(''); setRootId(''); setFolder('');
    setFileEndpoint('');setFileToken('');setFileNotice('');setFileError('');setFileProgress(null);
    setItems([]); setFile(null); setFilter(''); setPartial(false);
    setCatalogError(''); setBrowseError('');
    if (!online) { setCatalogPhase('offline'); setBrowsePhase('idle'); return () => { active = false; }; }
    setCatalogPhase('loading');
    void invoke<AgentResponse>('homecloud_hcss_sources', { serverId })
      .then(data => {
        if (!active) return;
        if (!Array.isArray(data.agents)) throw new Error('Неверный формат storage.agent.status');
        const next = data.agents;
        const first = next.find(a => a.online && a.roots?.some(isBrowsableRoot)) ?? next.find(a => a.online) ?? next[0];
        const allowed = first?.roots?.find(isBrowsableRoot);
        setAgents(next); setNodeId(first?.storage_node_id ?? '');
        setRootId(allowed ? rootKey(allowed) : '');
        setCatalogPhase('ready');
      })
      .catch(err => { if (active) { setCatalogPhase('error'); setCatalogError(String(err)); } });
    return () => { active = false; };
  }, [serverId, online, reload]);

  // Requests are cancelled logically when changing Backend, node, root or folder.
  useEffect(() => {
    let active = true;
    setItems([]); setFile(null); setPartial(false); setBrowseError('');setNextCursor('');setMoreError('');setMoreLoading(false);
    if (!online || !agent?.online || !root) {
      setBrowsePhase('idle');
      return () => { active = false; };
    }
    setBrowsePhase('loading');
    void invoke<HcssListResponse>('homecloud_hcss_browse', {
      serverId, storageNodeId: nodeId,
      rootKind: root.kind, rootId: root.id, path: folder,
    }).then(result => {
      if (!active) return;
      if (result.root?.kind !== root.kind || result.root?.id !== root.id || result.path !== folder ||
        !Array.isArray(result.items)) throw new Error('Некорректный каталог, полученный от HC SS');
      setItems(result.items);
      setPartial(Boolean(result.next_cursor));setNextCursor(result.next_cursor??'');
      setBrowsePhase('ready');
    }).catch(err => { if (active) { setBrowseError(String(err)); setBrowsePhase('error'); } });
    return () => { active = false; };
  }, [serverId, online, nodeId, rootId, folder, browseReload, agent?.online, root?.kind, root?.id]);

  function chooseNode(nextId: string) {
    const next = agents.find(a => a.storage_node_id === nextId);
    const allowed = next?.roots?.find(isBrowsableRoot);
    setNodeId(nextId); setRootId(allowed ? rootKey(allowed) : '');
    setFileEndpoint('');setFileToken('');setFileNotice('');setFileError('');
    setFolder(''); setFilter(''); setFile(null);
  }
  function chooseRoot(nextId: string) {
    setRootId(nextId); setFolder(''); setFilter(''); setFile(null);setFileNotice('');setFileError('');
  }
  function enterFolder(path: string) {
    setFolder(path); setFilter(''); setFile(null);setFileNotice('');setFileError('');
  }
  function reloadAll() { setReload(x => x + 1); }

  async function fileAction(operation: 'upload'|'download'|'mkdir'|'rename'|'delete',
    itemPath?: string, newPath?: string) {
    if (!agent?.online || !root || !fileConnected || fileBusy) return;
    setFileError('');setFileNotice('');setFileProgress(null);
    let remotePath=itemPath ?? '';
    let localFile:string|undefined;
    if(operation==='upload') {
      const chosen=await open({multiple:false,directory:false,title:'Файл для загрузки в HC Storage Service'});
      if(!chosen || typeof chosen!=='string')return;
      localFile=chosen;
      const name=chosen.split(/[\\/]/).pop()??'';
      if(!name || name==='.' || name==='..')return;
      remotePath=folder ? `${folder}/${name}` : name;
    }
    if(operation==='download') {
      const source=items.find(x=>x.path===remotePath&&x.kind==='file');
      if(!source)return;
      const dest=await save({defaultPath:source.name,title:'Сохранить из HC Storage Service'});
      if(!dest || typeof dest!=='string')return;
      localFile=dest;
    }
    setFileBusy(true);
    try {
      await invoke('homecloud_hcss_file_operation',{
        endpoint:fileEndpoint.trim(),token:fileToken.trim(),operation,
        rootKind:root.kind,rootId:root.id,path:remotePath,
        newPath:newPath??null,localFile:localFile??null,
      });
      setFileNotice(operation==='download' ? 'Файл скачан и проверен по SHA-256.' :
        operation==='upload' ? 'Файл загружен и проверен по SHA-256.' :
        operation==='mkdir' ? 'Каталог создан.' :
        operation==='rename' ? 'Файл переименован.' : 'Элемент удалён.');
      setPendingDelete(null);setFile(null);setDirectoryName('');setRenameName('');
      if(operation==='delete' && remotePath===folder) {
        setFolder(old=>old.split('/').slice(0,-1).join('/'));
      }
      if(operation!=='download')setBrowseReload(x=>x+1);
    } catch(error) {setFileError(String(error));}
    finally {setFileBusy(false);setFileProgress(null);}
  }
  async function loadMore() {
    if (!root || !agent?.online || !nextCursor || moreLoading || browsePhase!=='ready') return;
    const key=selectionKey;
    setMoreLoading(true);setMoreError('');
    try {
      const result=await invoke<HcssListResponse>('homecloud_hcss_browse',{
        serverId,storageNodeId:nodeId,rootKind:root.kind,rootId:root.id,path:folder,cursor:nextCursor,
      });
      if (liveSelection.current!==key)return;
      if (result.root?.kind!==root.kind||result.root?.id!==root.id||result.path!==folder||!Array.isArray(result.items)) {
        throw new Error('HC SS вернул каталог, отличный от запрошенного');
      }
      setItems(current=>{
        const seen=new Set(current.map(v=>v.path));
        return [...current,...result.items.filter(v=>pathIsDirectChild(folder,v)&&!seen.has(v.path))];
      });
      setNextCursor(result.next_cursor??'');
      setPartial(Boolean(result.next_cursor));
    }catch(error){if(liveSelection.current===key)setMoreError(String(error));}
    finally{if(liveSelection.current===key)setMoreLoading(false);}
  }
  function fileCanWrite(){return Boolean(root?.allow_write&&fileConnected&&!fileBusy);}
  function fileCanDelete(){return Boolean(root?.allow_delete&&fileConnected&&!fileBusy);}

  return <section className="hc-storage hc-storage--hcss" aria-label="HC Storage Service">
    <header className="hc-storage__head hc-storage__head--main">
      <div>
        <div className="hc-storage__overline">HOMECLOUD · HC STORAGE SERVICE</div>
        <h2>Хранилища</h2>
        <p>Диски и файлы узлов HomeCloud. Просмотр через Backend WS, без прямого подключения к HC SS.</p>
      </div>
      <div className="hc-storage__actions">
        <span className="hc-hcss__read-only">HC SS · защищённый Tailnet</span>
        <button className="hc-storage__button" type="button" onClick={reloadAll}
          disabled={!online || catalogPhase === 'loading'}>↻ Обновить</button>
      </div>
    </header>
    <div className="hc-storage__scroll">
      <div className="hc-storage__filters">
        <label><span>Backend</span>
          <select aria-label="Выбрать Backend" value={serverId} onChange={e => setServerId(e.target.value)}>
            {pool.servers.length
              ? pool.servers.map(s => <option value={s.id} key={s.id}>{s.name} · {s.phase}</option>)
              : <option value="primary">Основной Backend</option>}
          </select>
        </label>
        <span className={online ? 'hc-storage__state hc-storage__state--online' : 'hc-storage__state'}>
          <i />{online ? 'Backend Online' : 'Backend Offline'}
        </span>
      </div>

      {!online && <div className="hc-storage__empty homecloud-glass">
        <strong>Нет подключения к Backend</strong><span>Список HC Storage Service появится после соединения.</span>
      </div>}
      {online && catalogPhase === 'loading' && <div className="hc-storage__empty homecloud-glass">Получаем инвентаризацию HC SS…</div>}
      {online && catalogPhase === 'error' && <div role="alert" className="hc-hcss__error">
        Ошибка реестра узлов: {catalogError}
      </div>}
      {online && catalogPhase === 'ready' && <>
        <div className="hc-storage__stats">
          <div className="hc-storage__stat homecloud-glass">
            <span>Узлы HC Storage Service</span><strong>{agents.length}</strong>
            <small>{agents.filter(a => a.online).length} Online · {agents.length - agents.filter(a => a.online).length} Offline</small>
          </div>
          <div className="hc-storage__stat homecloud-glass">
            <span>Разрешённые корни</span><strong>{roots.length}</strong>
            <small>{roots.filter(isBrowsableRoot).length} доступны для просмотра</small>
          </div>
          <div className="hc-storage__stat homecloud-glass">
            <span>Файлы в каталоге</span><strong>{root && browsePhase === 'ready' ? filesCount : '—'}</strong>
            <small>{browsePhase === 'ready' ? `${dirsCount} каталогов · ${partial ? 'первая страница' : 'полный список'}` : 'Выбери разрешённый корень'}</small>
          </div>
        </div>

        <div className="hc-storage__section-head"><h3>Узлы хранения</h3><span>{agents.length} зарегистрировано</span></div>
        {!agents.length ? <div className="hc-storage__empty homecloud-glass">
          <strong>Нет HC Storage Service</strong><span>Подключи Storage Service к выбранному Backend.</span>
        </div> : <div className="hc-hcss__nodes" role="group" aria-label="Узлы хранения">
          {agents.map(a => <button key={a.storage_node_id} type="button"
            className={`hc-hcss__node homecloud-glass${nodeId === a.storage_node_id ? ' hc-hcss__node--active' : ''}`}
            onClick={() => chooseNode(a.storage_node_id)}>
            <strong>{a.storage_node_id}</strong>
            <span className={a.online ? 'hc-storage__pill hc-storage__pill--online' : 'hc-storage__pill'}>{a.online ? 'Online' : 'Offline'}</span>
            <small>Последняя активность: {a.last_seen ? new Date(a.last_seen).toLocaleString('ru-RU') : '—'}</small>
          </button>)}
        </div>}

        {agent && <>
          <div className="hc-storage__section-head">
            <h3>Диски и файловые системы</h3>
            <span>{volumes.length} смонтировано · {blockDevices.length} блочных устройств</span>
          </div>
          <div className="hc-storage__volumes">
            {!volumes.length && <div className="hc-storage__empty homecloud-glass">Нет данных о смонтированных файловых системах.</div>}
            {volumes.map(v => {
              const used = Math.max(0, v.size_bytes - v.available_bytes);
              const percent = v.size_bytes ? Math.min(100, Math.round(used * 100 / v.size_bytes)) : 0;
              return <article key={v.volume_id} className="hc-storage__volume homecloud-glass hc-hcss__volume">
                <div className="hc-storage__volume-head"><span className="hc-hcss__disc">▣</span>
                  <span className="hc-storage__pill hc-storage__pill--online">{v.fs_type || 'ФС'}</span></div>
                <strong>{v.mount_path || v.volume_id}</strong>
                <span className="hc-storage__path">Смонтирована · {v.read_only ? 'только чтение' : 'доступна для записи на узле'}</span>
                <div className="hc-storage__capacity"><span>{formatBytes(used)} занято</span><span>{percent}%</span></div>
                <div className="hc-storage__capacity-track"><i style={{width: `${percent}%`}} /></div>
                <small>{formatBytes(v.available_bytes)} доступно из {formatBytes(v.size_bytes)}</small>
              </article>;
            })}
          </div>
          <p className="hc-storage__note">Инвентаризация показывает смонтированные файловые системы; наличие диска не даёт доступ к его содержимому. Файлы доступны только через разрешённые корни HC SS.</p>
          <div className="hc-hcss__transfer-settings homecloud-glass">
            <div><strong>Защищённая передача файлов HC SS</strong>
              <small>Отдельный файловый WebSocket через Tailscale. Ключ остаётся только в памяти HomeCloudUI и не отправляется в Backend. HC SS должен разрешать Tailscale IP этого компьютера.</small></div>
            <label>Адрес HC SS в Tailscale
              <input value={fileEndpoint} onChange={e=>setFileEndpoint(e.target.value)}
                placeholder="ws://100.x.y.z:8093/ws/files" spellCheck={false} autoComplete="off" />
            </label>
            <label>Ключ HC SS (64 символа HEX)
              <input type="password" value={fileToken} onChange={e=>setFileToken(e.target.value)}
                placeholder="Ключ из защищённого файла HC SS" spellCheck={false} autoComplete="off" />
            </label>
            <span>{fileConnected ? 'Реквизиты введены, соединение будет проверено при операции' : 'Для управления файлами введи адрес и ключ HC SS'}</span>
          </div>

          <div className="hc-storage__section-head"><h3>Разрешённые корни HC SS</h3><span>{roots.length} опубликовано</span></div>
          <div className="hc-hcss__roots" role="group" aria-label="Разрешённые корни">
            {roots.length === 0 ? <div className="hc-storage__empty homecloud-glass">Корни ещё не опубликованы узлом.</div> :
              roots.map(r => <button type="button" key={rootKey(r)}
                disabled={!agent.online || !isBrowsableRoot(r)}
                className={`hc-hcss__root homecloud-glass${rootKey(r) === rootId ? ' hc-hcss__root--active' : ''}`}
                onClick={() => chooseRoot(rootKey(r))}>
                <strong>{r.name || r.id}</strong><small>{r.kind} · {r.id}</small>
                <span>{!r.online ? 'Offline' : !r.allow_list ? 'Просмотр запрещён' :
                  `Просмотр · ${r.allow_read ? 'чтение' : 'без чтения файлов'} · ${r.allow_write ? 'запись разрешена узлом' : 'без записи'}`}</span>
              </button>)}
          </div>

          <div className="hc-storage__section-head hc-storage__section-head--files">
            <div><h3>Проводник HC SS</h3><span>{root ? `${root.name || root.id} · ${folder || '/'}` : 'Выбери доступный корень'}</span></div>
            <button className="hc-storage__button" type="button" disabled={!root || !folder || browsePhase === 'loading'}
              onClick={() => enterFolder(folder.split('/').slice(0, -1).join('/'))}>← Вверх</button>
          </div>
          {root && <>
            <nav className="hc-hcss__breadcrumbs" aria-label="Путь каталога">
              {folderCrumbs(folder).map((crumb, i) => <button key={crumb.path} type="button"
                aria-current={crumb.path === folder ? 'page' : undefined}
                disabled={browsePhase === 'loading' || crumb.path === folder}
                onClick={() => enterFolder(crumb.path)}>{i ? '/ ' : ''}{crumb.label}</button>)}
            </nav>
            {root.allow_delete && folder && <div className="hc-hcss__actions">
              <button className="hc-storage__button hc-hcss__delete-button" type="button"
                disabled={!fileCanDelete()} onClick={()=>setPendingDelete(folder)}>Удалить текущий пустой каталог</button>
            </div>}
            {root.allow_write && <div className="hc-hcss__actions">
              <label>Новый каталог<input value={directoryName} onChange={e=>setDirectoryName(e.target.value)}
                 maxLength={180} placeholder="Название каталога" spellCheck={false}/></label>
              <button className="hc-storage__button hc-storage__button--primary" type="button"
                disabled={!fileCanWrite() || !directoryName.trim() || directoryName.includes('/') || directoryName.includes('\\')}
                onClick={()=>void fileAction('mkdir', folder ? `${folder}/${directoryName.trim()}` : directoryName.trim())}>
                Создать каталог</button>
              <button className="hc-storage__button hc-storage__button--primary" type="button"
                disabled={!fileCanWrite()} onClick={()=>void fileAction('upload')}>↑ Загрузить файл</button>
            </div>}
            <div className="hc-storage__toolbar">
              <label><span aria-hidden="true">⌕</span><input type="search" value={filter}
                onChange={e => setFilter(e.target.value)} placeholder="Поиск в текущем каталоге"
                aria-label="Поиск файлов в текущем каталоге"/></label>
              <button type="button" className="hc-storage__button" disabled={browsePhase === 'loading'}
                onClick={()=>setBrowseReload(x=>x+1)}>↻</button>
            </div>
            {browsePhase === 'loading' && <div className="hc-storage__empty homecloud-glass">Открываем каталог…</div>}
            {browsePhase === 'error' && <div role="alert" className="hc-hcss__error">{browseError}</div>}
            {browsePhase === 'ready' && <>
              {!visible.length ? <div className="hc-storage__empty homecloud-glass">
                <strong>Файлы не найдены</strong><span>{filter ? 'Ничего не совпадает с поиском' : 'Каталог пуст'}</span>
              </div> : <div className="hc-storage__files">
                {visible.map(item => <button key={item.path} type="button"
                  className={`hc-storage__file-row homecloud-glass${file?.path === item.path ? ' hc-hcss__file--selected' : ''}`}
                  onClick={() => item.kind === 'folder' ? enterFolder(item.path) : setFile(item)}>
                  <span className="hc-storage__file-icon">{item.kind === 'folder' ? '▤' : '▧'}</span>
                  <span className="hc-storage__file-text"><strong title={item.name}>{item.name}</strong>
                    <small>{item.kind === 'folder' ? 'Каталог' : 'Файл'} · {formatModified(item.modified_unix_nano)}</small></span>
                  <span className="hc-storage__file-size">{item.kind === 'folder' ? 'Открыть' : formatBytes(item.size_bytes)}</span>
                  <span aria-hidden="true">›</span>
                </button>)}
              </div>}
              {partial && <div className="hc-hcss__actions">
                <button className="hc-storage__button" type="button" disabled={moreLoading||fileBusy}
                  onClick={()=>void loadMore()}>{moreLoading?'Загружаем…':'Показать ещё 500 элементов'}</button>
                <span>Список загружается страницами, без полного чтения каталога в память</span>
              </div>}
              {moreError && <div className="hc-hcss__error" role="alert">{moreError}</div>}
              {file && <aside className="hc-hcss__file-detail homecloud-glass" aria-label="Сведения о выбранном файле">
                <div><strong>{file.name}</strong>
                  <button className="hc-storage__button" type="button" onClick={() => setFile(null)} aria-label="Закрыть сведения о файле">×</button>
                </div>
                <dl>
                  <dt>Относительный путь</dt><dd>{file.path}</dd>
                  <dt>Размер</dt><dd>{formatBytes(file.size_bytes)}</dd>
                  <dt>Изменён</dt><dd>{formatModified(file.modified_unix_nano)}</dd>
                  <dt>HCS1 file ID</dt><dd className="hc-hcss__file-id">{file.file_id || 'Не предоставлен Storage Service'}</dd>
                </dl>
                <div className="hc-hcss__actions">
                  <button className="hc-storage__button hc-storage__button--primary" type="button"
                    disabled={!root.allow_read||!fileConnected||fileBusy}
                    onClick={()=>void fileAction('download',file.path)}>↓ Скачать с SHA-256</button>
                  {root.allow_write&&root.allow_delete&&<>
                    <label>Новое имя файла<input value={renameName} onChange={e=>setRenameName(e.target.value)}
                      placeholder={file.name} maxLength={180}/></label>
                    <button className="hc-storage__button" type="button"
                      disabled={!fileCanWrite()||!renameName.trim()||renameName.includes('/')||renameName.includes('\\')}
                      onClick={()=>void fileAction('rename',file.path,(folder ? `${folder}/` : '')+renameName.trim())}>
                      Переименовать</button>
                  </>}
                  {root.allow_delete&&<button className="hc-storage__button" type="button" disabled={!fileCanDelete()}
                    onClick={()=>setPendingDelete(file.path)}>Удалить файл</button>}
                </div>
              </aside>}
              {root.allow_delete && pendingDelete && <div className="hc-hcss__delete-confirm" role="alertdialog"
                aria-label="Подтверждение удаления">
                <strong>Удалить «{items.find(x=>x.path===pendingDelete)?.name ?? pendingDelete}»?</strong>
                <span>Действие необратимо. Каталоги удаляются только пустыми.</span>
                <button className="hc-storage__button" type="button" disabled={fileBusy}
                  onClick={()=>setPendingDelete(null)}>Отмена</button>
                <button className="hc-storage__button hc-hcss__delete-button" type="button"
                  disabled={!fileCanDelete()} onClick={()=>void fileAction('delete',pendingDelete)}>Подтвердить удаление</button>
              </div>}
              {fileProgress&&fileBusy&&<div className="hc-hcss__progress" role="status">
                {fileProgress.role==='upload'?'Загрузка':'Скачивание'} · {formatBytes(fileProgress.completed_bytes)} / {formatBytes(fileProgress.total_bytes)}
                <div><i style={{width:`${fileProgress.total_bytes ? Math.round(fileProgress.completed_bytes*100/fileProgress.total_bytes):100}%`}}/></div>
              </div>}
              {fileError && <div className="hc-hcss__error" role="alert">{fileError}</div>}
              {fileNotice && <div className="hc-hcss__success" role="status">{fileNotice}</div>}
            </>}
          </>}
        </>}
      </>}
    </div>
  </section>;
}
