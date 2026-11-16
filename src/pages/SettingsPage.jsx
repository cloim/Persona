import React from 'react';
import GenerationSettings from '../components/GenerationSettings';
import CaptionSettings from '../components/CaptionSettings';
import GoogleConnection from '../components/GoogleConnection';

export default function SettingsPage({ settings, updateSettings, notify, google, refreshGoogle }) {
  return <div className="page settings-page">
    <section className="card">
      <h2 className="card-title">이미지 생성 연결</h2>
      <GenerationSettings settings={settings} updateSettings={updateSettings} notify={notify}/>
    </section>
    <section className="card">
      <h2 className="card-title">캡션 AI</h2>
      <CaptionSettings settings={settings} updateSettings={updateSettings}/>
    </section>
    <section className="card">
      <h2 className="card-title">Google 계정</h2>
      <GoogleConnection google={google} refreshGoogle={refreshGoogle} notify={notify}/>
    </section>
    <p className="privacy-note">연결 설정은 이 브라우저에 저장돼요 · API 키와 OAuth 토큰은 프로젝트 백업에 포함하지 않아요 · 외부 생성 연결을 실행하면 프롬프트와 선택한 참조 이미지가 해당 서비스로 전송돼요 · Google은 로그인한 계정 정보와 이 앱이 만든 Drive 파일만 사용하고 비공개로 저장해요</p>
  </div>;
}
