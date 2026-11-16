import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Check, CheckCheck, CheckCircle2, Copy, LoaderCircle, RefreshCw, Square, Terminal, TriangleAlert, Zap } from 'lucide-react';
import { Button, Field, Modal, SelectControl } from '../components/ui';
import { readiness } from '../lib/dataset.mjs';
import { TRAINING_MODELS, trainingModel, selectTrainingModel, trainingValid } from '../lib/training.mjs';
import { copyText, safeName } from '../lib/export.mjs';
import { TRIGGER_PATTERN, trainingPercent } from '../lib/steps.mjs';

export default function TrainingPage({ project, updateProject, notify, job, cliInfo, trainingActions }) {
  const navigate = useNavigate();
  const progress = readiness(project);
  const profile = trainingModel(project.model);
  const t = project.training || {};
  const valid = trainingValid(project);
  const isRunning = job.status === 'running' || job.status === 'cancelling';
  const [starting, setStarting] = useState(false);
  const [retrain, setRetrain] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const terminal = useRef(null);
  const change = patch => updateProject({ training: { ...project.training, ...patch } });
  const percent = trainingPercent(project, job);
  const totalSteps = job.steps || t.steps;

  const checks = [
    { label: '이미지 등록', value: `${progress.filled} / ${progress.total}장`, done: progress.complete, to: '/dataset' },
    { label: '캡션 확인', value: `${progress.reviewed} / ${progress.total}장`, done: progress.reviewed === progress.total, to: '/captions' },
    { label: '트리거 단어', value: project.trigger || '미입력', done: TRIGGER_PATTERN.test(project.trigger), to: '/setup' },
  ];

  const finished = !retrain && !isRunning && (
    job.status === 'completed' && job.trigger === project.trigger
      ? { file: job.outputFile, size: job.outputSize }
      : project.lora?.file ? { file: project.lora.file, size: project.lora.size } : null
  );
  const failed = !isRunning && !finished && job.status === 'failed';
  const lastLog = job.logs?.length ? job.logs[job.logs.length - 1] : '';

  useEffect(() => { if (isRunning) setLogOpen(true); }, [isRunning]);

  // 터미널 내부 자동 스크롤. 사용자가 위로 올려 과거 로그를 보는 중이면 간섭하지 않는다
  useEffect(() => {
    const el = terminal.current;
    if (!logOpen || !el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom || !el.dataset.scrolled) {
      el.scrollTop = el.scrollHeight;
      el.dataset.scrolled = 'true';
    }
  }, [job.logs, logOpen]);

  async function handleStartTraining() {
    if (!progress.ready) return notify('모든 슬롯의 이미지 등록과 캡션 확인을 완료해야 학습을 시작할 수 있어요', true);
    if (!valid) return notify('학습 설정값을 올바르게 입력해 주세요', true);
    setStarting(true);
    const ok = await trainingActions.start(project);
    setStarting(false);
    if (ok) setRetrain(false);
  }

  const charaName = safeName(project.trigger || project.name || 'character');
  const isKrea2 = project.model === 'krea2';
  const scriptFile = isKrea2 ? 'scripts/modal_train_krea2.py' : 'scripts/modal_train.py';
  const epochs = Math.max(1, Math.round((t.steps || 2304) / (progress.filled || 36)));
  const cliCommand = isKrea2
    ? `modal run ${scriptFile} --name ${charaName} --dataset-dir ./dataset_${charaName} --trigger-word "${project.trigger}" --epochs ${epochs} --rank ${t.rank || 32}`
    : `modal run ${scriptFile} --dataset-dir ./dataset_${charaName} --trigger "${project.trigger}" --model ${project.model} --steps ${t.steps || 1000} --rank ${t.rank || 8}`;
  async function copyCliCommand() {
    if (await copyText(cliCommand)) {
      setCopied(true);
      notify('Modal CLI 학습 명령어를 복사했어요');
      setTimeout(() => setCopied(false), 3000);
    } else notify('명령어를 직접 선택해 복사해 주세요', true);
  }

  return <div className="page training-page">
    <div className="training-main">
      <section className="card run-card" aria-live="polite">
        <div className="section-row">
          <h2 className="card-title">학습 실행</h2>
          {cliInfo?.available && <span className="badge green">Modal 준비됨 ({cliInfo.profile || 'active'})</span>}
        </div>

        {isRunning && <div className="run-state">
          <p className="run-status"><LoaderCircle size={18} className="spin"/>{job.status === 'cancelling' ? '학습을 중단하고 있어요' : job.isExternal ? `외부 수동 실행 감지됨 (${job.id})` : 'Modal A10G 클라우드에서 학습 중이에요'}</p>
          <div className="progress-track large" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><i style={{ width: `${percent}%` }}/></div>
          <div className="run-metrics">
            <span>{job.currentStep || 0} / {totalSteps} 스텝 ({percent}%)</span>
            {job.loss !== null && job.loss !== undefined && <span className="badge">Loss {job.loss}</span>}
            <Button variant="danger" icon={Square} disabled={job.status === 'cancelling'} onClick={() => setConfirmStop(true)}>중단</Button>
          </div>
        </div>}

        {finished && <div className="run-state">
          <p className="run-status success"><CheckCircle2 size={18}/>학습을 마쳤어요</p>
          <p className="card-note">{finished.file || `${project.trigger}_lora.safetensors`}{finished.size ? ` · ${(finished.size / 1024 / 1024).toFixed(1)} MB` : ''}</p>
          <div className="inline-actions">
            <Button variant="primary" icon={ArrowRight} onClick={() => navigate('/deploy')}>배포로 이동</Button>
            <Button onClick={() => setRetrain(true)}>다시 학습</Button>
          </div>
        </div>}

        {failed && <div className="run-state">
          <p className="run-status danger"><TriangleAlert size={18}/>학습이 실패했어요</p>
          {lastLog && <p className="error-summary">{lastLog}</p>}
          <div className="inline-actions">
            <Button variant="primary" icon={RefreshCw} busy={starting} disabled={!progress.ready || !valid} onClick={handleStartTraining}>다시 시도</Button>
          </div>
        </div>}

        {!isRunning && !finished && !failed && (progress.ready ? <div className="run-state">
          <p className="card-note">Modal A10G 24GB에서 학습</p>
          <div className="inline-actions">
            <Button variant="primary" className="large" icon={Zap} busy={starting} disabled={!valid} onClick={handleStartTraining}>학습 시작</Button>
          </div>
          {!valid && <p className="field-error">학습 설정값을 확인해 주세요</p>}
        </div> : <div className="run-state">
          <ul className="checklist">
            {checks.map(c => <li key={c.label} className={c.done ? 'done' : ''}>
              <span className={`check-circle${c.done ? ' done' : ''}`}><Check size={14} strokeWidth={3}/></span>
              <strong>{c.label}</strong>
              <span className="check-value">{c.value}</span>
              {!c.done && <Link className="text-link" to={c.to}>이동<ArrowRight size={14}/></Link>}
            </li>)}
          </ul>
          <div className="inline-actions"><Button variant="primary" className="large" icon={Zap} disabled>학습 시작</Button></div>
        </div>)}
      </section>

      <section className="card log-card">
        <details open={logOpen} onToggle={e => setLogOpen(e.currentTarget.open)}>
          <summary><Terminal size={16}/>실시간 로그{job.logs?.length ? ` (${job.logs.length}줄)` : ''}</summary>
          <div className="terminal-window" ref={terminal} tabIndex={0} aria-label="학습 로그">
            {job.logs?.length
              ? job.logs.map((line, idx) => <div key={idx} className="log-line">{line}</div>)
              : <span className="log-empty">학습을 시작하면 로그가 여기에 표시돼요</span>}
          </div>
        </details>
      </section>
    </div>

    <section className="card settings-card">
      <h2 className="card-title">학습 설정</h2>
      <Field label="학습 베이스" hint={profile.note}>
        <SelectControl value={project.model} disabled={isRunning} onChange={e => updateProject(selectTrainingModel(project, e.target.value))}>
          {TRAINING_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </SelectControl>
      </Field>
      <Field label="학습 스텝" hint="100~10,000 범위 · 학습 해상도 512px">
        <input type="number" min="100" max="10000" step="100" value={t.steps} disabled={isRunning} onChange={e => change({ steps: Number(e.target.value) })}/>
      </Field>
      <Field label="LoRA rank">
        <SelectControl value={t.rank} disabled={isRunning} onChange={e => change({ rank: Number(e.target.value) })}>
          {[4, 8].map(n => <option key={n} value={n}>{n}{n === 8 ? ' · 권장 시작값' : ''}</option>)}
        </SelectControl>
      </Field>
      <Field label="학습률">
        <SelectControl value={t.learningRate} disabled={isRunning} onChange={e => change({ learningRate: e.target.value })}>
          <option value="0.00005">0.00005 · 보수적</option>
          <option value="0.0001">0.0001 · 기본 권장</option>
          <option value="0.0002">0.0002 · 빠르게</option>
        </SelectControl>
      </Field>
      <details className="advanced">
        <summary>고급</summary>
        <Field label="베이스 모델 경로 또는 Hugging Face ID" hint="선택한 아키텍처와 호환되는 모델 식별자">
          <input value={t.checkpoint} disabled={isRunning} onChange={e => change({ checkpoint: e.target.value })}/>
        </Field>
        <div className="field">
          <span className="field-label">터미널에서 직접 실행</span>
          <div className="cli-command">
            <code>{cliCommand}</code>
            <Button variant="ghost" icon={copied ? CheckCheck : Copy} onClick={copyCliCommand}>{copied ? '복사됨' : '복사'}</Button>
          </div>
        </div>
      </details>
    </section>

    <Modal isOpen={confirmStop} onClose={() => setConfirmStop(false)} title="학습 중단" size="sm" footer={<>
      <Button onClick={() => setConfirmStop(false)}>계속 학습</Button>
      <Button variant="danger" onClick={() => { setConfirmStop(false); trainingActions.cancel(); }}>학습 중단</Button>
    </>}>
      <p>진행 중인 학습을 중단할까요</p>
    </Modal>
  </div>;
}
