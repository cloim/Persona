import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ImagePlus, RefreshCw, Trash2 } from 'lucide-react';
import { Button, Field, SelectControl } from '../components/ui';
import Pose from '../components/Pose';
import { imageFromFile } from '../lib/storage.mjs';
import { TRIGGER_PATTERN } from '../lib/steps.mjs';

export default function SetupPage({ project, updateProject, notify }) {
  const location = useLocation();
  const file = useRef();
  const nameInput = useRef();
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const triggerInvalid = !TRIGGER_PATTERN.test(project.trigger);

  useEffect(() => {
    if (location.state?.focusName) { nameInput.current?.focus(); nameInput.current?.select(); }
  }, [location.state, project.id]);

  async function register(selected) {
    if (!selected) return;
    setBusy(true);
    try {
      updateProject({ reference: await imageFromFile(selected) });
    } catch (error) {
      notify(error.message, true);
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  }

  return <div className="page setup-page">
    <section className="card reference-card">
      <h2 className="card-title">참조 이미지</h2>
      <div
        className={`dropzone${drag ? ' drag-active' : ''}${project.reference ? ' has-image' : ''}`}
        role="button"
        tabIndex={0}
        aria-label={project.reference ? '참조 이미지 교체' : '참조 이미지 등록'}
        onClick={() => file.current.click()}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.current.click(); } }}
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); register(e.dataTransfer.files[0]); }}
      >
        {project.reference ? <img src={project.reference.data} alt="캐릭터 참조"/> : <>
          <Pose/>
          <span className="dropzone-label"><ImagePlus size={20}/>이미지를 끌어 놓거나 클릭해요</span>
        </>}
      </div>
      <input ref={file} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={e => register(e.target.files[0])}/>
      {project.reference && <div className="inline-actions">
        <Button icon={RefreshCw} busy={busy} onClick={() => file.current.click()}>교체</Button>
        <Button variant="ghost" icon={Trash2} onClick={() => updateProject({ reference: null })}>해제</Button>
      </div>}
      <p className="card-note">얼굴과 고유한 특징이 잘 보이는 한 장 · AI 생성 시 캐릭터 기준으로 사용</p>
    </section>
    <section className="card">
      <h2 className="card-title">기본 정보</h2>
      <div className="form-grid three">
        <Field label="프로젝트 이름">
          <input ref={nameInput} maxLength={60} value={project.name} onChange={e => updateProject({ name: e.target.value })}/>
        </Field>
        <Field label="트리거 단어" hint={triggerInvalid ? <span className="field-error" role="alert">영문, 숫자, _, -로 2~64자</span> : '영문, 숫자, _, -를 조합한 고유한 단어'}>
          <input maxLength={64} aria-invalid={triggerInvalid || undefined} value={project.trigger} onChange={e => updateProject({ trigger: e.target.value.replace(/[^a-zA-Z0-9_-]/g, '') })}/>
        </Field>
        <Field label="이미지 스타일">
          <SelectControl value={project.style} onChange={e => updateProject({ style: e.target.value })}>
            <option value="illustration">캐릭터 일러스트</option>
            <option value="anime">애니메이션</option>
            <option value="photo">실사</option>
          </SelectControl>
        </Field>
      </div>
      <Field label="캐릭터 고유 특징" hint="생성 프롬프트에 공통으로 반영">
        <textarea rows={4} maxLength={2000} placeholder="예: short silver hair, amber eyes, small freckles, round glasses" value={project.identity} onChange={e => updateProject({ identity: e.target.value })}/>
      </Field>
    </section>
  </div>;
}
