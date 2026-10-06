import {lazy,Suspense,useState} from 'react';
import {Images,ArrowLeftRight} from 'lucide-react';
import './photos.css';
const PhotoLibrary=lazy(()=>import('./PhotoLibrary'));
const Converter=lazy(()=>import('./ImagesPanel'));
export default function ImageWorkshop(){
  const [tab,setTab]=useState<'photos'|'convert'>('photos'),[error,setError]=useState('');
  async function select(next:'photos'|'convert'){try{const detail={pending:Promise.resolve()};window.dispatchEvent(new CustomEvent('photo-before-leave',{detail}));await detail.pending;setTab(next);}catch(e){setError(e instanceof Error?e.message:'保存失败');}}
  return <div className="image-workshop"><nav className="photo-tabs"><button aria-pressed={tab==='photos'} onClick={()=>void select('photos')}><Images size={15}/>照片库</button><button aria-pressed={tab==='convert'} onClick={()=>void select('convert')}><ArrowLeftRight size={15}/>格式转换</button>{error&&<span role="alert">{error}</span>}</nav><Suspense fallback={<div className="photo-loading">正在打开…</div>}><div hidden={tab!=='photos'}><PhotoLibrary visible={tab==='photos'}/></div>{tab==='convert'&&<Converter/>}</Suspense></div>;
}
