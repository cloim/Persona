import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ArrowDownToLine, ArrowRight, BookOpen, Check, CheckCheck, ChevronRight, CloudOff, Download, FolderOpen, ImagePlus, Images, LayoutGrid, Leaf, Menu, MoreHorizontal, Plus, Settings2, SlidersHorizontal, Sparkles, Sprout, Tags, Upload, WandSparkles, X, Zap, Pencil, CircleHelp, RefreshCw, HardDrive, CheckCircle2, TriangleAlert, PanelLeftClose, Trash2 } from 'lucide-react';
import { PRESETS, GROUPS, newProject, readiness, resizeSlots, captionFor, promptFor } from './lib/dataset.mjs';
import { loadProjects, saveProject, deleteProject, getSettings, saveSettings, imageFromFile, imageFromData } from './lib/storage.mjs';
import { download, validateBackup } from './lib/export.mjs';
import { Button, Field, SelectControl, Modal, Toast } from './components/ui';
import Pose from './components/Pose';
import DatasetPage from './pages/DatasetPage';
import CaptionsPage from './pages/CaptionsPage';
import TrainingPage from './pages/TrainingPage';
import ConnectionsPage from './pages/ConnectionsPage';
import GuidePage from './pages/GuidePage';
import ShotEditor from './components/ShotEditor';
import './components/SelectControl/select-control.css';
import './components/Modal/modal.css';
import './styles.css';
import { TRAINING_MODELS, migrateTraining, selectTrainingModel } from './lib/training.mjs';
import CloudPage from './pages/CloudPage';
import { api } from './lib/api.mjs';
import { captionImageData } from './lib/captions.mjs';
import InstallHelp from './components/InstallHelp';

const initialSettings = { provider: 'comfy', comfyUrl: 'http://127.0.0.1:8188', workflow: '', apiBase: 'https://api.openai.com/v1', apiModel: 'gpt-image-2', apiKey: '', captionProvider:'codex',captionFormat:'natural',captionApiBase:'https://api.openai.com/v1',captionModel:'',captionApiKey:'',autoCaption:false };
const navItems = [{ to: '/dataset', label: '이미지셋 작업실', icon: LayoutGrid }, { to: '/captions', label: '캡션 편집', icon: Tags }, { to: '/training', label: '학습과 내보내기', icon: Sprout }];
const pages = { '/dataset': ['이미지셋 작업실', '캐릭터의 다양한 모습을 한곳에'], '/captions': ['캡션 편집', '이미지와 단어가 정확하게 연결되도록'], '/training': ['학습과 내보내기', '준비한 캐릭터를 나만의 LoRA로'], '/connections': ['AI 생성 연결', '익숙한 도구로 이미지를 만들어요'], '/cloud': ['Google Drive 보관함', '프로젝트와 데이터셋을 안전하게 보관해요'], '/guide': ['시작 가이드', '이미지셋부터 ComfyUI 적용까지'] };

function App() {
  const [projects, setProjects] = useState([]); const [project, setProject] = useState(null); const [settings, setSettings] = useState(initialSettings);
  const [loaded, setLoaded] = useState(false); const [loadError, setLoadError] = useState(''); const [saveState, setSaveState] = useState('saved');
  const [toast, setToast] = useState(null); const toastSequence = useRef(0);
  const closeToast = useCallback(() => setToast(null), []);
  const [showCharacter, setShowCharacter] = useState(false); const [showProjects, setShowProjects] = useState(false); const [mobileNav, setMobileNav] = useState(false); const [deleteTarget, setDeleteTarget] = useState(null);
  const [selectedShot, setSelectedShot] = useState(null); const [generation, setGeneration] = useState(null);
  const [google,setGoogle]=useState(null);const [captionTask,setCaptionTask]=useState(null);
  const captionAbort=useRef(),captionLock=useRef(false),autoAttempted=useRef(new Set());
  const googleRequest=useRef(null);
  async function refreshGoogle(){
    if(googleRequest.current)return googleRequest.current;
    setGoogle(previous=>({...previous,checking:true,error:''}));
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    googleRequest.current=(async()=>{try{
      const status=await api('/api/google/status',undefined,{signal:controller.signal});
      if(typeof status.configured!=='boolean')throw new Error('Google 연결 응답을 확인하지 못했어요. 앱 접속 주소를 확인해 주세요');
      setGoogle({...status,checking:false,error:''});
    }catch(error){setGoogle({configured:null,user:null,checking:false,error:controller.signal.aborted?'서버 응답이 지연되고 있어요. 네트워크 연결을 확인하고 다시 시도해 주세요':error.message});}
    finally{clearTimeout(timer);googleRequest.current=null;}})();
    return googleRequest.current;
  }
  const [installEvent, setInstallEvent] = useState(null); const [online, setOnline] = useState(navigator.onLine);
  const [showInstallHelp,setShowInstallHelp]=useState(false),[installing,setInstalling]=useState(false);
  const [installed,setInstalled]=useState(()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true);
  async function installApp(){
    if(!installEvent){setShowInstallHelp(true);return;}
    setInstalling(true);
    try{await installEvent.prompt();const choice=await installEvent.userChoice;if(choice.outcome!=='accepted')setShowInstallHelp(true);}
    catch{setShowInstallHelp(true);}
    finally{setInstallEvent(null);setInstalling(false);}
  }
  const location = useLocation(); const navigate = useNavigate(); const backupInput = useRef(); const projectRef = useRef(project); projectRef.current = project;
  const writeChain = useRef(Promise.resolve()); const saveRevision = useRef(0);
  const notify = (message, error = false) => setToast({ id: ++toastSequence.current, message, error });
  useEffect(() => {
    Promise.all([loadProjects(), getSettings()]).then(([saved, savedSettings]) => {
      const sorted = saved.map(migrateTraining).sort((a,b) => b.updatedAt - a.updatedAt); setProjects(sorted); setProject(sorted[0] || newProject()); if (savedSettings) setSettings({ ...initialSettings, ...savedSettings, apiKey: '',captionApiKey:'' }); setLoaded(true);
    }).catch(() => setLoadError('브라우저 저장 공간에 접근할 수 없어요. 저장 공간 권한을 확인한 뒤 새로고침해 주세요'));
    const install = e => { e.preventDefault(); setInstallEvent(e); }; const connection = () => {setOnline(navigator.onLine);if(navigator.onLine)refreshGoogle();};
    const appInstalled=()=>{setInstalled(true);setInstallEvent(null);setShowInstallHelp(false);};
    const resume=()=>{if(document.visibilityState==='visible')refreshGoogle();};
    refreshGoogle();
    window.addEventListener('beforeinstallprompt', install); window.addEventListener('online', connection); window.addEventListener('offline', connection);
    window.addEventListener('focus',resume);document.addEventListener('visibilitychange',resume);
    window.addEventListener('appinstalled',appInstalled);
    if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    return () => { window.removeEventListener('beforeinstallprompt', install); window.removeEventListener('online', connection); window.removeEventListener('offline', connection);window.removeEventListener('focus',resume);document.removeEventListener('visibilitychange',resume);window.removeEventListener('appinstalled',appInstalled); };
  }, []);
  useEffect(() => {
    if (!loaded || !project) return; setSaveState('saving'); const revision = ++saveRevision.current;
    const id = setTimeout(() => {
      writeChain.current = writeChain.current.catch(() => {}).then(() => saveProject(project)).then(() => { if (saveRevision.current === revision) setSaveState('saved'); setProjects(prev => [project, ...prev.filter(p => p.id !== project.id)]); }).catch(() => { if (saveRevision.current === revision) setSaveState('error'); notify('저장 공간이 부족할 수 있어요. 프로젝트 백업을 내려받아 주세요', true); });
    }, 450);
    return () => clearTimeout(id);
  }, [project, loaded]);
  useEffect(() => { const handler = e => { if (saveState !== 'saved' || generation || captionTask) { e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler); }, [saveState, generation, captionTask]);
  useEffect(() => { setMobileNav(false); }, [location.pathname]);
  const updateProject = patch => setProject(prev => {
    const changes = typeof patch === 'function' ? patch(prev) : patch;
    const next = { ...prev, ...changes, updatedAt: Date.now() };
    if (next.trigger !== prev.trigger || next.style !== prev.style) {
      next.slots = next.slots.map(s => s.image ? { ...s, reviewed: false, caption: next.trigger !== prev.trigger && s.caption.startsWith(prev.trigger + ',') ? next.trigger + s.caption.slice(prev.trigger.length) : s.caption } : s);
    }
    return next;
  });
  const updateSlot = (id, patch) => updateProject(prev => ({ slots: prev.slots.map(s => s.id === id ? { ...s, ...('caption' in patch && !patch.captionSource?{captionSource:'manual'}:{}), ...patch } : s) }));
  const updateSettings = next => { setSettings(next); saveSettings(next).catch(() => notify('연결 설정을 저장하지 못했어요', true)); };
  const registerImage = async (id, fileOrImage, source = 'upload') => {
    const image = fileOrImage instanceof File ? await imageFromFile(fileOrImage) : fileOrImage;
    updateProject(prev => ({ slots: prev.slots.map(s => s.id === id ? { ...s, image: { ...image, source }, caption: s.caption || captionFor(prev, s), captionSource:'guide', reviewed: false } : s) }));
    return image;
  };
  async function runCaptions(ids,{includeReviewed=false}={}){
    if(captionLock.current)return;
    const snapshot=projectRef.current;const targets=snapshot.slots.filter(s=>ids.includes(s.id)&&s.image&&(includeReviewed||!s.reviewed));
    if(!targets.length)return notify('AI 캡션을 작성할 등록 이미지를 선택해 주세요');
    captionLock.current=true;const abort=new AbortController();captionAbort.current=abort;
    let done=0,failed=0,skipped=0;let lastError='';
    setCaptionTask({done:0,total:targets.length,slotId:targets[0].id});
    try{
      for(const slot of targets){
        if(abort.signal.aborted)break;
        setCaptionTask({done,total:targets.length,slotId:slot.id});
        try{
          const image=await captionImageData(slot.image.data);
          const result=await api('/api/caption',{settings,image,trigger:snapshot.trigger,style:snapshot.style,format:settings.captionFormat},{signal:abort.signal});
          const current=projectRef.current,now=current.slots.find(s=>s.id===slot.id);
          if(current.id!==snapshot.id||current.trigger!==snapshot.trigger||now?.image?.hash!==slot.image.hash||now.caption!==slot.caption||now.reviewed!==slot.reviewed){skipped++;continue;}
          updateProject(prev=>prev.id===snapshot.id?{slots:prev.slots.map(s=>s.id===slot.id&&s.image?.hash===slot.image.hash&&s.caption===slot.caption?{...s,caption:result.caption,captionSource:'ai:'+result.provider,captionAt:new Date().toISOString(),reviewed:false}:s)}:{});
          done++;
        }catch(error){if(abort.signal.aborted)break;failed++;lastError=error.message;break;}
      }
      notify(abort.signal.aborted?'AI 캡션 작성을 중단했어요':`${done}장의 AI 캡션을 작성했어요${failed?` · ${failed}장 확인 필요: ${lastError}`:''}${skipped?` · 수정된 ${skipped}장은 유지했어요`:''}`,failed>0);
    }finally{captionLock.current=false;captionAbort.current=null;setCaptionTask(null);}
  }
  useEffect(()=>{
    if(!loaded||!project||!settings.autoCaption||captionLock.current)return;
    const target=project.slots.find(s=>s.image&&!s.reviewed&&s.captionSource==='guide'&&!autoAttempted.current.has(`${project.id}:${s.id}:${s.image.hash}`));
    if(target){autoAttempted.current.add(`${project.id}:${target.id}:${target.image.hash}`);runCaptions([target.id]);}
  },[loaded,project,settings.autoCaption,captionTask]);
  async function importProject(restored){
    if(generation||captionTask)throw Error('진행 중인 이미지 생성과 캡션 작성을 마친 뒤 불러와 주세요');
    await writeChain.current.catch(()=>{});
    await saveProject(projectRef.current);
    await saveProject(restored);
    setProjects(previous=>[restored,...previous.filter(p=>p.id!==restored.id)]);
    setProject(restored);navigate('/dataset');
  }
  const common = { project, settings, updateProject, updateSlot, notify, openShot: setSelectedShot, editCharacter: () => setShowCharacter(true), generation, setGeneration, projectRef, registerImage,google,refreshGoogle,captionTask,runCaptions,cancelCaptions:()=>captionAbort.current?.abort(),importProject };
  const backup = () => { download(new Blob([JSON.stringify({ format: 'persona-project-v1', project }, null, 2)], { type: 'application/json' }), `${project.trigger || 'character'}-project.json`); notify('이미지와 설정을 담은 프로젝트 백업을 내려받았어요'); };
  async function importBackup(file) {
    if (!file) return;
    try { if (file.size > 400 * 1024 * 1024) throw new Error('백업 파일은 400MB 이내로 선택해 주세요'); const restored = validateBackup(JSON.parse(await file.text())); if (generation||captionTask) throw new Error('이미지 생성이 끝나면 프로젝트를 가져와 주세요'); if (project) await saveProject(project); await saveProject(restored); setProject(restored); notify('프로젝트를 새 사본으로 가져왔어요'); }
    catch (error) { notify(error.message, true); }
    finally { backupInput.current.value = ''; }
  }
  if (!loaded) return <div className="boot"><div className="brand-mark">p<span>•</span></div><h1>Persona</h1><p>{loadError || '캐릭터 작업실을 준비하고 있어요'}</p>{loadError && <Button onClick={() => location.reload()}>새로고침</Button>}</div>;
  const ready = readiness(project); const current = pages[location.pathname] || pages['/dataset'];
  return <div className="app-shell">
    {mobileNav && <div className="nav-scrim" onClick={() => setMobileNav(false)}/>}
    <aside className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}>
      <NavLink to="/dataset" className="brand"><div className="brand-mark">p<span>•</span></div><div>persona<span>캐릭터가 시작되는 곳</span></div></NavLink>
      <button className="project-switcher" onClick={() => setShowProjects(true)}><div className="small-avatar">{project.reference ? <img src={project.reference.data} alt=""/> : <Leaf size={18}/>}</div><span><small>내 프로젝트</small><strong>{project.name}</strong></span><MoreHorizontal size={17}/></button>
      <div className="nav-heading">작업 공간</div>
      <nav>{navItems.map(({ to, label, icon: Icon }, index) => <NavLink key={to} to={to} className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}><Icon size={19}/><span>{label}</span>{index === 0 && <span className="nav-count">{project.size}</span>}</NavLink>)}</nav>
      <div className="nav-heading second">도구와 도움말</div>
      <nav><NavLink className="nav-item" to="/connections"><WandSparkles size={19}/><span>AI 생성 연결</span><i className="connection-dot"/></NavLink><NavLink className="nav-item" to="/cloud"><CloudOff size={19}/><span>Google Drive 보관</span></NavLink><NavLink className="nav-item" to="/guide"><BookOpen size={19}/><span>시작 가이드</span></NavLink></nav>
      <div className="sidebar-bottom"><div className="local-note"><HardDrive size={17}/><div><strong>이 기기에 안전하게</strong><span>이미지는 브라우저에 자동 저장</span></div></div>{!installed && <button className="install-button" disabled={installing} aria-busy={installing||undefined} onClick={installApp}>{installing?<RefreshCw size={16} className="spin"/>:<Download size={16}/>}<span>{installing?"설치 창을 여는 중":installEvent?"앱으로 설치하기":"홈 화면 추가 안내"}</span><ArrowRight size={15}/></button>}<div className="sidebar-foot"><span>Persona Studio</span><span>v1.0</span></div></div>
    </aside>
    <div className="app-main">
      <header className="topbar"><button className="icon-button mobile-menu" aria-label="메뉴 열기" onClick={() => setMobileNav(true)}><Menu size={21}/></button><div className="page-heading"><h1>{current[0]}</h1><span>{current[1]}</span></div><div className="topbar-actions"><span className={`save-status ${saveState === 'error' ? 'error' : ''}`}>{online ? <CheckCircle2 size={14}/> : <CloudOff size={14}/>}<span>{saveState === 'saving' ? '저장 중' : saveState === 'error' ? '백업이 필요해요' : online ? '자동 저장됨' : '오프라인 저장'}</span></span><button className="icon-button" aria-label="프로젝트 백업" data-tooltip="프로젝트 백업" onClick={backup}><ArrowDownToLine size={19}/></button><button className="icon-button" aria-label="프로젝트 설정" data-tooltip="프로젝트 설정" onClick={() => setShowCharacter(true)}><Settings2 size={19}/></button><NavLink to="/cloud" className="user-avatar" aria-label={google?.user?"Google 계정: "+google.user.email:"Google 로그인"}>{google?.user?.name?.slice(0,1)||"G"}</NavLink></div></header>
      <main className="page-scroll"><Routes><Route path="/dataset" element={<DatasetPage {...common}/>}/><Route path="/captions" element={<CaptionsPage {...common}/>}/><Route path="/training" element={<TrainingPage {...common}/>}/><Route path="/connections" element={<ConnectionsPage {...common} updateSettings={updateSettings}/>}/><Route path="/cloud" element={<CloudPage {...common}/>}/><Route path="/guide" element={<GuidePage/>}/><Route path="*" element={<Navigate to="/dataset" replace/>}/></Routes></main>
      <footer className="statusbar"><span><span className="tiny-dot"/>{project.name}</span><span>{ready.filled} / {ready.total} 이미지<span className="status-divider">|</span>{ready.reviewed} 캡션 확인<span className="status-divider">|</span>로컬 우선 작업실</span></footer>
    </div>
    <Modal isOpen={showCharacter} onClose={() => setShowCharacter(false)} title="캐릭터 설정" size="lg" footer={<Button variant="primary" onClick={() => { if (!/^[a-zA-Z0-9_-]{2,64}$/.test(project.trigger)) return notify('트리거는 영문, 숫자, _, -를 사용해 2~64자로 입력해 주세요', true); setShowCharacter(false); notify('캐릭터 설정을 저장했어요'); }}>설정 완료</Button>}>
      <CharacterForm project={project} updateProject={updateProject} notify={notify}/>
    </Modal>
    <Modal isOpen={showProjects} onClose={() => setShowProjects(false)} title="내 프로젝트" footer={<><Button icon={Upload} onClick={() => backupInput.current.click()}>백업 가져오기</Button><Button variant="primary" icon={Plus} disabled={!!generation||!!captionTask} onClick={async () => { try { await saveProject(project); const next = newProject(); await saveProject(next); setProject(next); setShowProjects(false); setShowCharacter(true); navigate('/dataset'); } catch { notify('새 프로젝트를 저장할 공간을 확인해 주세요', true); } }}>새 프로젝트</Button></>}>
      <div className="project-list">{[project, ...projects.filter(p => p.id !== project.id)].map(p => <div className="project-list-row" key={p.id}><button disabled={!!generation||!!captionTask} onClick={async () => { try { await saveProject(project); setProject(p); setShowProjects(false); navigate('/dataset'); } catch { notify('현재 프로젝트를 저장한 뒤 전환해 주세요', true); } }}><div className="small-avatar"><FolderOpen size={19}/></div><span><strong>{p.name}</strong><small>{p.slots.filter(s => s.image).length} / {p.size} 이미지 · {p.trigger}</small></span>{p.id === project.id ? <Check size={18}/> : <ChevronRight size={18}/>}</button>{p.id !== project.id && <button className="delete-button" disabled={!!generation||!!captionTask} aria-label={`${p.name} 프로젝트 삭제`} onClick={() => setDeleteTarget(p)}><Trash2 size={16}/></button>}</div>)}</div>
    </Modal>
    <Modal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="프로젝트 삭제" footer={<><Button onClick={() => setDeleteTarget(null)}>유지하기</Button><Button variant="danger" onClick={async () => { try { await writeChain.current; await deleteProject(deleteTarget.id); setProjects(prev => prev.filter(p => p.id !== deleteTarget.id)); setDeleteTarget(null); notify('선택한 프로젝트를 삭제했어요'); } catch { notify('프로젝트를 삭제하지 못했어요. 다시 시도해 주세요', true); } }}>프로젝트 삭제</Button></>}><p>{deleteTarget?.name}의 이미지와 캡션을 이 브라우저에서 삭제합니다. 보관할 내용이 있다면 해당 프로젝트의 백업을 먼저 내려받아 주세요.</p></Modal>
    <input ref={backupInput} type="file" accept="application/json,.json" hidden onChange={e => importBackup(e.target.files[0])}/>
    {selectedShot && <ShotEditor key={selectedShot} {...common} id={selectedShot} onClose={() => setSelectedShot(null)}/>}
    {toast && <Toast notification={toast} onClose={closeToast}/>}
    {showInstallHelp && <InstallHelp onClose={()=>setShowInstallHelp(false)} notify={notify}/>}
  </div>;
}
function CharacterForm({ project, updateProject, notify }) {
  const ref = useRef(); const [busy, setBusy] = useState(false);
  return <div className="character-form"><div className="reference-upload"><button onClick={() => ref.current.click()} className="reference-preview" aria-label="캐릭터 참조 이미지 등록">{project.reference ? <img src={project.reference.data} alt="캐릭터 참조"/> : <><Pose/><span><ImagePlus size={20}/>참조 이미지 등록</span></>}</button><div><h3>모든 이미지의 기준이 되는 한 장</h3><p>얼굴과 고유한 특징이 잘 보이는 이미지를 등록해 주세요. AI 생성 시 동일한 캐릭터를 유지하는 데 사용해요.</p><Button busy={busy} icon={Upload} onClick={() => ref.current.click()}>이미지 선택</Button>{project.reference && <Button variant="ghost" onClick={() => updateProject({ reference: null })}>참조 해제</Button>}<input ref={ref} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={async e => { const f = e.target.files[0]; if (!f) return; setBusy(true); try { updateProject({ reference: await imageFromFile(f) }); } catch (err) { notify(err.message, true); } finally { setBusy(false); e.target.value = ''; } }}/></div></div><div className="form-grid"><Field label="프로젝트 이름"><input maxLength={60} value={project.name} onChange={e => updateProject({ name: e.target.value })}/></Field><Field label="트리거 단어" hint="영문, 숫자, _, -를 조합한 고유한 단어"><input maxLength={64} value={project.trigger} onChange={e => updateProject({ trigger: e.target.value.replace(/[^a-zA-Z0-9_-]/g, '') })}/></Field><Field label="이미지 스타일"><SelectControl value={project.style} onChange={e => updateProject({ style: e.target.value })}><option value="illustration">캐릭터 일러스트</option><option value="anime">애니메이션</option><option value="photo">실사</option></SelectControl></Field><Field label="학습 베이스" hint="베이스를 바꾸면 해당 모델의 시작 설정을 적용해요"><SelectControl value={project.model} onChange={e => updateProject(selectTrainingModel(project, e.target.value))}>{TRAINING_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</SelectControl></Field></div><Field label="캐릭터의 고유한 특징" hint="생성 프롬프트에 공통으로 반영돼요. 캡션에는 구도와 변하는 요소를 중심으로 기록해요"><textarea rows={3} maxLength={2000} placeholder="예: short silver hair, amber eyes, small freckles, round glasses" value={project.identity} onChange={e => updateProject({ identity: e.target.value })}/></Field></div>;
}
createRoot(document.getElementById('root')).render(<BrowserRouter><App/></BrowserRouter>);
