import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy, Crop, Download, ImagePlus, RefreshCw, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { Button, Field, Modal, SelectControl } from './ui';
import Pose from './Pose';
import { captionFor, promptFor } from '../lib/dataset.mjs';
import { imageFromData } from '../lib/storage.mjs';
import { download } from '../lib/export.mjs';
import { api } from '../lib/api.mjs';

export default function ShotEditor({ id, project, updateSlot, registerImage, settings, notify, onClose, generation, setGeneration, projectRef, captionTask, runCaptions }) {
  const slot = project.slots.find(s => s.id === id);
  const input = useRef(); const [uploading, setUploading] = useState(false); const [tab, setTab] = useState('generate'); const [remove, setRemove] = useState(false); const [cropRatio, setCropRatio] = useState('1');
  const currentProjectId = project.id;
  const generating = generation?.slotId === id; const prompt = slot.prompt || promptFor(project, slot);
  async function upload(file) { if (!file) return; setUploading(true); try { await registerImage(id, file); notify('이미지와 캡션 초안을 등록했어요'); setTab('caption'); } catch (error) { notify(error.message, true); } finally { setUploading(false); if (input.current) input.current.value = ''; } }
  async function generate() {
    if (generation) return;
    if (!project.reference && !project.identity.trim()) return notify('캐릭터 설정에서 참조 이미지나 고유한 특징을 먼저 입력해 주세요', true);
    setGeneration({ slotId: id, message: '생성을 시작하고 있어요', jobId: null });
    let jobId;
    try {
      const job = await api('/api/generate', { settings, prompt, reference: project.reference?.data }); jobId = job.id;
      setGeneration({ slotId: id, message: '이미지 생성 중', jobId });
      while (true) {
        await new Promise(resolve => setTimeout(resolve, 1400));
        const result = await api(`/api/jobs/${jobId}`);
        if (result.status === 'complete') {
          const image = await imageFromData(result.image);
          if (projectRef.current.id !== currentProjectId) throw new Error('프로젝트가 변경됐어요. 원래 프로젝트에서 생성 결과를 확인해 주세요');
          await registerImage(id, image, settings.provider); notify('이미지를 생성했어요. 캐릭터 일관성과 캡션을 확인해 주세요'); setTab('caption'); break;
        }
        if (result.status !== 'running') throw new Error(result.message);
        setGeneration({ slotId: id, message: result.message, jobId });
      }
    } catch (error) { if (jobId) await api(`/api/jobs/${jobId}/cancel`, {}).catch(() => {}); notify(error.message, true); }
    finally { setGeneration(null); }
  }
  async function crop() {
    setUploading(true);
    try {
      const img = new Image(); img.src = slot.image.data; await img.decode();
      const ratio = Number(cropRatio); let w = img.width, h = img.height;
      if (w / h > ratio) w = h * ratio; else h = w / ratio;
      const canvas = document.createElement('canvas'); canvas.width = Math.round(w); canvas.height = Math.round(h);
      canvas.getContext('2d').drawImage(img, (img.width-w)/2, (img.height-h)/2, w, h, 0,0,canvas.width,canvas.height);
      const image = await imageFromData(canvas.toDataURL('image/png')); await registerImage(id, image, 'crop'); notify('중앙 기준으로 잘랐어요. 원본은 교체 전 내려받아 보관할 수 있어요');
    } catch { notify('이미지를 자르지 못했어요', true); } finally { setUploading(false); }
  }
  if (!slot) return null;
  return <><Modal isOpen onClose={onClose} title={`${String(project.slots.indexOf(slot)+1).padStart(2,'0')} · ${slot.title}`} size="xl" closeOnOverlayClick={!generating} footer={<><span className="editor-footer-hint">{slot.image ? `${slot.image.width} × ${slot.image.height} · ${slot.image.source === 'upload' ? '업로드 이미지' : '생성 또는 편집 이미지'}` : '이미지 등록 후 캡션 초안이 자동으로 만들어져요'}</span><Button variant="primary" icon={Check} onClick={onClose}>완료</Button></>}>
    <div className="shot-editor"><div className="editor-preview-column"><div className={`editor-preview ${slot.image ? '' : 'no-image'}`} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); upload(e.dataTransfer.files[0]); }}>{slot.image ? <img src={slot.image.data} alt={slot.title}/> : <><Pose group={slot.group} index={Number(id.split('-')[1])}/><div><ImagePlus size={25}/><strong>이 모습을 담아 주세요</strong><p>{slot.tip}</p></div></>}</div><Button busy={uploading} disabled={generating} icon={Upload} onClick={() => input.current.click()}>{slot.image ? '이미지 교체' : '이미지 업로드'}</Button><input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={e => upload(e.target.files[0])}/>{slot.image && <div className="image-tools"><Button icon={Download} variant="ghost" onClick={async () => download(await (await fetch(slot.image.data)).blob(), slot.image.name)}>원본 저장</Button><button className="delete-button" aria-label="등록 이미지 삭제" onClick={() => setRemove(true)}><Trash2 size={16}/></button></div>}<div className="editor-guidance"><strong>이 구도의 체크 포인트</strong><p>{slot.tip}</p><small>캐릭터의 얼굴, 헤어스타일, 신체 비율이 참조와 일치하는지 확인해 주세요</small></div></div>
    <div className="editor-controls"><div className="segmented"><button className={tab === 'generate' ? 'active' : ''} onClick={() => setTab('generate')}><Sparkles size={15}/>AI 생성</button><button className={tab === 'caption' ? 'active' : ''} onClick={() => setTab('caption')}>캡션과 구도</button>{slot.image && <button className={tab === 'crop' ? 'active' : ''} onClick={() => setTab('crop')}>자르기</button>}</div>
      {tab === 'generate' && <div className="editor-section"><div className="provider-summary"><span className="provider-glyph"><Sparkles size={17}/></span><div><strong>{settings.provider === 'comfy' ? 'ComfyUI' : settings.provider === 'codex' ? 'Codex OAuth' : 'OpenAI Compatible'}</strong><small>{project.reference ? '참조 이미지와 함께 생성' : '캐릭터 설명을 기준으로 생성'}</small></div><Link to="/connections" onClick={onClose}>연결 설정</Link></div><Field label="이 이미지의 생성 프롬프트" hint="구도에 맞춰 준비한 프롬프트를 자유롭게 수정해요"><textarea className="prompt-textarea" rows={10} maxLength={16000} value={prompt} onChange={e => updateSlot(id, { prompt: e.target.value })}/></Field><div className="prompt-actions"><Button variant="ghost" icon={RefreshCw} onClick={() => updateSlot(id, { prompt: '' })}>기본 프롬프트</Button><Button variant="ghost" icon={Copy} onClick={async () => { try { await navigator.clipboard.writeText(prompt); notify('프롬프트를 복사했어요'); } catch { notify('프롬프트를 직접 선택해 복사해 주세요', true); } }}>복사</Button></div>{generating && <div className="inline-status" role="status"><Sparkles size={15}/>{generation.message}</div>}<Button className="full-width" variant="primary" icon={Sparkles} busy={generating} disabled={!!generation || uploading} onClick={generate}>{slot.image ? '새 이미지 생성' : '이 프롬프트로 생성'}</Button>{generating && <Button variant="ghost" className="full-width" onClick={async () => { try { if (generation.jobId) await api(`/api/jobs/${generation.jobId}/cancel`, {}); } catch (err) { notify(err.message, true); } }}>생성 취소</Button>}<small className="muted-note">생성 서비스의 이용량과 요금이 적용될 수 있어요. 결과는 검토 후 학습에 사용해 주세요</small></div>}
      {tab === 'caption' && <div className="editor-section"><div className="form-grid"><Field label="시점과 포즈"><input value={slot.view} onChange={e => updateSlot(id, { view: e.target.value, reviewed: false })}/></Field><Field label="표정"><input value={slot.expression} onChange={e => updateSlot(id, { expression: e.target.value, reviewed: false })}/></Field></div><Field label="조명과 배경"><input value={slot.light} onChange={e => updateSlot(id, { light: e.target.value, reviewed: false })}/></Field><Button variant="primary" icon={Sparkles} busy={captionTask?.slotId===id} disabled={!slot.image||!!captionTask} onClick={()=>runCaptions([id],{includeReviewed:true})}>이미지로 AI 캡션 작성</Button><Field label="학습 캡션 (.txt)" hint="AI 작성과 촬영 가이드 초안을 지원해요. 실제 이미지 내용과 일치하는지 확인해 주세요"><textarea rows={7} value={slot.caption} onChange={e => updateSlot(id, { caption: e.target.value, reviewed: false })} placeholder="이미지를 등록하면 초안을 자동으로 준비해요"/></Field><Button variant="ghost" icon={RefreshCw} onClick={() => updateSlot(id, { caption: captionFor(project, slot), captionSource:'guide', reviewed: false })}>현재 구도로 초안 다시 만들기</Button><label className="review-checkbox"><input type="checkbox" disabled={!slot.image || !slot.caption.trim()} checked={slot.reviewed} onChange={e => updateSlot(id, { reviewed: e.target.checked })}/><span><strong>이미지와 캡션을 확인했어요</strong><small>고유 특징, 구도, 표정이 실제 이미지와 일치해요</small></span></label></div>}
      {tab === 'crop' && slot.image && <div className="editor-section"><h3>학습에 알맞게 다듬기</h3><p>이미지 중앙을 기준으로 선택한 비율로 잘라요. 캐릭터의 머리와 손발이 잘리지 않는지 확인해 주세요.</p><Field label="자르기 비율"><SelectControl value={cropRatio} onChange={e => setCropRatio(e.target.value)}><option value="1">1:1 정사각형</option><option value="0.75">3:4 세로</option><option value="1.333333333">4:3 가로</option></SelectControl></Field><div className="callout">적용하면 현재 이미지를 교체해요. 필요한 원본은 왼쪽의 원본 저장으로 보관해 주세요</div><Button variant="primary" icon={Crop} busy={uploading} onClick={crop}>중앙 기준 자르기 적용</Button></div>}
    </div></div>
  </Modal><Modal isOpen={remove} onClose={() => setRemove(false)} title="등록 이미지 삭제" footer={<><Button onClick={() => setRemove(false)}>유지하기</Button><Button variant="danger" onClick={() => { updateSlot(id, { image: null, caption: '', reviewed: false }); setRemove(false); notify('슬롯을 비웠어요. 새 이미지를 등록할 수 있어요'); }}>이미지 삭제</Button></>}><p>이 슬롯의 이미지와 캡션을 비우고 촬영 가이드는 유지합니다. 필요한 이미지는 원본 저장으로 보관해 주세요.</p></Modal></>;
}
