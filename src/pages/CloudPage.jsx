import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Cloud, FolderOpen, LogIn, LogOut, RefreshCw, ShieldCheck, UploadCloud, CheckCircle2 } from 'lucide-react';
import { Button } from '../components/ui';
import { api } from '../lib/api.mjs';
import { readiness } from '../lib/dataset.mjs';
import { uploadTrainingPackage } from '../lib/drive.mjs';
import DriveImport from '../components/DriveImport';

function DriveSavedInfo({ saved }) {
  return (
    <div className="cloud-links">
      <a className="button primary" href={saved.folderUrl} target="_blank" rel="noreferrer">
        <FolderOpen size={15}/>Drive에서 보관 폴더 열기
      </a>
      <small>{saved.email} · {new Date(saved.uploadedAt).toLocaleString('ko-KR')}</small>
    </div>
  );
}

export function GoogleConnection({ google, refreshGoogle, notify }) {
  const [busy, setBusy] = useState(false);
  const checking = !google || google.checking;
  async function login() {
    setBusy(true);
    try {
      const { url } = await api('/api/google/login', {});
      window.location.assign(url);
    } catch (error) {
      notify(error.message, true);
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    try {
      await api('/api/google/logout', {});
      await refreshGoogle();
      notify('이 기기의 Google 로그인을 해제했어요');
    } catch (error) {
      notify(error.message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="surface google-connection">
      <div className="panel-heading">
        <h3>Google 계정 연결</h3>
        <span className="subtle-pill">앱 파일 접근 권한</span>
      </div>
      {google?.user ? (
        <div className="google-profile">
          <div className="google-avatar">{google.user.name.slice(0, 1)}</div>
          <div>
            <strong>{google.user.name}</strong>
            <span>{google.user.email}</span>
          </div>
          <Button busy={busy || checking} variant="ghost" icon={LogOut} onClick={logout}>로그아웃</Button>
        </div>
      ) : (
        <>
          <p>Google로 로그인하고 프로젝트와 데이터셋을 내 Drive에 안전하게 보관하세요</p>
          <Button variant="primary" icon={LogIn} busy={busy || checking} disabled={google?.configured !== true} onClick={login}>
            Google로 로그인
          </Button>
        </>
      )}
      {checking ? (
        <p className="surface-note" role="status">Google 연결 상태를 확인하고 있어요</p>
      ) : google?.error ? (
        <div className="callout">
          <span>{google.error}</span>
          <Button icon={RefreshCw} onClick={refreshGoogle}>다시 확인</Button>
        </div>
      ) : google?.configured === false ? (
        <div className="callout">
          <span>이 작업실의 Google 로그인 설정을 확인해야 해요</span>
          <Button icon={RefreshCw} onClick={refreshGoogle}>다시 확인</Button>
        </div>
      ) : null}
      <div className="privacy-note">
        <ShieldCheck size={18}/>
        <p>로그인한 계정 정보와 이 앱에서 만든 Drive 파일만 사용해요. 파일은 내 Drive에 비공개로 저장됩니다.</p>
      </div>
    </section>
  );
}

export default function CloudPage({ project, updateProject, google, refreshGoogle, notify, importProject, generation, captionTask }) {
  const [upload, setUpload] = useState(null), [controller, setController] = useState(null), [importing, setImporting] = useState(false);
  const active = useRef(null);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    const warn = e => { if (upload) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [upload]);

  const progress = readiness(project), last = project.cloudPackage;

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const result = params.get('google');
    if (result) {
      notify(result === 'connected' ? 'Google 로그인과 Drive 연결을 완료했어요' : result === 'cancelled' ? 'Google 연결을 취소했어요' : 'Google 로그인 상태와 권한을 확인한 뒤 다시 시도해 주세요', result !== 'connected');
      history.replaceState(null, '', '/cloud');
      refreshGoogle();
    }
  }, []);

  async function save() {
    const sourceId = project.id, abort = new AbortController();
    active.current = abort;
    setController(abort);
    setUpload({ label: 'Drive 저장 준비 중', percent: 0 });
    try {
      const result = await uploadTrainingPackage(project, setUpload, abort.signal);
      updateProject(current => current.id === sourceId ? { cloudPackage: result } : {});
      notify('프로젝트 데이터셋을 Drive에 안전하게 저장했어요');
    } catch (error) {
      notify(abort.signal.aborted ? 'Drive 저장을 중단했어요. 로컬 프로젝트는 그대로 유지돼요' : error.message, true);
    } finally {
      active.current = null;
      setUpload(null);
      setController(null);
    }
  }

  return (
    <div className="standard-page cloud-page">
      <div className="section-intro">
        <div className="intro-icon"><Cloud size={25}/></div>
        <div>
          <h2>Google Drive 프로젝트 보관함</h2>
          <p>프로젝트와 데이터셋을 Google Drive에 안전하게 백업하고 언제든 다시 불러올 수 있어요</p>
        </div>
        <Button variant="ghost" icon={RefreshCw} busy={google?.checking} onClick={refreshGoogle}>연결 확인</Button>
      </div>

      <GoogleConnection google={google} refreshGoogle={refreshGoogle} notify={notify}/>

      {google?.user && (
        <DriveImport key={google.user.id} onImport={importProject} blocked={!!generation || !!captionTask || !!upload} notify={notify} onBusyChange={setImporting}/>
      )}

      <div className="training-grid">
        <section className="surface">
          <h3>현재 프로젝트를 Drive에 백업 저장</h3>
          <p>검토를 마친 이미지와 캡션, LoRA 학습 구성을 압축 패키지로 보관해요</p>
          <div className="cloud-summary">
            <span>{project.name}</span>
            <strong>{progress.filled} / {progress.total} 이미지</strong>
            <strong>{progress.reviewed} 캡션 확인</strong>
          </div>
          {!progress.ready && (
            <div className="callout">
              이미지 등록과 캡션 확인을 완료하면 보관 패키지를 저장할 수 있어요 <Link className="text-link" to="/captions">캡션 확인<ArrowRight size={14}/></Link>
            </div>
          )}
          {upload && (
            <div className="upload-progress" role="status">
              <span>{upload.label} · {upload.percent}%</span>
              <div className="progress-track"><i style={{ width: `${upload.percent}%` }}/></div>
            </div>
          )}
          <div className="cloud-actions">
            <Button variant="primary" icon={UploadCloud} busy={!!upload} disabled={!google?.user || !progress.ready || importing} onClick={save}>
              Drive에 안전하게 백업 저장
            </Button>
            {upload && <Button onClick={() => controller?.abort()}>중단</Button>}
          </div>
          <p className="surface-note">Drive의 Persona Studio 폴더 아래 매번 새로운 패키지를 만들어요. 기존 파일을 덮어쓰지 않습니다.</p>
        </section>

        <aside>
          <section className="export-panel">
            <h3>클라우드 보관 안내</h3>
            <p>언제 어디서든 내 캐릭터 프로젝트를 복원할 수 있어요</p>
            <ol className="simple-list">
              <li>검토한 데이터셋 백업 저장</li>
              <li>다른 PC나 브라우저에서 로그인</li>
              <li>보관 프로젝트 불러오기로 즉시 복원</li>
            </ol>
            {last && <DriveSavedInfo saved={last}/>}
          </section>
        </aside>
      </div>
    </div>
  );
}
