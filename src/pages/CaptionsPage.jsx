import React, { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCheck, FileText, MoreHorizontal, RefreshCw, Settings2, Sparkles } from 'lucide-react';
import { captionFor } from '../lib/dataset.mjs';
import { Button, Empty, Modal, Popover } from '../components/ui';
import CaptionSettings from '../components/CaptionSettings';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');

function sourceLabel(slot) {
  if (slot.reviewed) return '확인 완료';
  if (slot.captionSource?.startsWith('ai:')) return 'AI 작성';
  if (slot.captionSource === 'manual') return '직접 작성';
  return '가이드 초안';
}

export default function CaptionsPage({ project, settings, updateSettings, updateProject, updateSlot, openShot, notify, captionTask, runCaptions, cancelCaptions }) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('review');
  const [confirm, setConfirm] = useState(false);
  const [menu, setMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const menuButton = useRef(null);
  const areas = useRef({});
  const images = project.slots.filter(s => s.image);
  const pending = images.filter(s => !s.reviewed);
  const filtered = images.filter(s => filter === 'all' || (filter === 'review' ? !s.reviewed : s.reviewed));
  const visiblePending = filtered.filter(s => !s.reviewed);
  const closeMenu = () => setMenu(false);
  const filters = [
    { key: 'review', label: '확인 필요', count: pending.length },
    { key: 'done', label: '확인 완료', count: images.length - pending.length },
    { key: 'all', label: '전체', count: images.length },
  ];

  function approveVisible() {
    const ids = new Set(filtered.filter(s => s.caption.trim() && !s.reviewed).map(s => s.id));
    if (!ids.size) return notify('확인 처리할 캡션이 없어요');
    updateProject(prev => ({ slots: prev.slots.map(s => ids.has(s.id) ? { ...s, reviewed: true } : s) }));
    notify(`${ids.size}장의 캡션을 확인 처리했어요`);
  }

  function approveAndNext(slot, event) {
    if (!(event.ctrlKey || event.metaKey) || event.key !== 'Enter') return;
    event.preventDefault();
    if (!slot.caption.trim()) return;
    updateSlot(slot.id, { reviewed: true });
    const at = filtered.findIndex(s => s.id === slot.id);
    const next = filtered.slice(at + 1).find(s => !s.reviewed);
    if (next) areas.current[next.id]?.focus();
  }

  return <div className="page captions-page">
    <div className="toolbar" role="toolbar" aria-label="캡션 도구">
      <div className="segmented" role="group" aria-label="캡션 상태">
        {filters.map(f => <button type="button" key={f.key} className={filter === f.key ? 'active' : ''} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>{f.label} {f.count}</button>)}
      </div>
      <div className="toolbar-end">
        {captionTask
          ? <div className="caption-job" role="status"><span>{captionTask.done}/{captionTask.total} 작성 중</span><Button onClick={cancelCaptions}>중단</Button></div>
          : <Button variant="primary" icon={Sparkles} disabled={!visiblePending.length} onClick={() => runCaptions(visiblePending.map(s => s.id))}>AI로 작성</Button>}
        <button ref={menuButton} type="button" className="icon-button bordered" aria-label="더보기" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(open => !open)}><MoreHorizontal size={18}/></button>
        <Popover anchorRef={menuButton} open={menu} onClose={closeMenu} label="캡션 더보기">
          <button type="button" role="menuitem" className="menu-item" disabled={!filtered.length} onClick={() => { closeMenu(); approveVisible(); }}><CheckCheck size={16}/>보이는 항목 모두 확인</button>
          <button type="button" role="menuitem" className="menu-item" disabled={!images.length} onClick={() => { closeMenu(); setConfirm(true); }}><RefreshCw size={16}/>초안 다시 만들기</button>
          <button type="button" role="menuitem" className="menu-item" onClick={() => { closeMenu(); setShowSettings(true); }}><Settings2 size={16}/>캡션 AI 설정</button>
        </Popover>
      </div>
    </div>
    <p className="key-hint">{isMac ? '⌘+Enter' : 'Ctrl+Enter'}로 확인하고 다음 캡션으로 이동</p>

    <div className="caption-list">
      {filtered.map(slot => <article className="caption-row" key={slot.id}>
        <button type="button" className="caption-thumb" onClick={() => openShot(slot.id, 'caption')} aria-label={`${slot.title} 이미지 상세`}>
          <img src={slot.image.data} alt="" loading="lazy"/>
        </button>
        <div className="caption-body">
          <div className="caption-head">
            <strong>{String(project.slots.indexOf(slot) + 1).padStart(2, '0')} · {slot.title}</strong>
            <span className={`badge${slot.reviewed ? ' green' : ''}`}>{sourceLabel(slot)}</span>
          </div>
          <textarea ref={el => { if (el) areas.current[slot.id] = el; else delete areas.current[slot.id]; }} aria-label={`${slot.title} 캡션`} rows={3} value={slot.caption} onChange={e => updateSlot(slot.id, { caption: e.target.value, reviewed: false })} onKeyDown={e => approveAndNext(slot, e)}/>
          <div className="caption-foot">
            <label className="check-row compact">
              <input type="checkbox" disabled={!slot.caption.trim()} checked={slot.reviewed} onChange={e => updateSlot(slot.id, { reviewed: e.target.checked })}/>
              <span>이미지와 일치</span>
            </label>
            <button type="button" className="icon-button" aria-label="AI로 다시 작성" data-tooltip="AI 재작성" disabled={!!captionTask} onClick={() => runCaptions([slot.id], { includeReviewed: true })}><Sparkles size={18}/></button>
          </div>
        </div>
      </article>)}
      {!filtered.length && (!images.length
        ? <Empty icon={FileText} title="이미지셋에서 이미지를 등록해 주세요"><Link className="button primary" to="/dataset">이미지셋으로<ArrowRight size={16}/></Link></Empty>
        : filter === 'review'
          ? <Empty icon={CheckCheck} title="확인할 캡션이 없어요"><Button variant="primary" onClick={() => navigate('/training')}>학습으로<ArrowRight size={16}/></Button></Empty>
          : <Empty icon={FileText} title="해당하는 캡션이 없어요"><Button onClick={() => setFilter('all')}>전체 보기</Button></Empty>)}
    </div>

    <Modal isOpen={confirm} onClose={() => setConfirm(false)} title="캡션 초안 다시 만들기" footer={<>
      <Button onClick={() => setConfirm(false)}>현재 캡션 유지</Button>
      <Button variant="primary" onClick={() => { updateProject({ slots: project.slots.map(s => s.image ? { ...s, caption: captionFor(project, s), captionSource: 'guide', reviewed: false } : s) }); setConfirm(false); notify('등록 이미지의 캡션 초안을 다시 만들었어요'); }}>초안 다시 만들기</Button>
    </>}>
      <p>등록된 이미지 {images.length}장의 캡션을 현재 촬영 구도와 트리거로 다시 만들어요 · 직접 수정한 캡션도 교체되며 확인 상태는 초안으로 바뀌어요</p>
    </Modal>
    <Modal isOpen={showSettings} onClose={() => setShowSettings(false)} title="캡션 AI 설정" size="lg" footer={<Button variant="primary" onClick={() => setShowSettings(false)}>완료</Button>}>
      <CaptionSettings settings={settings} updateSettings={updateSettings}/>
    </Modal>
  </div>;
}
