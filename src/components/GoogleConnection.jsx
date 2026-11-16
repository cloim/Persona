import React, { useState } from 'react';
import { LogIn, LogOut, RefreshCw } from 'lucide-react';
import { Button } from './ui';
import { api } from '../lib/api.mjs';

export const GOOGLE_RETURN_KEY = 'persona-google-return';

export async function startGoogleLogin(notify) {
  try {
    sessionStorage.setItem(GOOGLE_RETURN_KEY, location.pathname);
    const { url } = await api('/api/google/login', {});
    window.location.assign(url);
    return true;
  } catch (error) {
    notify(error.message, true);
    return false;
  }
}

export async function logoutGoogle(refreshGoogle, notify) {
  try {
    await api('/api/google/logout', {});
    await refreshGoogle();
    notify('이 기기의 Google 로그인을 해제했어요');
  } catch (error) {
    notify(error.message, true);
  }
}

export default function GoogleConnection({ google, refreshGoogle, notify }) {
  const [busy, setBusy] = useState(false);
  const checking = !google || google.checking;
  async function login() {
    setBusy(true);
    if (!await startGoogleLogin(notify)) setBusy(false);
  }
  async function logout() {
    setBusy(true);
    await logoutGoogle(refreshGoogle, notify);
    setBusy(false);
  }
  return (
    <div className="google-connection">
      {google?.user ? (
        <div className="google-profile">
          <div className="avatar">{google.user.name.slice(0, 1)}</div>
          <div>
            <strong>{google.user.name}</strong>
            <span>{google.user.email}</span>
          </div>
          <Button busy={busy || checking} variant="ghost" icon={LogOut} onClick={logout}>로그아웃</Button>
        </div>
      ) : (
        <>
          <p className="card-note">Google로 로그인하고 프로젝트와 데이터셋을 내 Drive에 보관해요</p>
          <Button variant="primary" icon={LogIn} busy={busy || checking} disabled={google?.configured !== true} onClick={login}>Google로 로그인</Button>
        </>
      )}
      {checking ? (
        <p className="card-note" role="status">Google 연결 상태를 확인하고 있어요</p>
      ) : google?.error ? (
        <div className="notice">
          <span>{google.error}</span>
          <Button icon={RefreshCw} onClick={refreshGoogle}>다시 확인</Button>
        </div>
      ) : google?.configured === false ? (
        <div className="notice">
          <span>이 작업실의 Google 로그인 설정을 확인해 주세요</span>
          <Button icon={RefreshCw} onClick={refreshGoogle}>다시 확인</Button>
        </div>
      ) : null}
    </div>
  );
}
