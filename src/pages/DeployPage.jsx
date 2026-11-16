import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Copy, Download, FolderOpen, LogIn, PackageOpen, UploadCloud } from 'lucide-react';
import { Button, Empty } from '../components/ui';
import { readiness } from '../lib/dataset.mjs';
import { uploadTrainingPackage } from '../lib/drive.mjs';
import { exportDataset, download, safeName, copyText } from '../lib/export.mjs';
import { TRAINING_MODELS, trainingValid } from '../lib/training.mjs';
import { startGoogleLogin } from '../components/GoogleConnection';

export default function DeployPage({ project, updateProject, google, notify }) {
  const [upload, setUpload] = useState(null);
  const [controller, setController] = useState(null);
  const [busyExport, setBusyExport] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const active = useRef(null);
  const progress = readiness(project);
  const lora = project.lora;
  const last = project.cloudPackage;
  const exportReady = progress.ready && trainingValid(project);
  const modelLabel = lora && (TRAINING_MODELS.find(m => m.id === lora.model)?.label || lora.model);
  const examplePrompt = `${project.trigger}, a portrait in soft daylight`;

  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    const warn = e => { if (upload) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [upload]);

  async function copy(text, message) {
    notify(await copyText(text) ? message : '직접 선택해 복사해 주세요', false);
  }

  async function exportAll() {
    setBusyExport(true);
    try {
      download(await exportDataset(project), `${safeName(project.trigger)}-dataset.zip`);
      notify('이미지, 캡션과 train.yaml을 담은 데이터셋 ZIP을 내려받았어요');
    } catch (error) {
      notify(error.message, true);
    } finally {
      setBusyExport(false);
    }
  }

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

  async function login() {
    setLoginBusy(true);
    if (!await startGoogleLogin(notify)) setLoginBusy(false);
  }

  return <div className="page deploy-page">
    <section className="card">
      <h2 className="card-title">LoRA 모델</h2>
      {lora ? <>
        <dl className="detail-list">
          <div><dt>파일</dt><dd>{lora.file}</dd></div>
          {lora.size ? <div><dt>크기</dt><dd>{(lora.size / 1024 / 1024).toFixed(1)} MB</dd></div> : null}
          <div><dt>완료 시각</dt><dd>{new Date(lora.completedAt).toLocaleString('ko-KR')}</dd></div>
          {modelLabel ? <div><dt>베이스 모델</dt><dd>{modelLabel}</dd></div> : null}
        </dl>
        <div className="inline-actions">
          <a className="button primary" href={`/api/train/output/${encodeURIComponent(lora.file)}`} download={lora.file}><Download size={16}/>LoRA 다운로드</a>
        </div>
      </> : <Empty icon={PackageOpen} title="학습을 완료하면 LoRA 파일이 여기에 준비돼요"><Link className="button" to="/training">학습으로<ArrowRight size={16}/></Link></Empty>}
    </section>

    <section className="card">
      <h2 className="card-title">ComfyUI에서 사용</h2>
      <ol className="step-list">
        <li>내려받은 <code>.safetensors</code> 파일을 <code>ComfyUI/models/loras</code>에 복사해요</li>
        <li><code>LoraLoader</code> 노드에서 파일을 선택해요 · 강도는 0.8~1.0부터 시작해요</li>
        <li>프롬프트의 첫 단어로 트리거를 사용해요</li>
      </ol>
      <div className="copy-row">
        <span className="trigger-chip">{project.trigger}</span>
        <Button icon={Copy} onClick={() => copy(project.trigger, '트리거 단어를 복사했어요')}>복사</Button>
      </div>
      <div className="copy-row">
        <code className="code-block">{examplePrompt}</code>
        <Button icon={Copy} onClick={() => copy(examplePrompt, '예시 프롬프트를 복사했어요')}>복사</Button>
      </div>
    </section>

    <section className="card">
      <h2 className="card-title">데이터셋과 보관</h2>
      <div className="deploy-block">
        <div>
          <strong>데이터셋 ZIP</strong>
          <p className="card-note">이미지, 캡션, train.yaml을 한 번에 담아요</p>
          {!exportReady && <p className="card-note">이미지 등록과 캡션 확인을 마치면 내려받을 수 있어요</p>}
        </div>
        <Button icon={Download} busy={busyExport} disabled={!exportReady} onClick={exportAll}>데이터셋 ZIP 다운로드</Button>
      </div>
      <div className="deploy-block">
        <div>
          <strong>Google Drive</strong>
          <p className="card-note">Drive의 Persona Studio 폴더 아래 매번 새 패키지를 만들어요 · 기존 파일은 덮어쓰지 않아요</p>
          {google?.user && !progress.ready && <p className="card-note">이미지 등록과 캡션 확인을 마치면 저장할 수 있어요</p>}
          {upload && <div className="progress-block" role="status"><span>{upload.label} · {upload.percent}%</span><div className="progress-track"><i style={{ width: `${upload.percent}%` }}/></div></div>}
          {last && <p className="card-note">마지막 저장 {last.email} · {new Date(last.uploadedAt).toLocaleString('ko-KR')}</p>}
        </div>
        <div className="inline-actions">
          {google?.user ? <>
            <Button variant="primary" icon={UploadCloud} busy={!!upload} disabled={!progress.ready} onClick={save}>Drive에 저장</Button>
            {upload && <Button onClick={() => controller?.abort()}>중단</Button>}
            {last && <a className="button" href={last.folderUrl} target="_blank" rel="noreferrer"><FolderOpen size={16}/>Drive 폴더 열기</a>}
          </> : <Button icon={LogIn} busy={loginBusy} disabled={google?.configured !== true} onClick={login}>Google 로그인</Button>}
        </div>
      </div>
    </section>
  </div>;
}
