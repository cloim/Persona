import React from 'react';
import { Field, SelectControl } from './ui';

export default function CaptionSettings({ settings, updateSettings }) {
  const change = patch => updateSettings({ ...settings, ...patch });
  return (
    <div className="caption-settings">
      <p className="card-note">촬영 가이드 대신 실제 이미지의 구도, 표정, 의상과 배경을 설명해요</p>
      <div className="form-grid two">
        <Field label="캡션 AI">
          <SelectControl value={settings.captionProvider} onChange={e => change({ captionProvider: e.target.value })}>
            <option value="codex">Codex OAuth · 기존 로그인 사용</option>
            <option value="api">OpenAI Compatible 비전 API</option>
          </SelectControl>
        </Field>
        <Field label="캡션 형식">
          <SelectControl value={settings.captionFormat} onChange={e => change({ captionFormat: e.target.value })}>
            <option value="natural">영어 자연어 문장 · 기본</option>
            <option value="tags">영어 태그</option>
          </SelectControl>
        </Field>
      </div>
      {settings.captionProvider === 'api' && <>
        <div className="form-grid two">
          <Field label="캡션 API Base URL">
            <input type="url" value={settings.captionApiBase} onChange={e => change({ captionApiBase: e.target.value })}/>
          </Field>
          <Field label="비전 모델 ID">
            <input value={settings.captionModel} placeholder="이미지 입력을 지원하는 모델" onChange={e => change({ captionModel: e.target.value })}/>
          </Field>
        </div>
        <Field label="캡션 API 키" hint="현재 탭 메모리에서만 사용해요 · 저장과 백업에 포함되지 않아요">
          <input type="password" autoComplete="off" value={settings.captionApiKey} onChange={e => change({ captionApiKey: e.target.value })}/>
        </Field>
      </>}
      <label className="check-row">
        <input type="checkbox" checked={settings.autoCaption} onChange={e => change({ autoCaption: e.target.checked })}/>
        <span>
          <strong>이미지 등록 후 자동으로 AI 캡션 작성</strong>
          <small>등록 이미지를 선택한 AI로 보내요 · 서비스 이용량이 적용될 수 있어요</small>
        </span>
      </label>
      <p className="card-note">트리거를 첫 단어로 유지하고 AI 작성 결과는 초안으로 표시해요 · 검토 후 학습에 사용해 주세요</p>
    </div>
  );
}
