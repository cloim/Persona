import React, { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, CloudOff, Download, LoaderCircle, LogIn, LogOut, Menu, Settings2, TriangleAlert, UserRound } from 'lucide-react';
import { Button, Popover } from './ui';
import { STEPS } from '../lib/steps.mjs';
import { readiness } from '../lib/dataset.mjs';
import { logoutGoogle, startGoogleLogin } from './GoogleConnection';

const TITLES = { '/setup': '프로젝트 설정', '/dataset': '이미지셋', '/captions': '캡셔닝', '/training': '학습', '/deploy': '모델 배포', '/settings': '설정' };

function subtitleFor(path, project, status) {
  const ready = readiness(project);
  switch (path) {
    case '/setup': return status.setup.done ? `${project.name} · 트리거 ${project.trigger}` : '이름, 트리거, 참조 이미지나 고유 특징을 입력해 주세요';
    case '/dataset': return `${ready.filled} / ${ready.total}장 등록${ready.warnings.length ? ` · 확인 필요 ${ready.warnings.length}건` : ''}`;
    case '/captions': return `${ready.reviewed} / ${ready.total} 확인 · 첫 단어는 ${project.trigger}`;
    case '/training': return status.training.detail === '대기' ? (ready.ready ? '준비를 마쳤어요, 학습을 시작할 수 있어요' : '준비 점검이 필요해요') : status.training.detail;
    case '/deploy': return project.lora ? 'LoRA 파일을 내려받을 수 있어요' : '학습을 마치면 LoRA 파일이 준비돼요';
    case '/settings': return '이미지 생성 연결, 캡션 AI, Google 계정';
    default: return '';
  }
}

export default function Topbar({ project, status, saveState, online, google, refreshGoogle, notify, onMenu, installed, installEvent, installing, installApp }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const avatar = useRef(null);
  const [menu, setMenu] = useState(false);
  const stepIndex = STEPS.findIndex(step => step.path === pathname);
  const nextStep = stepIndex >= 0 && stepIndex < STEPS.length - 1 ? STEPS[stepIndex + 1] : null;
  const user = google?.user;
  const save = saveState === 'saving' ? { icon: <LoaderCircle size={14} className="spin"/>, text: '저장 중' }
    : saveState === 'error' ? { icon: <TriangleAlert size={14}/>, text: '저장 실패' }
    : !online ? { icon: <CloudOff size={14}/>, text: '오프라인 저장' }
    : { icon: <CheckCircle2 size={14}/>, text: '자동 저장됨' };
  const close = () => setMenu(false);
  return <header className="topbar">
    <button type="button" className="icon-button menu-button" aria-label="메뉴 열기" onClick={onMenu}><Menu size={20}/></button>
    <div className="page-heading">
      <h1>{TITLES[pathname] || '프로젝트 설정'}</h1>
      <span className="page-subtitle">{subtitleFor(pathname, project, status)}</span>
    </div>
    <div className="topbar-actions">
      <span className={`save-status${saveState === 'error' ? ' error' : ''}`} role="status">{save.icon}<span>{save.text}</span></span>
      {nextStep && <Button className="next-step" variant={status[STEPS[stepIndex].key].done ? 'primary' : 'secondary'} onClick={() => navigate(nextStep.path)}>다음: {nextStep.label}<ArrowRight size={16}/></Button>}
      <button ref={avatar} type="button" className="avatar" aria-label={user ? `Google 계정: ${user.email}` : '계정 메뉴'} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(open => !open)}>
        {user ? user.name.slice(0, 1) : <UserRound size={18}/>}
      </button>
      <Popover anchorRef={avatar} open={menu} onClose={close} label="계정 메뉴">
        {user ? <div className="menu-profile"><strong>{user.name}</strong><span>{user.email}</span></div> : null}
        {!user && <button type="button" role="menuitem" className="menu-item" disabled={google?.configured !== true} onClick={() => { close(); startGoogleLogin(notify); }}><LogIn size={16}/>Google 로그인</button>}
        <button type="button" role="menuitem" className="menu-item" onClick={() => { close(); navigate('/settings'); }}><Settings2 size={16}/>연결 설정</button>
        {!installed && <button type="button" role="menuitem" className="menu-item" disabled={installing} onClick={() => { close(); installApp(); }}><Download size={16}/>{installEvent ? '앱으로 설치' : '홈 화면 추가 안내'}</button>}
        {user && <button type="button" role="menuitem" className="menu-item" onClick={() => { close(); logoutGoogle(refreshGoogle, notify); }}><LogOut size={16}/>로그아웃</button>}
      </Popover>
    </div>
  </header>;
}
