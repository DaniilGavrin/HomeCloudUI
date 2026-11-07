import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useHomeCloudPool } from '../../hooks/useHomeCloudPool';
import { type HcssAgent, filesystemVolumes, formatBytes, isBrowsableRoot } from './hcssModel';
import '../../styles/storage.css';

type AgentResponse = {agents:HcssAgent[]};

// Device/inventory dashboard only. All filesystem operations live in the
// dedicated WebOS-style HC SS Explorer, not nested under storage statistics.
export function HcssStorageOverviewPage() {
  const {snapshot:pool}=useHomeCloudPool();
  const [serverId,setServerId]=useState('');
  const [agents,setAgents]=useState<HcssAgent[]>([]);
  const [selectedNode,setSelectedNode]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [reload,setReload]=useState(0);
  const server=pool.servers.find(s=>s.id===serverId);
  const online=server?.phase==='ready';
  const selected=agents.find(a=>a.storage_node_id===selectedNode)??agents[0];
  const disks=useMemo(()=>filesystemVolumes(selected?.volumes),[selected]);
  const physical=(selected?.volumes??[]).filter(v=>v.kind==='block');
  const roots=selected?.roots??[];
  const onlineAgents=agents.filter(a=>a.online).length;

  useEffect(()=>{
    if(pool.servers.length&&!pool.servers.some(s=>s.id===serverId)){
      setServerId((pool.servers.find(s=>s.phase==='ready')??pool.servers[0]).id);
    }
  },[serverId,pool.servers]);
  useEffect(()=>{
    let active=true;
    setAgents([]);setSelectedNode('');setError('');
    if(!online)return()=>{active=false};
    setBusy(true);
    void invoke<AgentResponse>('homecloud_hcss_sources',{serverId})
      .then(result=>{
        if(!active)return;
        if(!Array.isArray(result.agents))throw Error('Некорректный реестр HC SS');
        setAgents(result.agents);
        setSelectedNode(result.agents.find(a=>a.online)?.storage_node_id??result.agents[0]?.storage_node_id??'');
      }).catch(e=>{if(active)setError(String(e))})
      .finally(()=>{if(active)setBusy(false)});
    return()=>{active=false};
  },[serverId,online,reload]);

  return <section className="hc-storage hc-storage--hcss" aria-label="Хранилища HomeCloud">
    <header className="hc-storage__head hc-storage__head--main">
      <div><span className="hc-storage__overline">HOMECLOUD · HC STORAGE SERVICE</span>
        <h2>Хранилища</h2>
        <p>Состояние узлов, файловых систем и разрешённых корней. Операции с файлами — в Проводнике.</p>
      </div>
      <button className="hc-storage__button" type="button" disabled={busy||!online}
        onClick={()=>setReload(v=>v+1)}>↻ Обновить</button>
    </header>
    <div className="hc-storage__scroll">
      <div className="hc-storage__filters">
        <label><span>Backend</span>
          <select aria-label="Backend" value={serverId} onChange={e=>setServerId(e.target.value)}>
            {!pool.servers.length&&<option value="">Серверы не добавлены</option>}
            {pool.servers.map(s=><option key={s.id} value={s.id}>{s.name} · {s.phase}</option>)}
          </select>
        </label>
        <span className={online?'hc-storage__state hc-storage__state--online':'hc-storage__state'}>
          <i/>{online?'Backend Online':'Backend Offline'}
        </span>
      </div>
      {error&&<div className="hc-hcss__error" role="alert">{error}</div>}
      {busy&&<div className="hc-storage__empty homecloud-glass">Получаем инвентаризацию HC Storage Service…</div>}
      {!online&&<div className="hc-storage__empty homecloud-glass">
        <strong>Нет соединения с Backend</strong>
        <span>Информация о дисках появится после подключения.</span>
      </div>}
      {online&&!busy&&<div className="hc-storage__stats">
        <div className="hc-storage__stat homecloud-glass">
          <span>Узлы HC Storage Service</span><strong>{agents.length}</strong>
          <small>{onlineAgents} онлайн · {agents.length-onlineAgents} офлайн</small>
        </div>
        <div className="hc-storage__stat homecloud-glass">
          <span>Файловые системы</span><strong>{disks.length}</strong>
          <small>{physical.length} физических блочных устройств</small>
        </div>
        <div className="hc-storage__stat homecloud-glass">
          <span>Опубликованные корни</span><strong>{roots.length}</strong>
          <small>{roots.filter(isBrowsableRoot).length} доступны для просмотра</small>
        </div>
      </div>}
      {online&&!busy&&<>
        <div className="hc-storage__section-head"><h3>Узлы хранения</h3>
          <span>{agents.length} зарегистрировано</span></div>
        {!agents.length?<div className="hc-storage__empty homecloud-glass">HC Storage Service пока не зарегистрирован</div>:
          <div className="hc-hcss__nodes">
            {agents.map(agent=><button className={`hc-hcss__node homecloud-glass ${selected?.storage_node_id===agent.storage_node_id?'hc-hcss__node--active':''}`}
              key={agent.storage_node_id} type="button" onClick={()=>setSelectedNode(agent.storage_node_id)}>
              <strong>{agent.storage_node_id}</strong>
              <span className={agent.online?'hc-storage__pill hc-storage__pill--online':'hc-storage__pill'}>
                {agent.online?'Online':'Offline'}</span>
              <small>Последнее соединение: {agent.last_seen?new Date(agent.last_seen).toLocaleString('ru-RU'):'—'}</small>
            </button>)}
          </div>}
        {selected&&<>
          <div className="hc-storage__section-head"><h3>Смонтированные диски и разделы</h3>
            <span>{disks.length} файловых систем</span></div>
          <div className="hc-storage__volumes">
            {!disks.length&&<div className="hc-storage__empty homecloud-glass">Нет опубликованных смонтированных файловых систем.</div>}
            {disks.map(d=>{
              const used=Math.max(0,d.size_bytes-d.available_bytes);
              const percent=d.size_bytes?Math.min(100,Math.round(used*100/d.size_bytes)):0;
              return <article className="hc-storage__volume homecloud-glass hc-hcss__volume"
                key={d.volume_id}>
                <div className="hc-storage__volume-head"><span className="hc-hcss__disc">▣</span>
                  <span className="hc-storage__pill hc-storage__pill--online">{d.fs_type||'ФС'}</span></div>
                <strong>{d.mount_path||d.volume_id}</strong>
                <span className="hc-storage__path">{d.read_only?'Только чтение':'Файловая система доступна для записи'}</span>
                <div className="hc-storage__capacity"><span>{formatBytes(used)} занято</span><span>{percent}%</span></div>
                <div className="hc-storage__capacity-track"><i style={{width:`${percent}%`}}/></div>
                <small>{formatBytes(d.available_bytes)} доступно из {formatBytes(d.size_bytes)}</small>
              </article>;
            })}
          </div>
          <div className="hc-storage__section-head"><h3>Разрешённые корни</h3><span>{roots.length} опубликовано</span></div>
          <div className="hc-hcss__roots">
            {roots.map(root=><article key={root.kind+root.id} className="hc-hcss__root homecloud-glass">
              <strong>{root.name||root.id}</strong><small>{root.kind} · {root.id}</small>
              <span>{root.online?'Online':'Offline'} · {root.allow_list?'список':'без списка'} ·
                {root.allow_read?' чтение':' без чтения'} · {root.allow_write?' запись':' без записи'} ·
                {root.allow_delete?' удаление':' без удаления'}</span>
            </article>)}
          </div>
          <p className="hc-storage__note">
            Наличие физического диска не означает доступ к файлам. Проводник показывает
            только root, опубликованные HC Storage Service с разрешением просмотра.
            Содержимое файлов не проходит через управляющий WebSocket Backend.
          </p>
        </>}
      </>}
    </div>
  </section>;
}
