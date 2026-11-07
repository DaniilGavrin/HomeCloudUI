import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useHomeCloudPool } from '../../hooks/useHomeCloudPool';
import { useHomeCloudDeviceRegistry } from '../../hooks/useHomeCloudDeviceRegistry';
import { useHomeCloudMediaRooms, refreshMediaRooms } from '../../hooks/useHomeCloudMediaRooms';
import { kindOf } from '../devices/deviceKind';
import {
  type HcssAgent, type HcssDirectoryItem, type HcssListResponse,
  rootKey, isBrowsableRoot, pathIsDirectChild, folderCrumbs, formatModified, formatBytes,
} from '../storage/hcssModel';
import '../../styles/explorer.css';

type Action = 'upload'|'download'|'mkdir'|'touch'|'copy'|'move'|'rename'|'delete';
type Mode = 'grid'|'list';
type Sort = 'name'|'size'|'modified'|'type';
type Clipboard = { scope: string; paths: string[]; mode: 'copy'|'move' };
type Modal =
  | { type: 'create-folder'|'create-file'|'rename'|'delete'|'properties'; paths: string[] }
  | { type: 'destination'; paths: string[]; mode: 'copy'|'move' }
  | { type: 'tv'; paths: string[] }
  | { type: 'history'; paths: string[] };
type Menu = { x: number; y: number; path: string };
type Progress = {role:string;completed_bytes:number;total_bytes:number};
type AgentResponse = { agents: HcssAgent[] };

const parentOf = (p:string) => p.split('/').slice(0,-1).join('/');
const basename = (p:string) => p.split('/').pop() ?? p;
const join = (parent:string,name:string) => parent ? `${parent}/${name}` : name;
const canUseName = (name:string) =>
  Boolean(name && name !== '.' && name !== '..' && name.length <= 180 &&
    !/[\\/:\u0000]/.test(name) && !name.startsWith('.hcss-upload-') &&
    !name.startsWith('.hcss-copy-'));
const mediaFile = (name:string) => /\.(mp3|m4a|flac|wav|aac|ogg|opus|mp4|m4v|mkv|avi|webm|mov|ts|mpeg|mpg)$/i.test(name);
type Category = 'folder'|'audio'|'video'|'image'|'archive'|'document'|'code'|'other';
function category(item:HcssDirectoryItem):Category {
  if (item.kind === 'folder') return 'folder';
  const name=item.name.toLowerCase();
  if (/\.(mp3|m4a|wav|flac|aac|ogg|opus)$/.test(name)) return 'audio';
  if (/\.(mp4|mov|mkv|webm|avi|ts|m4v)$/.test(name)) return 'video';
  if (/\.(png|jpg|jpeg|gif|webp|svg|avif|bmp)$/.test(name)) return 'image';
  if (/\.(zip|7z|rar|gz|tar|xz)$/.test(name)) return 'archive';
  if (/\.(go|rs|py|js|ts|tsx|jsx|json|yaml|yml|md|html|css)$/.test(name)) return 'code';
  if (/\.(pdf|doc|docx|odt|txt|xls|xlsx)$/.test(name)) return 'document';
  return 'other';
}
const glyph:Record<Category,string> = {
  folder:'▤',audio:'♫',video:'▶',image:'▧',archive:'▣',document:'▤',code:'{ }',other:'◇',
};
const categoryName:Record<Category,string> = {
  folder:'Папка',audio:'Аудио',video:'Видео',image:'Изображение',
  archive:'Архив',document:'Документ',code:'Код',other:'Файл',
};
function sorted(items:HcssDirectoryItem[],sort:Sort,hidden:boolean,query:string) {
  const q=query.trim().toLocaleLowerCase('ru-RU');
  return items.filter(item => (hidden||!item.name.startsWith('.')) &&
    (!q||item.name.toLocaleLowerCase('ru-RU').includes(q))).sort((a,b) => {
    if(a.kind!==b.kind) return a.kind==='folder'?-1:1;
    const first=sort==='size'?a.size_bytes-b.size_bytes :
      sort==='modified'?a.modified_unix_nano-b.modified_unix_nano :
      sort==='type'?category(a).localeCompare(category(b)) : 0;
    return first||a.name.localeCompare(b.name,'ru-RU',{numeric:true,sensitivity:'base'});
  });
}
function icon(item:HcssDirectoryItem,size:'lg'|'sm'='sm') {
  const cat=category(item);
  return <span className={`hc-explorer-icon hc-explorer-icon--${cat} hc-explorer-icon--${size}`} aria-hidden="true">{glyph[cat]}</span>;
}

export function HcssExplorerPage() {
  const {snapshot:pool}=useHomeCloudPool();
  const {snapshot:registry}=useHomeCloudDeviceRegistry();
  const [serverId,setServerId]=useState('');
  const {snapshot:mediaRooms}=useHomeCloudMediaRooms(serverId);
  const [agents,setAgents]=useState<HcssAgent[]>([]);
  const [nodeId,setNodeId]=useState('');
  const [rootId,setRootId]=useState('');
  const [folder,setFolder]=useState('');
  const [items,setItems]=useState<HcssDirectoryItem[]>([]);
  const [cursor,setCursor]=useState('');
  const [browseStatus,setBrowseStatus]=useState<'idle'|'loading'|'ready'|'error'>('idle');
  const [reload,setReload]=useState(0);
  const [loadingNodes,setLoadingNodes]=useState(false);
  const [busy,setBusy]=useState(false);
  const locked=useRef(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [progress,setProgress]=useState<Progress|null>(null);
  const [selected,setSelected]=useState<Set<string>>(new Set());
  const [anchor,setAnchor]=useState('');
  const [clipboard,setClipboard]=useState<Clipboard|null>(null);
  const [view,setView]=useState<Mode>('list');
  const [sort,setSort]=useState<Sort>('name');
  const [showHidden,setShowHidden]=useState(false);
  const [query,setQuery]=useState('');
  const [history,setHistory]=useState<string[]>([]);
  const [back,setBack]=useState<string[]>([]);
  const [forward,setForward]=useState<string[]>([]);
  const [favorites,setFavorites]=useState<string[]>([]);
  const [modal,setModal]=useState<Modal|null>(null);
  const [name,setName]=useState('');
  const [menu,setMenu]=useState<Menu|null>(null);
  const [dragPath,setDragPath]=useState('');
  const [dragTarget,setDragTarget]=useState('');
  const [destFolder,setDestFolder]=useState('');
  const destinationRef=useRef(destFolder);
  destinationRef.current=destFolder;
  const [destItems,setDestItems]=useState<HcssDirectoryItem[]>([]);
  const [destCursor,setDestCursor]=useState('');
  const [destLoading,setDestLoading]=useState(false);
  const [tvId,setTvId]=useState('');
  const [replaceRoom,setReplaceRoom]=useState(false);
  const [network,setNetwork]=useState<'lan'|'tailscale'>('lan');
  const [addressEditing,setAddressEditing]=useState(false);
  const [address,setAddress]=useState('');
  const [moreLoading,setMoreLoading]=useState(false);

  const server=pool.servers.find(s=>s.id===serverId);
  const online=server?.phase==='ready';
  const agent=agents.find(a=>a.storage_node_id===nodeId);
  const roots=agent?.roots?.filter(isBrowsableRoot)??[];
  const root=roots.find(r=>rootKey(r)===rootId);
  const endpoints=agent?.online
    ? (agent.file_ws?.endpoints?.length?agent.file_ws.endpoints:
      agent.file_ws?.endpoint?[agent.file_ws.endpoint]:[])
    : [];
  const scope=JSON.stringify([serverId,nodeId,root?.kind,root?.id]);
  const selectionFence=JSON.stringify([scope,folder]);
  const currentFence=useRef(selectionFence);
  currentFence.current=selectionFence;
  const writable=Boolean(online&&agent?.online&&root?.allow_write&&endpoints.length&&!busy);
  const deletable=Boolean(online&&agent?.online&&root?.allow_delete&&endpoints.length&&!busy);
  const readable=Boolean(root?.allow_read&&endpoints.length&&!busy);
  const shown=useMemo(()=>sorted(items.filter(x=>pathIsDirectChild(folder,x)),sort,showHidden,query),
    [items,sort,showHidden,query,folder]);
  const chosen=shown.filter(x=>selected.has(x.path));
  const allChosen=items.filter(x=>selected.has(x.path));
  const tvs=registry.devices.filter(d=>d.server_id===serverId&&d.online&&kindOf(d.client_type)==='tv');
  const existingRoom=mediaRooms.phase==='ready'&&mediaRooms.server_id===serverId
    ? mediaRooms.rooms.find(room=>room.target.device_id===tvId&&room.room_state!=='CLOSED')
    : null;
  const selectedForModal=modal?.paths.map(p=>items.find(x=>x.path===p)).filter((x):x is HcssDirectoryItem=>Boolean(x))??[];

  useEffect(()=>{
    const chosenServer=pool.servers.find(s=>s.id===serverId);
    if(!chosenServer&&pool.servers.length) setServerId((pool.servers.find(s=>s.phase==='ready')??pool.servers[0]).id);
  },[pool.servers,serverId]);

  useEffect(()=>{
    let active=true;
    setAgents([]);setNodeId('');setRootId('');setFolder('');
    setBack([]);setForward([]);setSelected(new Set());setModal(null);setClipboard(null);
    if(!online) return ()=>{active=false};
    setLoadingNodes(true);
    void invoke<AgentResponse>('homecloud_hcss_sources',{serverId}).then(data=>{
      if(!active)return;
      if(!Array.isArray(data.agents))throw Error('Неверный ответ storage.agent.status');
      setAgents(data.agents);
      const node=data.agents.find(a=>a.online&&a.roots?.some(isBrowsableRoot));
      setNodeId(node?.storage_node_id??'');
      const first=node?.roots?.find(isBrowsableRoot);
      setRootId(first?rootKey(first):'');
    }).catch(e=>{if(active)setError(String(e))})
      .finally(()=>{if(active)setLoadingNodes(false)});
    return ()=>{active=false};
  },[serverId,online]);

  useEffect(()=>{
    setItems([]);setCursor('');setSelected(new Set());setModal(null);setError('');
    if(!online||!agent?.online||!root){setBrowseStatus('idle');return;}
    let active=true;
    setBrowseStatus('loading');
    void invoke<HcssListResponse>('homecloud_hcss_browse',{
      serverId,storageNodeId:nodeId,rootKind:root.kind,rootId:root.id,path:folder,
    }).then(result=>{
      if(!active)return;
      if(result.path!==folder||result.root?.kind!==root.kind||
        result.root?.id!==root.id||!Array.isArray(result.items))throw Error('HC SS вернул другой каталог');
      setItems(result.items.filter(x=>pathIsDirectChild(folder,x)));
      setCursor(result.next_cursor??'');
      setBrowseStatus('ready');
    }).catch(e=>{if(active){setError(String(e));setBrowseStatus('error')}});
    return ()=>{active=false};
  },[online,agent?.online,serverId,nodeId,rootId,folder,root?.kind,root?.id,reload]);

  useEffect(()=>{
    let active=true,stop:undefined|(()=>void);
    void listen<Progress>('homecloud:hcss-transfer-progress',e=>{if(active&&locked.current)setProgress(e.payload)})
      .then(fn=>{if(active)stop=fn;else fn()}).catch(()=>{});
    return ()=>{active=false;stop?.()};
  },[]);

  useEffect(()=>{
    try {
      const raw=window.localStorage.getItem('homecloud:explorer:favorites:'+scope);
      const list=raw?JSON.parse(raw):[];
      setFavorites(Array.isArray(list)?list.filter((v):v is string=>typeof v==='string'&&v.length<=1800):[]);
    }catch{setFavorites([])}
  },[scope]);

  const navigate=useCallback((path:string)=>{
    if(locked.current||path===folder)return;
    setBack(old=>[...old.slice(-49),folder]);setForward([]);
    setFolder(path);setQuery('');setMenu(null);setAddressEditing(false);
  },[folder]);

  function navigateHistory(direction:'back'|'forward'){
    if(locked.current)return;
    if(direction==='back'){
      const target=back[back.length-1];if(target===undefined)return;
      setBack(old=>old.slice(0,-1));setForward(old=>[...old,folder]);setFolder(target);
    }else{
      const target=forward[forward.length-1];if(target===undefined)return;
      setForward(old=>old.slice(0,-1));setBack(old=>[...old,folder]);setFolder(target);
    }
    setQuery('');setModal(null);setMenu(null);
  }

  function changeRoot(next:string){
    if(locked.current)return;
    setRootId(next);setFolder('');setBack([]);setForward([]);setClipboard(null);
    setModal(null);setMenu(null);
  }
  function changeNode(next:string){
    if(locked.current)return;
    setNodeId(next);setRootId('');
    const candidate=agents.find(a=>a.storage_node_id===next)?.roots?.find(isBrowsableRoot);
    if(candidate)setRootId(rootKey(candidate));
    setFolder('');setBack([]);setForward([]);setClipboard(null);
    setModal(null);setMenu(null);
  }

  async function loadMore(destination=false){
    if(!root||!agent?.online||moreLoading||destLoading)return;
    const current=destination?destFolder:folder;
    const next=destination?destCursor:cursor;
    if(!next)return;
    const fence=currentFence.current;
    if(destination)setDestLoading(true);else setMoreLoading(true);
    try{
      const result=await invoke<HcssListResponse>('homecloud_hcss_browse',{
        serverId,storageNodeId:nodeId,rootKind:root.kind,rootId:root.id,path:current,cursor:next,
      });
      if(fence!==currentFence.current||result.path!==current||
        (destination&&destinationRef.current!==current)||
        result.root.kind!==root.kind||result.root.id!==root.id) return;
      if(destination){
        setDestItems(old=>[...old,...result.items.filter(x=>x.kind==='folder'&&!old.some(y=>y.path===x.path))]);
        setDestCursor(result.next_cursor??'');
      }else{
        setItems(old=>[...old,...result.items.filter(x=>pathIsDirectChild(folder,x)&&!old.some(y=>y.path===x.path))]);
        setCursor(result.next_cursor??'');
      }
    }catch(e){setError(String(e))}
    finally{setMoreLoading(false);setDestLoading(false)}
  }

  function selectEntry(item:HcssDirectoryItem,event:ReactMouseEvent<HTMLElement>){
    if(event.shiftKey&&anchor){
      const a=shown.findIndex(x=>x.path===anchor),b=shown.findIndex(x=>x.path===item.path);
      if(a>=0&&b>=0){
        const range=shown.slice(Math.min(a,b),Math.max(a,b)+1).map(x=>x.path);
        setSelected(previous=>new Set([...(event.ctrlKey||event.metaKey?previous:[]),...range]));
        return;
      }
    }
    if(event.ctrlKey||event.metaKey){
      setSelected(previous=>{const next=new Set(previous);if(next.has(item.path))next.delete(item.path);else next.add(item.path);return next});
    }else setSelected(new Set([item.path]));
    setAnchor(item.path);
  }

  function showModal(type:Modal['type'],paths:string[]=Array.from(selected)){
    setMenu(null);setError('');setName(type==='rename'&&paths.length===1?basename(paths[0]):'');
    if(type==='tv'){setTvId('');setReplaceRoom(false)}
    setModal(type==='destination'?{type,paths,mode:'move'}:{type,paths} as Modal);
    if(type==='destination')setDestFolder(folder);
  }

  function putClipboard(mode:'copy'|'move',paths:string[]=Array.from(selected)){
    if(!paths.length)return;
    setClipboard({scope,mode,paths});setNotice(mode==='copy'
      ?`Скопировано в буфер: ${paths.length} объектов`:`Вырезано: ${paths.length} объектов`);
    setMenu(null);
  }

  async function fileAction(operation:Action,path:string,newPath?:string,localFile?:string){
    if(!root||!agent?.online||!endpoints.length)throw Error('Нет доступного HC Storage Service');
    return invoke<{integrity_retries?:number}>('homecloud_hcss_file_operation',{
      endpoints:[...endpoints],rootKind:root.kind,rootId:root.id,
      operation,path,newPath:newPath??null,localFile:localFile??null,
    });
  }

  async function batch(operation:Action,entries:{path:string;newPath?:string;localFile?:string}[]){
    if(!entries.length||locked.current||!root)return;
    const fence=currentFence.current;
    locked.current=true;setBusy(true);setProgress(null);setError('');setNotice('');setMenu(null);
    let completed=0;
    try{
      for(const entry of entries){
        if(fence!==currentFence.current)throw Error('Изменился узел или каталог во время операции');
        await fileAction(operation,entry.path,entry.newPath,entry.localFile);
        completed++;
        setHistory(old=>[`${operation} · ${entry.path}${entry.newPath?' → '+entry.newPath:''}`,...old].slice(0,40));
      }
      setNotice(`Готово: ${completed} из ${entries.length}`);
      if(operation!=='download')setReload(x=>x+1);
      if(operation==='move'&&clipboard?.mode==='move')setClipboard(null);
      setModal(null);
    }catch(e){
      setError(`Выполнено ${completed} из ${entries.length}. ${String(e)}`);
      if(completed)setReload(x=>x+1);
    }finally{locked.current=false;setBusy(false);setProgress(null)}
  }

  async function uploadFiles(){
    if(!writable)return;
    const picked=await open({title:'Загрузить файлы в HC Storage Service',multiple:true,directory:false});
    if(!picked)return;
    const files=(Array.isArray(picked)?picked:[picked]).filter((p):p is string=>typeof p==='string');
    if(files.length>100){setError('Максимум 100 файлов за одну операцию');return}
    const entries=files.map(localFile=>({localFile,path:join(folder,basename(localFile.replace(/\\\\/g,'/')))}));
    await batch('upload',entries);
  }

  async function downloadFile(){
    const item=allChosen.length===1?allChosen[0]:null;
    if(!readable||!item||item.kind!=='file')return;
    const destination=await save({title:'Скачать из HC Storage Service',defaultPath:item.name});
    if(typeof destination!=='string')return;
    await batch('download',[{path:item.path,localFile:destination}]);
  }

  async function paste(paths=clipboard?.paths,mode=clipboard?.mode,to=folder){
    if(!writable||!clipboard||clipboard.scope!==scope||!paths||!mode)return;
    if(mode==='copy'&&!root?.allow_read){setError('HC SS запрещает чтение для копирования');return;}
    const entries=paths.map(path=>({path,newPath:join(to,basename(path))}));
    if(entries.some(e=>e.path===e.newPath||to===e.path||to.startsWith(e.path+'/'))){
      setError('Нельзя копировать в тот же путь или переносить каталог внутрь себя');return;
    }
    await batch(mode==='copy'?'copy':'move',entries);
  }

  const beginDrop=(e:DragEvent<HTMLElement>,path:string)=>{
    if(!writable)return;
    const paths=selected.has(path)?Array.from(selected):[path];
    e.dataTransfer.effectAllowed='copyMove';
    e.dataTransfer.setData('application/x-homecloud-explorer',JSON.stringify({scope,paths}));
    setDragPath(path);
  };
  const drop=(e:DragEvent<HTMLElement>,target:string)=>{
    e.preventDefault();e.stopPropagation();setDragTarget('');setDragPath('');
    if(!writable)return;
    let data:{scope:string;paths:string[]}|null=null;
    try{data=JSON.parse(e.dataTransfer.getData('application/x-homecloud-explorer'))}catch{return}
    if(!data||data.scope!==scope||!Array.isArray(data.paths))return;
    const safe=data.paths.filter(p=>typeof p==='string'&&items.some(x=>x.path===p));
    if(!safe.length||safe.some(p=>target===p||target.startsWith(p+'/')))return;
    const mode=e.ctrlKey?'copy':'move';
    if(mode==='copy'&&!root?.allow_read){setError('Нет права чтения для копирования');return}
    void batch(mode,safe.map(path=>({path,newPath:join(target,basename(path))})));
  };

  useEffect(()=>{
    const close=()=>setMenu(null);
    window.addEventListener('pointerdown',close);
    return()=>window.removeEventListener('pointerdown',close);
  },[]);

  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{
      if(modal){if(event.key==='Escape'){event.preventDefault();setModal(null)}return}
      const target=event.target;
      if(target instanceof HTMLElement&&target.closest('input,textarea,select,[contenteditable="true"]'))return;
      const key=event.key.toLowerCase();
      if((event.ctrlKey||event.metaKey)&&key==='a'){
        event.preventDefault();setSelected(new Set(shown.map(x=>x.path)));
      }else if((event.ctrlKey||event.metaKey)&&key==='c'){
        event.preventDefault();putClipboard('copy');
      }else if((event.ctrlKey||event.metaKey)&&key==='x'){
        event.preventDefault();putClipboard('move');
      }else if((event.ctrlKey||event.metaKey)&&key==='v'){
        event.preventDefault();void paste();
      }else if((event.ctrlKey||event.metaKey)&&key==='l'){
        event.preventDefault();setAddress(folder);setAddressEditing(true);
      }else if((event.ctrlKey||event.metaKey)&&event.shiftKey&&key==='n'){
        event.preventDefault();showModal('create-folder',[]);
      }else if(event.key==='F2'&&selected.size===1){
        event.preventDefault();showModal('rename');
      }else if(event.key==='Delete'&&selected.size>0){
        event.preventDefault();showModal('delete');
      }else if(event.key==='Escape'){
        setSelected(new Set());setMenu(null);
      }
    };
    window.addEventListener('keydown',key);
    return()=>window.removeEventListener('keydown',key);
  });

  useEffect(()=>{
    let active=true;
    setDestItems([]);setDestCursor('');
    if(modal?.type!=='destination'||!root)return()=>{active=false};
    setDestLoading(true);
    void invoke<HcssListResponse>('homecloud_hcss_browse',{
      serverId,storageNodeId:nodeId,rootKind:root.kind,rootId:root.id,path:destFolder,
    }).then(data=>{
      if(!active)return;
      if(data.path!==destFolder||data.root?.kind!==root.kind||data.root?.id!==root.id)throw Error('HC SS вернул другой каталог');
      setDestItems(data.items.filter(x=>x.kind==='folder'&&pathIsDirectChild(destFolder,x)));
      setDestCursor(data.next_cursor??'');
    }).catch(e=>{if(active)setError(String(e))})
      .finally(()=>{if(active)setDestLoading(false)});
    return()=>{active=false};
  },[modal?.type,serverId,nodeId,rootId,destFolder,root?.kind,root?.id]);

  function setFavorite(path:string){
    const next=favorites.includes(path)?favorites.filter(p=>p!==path):[...favorites,path];
    setFavorites(next);
    try{window.localStorage.setItem('homecloud:explorer:favorites:'+scope,JSON.stringify(next))}catch{/* optional */}
  }

  async function submitModal(){
    if(!modal||busy)return;
    const paths=modal.paths;
    if(modal.type==='create-folder'||modal.type==='create-file'||modal.type==='rename'){
      const trimmed=name.trim();
      if(!canUseName(trimmed)){setError('Недопустимое имя файла или каталога');return}
      const path=modal.type==='rename'?paths[0]:join(folder,trimmed);
      const newPath=join(parentOf(path),trimmed);
      if(modal.type==='rename'&&selectedForModal[0]?.kind==='file'&&!deletable){
        setError('Переименование файла запрещено правами этого root');return;
      }
      if(modal.type==='create-folder')await batch('mkdir',[{path}]);
      else if(modal.type==='create-file')await batch('touch',[{path}]);
      else if(path!==newPath)await batch(
        selectedForModal[0]?.kind==='folder'?'move':'rename',[{path,newPath}]);
      else setModal(null);
    }else if(modal.type==='delete')await batch('delete',paths.map(path=>({path})));
    else if(modal.type==='destination'){
      const entries=paths.map(path=>({path,newPath:join(destFolder,basename(path))}));
      if(entries.some(e=>e.path===e.newPath||destFolder===e.path||destFolder.startsWith(e.path+'/'))){
        setError('Нельзя переносить каталог внутрь самого себя');return;
      }
      if(modal.mode==='copy'&&!root?.allow_read){setError('Нет права чтения для копирования');return}
      await batch(modal.mode,entries);
    }
  }

  async function playOnTv(){
    const item=selectedForModal[0],tv=tvs.find(d=>d.device_id===tvId);
    if(!item||!tv||!item.file_id?.startsWith('hc1.')||!agent||!root||busy)return;
    if(!root.allow_read){setError('Нет разрешения HC SS на чтение файла');return}
    if(mediaRooms.phase!=='ready'||mediaRooms.server_id!==serverId){
      setError('Состояние медиакомнат Backend ещё не загружено');return;
    }
    if(existingRoom&&!replaceRoom){
      setError('На телевизоре уже есть активная медиакомната. Подтверди её замену.');return;
    }
    setBusy(true);setError('');
    try{
      const r=await invoke<{room_id:string}>('homecloud_hcss_play',{
        serverId,deviceId:tv.device_id,storageNodeId:agent.storage_node_id,
        fileId:item.file_id,network,
      });
      setNotice(`Backend принял команду воспроизведения · комната ${r.room_id}. Статус подтверждается TV.`);
      await refreshMediaRooms(serverId);
      setModal(null);
    }catch(e){setError(String(e))}
    finally{setBusy(false)}
  }

  const menuPaths=menu && selected.has(menu.path)?Array.from(selected):menu?[menu.path]:[];
  const rootLabel=root?.name||root?.id||'Выбери хранилище';

  function entryButton(item:HcssDirectoryItem){
    const cat=category(item);
    const common={
      key:item.path,
      type:'button' as const,
      title:item.path,
      draggable:!busy,
      onDragStart:(e:DragEvent<HTMLButtonElement>)=>beginDrop(e,item.path),
      onDragEnd:()=>{setDragPath('');setDragTarget('')},
      onDragOver:(e:DragEvent<HTMLButtonElement>)=>{
        if(item.kind==='folder'&&writable){e.preventDefault();e.dataTransfer.dropEffect=e.ctrlKey?'copy':'move';setDragTarget(item.path)}
      },
      onDragLeave:()=>{if(dragTarget===item.path)setDragTarget('')},
      onDrop:(e:DragEvent<HTMLButtonElement>)=>{if(item.kind==='folder')drop(e,item.path)},
      onClick:(e:ReactMouseEvent<HTMLButtonElement>)=>selectEntry(item,e),
      onDoubleClick:()=>{if(item.kind==='folder')navigate(item.path);else showModal('properties',[item.path])},
      onContextMenu:(e:ReactMouseEvent<HTMLButtonElement>)=>{
        e.preventDefault();e.stopPropagation();
        if(!selected.has(item.path))setSelected(new Set([item.path]));
        // Event coordinates are viewport-relative, but the explorer is nested
        // inside an animated workspace. Anchor the menu to the explorer.
        const bounds=e.currentTarget.closest('.hc-explorer')?.getBoundingClientRect();
        setMenu({
          x:Math.max(6,Math.min(e.clientX-(bounds?.left??0),(bounds?.width??window.innerWidth)-210)),
          y:Math.max(6,Math.min(e.clientY-(bounds?.top??0),(bounds?.height??window.innerHeight)-260)),
          path:item.path,
        });
      },
      'aria-selected':selected.has(item.path),
      role:'option',
    };
    return view==='grid'?<button {...common}
      className={`hc-explorer-tile${selected.has(item.path)?' is-selected':''}${dragTarget===item.path?' is-drop-target':''}${clipboard?.mode==='move'&&clipboard.paths.includes(item.path)?' is-cut':''}`}>
      {icon(item,'lg')}
      <span className="hc-explorer-tile__name">{item.name}</span>
      <small>{item.kind==='folder'?'Папка':formatBytes(item.size_bytes)}</small>
    </button>:<button {...common}
      className={`hc-explorer-row${selected.has(item.path)?' is-selected':''}${dragTarget===item.path?' is-drop-target':''}${clipboard?.mode==='move'&&clipboard.paths.includes(item.path)?' is-cut':''}`}>
      <span className="hc-explorer-row__name">{icon(item)}<strong>{item.name}</strong></span>
      <span>{categoryName[cat]}</span><span>{formatModified(item.modified_unix_nano)}</span>
      <span>{item.kind==='folder'?'—':formatBytes(item.size_bytes)}</span>
    </button>;
  }

  return <section className="hc-explorer" aria-label="Проводник HomeCloud">
    <aside className="hc-explorer-sidebar" aria-label="Места">
      <div className="hc-explorer-brand"><span className="hc-explorer-brand__mark">▤</span>
        <div><strong>Проводник</strong><span>HomeCloud Navigator</span></div></div>
      <div className="hc-explorer-sidebar__section">
        <span className="hc-explorer-sidebar__label">Backend</span>
        <select aria-label="Backend" value={serverId} disabled={busy}
          onChange={e=>setServerId(e.target.value)}>
          {!pool.servers.length&&<option value="">Серверы не добавлены</option>}
          {pool.servers.map(s=><option key={s.id} value={s.id}>{s.name} · {s.phase}</option>)}
        </select>
      </div>
      <div className="hc-explorer-sidebar__section">
        <span className="hc-explorer-sidebar__label">Узлы хранения</span>
        {loadingNodes&&<small>Обнаружение HC SS…</small>}
        {agents.map(a=><button key={a.storage_node_id} type="button"
          disabled={busy||!a.online} onClick={()=>changeNode(a.storage_node_id)}
          className={nodeId===a.storage_node_id?'is-active':''}
          title={a.storage_node_id}><span>◫</span><em>{a.storage_node_id}</em>
          <i>{a.online?'●':'○'}</i></button>)}
      </div>
      <div className="hc-explorer-sidebar__section">
        <span className="hc-explorer-sidebar__label">Пространства HC SS</span>
        {roots.map(r=><button key={rootKey(r)} type="button"
          className={rootId===rootKey(r)?'is-active':''}
          disabled={busy} onClick={()=>changeRoot(rootKey(r))}>
          <span>▣</span><em>{r.name||r.id}</em><i>{r.kind}</i>
        </button>)}
        {root&&<button type="button" onClick={()=>navigate('')}
          className={!folder?'is-active':''} disabled={busy}>
          <span>⌂</span><em>Корень</em></button>}
      </div>
      <div className="hc-explorer-sidebar__section hc-explorer-sidebar__favorites">
        <span className="hc-explorer-sidebar__label">Избранное</span>
        {!favorites.length&&<small>ПКМ по папке → В избранное</small>}
        {favorites.map(p=><div className="hc-explorer-favorite" key={p}>
          <button type="button" onClick={()=>navigate(p)} disabled={busy}
            className={folder===p?'is-active':''}><span>☆</span><em>{basename(p)}</em></button>
          <button type="button" title="Убрать" aria-label={`Убрать ${p} из избранного`}
            onClick={()=>setFavorite(p)}>×</button></div>)}
      </div>
      <div className="hc-explorer-sidebar__section hc-explorer-sidebar__section--volumes">
        <span className="hc-explorer-sidebar__label">Соединение</span>
        <small>{online?'● Backend Online':'○ Backend Offline'}</small>
        <small>{agent?.online?'● HC SS Online':'○ Нет соединения HC SS'}</small>
        <small>{endpoints.length?'Файловый канал доступен':'Файловый канал не опубликован'}</small>
      </div>
    </aside>

    <div className="hc-explorer-shell">
      <header className="hc-explorer-toolbar">
        <div className="hc-explorer-navbuttons">
          <button type="button" disabled={!back.length||busy} onClick={()=>navigateHistory('back')} title="Назад">‹</button>
          <button type="button" disabled={!forward.length||busy} onClick={()=>navigateHistory('forward')} title="Вперёд">›</button>
          <button type="button" disabled={!folder||busy} onClick={()=>navigate(parentOf(folder))} title="Вверх">↑</button>
          <button type="button" disabled={busy} onClick={()=>setReload(v=>v+1)} title="Обновить">↻</button>
        </div>
        {addressEditing?<form className="hc-explorer-address" onSubmit={e=>{e.preventDefault();
          const next=address.trim();if(!next||next==='/'||next===folder){setAddressEditing(false);return}
          // Paths are relative to the selected published root.
          if(next.split('/').every(canUseName))navigate(next);else setError('Недопустимый путь');
          setAddressEditing(false);
        }}>
          <input aria-label="Путь к папке" autoFocus value={address}
            onChange={e=>setAddress(e.target.value)}
            onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();setAddressEditing(false)}}}/>
        </form>:<nav className="hc-explorer-path" aria-label="Путь каталога"
          title="Двойной клик или Ctrl+L — перейти к пути" onDoubleClick={()=>{setAddress(folder);setAddressEditing(true)}}>
          <span className="hc-explorer-path__root">{rootLabel}</span>
          {folderCrumbs(folder).map(c=><button type="button" key={c.path}
            disabled={busy||c.path===folder} onClick={()=>navigate(c.path)}>
            {c.path?'› '+c.label:' /'}</button>)}
        </nav>}
        <label className="hc-explorer-search"><span>⌕</span><input value={query}
          onChange={e=>setQuery(e.target.value)} type="search" placeholder="Поиск в папке"
          aria-label="Поиск в текущем каталоге"/></label>
      </header>
      <div className="hc-explorer-commandbar">
        <div className="hc-explorer-commandbar__group">
          <button type="button" className="is-primary" disabled={!writable}
            onClick={()=>showModal('create-folder',[])}>＋ Папка</button>
          <button type="button" disabled={!writable}
            onClick={()=>showModal('create-file',[])}>＋ Файл</button>
          <button type="button" disabled={!writable} onClick={()=>void uploadFiles()}>↑ Загрузить</button>
          <button type="button" disabled={!readable||chosen.length!==1||chosen[0].kind!=='file'}
            onClick={()=>void downloadFile()}>↓ Скачать</button>
          <span className="hc-explorer-commandbar__divider"/>
          <button type="button" disabled={!selected.size||!readable} onClick={()=>putClipboard('copy')}>Копировать</button>
          <button type="button" disabled={!selected.size||!writable} onClick={()=>putClipboard('move')}>Вырезать</button>
          <button type="button" disabled={!writable||!clipboard||clipboard.scope!==scope}
            onClick={()=>void paste()}>Вставить</button>
          <button type="button" disabled={selected.size!==1||!writable||
              (chosen[0]?.kind==='file'&&!deletable)}
            onClick={()=>showModal('rename')}>Переименовать</button>
          <button type="button" className="is-danger" disabled={!deletable||!selected.size}
            onClick={()=>showModal('delete')}>Удалить</button>
        </div>
        <div className="hc-explorer-commandbar__group hc-explorer-commandbar__group--right">
          <button type="button" disabled={selected.size!==1}
            onClick={()=>showModal('properties')}>Свойства</button>
          <button type="button" title="История" onClick={()=>showModal('history',[])}>◷</button>
          <button type="button" className={showHidden?'is-active':''}
            onClick={()=>setShowHidden(v=>!v)} title="Скрытые файлы">·ф</button>
          <select aria-label="Сортировка" value={sort} onChange={e=>setSort(e.target.value as Sort)}>
            <option value="name">Имя</option><option value="type">Тип</option>
            <option value="modified">Изменено</option><option value="size">Размер</option>
          </select>
          <div className="hc-explorer-viewtoggle">
            <button type="button" aria-label="Список" aria-pressed={view==='list'}
              className={view==='list'?'is-active':''} onClick={()=>setView('list')}>☷</button>
            <button type="button" aria-label="Плитки" aria-pressed={view==='grid'}
              className={view==='grid'?'is-active':''} onClick={()=>setView('grid')}>▦</button>
          </div>
        </div>
      </div>
      <div className="hc-explorer-center" onDragOver={e=>{if(writable&&dragPath)e.preventDefault()}}
        onDrop={e=>drop(e,folder)}>
        {!root?<div className="hc-explorer-empty">Выбери доступный HC Storage Service и разрешённый каталог</div>:
          browseStatus==='loading'?<div className="hc-explorer-empty">Открываем каталог…</div>:
          browseStatus==='error'?<div className="hc-explorer-empty" role="alert">{error}</div>:<>
          {shown.length===0?<div className="hc-explorer-empty">{query?'Совпадений не найдено':'Каталог пуст'}</div>:
            view==='grid'?<div className="hc-explorer-grid" role="listbox" aria-multiselectable="true">
              {shown.map(entryButton)}</div>:
            <div className="hc-explorer-list" role="listbox" aria-multiselectable="true">
              <div className="hc-explorer-list__header"><span>Имя</span><span>Тип</span><span>Изменено</span><span>Размер</span></div>
              {shown.map(entryButton)}
            </div>}
          {cursor&&<button type="button" className="hc-explorer-more" disabled={moreLoading}
            onClick={()=>void loadMore()}>{moreLoading?'Загрузка…':'Показать ещё файлы'}</button>}
        </>}
      </div>
      <footer className="hc-explorer-status">
        <span>{items.length} объектов {cursor?'(часть каталога)':''} · {selected.size} выбрано</span>
        <span>{busy?'Выполняется файловая операция':rootLabel} · {folder||'/'}</span>
      </footer>
    </div>

    {menu&&<div className="hc-explorer-context" role="menu" style={{left:Math.max(0,menu.x),top:Math.max(0,menu.y)}}
      onPointerDown={e=>e.stopPropagation()}>
      {items.find(x=>x.path===menu.path)?.kind==='folder'&&<button role="menuitem"
        onClick={()=>{navigate(menu.path);setMenu(null)}}>Открыть</button>}
      <button role="menuitem" disabled={!readable} onClick={()=>putClipboard('copy',menuPaths)}>Копировать</button>
      <button role="menuitem" disabled={!writable} onClick={()=>putClipboard('move',menuPaths)}>Вырезать</button>
      {items.find(x=>x.path===menu.path)?.kind==='folder'&&<button role="menuitem"
        onClick={()=>{setFavorite(menu.path);setMenu(null)}}>{favorites.includes(menu.path)?'Убрать из избранного':'В избранное'}</button>}
      <button role="menuitem" disabled={!writable||menuPaths.length!==1||
          (items.find(x=>x.path===menuPaths[0])?.kind==='file'&&!deletable)}
        onClick={()=>showModal('rename',menuPaths)}>Переименовать</button>
      <button role="menuitem" disabled={!writable}
        onClick={()=>{setModal({type:'destination',paths:menuPaths,mode:'move'});setDestFolder(folder);setMenu(null)}}>
        Переместить в…</button>
      <button role="menuitem" disabled={!writable||!readable}
        onClick={()=>{setModal({type:'destination',paths:menuPaths,mode:'copy'});setDestFolder(folder);setMenu(null)}}>
        Копировать в…</button>
      {menuPaths.length===1&&items.find(x=>x.path===menuPaths[0])?.kind==='file'&&mediaFile(basename(menuPaths[0]))&&
        <button role="menuitem" onClick={()=>showModal('tv',menuPaths)}>Воспроизвести на TV…</button>}
      <button role="menuitem" onClick={()=>showModal('properties',menuPaths)}>Свойства…</button>
      <button role="menuitem" className="is-danger" disabled={!deletable}
        onClick={()=>showModal('delete',menuPaths)}>Удалить…</button>
    </div>}

    {notice&&!modal&&<div className="hc-explorer-toast" role="status">
      <span>{notice}</span><button type="button" aria-label="Закрыть" onClick={()=>setNotice('')}>×</button>
    </div>}
    {error&&browseStatus!=='error'&&!modal&&<div className="hc-explorer-toast hc-explorer-toast--error" role="alert">
      <span>{error}</span><button type="button" aria-label="Закрыть" onClick={()=>setError('')}>×</button>
    </div>}
    {busy&&progress&&<div className="hc-explorer-progress" role="status">
      {progress.role==='upload'?'Загрузка':progress.role==='copy'?'Копирование':'Скачивание'} · {formatBytes(progress.completed_bytes)}
      {progress.total_bytes>0?' / '+formatBytes(progress.total_bytes):' скопировано'}
      {progress.total_bytes>0&&<div><i style={{width:`${Math.min(100,progress.completed_bytes*100/progress.total_bytes)}%`}}/></div>}
    </div>}

    {modal&&<div className="hc-explorer-modal-backdrop" onPointerDown={e=>{if(e.target===e.currentTarget&&!busy)setModal(null)}}>
      <section className="hc-explorer-dialog" role="dialog" aria-modal="true"
        aria-label={modal.type==='properties'?'Свойства':modal.type==='destination'?'Выбор папки назначения':modal.type==='tv'?'Воспроизведение на телевизоре':'Файловая операция'}>
        <header><h3>{modal.type==='properties'?'Свойства файла':
          modal.type==='create-folder'?'Новая папка':modal.type==='create-file'?'Новый файл':
          modal.type==='rename'?'Переименовать':
          modal.type==='delete'?'Удалить выбранное':
          modal.type==='destination'?(modal.mode==='copy'?'Копировать в папку':'Переместить в папку'):
          modal.type==='tv'?'Воспроизвести на телевизоре':'История операций'}</h3>
          <button type="button" aria-label="Закрыть окно" disabled={busy} onClick={()=>setModal(null)}>×</button></header>
        {(modal.type==='create-folder'||modal.type==='create-file'||modal.type==='rename')&&
          <label className="hc-explorer-dialog__field">Имя
            <input autoFocus maxLength={180} value={name} onChange={e=>setName(e.target.value)}
              onKeyDown={(e:ReactKeyboardEvent<HTMLInputElement>)=>{if(e.key==='Enter'){e.preventDefault();void submitModal()}}}/>
          </label>}
        {modal.type==='delete'&&<p>Удалить {modal.paths.length} объект(ов)?
          Действие необратимо. Каталоги HC SS удаляются только пустыми.</p>}
        {modal.type==='properties'&&selectedForModal.map(item=><dl className="hc-explorer-properties" key={item.path}>
          <dt>Имя</dt><dd>{item.name}</dd>
          <dt>Тип</dt><dd>{categoryName[category(item)]}</dd>
          <dt>Путь в хранилище</dt><dd>{item.path}</dd>
          <dt>Размер</dt><dd>{item.kind==='folder'?'Каталог':formatBytes(item.size_bytes)}</dd>
          <dt>Изменён</dt><dd>{formatModified(item.modified_unix_nano)}</dd>
          <dt>HC SS File ID</dt><dd>{item.file_id??'Не предоставлен'}</dd>
          <dt>Узел</dt><dd>{nodeId}</dd>
          <dt>Корень</dt><dd>{rootLabel}</dd>
        </dl>)}
        {modal.type==='destination'&&<div className="hc-explorer-destination">
          <nav className="hc-explorer-path">
            {folderCrumbs(destFolder).map(c=><button type="button" key={c.path}
              onClick={()=>setDestFolder(c.path)} disabled={busy||c.path===destFolder}>{c.label} /</button>)}
          </nav>
          <div className="hc-explorer-destination__folders">
            {destLoading?<p>Загружаем каталоги…</p>:destItems.map(item=><button type="button"
              key={item.path} onClick={()=>setDestFolder(item.path)}>
              <span>▤</span>{item.name}<span>›</span></button>)}
            {destCursor&&<button type="button" onClick={()=>void loadMore(true)}>Показать ещё</button>}
            {!destLoading&&!destItems.length&&<p>Вложенных каталогов нет — можно выбрать текущий.</p>}
          </div>
          <small>Выбранная папка: {destFolder||'Корень'}</small>
        </div>}
        {modal.type==='history'&&<div className="hc-explorer-history">
          {!history.length?<p>Операций в этой сессии пока нет</p>:history.map((record,i)=><p key={i}>{record}</p>)}
        </div>}
        {modal.type==='tv'&&<div className="hc-explorer-tv">
          <p>{selectedForModal[0]?.name}</p>
          <label>Телевизор<select value={tvId} onChange={e=>{setTvId(e.target.value);setReplaceRoom(false)}}>
            <option value="">Выбери TV</option>
            {tvs.map(d=><option key={d.device_id} value={d.device_id}>{d.device_id}</option>)}
          </select></label>
          <label>Сеть<select value={network} onChange={e=>setNetwork(e.target.value as 'lan'|'tailscale')}>
            <option value="lan">LAN</option><option value="tailscale">Tailscale</option>
          </select></label>
          {existingRoom&&<label className="hc-explorer-confirm-checkbox">
            <input type="checkbox" checked={replaceRoom} onChange={e=>setReplaceRoom(e.target.checked)}/>
            <span>На этом TV уже есть медиакомната. Заменить текущее воспроизведение?</span>
          </label>}
          {mediaRooms.phase!=='ready'&&<small>Ожидание состояния медиакомнат от Backend…</small>}
          <small>Запуск выполняет Backend. Локального видеоплеера в HomeCloudUI нет.</small>
        </div>}
        {error&&<p className="hc-explorer-dialog__error" role="alert">{error}</p>}
        <footer>
          <button type="button" disabled={busy} onClick={()=>{setModal(null);setError('')}}>Закрыть</button>
          {modal.type==='tv'?<button type="button" className="is-primary"
            disabled={busy||!tvId||!root?.allow_read||mediaRooms.phase!=='ready'||
              Boolean(existingRoom&&!replaceRoom)||!selectedForModal[0]?.file_id}
            onClick={()=>void playOnTv()}>Воспроизвести на TV</button>:
            !['properties','history'].includes(modal.type)&&<button type="button"
              className={modal.type==='delete'?'is-danger':'is-primary'}
              disabled={busy||modal.type==='destination'&&destLoading||
                ['create-folder','create-file','rename'].includes(modal.type)&&!canUseName(name.trim())}
              onClick={()=>void submitModal()}>{modal.type==='delete'?'Удалить':'Подтвердить'}</button>}
        </footer>
      </section>
    </div>}
  </section>;
}
