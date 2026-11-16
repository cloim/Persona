import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronLeft, ChevronRight, Copy, Crop, Download, ImagePlus, RefreshCw, Sparkles, Trash2, Upload, WandSparkles } from 'lucide-react';
import { Button, Field, Modal, SelectControl } from './ui';
import Pose from './Pose';
import { captionFor, promptFor } from '../lib/dataset.mjs';
import { imageFromData } from '../lib/storage.mjs';
import { download, copyText } from '../lib/export.mjs';
import { api } from '../lib/api.mjs';

const PROVIDER_NAMES = { comfy: 'ComfyUI', codex: 'Codex OAuth', api: 'OpenAI Compatible' };

export default function ShotEditor({ id, tab: requestedTab, openShot, project, updateSlot, registerImage, settings, notify, onClose, generation, setGeneration, projectRef, captionTask, runCaptions }) {
  const slot = project.slots.find(s => s.id === id);
  const input = useRef();
  const [uploading, setUploading] = useState(false);
  const [remove, setRemove] = useState(false);
  const [cropRatio, setCropRatio] = useState('1');
  const currentProjectId = project.id;
  const index = project.slots.findIndex(s => s.id === id);
  const generating = generation?.slotId === id;
  const tab = requestedTab === 'caption' && !slot?.image ? 'image' : requestedTab;
  const prompt = slot ? (slot.prompt || promptFor(project, slot)) : '';
  const navLocked = !!generation || remove;

  function move(step) {
    if (navLocked) return;
    const target = project.slots[index + step];
    if (!target) return;
    openShot(target.id, tab === 'caption' && !target.image ? 'image' : tab);
  }

  const moveRef = useRef(move);
  moveRef.current = move;
  useEffect(() => {
    const key = event => {
      if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
      event.preventDefault();
      moveRef.current(event.key === 'ArrowLeft' ? -1 : 1);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  async function upload(file) {
    if (!file) return;
    setUploading(true);
    try {
      await registerImage(id, file);
      notify('이미지와 캡션 초안을 등록했어요');
      openShot(id, 'caption');
    } catch (error) {
      notify(error.message, true);
    } finally {
      setUploading(false);
      if (input.current) input.current.value = '';
    }
  }

  async function generate() {
    if (generation) return;
    if (!project.reference && !project.identity.trim()) return notify('프로젝트 설정에서 참조 이미지나 고유한 특징을 먼저 입력해 주세요', true);
    setGeneration({ slotId: id, message: '생성을 시작하고 있어요', jobId: null });
    let jobId;
    try {
      const job = await api('/api/generate', { settings, prompt, reference: project.reference?.data });
      jobId = job.id;
      setGeneration({ slotId: id, message: '이미지 생성 중', jobId });
      while (true) {
        await new Promise(resolve => setTimeout(resolve, 1400));
        const result = await api(`/api/jobs/${jobId}`);
        if (result.status === 'complete') {
          const image = await imageFromData(result.image);
          if (projectRef.current.id !== currentProjectId) throw new Error('프로젝트가 변경됐어요. 원래 프로젝트에서 생성 결과를 확인해 주세요');
          await registerImage(id, image, settings.provider);
          notify('이미지를 생성했어요. 캐릭터 일관성과 캡션을 확인해 주세요');
          openShot(id, 'caption');
          break;
        }
        if (result.status !== 'running') throw new Error(result.message);
        setGeneration({ slotId: id, message: result.message, jobId });
      }
    } catch (error) {
      if (jobId) await api(`/api/jobs/${jobId}/cancel`, {}).catch(() => {});
      notify(error.message, true);
    } finally {
      setGeneration(null);
    }
  }

  async function crop() {
    setUploading(true);
    try {
      const img = new Image();
      img.src = slot.image.data;
      await img.decode();
      const ratio = Number(cropRatio);
      let w = img.width, h = img.height;
      if (w / h > ratio) w = h * ratio; else h = w / ratio;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w);
      canvas.height = Math.round(h);
      canvas.getContext('2d').drawImage(img, (img.width - w) / 2, (img.height - h) / 2, w, h, 0, 0, canvas.width, canvas.height);
      const image = await imageFromData(canvas.toDataURL('image/png'));
      await registerImage(id, image, 'crop');
      notify('중앙 기준으로 잘랐어요. 원본은 교체 전에 내려받아 보관할 수 있어요');
    } catch {
      notify('이미지를 자르지 못했어요', true);
    } finally {
      setUploading(false);
    }
  }

  async function copyPrompt() {
    notify(await copyText(prompt) ? '프롬프트를 복사했어요' : '프롬프트를 직접 선택해 복사해 주세요', false);
  }

  if (!slot) return null;
  const tabs = [
    { key: 'image', label: '이미지' },
    { key: 'generate', label: 'AI 생성' },
    { key: 'caption', label: '캡션', disabled: !slot.image },
  ];
  return <>
    <Modal isOpen onClose={onClose} title={`${String(index + 1).padStart(2, '0')} · ${slot.title}`} size="xl" closeOnOverlayClick={!generating} footer={<>
      <span className="editor-footer-hint">{slot.image ? `${slot.image.width} × ${slot.image.height} · ${slot.image.source === 'upload' ? '업로드 이미지' : '생성 또는 편집 이미지'}` : '이미지를 등록하면 캡션 초안이 자동으로 만들어져요'}</span>
      <Button variant="primary" icon={Check} onClick={onClose}>완료</Button>
    </>}>
      <div className="shot-editor">
        <div className={`editor-preview${slot.image ? '' : ' no-image'}`} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); upload(e.dataTransfer.files[0]); }}>
          {slot.image ? <img src={slot.image.data} alt={slot.title}/> : <>
            <Pose group={slot.group} index={Number(id.split('-')[1])}/>
            <div className="editor-empty"><ImagePlus size={24}/><strong>이 모습을 담아 주세요</strong><span>{slot.tip}</span></div>
          </>}
        </div>
        <div className="editor-controls">
          <div className="editor-nav">
            <button type="button" className="icon-button" aria-label="이전 이미지" data-tooltip="이전 (Alt+←)" disabled={navLocked || index <= 0} onClick={() => move(-1)}><ChevronLeft size={18}/></button>
            <span className="editor-count" aria-live="polite">{index + 1} / {project.slots.length}</span>
            <button type="button" className="icon-button" aria-label="다음 이미지" data-tooltip="다음 (Alt+→)" disabled={navLocked || index >= project.slots.length - 1} onClick={() => move(1)}><ChevronRight size={18}/></button>
            <div className="segmented editor-tabs" role="tablist" aria-label="편집 도구">
              {tabs.map(t => <button type="button" key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'active' : ''} disabled={t.disabled} onClick={() => openShot(id, t.key)}>{t.label}</button>)}
            </div>
          </div>

          {tab === 'image' && <div className="editor-section" role="tabpanel">
            <div className="inline-actions">
              <Button busy={uploading} disabled={generating} icon={Upload} onClick={() => input.current.click()}>{slot.image ? '이미지 교체' : '이미지 업로드'}</Button>
              {slot.image && <Button variant="ghost" icon={Download} onClick={async () => download(await (await fetch(slot.image.data)).blob(), slot.image.name)}>원본 저장</Button>}
              {slot.image && <button type="button" className="icon-button danger" aria-label="등록 이미지 삭제" data-tooltip="이미지 삭제" onClick={() => setRemove(true)}><Trash2 size={18}/></button>}
            </div>
            <input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={e => upload(e.target.files[0])}/>
            {slot.image && <div className="crop-row">
              <Field label="자르기 비율">
                <SelectControl value={cropRatio} onChange={e => setCropRatio(e.target.value)}>
                  <option value="1">1:1 정사각형</option>
                  <option value="0.75">3:4 세로</option>
                  <option value="1.333333333">4:3 가로</option>
                </SelectControl>
              </Field>
              <Button icon={Crop} busy={uploading} onClick={crop}>적용</Button>
            </div>}
            {slot.image && <small className="field-hint">중앙 기준으로 잘라 현재 이미지를 교체해요</small>}
            <p className="card-note"><strong>구도 체크 포인트</strong> · {slot.tip}</p>
          </div>}

          {tab === 'generate' && <div className="editor-section" role="tabpanel">
            <p className="provider-line"><Sparkles size={15}/><strong>{PROVIDER_NAMES[settings.provider]}</strong><span>{project.reference ? '참조 이미지와 함께 생성' : '캐릭터 설명을 기준으로 생성'}</span><Link to="/settings" onClick={onClose}>설정</Link></p>
            <div className="form-grid two">
              <Field label="시점과 포즈"><input value={slot.view} onChange={e => updateSlot(id, { view: e.target.value, reviewed: false })}/></Field>
              <Field label="표정"><input value={slot.expression} onChange={e => updateSlot(id, { expression: e.target.value, reviewed: false })}/></Field>
            </div>
            <Field label="조명과 배경"><input value={slot.light} onChange={e => updateSlot(id, { light: e.target.value, reviewed: false })}/></Field>
            <Field label="생성 프롬프트" hint="구도에 맞춰 준비한 프롬프트를 자유롭게 수정해요">
              <textarea className="prompt-textarea" rows={8} maxLength={16000} value={prompt} onChange={e => updateSlot(id, { prompt: e.target.value })}/>
            </Field>
            <div className="inline-actions">
              <Button variant="ghost" icon={RefreshCw} onClick={() => updateSlot(id, { prompt: '' })}>기본 프롬프트</Button>
              <Button variant="ghost" icon={Copy} onClick={copyPrompt}>복사</Button>
            </div>
            {generating && <div className="inline-status" role="status"><Sparkles size={15}/>{generation.message}</div>}
            <div className="inline-actions">
              <Button variant="primary" icon={WandSparkles} busy={generating} disabled={!!generation || uploading} onClick={generate}>{slot.image ? '새 이미지 생성' : '이 프롬프트로 생성'}</Button>
              {generating && <Button onClick={async () => { try { if (generation.jobId) await api(`/api/jobs/${generation.jobId}/cancel`, {}); } catch (error) { notify(error.message, true); } }}>생성 취소</Button>}
            </div>
            <p className="card-note">생성 서비스의 이용량과 요금이 적용될 수 있어요</p>
          </div>}

          {tab === 'caption' && slot.image && <div className="editor-section" role="tabpanel">
            <Field label="학습 캡션 (.txt)" hint="실제 이미지 내용과 일치하는지 확인해 주세요">
              <textarea rows={7} value={slot.caption} onChange={e => updateSlot(id, { caption: e.target.value, reviewed: false })} placeholder="이미지를 등록하면 초안을 자동으로 준비해요"/>
            </Field>
            <div className="inline-actions">
              <Button variant="primary" icon={Sparkles} busy={captionTask?.slotId === id} disabled={!!captionTask} onClick={() => runCaptions([id], { includeReviewed: true })}>AI로 다시 작성</Button>
              <Button variant="ghost" icon={RefreshCw} onClick={() => updateSlot(id, { caption: captionFor(project, slot), captionSource: 'guide', reviewed: false })}>구도로 초안 만들기</Button>
            </div>
            <label className="check-row">
              <input type="checkbox" disabled={!slot.caption.trim()} checked={slot.reviewed} onChange={e => updateSlot(id, { reviewed: e.target.checked })}/>
              <span><strong>이미지와 캡션이 일치해요</strong></span>
            </label>
          </div>}
        </div>
      </div>
    </Modal>
    <Modal isOpen={remove} onClose={() => setRemove(false)} title="등록 이미지 삭제" size="sm" footer={<>
      <Button onClick={() => setRemove(false)}>유지하기</Button>
      <Button variant="danger" onClick={() => { updateSlot(id, { image: null, caption: '', reviewed: false }); setRemove(false); notify('슬롯을 비웠어요. 새 이미지를 등록할 수 있어요'); }}>이미지 삭제</Button>
    </>}>
      <p>이 슬롯의 이미지와 캡션을 비우고 촬영 가이드는 유지해요 · 필요한 이미지는 원본 저장으로 보관해 주세요</p>
    </Modal>
  </>;
}
