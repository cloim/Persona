import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { newProject, readiness, captionFor } from './lib/dataset.mjs';
import { loadProjects, saveProject, deleteProject, getSettings, saveSettings, imageFromFile } from './lib/storage.mjs';
import { download, validateBackup } from './lib/export.mjs';
import { Button, Toast } from './components/ui';
import SetupPage from './pages/SetupPage';
import DatasetPage from './pages/DatasetPage';
import CaptionsPage from './pages/CaptionsPage';
import TrainingPage from './pages/TrainingPage';
import DeployPage from './pages/DeployPage';
import SettingsPage from './pages/SettingsPage';
import ShotEditor from './components/ShotEditor';
import Sidebar, { StepTabBar } from './components/Sidebar';
import Topbar from './components/Topbar';
import ProjectsModal from './components/ProjectsModal';
import InstallHelp from './components/InstallHelp';
import { GOOGLE_RETURN_KEY } from './components/GoogleConnection';
import './components/SelectControl/select-control.css';
import './components/Modal/modal.css';
import './styles.css';
import { migrateTraining } from './lib/training.mjs';
import { stepStatus, firstIncompleteStep } from './lib/steps.mjs';
import { api } from './lib/api.mjs';
import { captionImageData } from './lib/captions.mjs';
import useTrainingJob, { trainingProjectId } from './hooks/useTrainingJob';

const initialSettings = {
  provider: 'comfy',
  comfyUrl: 'http://127.0.0.1:8188',
  workflow: '',
  apiBase: 'https://api.openai.com/v1',
  apiModel: 'gpt-image-2',
  apiKey: '',
  captionProvider: 'codex',
  captionFormat: 'natural',
  captionApiBase: 'https://api.openai.com/v1',
  captionModel: '',
  captionApiKey: '',
  autoCaption: false,
};

function App() {
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [settings, setSettings] = useState(initialSettings);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saveState, setSaveState] = useState('saved');
  const [toast, setToast] = useState(null);
  const toastSequence = useRef(0);
  const closeToast = useCallback(() => setToast(null), []);
  const [showProjects, setShowProjects] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [selectedShot, setSelectedShot] = useState(null);
  const [generation, setGeneration] = useState(null);
  const [google, setGoogle] = useState(null);
  const [captionTask, setCaptionTask] = useState(null);
  const captionAbort = useRef();
  const captionLock = useRef(false);
  const autoAttempted = useRef(new Set());
  const googleRequest = useRef(null);
  const mainScroll = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();
  const projectRef = useRef(project);
  projectRef.current = project;
  const writeChain = useRef(Promise.resolve());
  const saveRevision = useRef(0);
  const notify = useCallback((message, error = false) => setToast({ id: ++toastSequence.current, message, error }), []);
  const { job, cliInfo, refresh: refreshJob, start: startTraining, cancel: cancelTraining } = useTrainingJob(notify);

  async function refreshGoogle() {
    if (googleRequest.current) return googleRequest.current;
    setGoogle(previous => ({ ...previous, checking: true, error: '' }));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    googleRequest.current = (async () => {
      try {
        const status = await api('/api/google/status', undefined, { signal: controller.signal });
        if (typeof status.configured !== 'boolean') throw new Error('Google 연결 응답을 확인하지 못했어요. 앱 접속 주소를 확인해 주세요');
        setGoogle({ ...status, checking: false, error: '' });
      } catch (error) {
        setGoogle({ configured: null, user: null, checking: false, error: controller.signal.aborted ? '서버 응답이 지연되고 있어요. 네트워크 연결을 확인하고 다시 시도해 주세요' : error.message });
      } finally {
        clearTimeout(timer);
        googleRequest.current = null;
      }
    })();
    return googleRequest.current;
  }

  const [installEvent, setInstallEvent] = useState(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installed, setInstalled] = useState(() => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true);
  async function installApp() {
    if (!installEvent) { setShowInstallHelp(true); return; }
    setInstalling(true);
    try {
      await installEvent.prompt();
      const choice = await installEvent.userChoice;
      if (choice.outcome !== 'accepted') setShowInstallHelp(true);
    } catch {
      setShowInstallHelp(true);
    } finally {
      setInstallEvent(null);
      setInstalling(false);
    }
  }

  useEffect(() => {
    Promise.all([loadProjects(), getSettings()]).then(([saved, savedSettings]) => {
      const sorted = saved.map(migrateTraining).sort((a, b) => b.updatedAt - a.updatedAt);
      setProjects(sorted);
      setProject(sorted[0] || newProject());
      if (savedSettings) setSettings({ ...initialSettings, ...savedSettings, apiKey: '', captionApiKey: '' });
      setLoaded(true);
    }).catch(() => setLoadError('브라우저 저장 공간에 접근할 수 없어요. 저장 공간 권한을 확인한 뒤 새로고침해 주세요'));
    const install = e => { e.preventDefault(); setInstallEvent(e); };
    const connection = () => { setOnline(navigator.onLine); if (navigator.onLine) refreshGoogle(); };
    const appInstalled = () => { setInstalled(true); setInstallEvent(null); setShowInstallHelp(false); };
    const resume = () => { if (document.visibilityState === 'visible') refreshGoogle(); };
    refreshGoogle();
    window.addEventListener('beforeinstallprompt', install);
    window.addEventListener('online', connection);
    window.addEventListener('offline', connection);
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('appinstalled', appInstalled);
    if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    return () => {
      window.removeEventListener('beforeinstallprompt', install);
      window.removeEventListener('online', connection);
      window.removeEventListener('offline', connection);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('appinstalled', appInstalled);
    };
  }, []);

  // Google OAuth 콜백 결과 처리: /settings?google=... 로 돌아온 뒤 로그인을 시작한 경로로 복귀한다
  useEffect(() => {
    const result = new URLSearchParams(location.search).get('google');
    if (!result) return;
    notify(result === 'connected' ? 'Google 로그인과 Drive 연결을 완료했어요' : result === 'cancelled' ? 'Google 연결을 취소했어요' : 'Google 로그인 상태와 권한을 확인한 뒤 다시 시도해 주세요', result !== 'connected');
    const back = sessionStorage.getItem(GOOGLE_RETURN_KEY);
    sessionStorage.removeItem(GOOGLE_RETURN_KEY);
    refreshGoogle();
    navigate(back || '/settings', { replace: true });
  }, [location.search]);

  useEffect(() => {
    if (!loaded || !project) return;
    setSaveState('saving');
    const revision = ++saveRevision.current;
    const id = setTimeout(() => {
      writeChain.current = writeChain.current.catch(() => {}).then(() => saveProject(project)).then(() => {
        if (saveRevision.current === revision) setSaveState('saved');
        setProjects(prev => [project, ...prev.filter(p => p.id !== project.id)]);
      }).catch(() => {
        if (saveRevision.current === revision) setSaveState('error');
        notify('저장 공간이 부족할 수 있어요. 프로젝트 백업을 내려받아 주세요', true);
      });
    }, 450);
    return () => clearTimeout(id);
  }, [project, loaded]);

  useEffect(() => {
    const handler = e => { if (saveState !== 'saved' || generation || captionTask) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [saveState, generation, captionTask]);

  useEffect(() => {
    setMobileNav(false);
    mainScroll.current?.scrollTo(0, 0);
  }, [location.pathname]);

  const updateProject = patch => setProject(prev => {
    const changes = typeof patch === 'function' ? patch(prev) : patch;
    const next = { ...prev, ...changes, updatedAt: Date.now() };
    if (next.trigger !== prev.trigger || next.style !== prev.style) {
      next.slots = next.slots.map(s => s.image ? { ...s, reviewed: false, caption: next.trigger !== prev.trigger && s.caption.startsWith(prev.trigger + ',') ? next.trigger + s.caption.slice(prev.trigger.length) : s.caption } : s);
    }
    return next;
  });
  const updateSlot = (id, patch) => updateProject(prev => ({ slots: prev.slots.map(s => s.id === id ? { ...s, ...('caption' in patch && !patch.captionSource ? { captionSource: 'manual' } : {}), ...patch } : s) }));
  const updateSettings = next => { setSettings(next); saveSettings(next).catch(() => notify('연결 설정을 저장하지 못했어요', true)); };
  const registerImage = async (id, fileOrImage, source = 'upload') => {
    const image = fileOrImage instanceof File ? await imageFromFile(fileOrImage) : fileOrImage;
    updateProject(prev => ({ slots: prev.slots.map(s => s.id === id ? { ...s, image: { ...image, source }, caption: s.caption || captionFor(prev, s), captionSource: 'guide', reviewed: false } : s) }));
    return image;
  };

  async function runCaptions(ids, { includeReviewed = false } = {}) {
    if (captionLock.current) return;
    const snapshot = projectRef.current;
    const targets = snapshot.slots.filter(s => ids.includes(s.id) && s.image && (includeReviewed || !s.reviewed));
    if (!targets.length) return notify('AI 캡션을 작성할 등록 이미지를 선택해 주세요');
    captionLock.current = true;
    const abort = new AbortController();
    captionAbort.current = abort;
    let done = 0, failed = 0, skipped = 0;
    let lastError = '';
    setCaptionTask({ done: 0, total: targets.length, slotId: targets[0].id });
    try {
      for (const slot of targets) {
        if (abort.signal.aborted) break;
        setCaptionTask({ done, total: targets.length, slotId: slot.id });
        try {
          const image = await captionImageData(slot.image.data);
          const result = await api('/api/caption', { settings, image, trigger: snapshot.trigger, style: snapshot.style, format: settings.captionFormat }, { signal: abort.signal });
          const current = projectRef.current, now = current.slots.find(s => s.id === slot.id);
          if (current.id !== snapshot.id || current.trigger !== snapshot.trigger || now?.image?.hash !== slot.image.hash || now.caption !== slot.caption || now.reviewed !== slot.reviewed) { skipped++; continue; }
          updateProject(prev => prev.id === snapshot.id ? { slots: prev.slots.map(s => s.id === slot.id && s.image?.hash === slot.image.hash && s.caption === slot.caption ? { ...s, caption: result.caption, captionSource: 'ai:' + result.provider, captionAt: new Date().toISOString(), reviewed: false } : s) } : {});
          done++;
        } catch (error) { if (abort.signal.aborted) break; failed++; lastError = error.message; break; }
      }
      notify(abort.signal.aborted ? 'AI 캡션 작성을 중단했어요' : `${done}장의 AI 캡션을 작성했어요${failed ? ` · ${failed}장 확인 필요: ${lastError}` : ''}${skipped ? ` · 수정된 ${skipped}장은 유지했어요` : ''}`, failed > 0);
    } finally { captionLock.current = false; captionAbort.current = null; setCaptionTask(null); }
  }
  useEffect(() => {
    if (!loaded || !project || !settings.autoCaption || captionLock.current) return;
    const target = project.slots.find(s => s.image && !s.reviewed && s.captionSource === 'guide' && !autoAttempted.current.has(`${project.id}:${s.id}:${s.image.hash}`));
    if (target) { autoAttempted.current.add(`${project.id}:${target.id}:${target.image.hash}`); runCaptions([target.id]); }
  }, [loaded, project, settings.autoCaption, captionTask]);

  // 학습 완료 결과를 현재 프로젝트의 LoRA 정보로 연결한다
  useEffect(() => {
    if (!loaded || !project) return;
    const owner = trainingProjectId();
    if (job.status === 'completed' && job.outputFile && job.trigger === project.trigger && (!owner || owner === project.id) && project.lora?.file !== job.outputFile) {
      updateProject({ lora: { file: job.outputFile, size: job.outputSize, completedAt: job.completedAt || Date.now(), model: job.modelId } });
    }
  }, [job, project, loaded]);

  async function importProject(restored) {
    if (generation || captionTask) throw Error('진행 중인 이미지 생성과 캡션 작성을 마친 뒤 불러와 주세요');
    await writeChain.current.catch(() => {});
    await saveProject(projectRef.current);
    await saveProject(restored);
    setProjects(previous => [restored, ...previous.filter(p => p.id !== restored.id)]);
    setProject(restored);
    setShowProjects(false);
    navigate('/');
  }

  function backupProject(target) {
    download(new Blob([JSON.stringify({ format: 'persona-project-v1', project: target }, null, 2)], { type: 'application/json' }), `${target.trigger || 'character'}-project.json`);
    notify('이미지와 설정을 담은 프로젝트 백업을 내려받았어요');
  }

  async function importBackup(file) {
    try {
      if (file.size > 400 * 1024 * 1024) throw new Error('백업 파일은 400MB 이내로 선택해 주세요');
      const restored = validateBackup(JSON.parse(await file.text()));
      if (generation || captionTask) throw new Error('이미지 생성이 끝나면 프로젝트를 가져와 주세요');
      if (project) await saveProject(project);
      await saveProject(restored);
      setProject(restored);
      setShowProjects(false);
      navigate('/');
      notify('프로젝트를 새 사본으로 가져왔어요');
    } catch (error) { notify(error.message, true); }
  }

  async function switchProject(target) {
    try {
      await saveProject(project);
      setProject(target);
      setShowProjects(false);
      navigate('/');
    } catch { notify('현재 프로젝트를 저장한 뒤 전환해 주세요', true); }
  }

  async function createProject() {
    try {
      await saveProject(project);
      const next = newProject();
      await saveProject(next);
      setProject(next);
      setShowProjects(false);
      navigate('/setup', { state: { focusName: true } });
    } catch { notify('새 프로젝트를 저장할 공간을 확인해 주세요', true); }
  }

  async function removeProject(target) {
    try {
      await writeChain.current;
      await deleteProject(target.id);
      setProjects(prev => prev.filter(p => p.id !== target.id));
      notify('선택한 프로젝트를 삭제했어요');
      return true;
    } catch {
      notify('프로젝트를 삭제하지 못했어요. 다시 시도해 주세요', true);
      return false;
    }
  }

  if (!loaded) return <div className="boot"><div className="brand-mark"><img src="/logo-white.svg" alt="Persona"/></div><h1>Persona</h1><p>{loadError || '캐릭터 작업실을 준비하고 있어요'}</p>{loadError && <Button onClick={() => window.location.reload()}>새로고침</Button>}</div>;

  const status = stepStatus(project, job);
  const running = job.status === 'running' || job.status === 'cancelling';
  const busy = !!generation || !!captionTask;
  const openShot = (id, tab = 'image') => setSelectedShot({ id, tab });
  const trainingActions = { start: startTraining, cancel: cancelTraining, refresh: refreshJob };
  const common = { project, settings, updateProject, updateSlot, updateSettings, notify, openShot, generation, setGeneration, projectRef, registerImage, google, refreshGoogle, captionTask, runCaptions, cancelCaptions: () => captionAbort.current?.abort(), importProject, job, cliInfo, trainingActions, status };
  const home = <Navigate to={firstIncompleteStep(status)} replace/>;

  return <div className="app-shell">
    <Sidebar project={project} status={status} running={running} open={mobileNav} onClose={() => setMobileNav(false)} onOpenProjects={() => { setMobileNav(false); setShowProjects(true); }}/>
    <div className="app-main">
      <Topbar project={project} status={status} saveState={saveState} online={online} google={google} refreshGoogle={refreshGoogle} notify={notify} onMenu={() => setMobileNav(true)} installed={installed} installEvent={installEvent} installing={installing} installApp={installApp}/>
      <main className="page-scroll" ref={mainScroll}>
        <Routes>
          <Route path="/setup" element={<SetupPage {...common}/>}/>
          <Route path="/dataset" element={<DatasetPage {...common}/>}/>
          <Route path="/captions" element={<CaptionsPage {...common}/>}/>
          <Route path="/training" element={<TrainingPage {...common}/>}/>
          <Route path="/deploy" element={<DeployPage {...common}/>}/>
          <Route path="/settings" element={<SettingsPage {...common}/>}/>
          <Route path="/connections" element={<Navigate to="/settings" replace/>}/>
          <Route path="/cloud" element={<Navigate to="/deploy" replace/>}/>
          <Route path="/guide" element={home}/>
          <Route path="*" element={home}/>
        </Routes>
      </main>
    </div>
    <StepTabBar status={status} running={running}/>
    <ProjectsModal isOpen={showProjects} onClose={() => setShowProjects(false)} project={project} projects={projects} busy={busy} google={google} notify={notify} onSwitch={switchProject} onCreate={createProject} onDelete={removeProject} onBackup={backupProject} onImportFile={importBackup} importProject={importProject}/>
    {selectedShot && <ShotEditor {...common} id={selectedShot.id} tab={selectedShot.tab} onClose={() => setSelectedShot(null)}/>}
    {toast && <Toast notification={toast} onClose={closeToast}/>}
    {showInstallHelp && <InstallHelp onClose={() => setShowInstallHelp(false)} notify={notify}/>}
  </div>;
}

createRoot(document.getElementById('root')).render(<BrowserRouter><App/></BrowserRouter>);
