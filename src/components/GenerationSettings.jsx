import React, { useEffect, useRef, useState } from 'react';
import { CircleHelp, Code2, ExternalLink, FileJson, KeyRound, Link2, Plug, ShieldCheck, Sparkles, Upload } from 'lucide-react';
import { api } from '../lib/api.mjs';
import { Button, Field } from './ui';

const PROVIDERS = [
  { id: 'comfy', name: 'ComfyUI', note: '나만의 워크플로로 정교하게', logo: <span className="provider-letter">C</span> },
  { id: 'codex', name: 'Codex OAuth', note: '기존 ChatGPT 로그인 활용', logo: <Code2 size={22}/> },
  { id: 'api', name: 'OpenAI Compatible', note: '호환 이미지 API로 유연하게', logo: <Sparkles size={22}/> },
];

export default function GenerationSettings({ settings, updateSettings, notify }) {
  const [busy, setBusy] = useState(false);
  const [deviceAuth, setDeviceAuth] = useState(null);
  const [authBusy, setAuthBusy] = useState(false);
  const input = useRef();
  const poll = useRef(null);
  const change = patch => updateSettings({ ...settings, ...patch });
  useEffect(() => () => clearInterval(poll.current), []);

  async function test() {
    setBusy(true);
    try {
      const response = await api('/api/test-connection', settings);
      notify(response.message || '연결을 확인했어요', !response.ok);
    } catch (error) {
      notify(error.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function startDeviceAuth() {
    setAuthBusy(true);
    try {
      const res = await api('/api/codex/device-auth', {});
      setDeviceAuth(res);
      notify(res.message || '인증 코드를 확인해 주세요');
      clearInterval(poll.current);
      poll.current = setInterval(async () => {
        try {
          const status = await api('/api/codex/device-auth/status');
          if (status.status === 'completed') {
            clearInterval(poll.current);
            setDeviceAuth(null);
            notify('ChatGPT OAuth 로그인을 완료했어요');
            test();
          } else if (status.status === 'failed') {
            clearInterval(poll.current);
            setDeviceAuth(null);
            notify(status.message || '인증이 취소되었거나 만료됐어요', true);
          }
        } catch {}
      }, 3000);
    } catch (error) {
      notify(error.message, true);
    } finally {
      setAuthBusy(false);
    }
  }

  async function uploadWorkflow(file) {
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('워크플로는 2MB 이내로 선택해 주세요');
      const parsed = JSON.parse(await file.text());
      if (parsed.nodes || !Object.values(parsed).every(n => n.class_type && n.inputs)) throw new Error('ComfyUI의 API 형식으로 내보낸 JSON을 선택해 주세요');
      change({ workflow: JSON.stringify(parsed, null, 2) });
      notify('API 워크플로를 불러왔어요. {{prompt}} 자리 표시자를 확인해 주세요');
    } catch (error) {
      notify(error.message, true);
    } finally {
      input.current.value = '';
    }
  }

  return (
    <div className="generation-settings">
      <div className="provider-cards" role="radiogroup" aria-label="이미지 생성 도구">
        {PROVIDERS.map(p => (
          <button key={p.id} type="button" role="radio" aria-checked={settings.provider === p.id} className={`provider-card${settings.provider === p.id ? ' selected' : ''}`} onClick={() => change({ provider: p.id })}>
            <span className="provider-logo">{p.logo}</span>
            <span className="provider-text"><strong>{p.name}</strong><small>{p.note}</small></span>
            <span className="radio-circle"/>
          </button>
        ))}
      </div>

      {settings.provider === 'comfy' && <>
        <Field label="ComfyUI 서버 주소" hint="로컬 또는 접근 가능한 ComfyUI 서버의 주소">
          <input type="url" value={settings.comfyUrl} onChange={e => change({ comfyUrl: e.target.value })} placeholder="http://127.0.0.1:8188"/>
        </Field>
        <div className="field">
          <div className="field-heading">
            <span className="field-label">API 워크플로 JSON</span>
            <Button icon={Upload} onClick={() => input.current.click()}>파일 불러오기</Button>
          </div>
          <input ref={input} hidden type="file" accept="application/json,.json" onChange={e => uploadWorkflow(e.target.files[0])}/>
          <textarea rows={10} className="code-input" aria-label="API 워크플로 JSON" value={settings.workflow} onChange={e => change({ workflow: e.target.value })} placeholder={'ComfyUI에서 API 형식으로 내보낸 워크플로를 붙여 넣으세요\n\n긍정 프롬프트: {{prompt}}\n시드: {{seed}}\nLoadImage 참조: {{reference}}'}/>
        </div>
        <div className="notice">
          <FileJson size={18}/>
          <span>긍정 프롬프트 입력에 <code>{'{{prompt}}'}</code>를 넣어 주세요 · <code>{'{{seed}}'}</code>는 새 시드로, <code>{'{{reference}}'}</code>는 업로드한 참조 이미지 경로로 바뀌어요 · 참조를 쓰려면 IPAdapter 등 워크플로에 맞는 노드가 필요해요</span>
        </div>
        <a className="text-link" href="https://docs.comfy.org/development/comfyui-server/comms_routes" target="_blank" rel="noreferrer">ComfyUI API 문서<ExternalLink size={14}/></a>
      </>}

      {settings.provider === 'codex' && <>
        <div className="notice">
          <ShieldCheck size={18}/>
          <span>호스트 PC와 분리된 컨테이너 자체 세션을 사용해요 · 아래 버튼으로 바로 인증하거나 터미널에서 로그인할 수 있어요</span>
        </div>
        <div className="inline-actions">
          <Button variant="primary" busy={authBusy} icon={KeyRound} onClick={startDeviceAuth}>자체 디바이스 로그인 시작</Button>
        </div>
        {deviceAuth?.userCode && (
          <div className="device-auth" role="status">
            <strong>1. 브라우저에서 아래 링크를 열어 주세요</strong>
            <a href={deviceAuth.url} target="_blank" rel="noreferrer" className="text-link">{deviceAuth.url}<ExternalLink size={14}/></a>
            <strong>2. 일회성 인증 코드를 입력해 주세요</strong>
            <span className="device-code">{deviceAuth.userCode}</span>
            <small>승인이 끝나면 작업실과 자동으로 연결돼요</small>
          </div>
        )}
        <ol className="simple-list">
          <li>위 <strong>자체 디바이스 로그인 시작</strong>을 눌러 코드 입력 후 로그인</li>
          <li>또는 터미널에서 <code>docker exec -it persona-app codex login --device-auth</code></li>
          <li>로그인 세션은 컨테이너 전용 격리 볼륨에 보관돼요</li>
        </ol>
        <div className="notice">
          <CircleHelp size={18}/>
          <span>CLI의 <code>image_generation</code> 지원과 해당 계정의 사용 권한이 필요해요 · 생성은 Codex 이용 한도를 사용해요 · API 키로 로그인되어 있다면 ChatGPT 계정으로 다시 로그인해 주세요</span>
        </div>
        <p className="card-note">생성 작업은 읽기 전용 샌드박스에서 실행하고 셸, 앱과 브라우저 도구를 끈 전용 세션을 사용해요</p>
      </>}

      {settings.provider === 'api' && <>
        <div className="form-grid two">
          <Field label="API Base URL" hint="/v1까지 포함해 입력해 주세요">
            <input type="url" value={settings.apiBase} onChange={e => change({ apiBase: e.target.value })}/>
          </Field>
          <Field label="이미지 생성 모델 ID">
            <input value={settings.apiModel} onChange={e => change({ apiModel: e.target.value })} placeholder="gpt-image-2"/>
          </Field>
        </div>
        <Field label="API 키" hint="현재 탭 메모리에서만 사용해요 · 새로고침하면 다시 입력해야 해요">
          <input type="password" autoComplete="off" spellCheck="false" value={settings.apiKey} onChange={e => change({ apiKey: e.target.value })} placeholder="API key"/>
        </Field>
        <div className="notice">
          <Link2 size={18}/>
          <span>참조 이미지가 없으면 <code>POST /images/generations</code>, 있으면 <code>POST /images/edits</code>를 사용해요 · 응답의 <code>b64_json</code>과 이미지 URL을 지원해요 · 호환 서버가 해당 이미지 API와 선택한 모델을 지원해야 해요</span>
        </div>
        <a className="text-link" href="https://developers.openai.com/api/docs/guides/image-generation" target="_blank" rel="noreferrer">OpenAI 이미지 생성 문서<ExternalLink size={14}/></a>
      </>}

      <div className="inline-actions">
        <Button variant="primary" busy={busy} icon={Plug} onClick={test}>{settings.provider === 'codex' ? 'Codex 로그인 확인' : '서버 연결 확인'}</Button>
        <small className="card-note">변경 내용은 자동 저장돼요</small>
      </div>
    </div>
  );
}
