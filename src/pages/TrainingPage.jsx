import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Check, CheckCircle2, Download, ExternalLink,
  FileArchive, FileCode2, Folder, Sprout, TriangleAlert,
  Zap, Play, Square, RefreshCw, Terminal, Copy, Cpu, CheckCheck, HardDrive
} from 'lucide-react';
import { Button, Field, SelectControl } from '../components/ui';
import { readiness } from '../lib/dataset.mjs';
import { TRAINING_MODELS, trainingModel, selectTrainingModel, TRAINING_TARGETS, trainingTarget, selectTrainingTarget } from '../lib/training.mjs';
import { exportDataset, download, safeName } from '../lib/export.mjs';
import { api } from '../lib/api.mjs';

export default function TrainingPage({ project, updateProject, notify, openShot }) {
  const progress = readiness(project);
  const profile = trainingModel(project.model);
  const [busyExport, setBusyExport] = useState(false);
  const [cliInfo, setCliInfo] = useState(null);
  const [job, setJob] = useState({ status: 'idle' });
  const [starting, setStarting] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [copied, setCopied] = useState(false);

  const terminalBodyRef = useRef(null);
  const pollTimerRef = useRef(null);

  const change = patch => updateProject({ training: { ...project.training, ...patch } });
  const t = project.training || {};
  const target = trainingTarget(t);

  const valid = t.steps >= 100 && t.steps <= 10000 && [4, 8].includes(Number(t.rank)) && Number(t.learningRate) > 0 && Number(t.learningRate) <= 0.01 && typeof t.checkpoint === 'string' && t.checkpoint.trim().length > 2;

  const checks = [
    { label: '모든 슬롯에 이미지 등록', detail: `${progress.filled} / ${progress.total}장`, done: progress.complete, to: '/dataset' },
    { label: '모든 캡션 내용 확인', detail: `${progress.reviewed} / ${progress.total}장`, done: progress.reviewed === progress.total, to: '/captions' },
    { label: '고유한 트리거 단어', detail: project.trigger, done: /^[a-zA-Z0-9_-]{2,64}$/.test(project.trigger), to: '/dataset' },
  ];

  // Modal CLI 정보 및 최근 작업 상태 확인
  async function refreshCliInfo() {
    try {
      const info = await api('/api/train/info');
      setCliInfo(info);
    } catch {
      setCliInfo({ available: false });
    }
  }

  async function checkJobStatus() {
    try {
      const data = await api('/api/train/status');
      setJob(data);
      return data;
    } catch {
      return { status: 'idle' };
    }
  }

  useEffect(() => {
    refreshCliInfo();
    checkJobStatus();
  }, []);

  // 작업이 running일 때 2.5초마다 폴링
  useEffect(() => {
    if (job.status === 'running' || job.status === 'cancelling') {
      pollTimerRef.current = setInterval(async () => {
        const next = await checkJobStatus();
        if (next.status !== 'running' && next.status !== 'cancelling') {
          clearInterval(pollTimerRef.current);
          if (next.status === 'completed') {
            notify('Modal 클라우드 학습이 완료되었어요! LoRA 파일을 다운로드할 수 있습니다.');
          } else if (next.status === 'failed') {
            notify('학습 실행 중 오류가 발생했습니다. 로그를 확인해 주세요.', true);
          }
        }
      }, 2500);
    } else {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    }
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [job.status]);

  // 터미널 내부 자동 스크롤 (전체 페이지 스크롤 간섭 방지)
  useEffect(() => {
    if (!terminalOpen || !terminalBodyRef.current) return;
    const el = terminalBodyRef.current;
    // 사용자가 스크롤을 위로 올려 과거 로그를 보는 중이 아니면(바닥 120px 이내) 하단으로 자동 스크롤
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (isNearBottom || !el.dataset.scrolled) {
      el.scrollTop = el.scrollHeight;
      el.dataset.scrolled = 'true';
    }
  }, [job.logs, terminalOpen]);

  // Modal 학습 시작
  async function handleStartTraining() {
    if (!progress.ready) {
      notify('모든 슬롯의 이미지 등록과 캡션 확인을 완료해야 학습을 시작할 수 있어요.', true);
      return;
    }
    if (!valid) {
      notify('학습 설정값을 올바르게 입력해 주세요.', true);
      return;
    }

    setStarting(true);
    try {
      const res = await api('/api/train/start', { project, slots: project.slots });
      notify('Modal 클라우드 A10G 인스턴스에 학습 작업을 요청했어요.');
      setJob(prev => ({ ...prev, status: 'running', logs: ['[시스템] 학습 작업을 시작합니다...'] }));
      checkJobStatus();
    } catch (err) {
      notify(err.message, true);
    } finally {
      setStarting(false);
    }
  }

  // Modal 학습 취소
  async function handleCancelTraining() {
    try {
      await api('/api/train/cancel', {});
      notify('학습 취소를 요청했습니다.');
      checkJobStatus();
    } catch (err) {
      notify(err.message, true);
    }
  }

  // 학습 데이터셋 ZIP 내보내기
  async function exportAll() {
    setBusyExport(true);
    try {
      download(await exportDataset(project), `${safeName(project.trigger)}-dataset.zip`);
      notify('이미지, 캡션과 train.yaml을 담은 데이터셋 ZIP을 내보냈어요');
    } catch (error) {
      notify(error.message, true);
    } finally {
      setBusyExport(false);
    }
  }

  // CLI 명령어 복사
  const cliCommand = `modal run scripts/modal_train.py --dataset-dir ./dataset_omz --trigger ${safeName(project.trigger)} --model ${project.model} --steps ${t.steps || 1000} --rank ${t.rank || 8}`;
  async function copyCliCommand() {
    try {
      await navigator.clipboard.writeText(cliCommand);
      setCopied(true);
      notify('Modal CLI 학습 명령어를 복사했어요.');
      setTimeout(() => setCopied(false), 3000);
    } catch {
      notify('명령어를 직접 선택하여 복사해 주세요.', true);
    }
  }

  const isRunning = job.status === 'running' || job.status === 'cancelling';
  const percent = t.steps && job.currentStep ? Math.min(100, Math.round((job.currentStep / t.steps) * 100)) : 0;

  return (
    <div className="standard-page">
      <div className="section-intro">
        <div className="intro-icon"><Sprout size={25}/></div>
        <div>
          <h2>이제, 캐릭터를 학습할 시간</h2>
          <p>Modal A10G 24GB 클라우드에서 나만의 LoRA를 원클릭으로 자동 학습하세요</p>
        </div>
        <span className={`state-badge ${progress.ready ? 'green' : ''}`}>
          {progress.ready ? '학습 준비 완료' : '데이터 준비 중'}
        </span>
      </div>

      <div className="training-grid">
        <div>
          {/* 체크리스트 */}
          <section className="surface">
            <h3>학습 전 체크리스트</h3>
            <div className="checklist">
              {checks.map(c => (
                <Link key={c.label} to={c.to}>
                  <span className={`check-circle ${c.done ? 'done' : ''}`}><Check size={14}/></span>
                  <strong>{c.label}</strong>
                  <span>{c.detail}</span>
                  <ArrowRight size={15}/>
                </Link>
              ))}
            </div>
            {!!progress.warnings.length && (
              <div className="callout warning">
                <TriangleAlert size={18}/>
                <span>
                  중복 또는 해상도 확인이 필요한 항목 {progress.warnings.length}건{' '}
                  <button className="text-link" onClick={() => openShot(progress.warnings[0].id)}>첫 이미지 확인</button>
                </span>
              </div>
            )}
            <p className="surface-note">캡션과 이미지의 일치 여부, 캐릭터의 일관성도 최종 확인해 주세요</p>
          </section>

          {/* 학습 설정 */}
          <section className="surface">
            <div className="panel-heading" style={{ marginBottom: 12 }}>
              <h3>학습 설정</h3>
              <span className="subtle-pill">{target.label}</span>
            </div>
            <div className="callout" style={{ marginTop: 0 }}>
              <Cpu size={18}/>
              <span>{target.note}</span>
            </div>

            <Field label="학습 베이스" hint="베이스를 바꾸면 해당 모델의 시작 설정을 적용해요">
              <SelectControl value={project.model} onChange={e => updateProject(selectTrainingModel(project, e.target.value))}>
                {TRAINING_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </SelectControl>
            </Field>

            <div className="callout">
              <span><strong>{profile.label}</strong><br/>{profile.note}</span>
            </div>

            <div className="form-grid">
              <Field label="학습 스텝" hint="100~10,000 범위 (기본 1,000)">
                <input
                  type="number"
                  min="100"
                  max="10000"
                  step="100"
                  value={t.steps}
                  onChange={e => change({ steps: Number(e.target.value) })}
                  disabled={isRunning}
                />
              </Field>
              <Field label="LoRA rank">
                <SelectControl value={t.rank} onChange={e => change({ rank: Number(e.target.value) })} disabled={isRunning}>
                  {[4, 8].map(n => <option key={n} value={n}>{n}{n === 8 ? ' · 권장 시작값' : ''}</option>)}
                </SelectControl>
              </Field>
              <Field label="학습률">
                <SelectControl value={t.learningRate} onChange={e => change({ learningRate: e.target.value })} disabled={isRunning}>
                  <option value="0.00005">0.00005 · 보수적</option>
                  <option value="0.0001">0.0001 · 기본 권장</option>
                  <option value="0.0002">0.0002 · 빠르게</option>
                </SelectControl>
              </Field>
              <Field label="학습 해상도">
                <input readOnly value="512px · AI Toolkit 표준"/>
              </Field>
            </div>

            <Field label="베이스 모델 경로 또는 Hugging Face ID" hint="선택한 아키텍처와 호환되는 모델 식별자예요">
              <input value={t.checkpoint} onChange={e => change({ checkpoint: e.target.value })} disabled={isRunning}/>
            </Field>
          </section>

          {/* Modal 자동 학습 제어판 */}
          <section className="surface modal-train-panel">
            <div className="panel-heading modal-train-header">
              <h3 className="modal-train-title">
                <Zap size={20} style={{ color: '#4c783c' }}/>
                Modal 클라우드 원클릭 자동 학습
              </h3>
              {cliInfo?.available && (
                <span className="subtle-pill" style={{ background: '#eaf4e6', color: '#39603f', fontWeight: 600 }}>
                  Modal 준비됨 ({cliInfo.profile || 'active'})
                </span>
              )}
            </div>

            <p style={{ marginTop: 6, marginBottom: 18 }}>
              현재 구성된 이미지와 캡션을 Modal 원격 컨테이너(NVIDIA A10G 24GB VRAM)로 전송하여 고속 학습을 자동 진행합니다.
            </p>

            {/* 학습 시작 / 진행 / 완료 컨트롤 영역 */}
            {!isRunning && job.status !== 'completed' && (
              <div className="modal-train-actions">
                <Button
                  variant="primary"
                  icon={Zap}
                  disabled={!progress.ready || !valid || starting}
                  busy={starting}
                  onClick={handleStartTraining}
                  style={{ minHeight: 44, fontSize: 13, padding: '0 22px', fontWeight: 650 }}
                >
                  Modal에서 자동 학습 시작
                </Button>
                {!progress.ready && (
                  <span style={{ fontSize: 11, color: '#768472' }}>
                    이미지 등록과 캡션 확인을 완료하면 시작할 수 있어요
                  </span>
                )}
              </div>
            )}

            {/* 진행 중 상태 */}
            {isRunning && (
              <div className="modal-train-status-box">
                <div className="modal-train-status-header">
                  <strong style={{ fontSize: 13, color: '#385834', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <RefreshCw size={16} className="spin"/>
                    {job.isExternal ? `외부 수동 실행 감지됨 (${job.id})` : 'Modal A10G 클라우드 학습 실행 중...'}
                  </strong>
                  <div className="modal-train-metrics">
                    {job.loss !== null && (
                      <span className="modal-train-metric-pill">
                        Loss: {job.loss}
                      </span>
                    )}
                    <span style={{ fontSize: 11, color: '#556950', fontWeight: 600 }}>
                      {job.currentStep || 0} / {job.steps || t.steps} 스텝 ({percent}%)
                    </span>
                    <Button variant="danger" icon={Square} onClick={handleCancelTraining} style={{ height: 32, fontSize: 11 }}>
                      학습 중단
                    </Button>
                  </div>
                </div>

                <div className="progress-track" style={{ height: 8, margin: '8px 0' }}>
                  <i style={{ width: `${percent}%`, background: '#4c783c' }}/>
                </div>
              </div>
            )}

            {/* 완료 상태 */}
            {job.status === 'completed' && (
              <div className="modal-train-completed-box">
                <div>
                  <strong style={{ fontSize: 14, color: '#2d5a32', display: 'flex', alignItems: 'center', gap: 7 }}>
                    <CheckCircle2 size={18} style={{ color: '#3e7e44' }}/>
                    학습 완료! LoRA 가중치가 준비되었습니다.
                  </strong>
                  <span style={{ fontSize: 11, color: '#50664e', display: 'block', marginTop: 4 }}>
                    결과 파일: {job.outputFile || `${project.trigger}_lora.safetensors`}{' '}
                    {job.outputSize ? `(${(job.outputSize / 1024 / 1024).toFixed(1)} MB)` : ''}
                  </span>
                </div>
                <div className="modal-train-completed-actions">
                  {job.outputFile && (
                    <a
                      href={`/api/train/output/${encodeURIComponent(job.outputFile)}`}
                      download={job.outputFile}
                      className="button primary"
                      style={{ minHeight: 40, fontSize: 12, fontWeight: 600 }}
                    >
                      <Download size={16}/> LoRA 다운로드 (.safetensors)
                    </a>
                  )}
                  <Button variant="secondary" onClick={() => setJob({ status: 'idle' })}>
                    새로 학습하기
                  </Button>
                </div>
              </div>
            )}

            {/* 터미널 로그 뷰어 */}
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
                <button
                  type="button"
                  onClick={() => setTerminalOpen(prev => !prev)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#4f6848', fontWeight: 600 }}
                >
                  <Terminal size={14}/>
                  {terminalOpen ? '실시간 로그 창 접기' : '실시간 로그 창 열기'}
                  {job.logs?.length ? ` (${job.logs.length}줄)` : ''}
                </button>
                {isRunning && (
                  <span style={{ fontSize: 10, color: '#58734e', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span className="tiny-dot"/> 실시간 스트리밍 중
                  </span>
                )}
              </div>

              {terminalOpen && (
                <div className="terminal-window" ref={terminalBodyRef}>
                  {(!job.logs || job.logs.length === 0) ? (
                    <span style={{ color: '#68826d' }}>대기 중입니다. 'Modal에서 자동 학습 시작'을 누르면 실시간 로그가 표시됩니다.</span>
                  ) : (
                    job.logs.map((line, idx) => (
                      <div key={idx} style={{ wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
                        {line}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* 터미널 직접 실행 가이드 */}
            <div style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid #e5ecd9' }}>
              <strong style={{ fontSize: 11, color: '#4d6945', display: 'block', marginBottom: 6 }}>
                터미널에서 직접 실행하려면:
              </strong>
              <div className="cli-command-box">
                <code style={{ fontSize: 10, color: '#334c2c', flex: 1, overflowX: 'auto', fontFamily: 'Consolas, monospace' }}>
                  {cliCommand}
                </code>
                <Button variant="ghost" icon={copied ? CheckCheck : Copy} onClick={copyCliCommand} style={{ height: 28, padding: '0 8px', fontSize: 10 }}>
                  {copied ? '복사됨' : '복사'}
                </Button>
              </div>
            </div>
          </section>
        </div>

        {/* 우측 사이드바: 패키지 내보내기 & Drive 연결 */}
        <aside>
          <section className="export-panel">
            <div className="export-icon"><FileArchive size={32}/></div>
            <h3>한 번에 준비되는<br/>나만의 학습 패키지</h3>
            <p>학습에 필요한 이미지와<br/>설정을 가지런하게 담아 드려요</p>
            <div className="package-tree">
              <span><Folder size={16}/>dataset/</span>
              <small>캐릭터 이미지 {progress.filled}장</small>
              <small>동일한 이름의 캡션 .txt</small>
              <span><FileCode2 size={16}/>train.yaml</span>
              <span><FileCode2 size={16}/>manifest.json</span>
              <span><FileCode2 size={16}/>README.txt</span>
            </div>
            <Button
              variant="primary"
              className="full-width"
              icon={Download}
              busy={busyExport}
              disabled={!progress.ready || !valid}
              onClick={exportAll}
            >
              학습 데이터셋 ZIP 다운로드
            </Button>
            {!progress.ready && <small>이미지 등록과 캡션 확인을 완료하면 활성화돼요</small>}

            <Link to="/cloud" className="button secondary full-width" style={{ marginTop: 12 }}>
              <HardDrive size={15}/> Drive에 프로젝트 보관<ArrowRight size={15}/>
            </Link>
          </section>

          <div className="privacy-note">
            <CheckCircle2 size={17}/>
            <p>
              Modal 클라우드 학습은 내 전용 A10G 인스턴스에서 안전하게 실행됩니다.<br/>
              완료된 LoRA 파일은 로컬 output 폴더에 자동 저장돼요.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
