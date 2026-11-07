/** Pure server-root-relative drag/drop plan. No desktop paths escape to WebView.
 * WebOS-like Ctrl+drag = copy, plain drag = move.
 */
export type ExplorerDragMode = 'copy'|'move';
export type ExplorerDropEntry = {path:string;newPath:string};
export type ExplorerDropPermissions = {read:boolean;write:boolean};

const basename=(p:string)=>p.split('/').pop()??p;
const parent=(p:string)=>p.split('/').slice(0,-1).join('/');
const join=(dir:string,name:string)=>dir?`${dir}/${name}`:name;

export function canDropInto(paths:string[],destination:string,mode:ExplorerDragMode,perms:ExplorerDropPermissions):boolean {
  if(!perms.write||(mode==='copy'&&!perms.read)||!paths.length)return false;
  if(paths.some(p=>!p||destination===p||destination.startsWith(p+'/')))return false;
  // Same-folder move is a no-op; copy in place gets a unique copy name.
  if(mode==='move'&&paths.every(p=>parent(p)===destination))return false;
  return true;
}

function availableCopyName(name:string,taken:Set<string>):string {
  const dot=name.lastIndexOf('.');
  const split=dot>0?dot:name.length;
  const stem=name.slice(0,split),ext=name.slice(split);
  for(let n=1;n<=1000;n++){
    const suffix=n===1?' (копия)':` (копия ${n})`;
    const candidate=stem.slice(0,Math.max(1,180-suffix.length-ext.length))+suffix+ext;
    if(!taken.has(candidate)){taken.add(candidate);return candidate;}
  }
  throw new Error('Не удалось выбрать имя для копии');
}

export function planDrop(paths:string[],destination:string,mode:ExplorerDragMode,
  existingNames:string[]=[]):ExplorerDropEntry[]{
  const taken=new Set(existingNames);
  const results:ExplorerDropEntry[]=[];
  for(const path of paths){
    if(mode==='move'&&parent(path)===destination)continue;
    const original=basename(path);
    const filename=mode==='copy'&&parent(path)===destination
      ?availableCopyName(original,taken):original;
    results.push({path,newPath:join(destination,filename)});
    taken.add(filename);
  }
  return results;
}
