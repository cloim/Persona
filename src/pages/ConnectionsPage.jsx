import React, { useRef, useState } from 'react';
import { CheckCircle2, CircleHelp, Code2, ExternalLink, FileJson, KeyRound, Link2, Plug, RefreshCw, ShieldCheck, Sparkles, Upload, WandSparkles } from 'lucide-react';
import { api } from '../lib/api.mjs';
import { Button, Field } from '../components/ui';
import CaptionSettings from '../components/CaptionSettings';
import { GoogleConnection } from './CloudPage';

export default function ConnectionsPage({ settings, updateSettings, notify,google,refreshGoogle }) {
  const [busy, setBusy] = useState(false); const input = useRef();
  const [deviceAuth, setDeviceAuth] = useState(null);
  const [authBusy, setAuthBusy] = useState(false);
  const change = patch => { updateSettings({ ...settings, ...patch }); };
  async function test() { setBusy(true); try { const response = await api('/api/test-connection', settings); notify(response.message || '연결을 확인했어요', !response.ok); } catch (error) { notify(error.message, true); } finally { setBusy(false); } }
  async function startDeviceAuth() {
    setAuthBusy(true);
    try {
      const res = await api('/api/codex/device-auth', {});
      setDeviceAuth(res);
      notify(res.message || '인증 코드를 확인해 주세요');
      const poll = setInterval(async () => {
        try {
          const status = await api('/api/codex/device-auth/status');
          if (status.status === 'completed') {
            clearInterval(poll);
            setDeviceAuth(null);
            notify('ChatGPT OAuth 로그인이 완료되었습니다!');
            test();
          } else if (status.status === 'failed') {
            clearInterval(poll);
            setDeviceAuth(null);
            notify(status.message || '인증이 취소되었거나 만료되었습니다', true);
          }
        } catch {}
      }, 3000);
    } catch (err) {
      notify(err.message, true);
    } finally {
      setAuthBusy(false);
    }
  }
  async function uploadWorkflow(file) { if (!file) return; try { if (file.size > 2 * 1024 * 1024) throw new Error('워크플로는 2MB 이내로 선택해 주세요'); const raw = await file.text(); const parsed = JSON.parse(raw); if (parsed.nodes || !Object.values(parsed).every(n => n.class_type && n.inputs)) throw new Error('ComfyUI의 API 형식으로 내보낸 JSON을 선택해 주세요'); change({ workflow: JSON.stringify(parsed, null, 2) }); notify('API 워크플로를 불러왔어요. {{prompt}} 자리 표시자를 확인해 주세요'); } catch (error) { notify(error.message, true); } finally { input.current.value = ''; } }
  return <div className="standard-page connections-page"><div className="section-intro"><div className="intro-icon"><WandSparkles size={24}/></div><div><h2>좋아하는 도구와 연결하세요</h2><p>이미지마다 준비된 프롬프트를 선택한 생성 도구로 보내요</p></div></div><div className="provider-cards" role="radiogroup" aria-label="이미지 생성 도구"><button role="radio" aria-checked={settings.provider === 'comfy'} className={settings.provider === 'comfy' ? 'selected' : ''} onClick={() => change({ provider: 'comfy' })}><span className="provider-logo comfy">C</span><strong>ComfyUI</strong><small>나만의 워크플로로 정교하게</small><span className="radio-circle"/></button><button role="radio" aria-checked={settings.provider === 'codex'} className={settings.provider === 'codex' ? 'selected' : ''} onClick={() => change({ provider: 'codex' })}><span className="provider-logo codex"><Code2 size={27}/></span><strong>Codex OAuth</strong><small>기존 ChatGPT 로그인 활용</small><span className="radio-circle"/></button><button role="radio" aria-checked={settings.provider === 'api'} className={settings.provider === 'api' ? 'selected' : ''} onClick={() => change({ provider: 'api' })}><span className="provider-logo api"><Sparkles size={26}/></span><strong>OpenAI Compatible</strong><small>호환 이미지 API로 유연하게</small><span className="radio-circle"/></button></div>
    <section className="surface connection-settings"><div className="panel-heading"><h3>{settings.provider === 'comfy' ? 'ComfyUI 연결 설정' : settings.provider === 'codex' ? 'Codex 로그인 연결' : 'OpenAI 호환 API 설정'}</h3><span className="subtle-pill">변경 내용 자동 저장</span></div>
    {settings.provider === 'comfy' && <><Field label="ComfyUI 서버 주소" hint="로컬 또는 접근 가능한 ComfyUI 서버의 주소"><input type="url" value={settings.comfyUrl} onChange={e => change({ comfyUrl: e.target.value })} placeholder="http://127.0.0.1:8188"/></Field><div className="field"><div className="field-heading"><span>API 워크플로 JSON</span><Button icon={Upload} onClick={() => input.current.click()}>파일 불러오기</Button></div><input ref={input} hidden type="file" accept="application/json,.json" onChange={e => uploadWorkflow(e.target.files[0])}/><textarea rows={12} className="code-input" value={settings.workflow} onChange={e => change({ workflow: e.target.value })} placeholder={'ComfyUI에서 API 형식으로 내보낸 워크플로를 붙여 넣으세요\n\n긍정 프롬프트: {{prompt}}\n시드: {{seed}}\nLoadImage 참조: {{reference}}'}/></div><div className="callout"><FileJson size={20}/><span>긍정 프롬프트 입력에 <code>{'{{prompt}}'}</code>를 넣어 주세요. <code>{'{{seed}}'}</code>는 새 시드로 바뀌며, <code>{'{{reference}}'}</code>는 업로드한 참조 이미지 경로로 치환돼요. 참조를 사용하려면 IPAdapter 등 해당 워크플로에 맞는 노드가 필요합니다.</span></div><a className="text-link" href="https://docs.comfy.org/development/comfyui-server/comms_routes" target="_blank" rel="noreferrer">ComfyUI API 문서<ExternalLink size={14}/></a></>}
    {settings.provider === 'codex' && <><div className="oauth-info"><ShieldCheck size={38}/><div><h3>컨테이너 독립 디바이스 로그인</h3><p>호스트 PC와 완전히 분리된 컨테이너 자체 세션을 사용해요. 아래 버튼을 눌러 원클릭으로 인증하거나 터미널에서 직접 로그인할 수 있습니다.</p></div></div><div style={{ display: 'flex', gap: '12px', alignItems: 'center', margin: '14px 0' }}><Button variant="primary" busy={authBusy} icon={KeyRound} onClick={startDeviceAuth}>자체 디바이스 로그인 시작</Button></div>{deviceAuth && deviceAuth.userCode && <div className="callout" style={{ borderColor: 'var(--accent, #6366f1)', background: 'rgba(99, 102, 241, 0.08)' }}><div><strong>1. 브라우저에서 아래 링크를 열어주세요:</strong><br/><a href={deviceAuth.url} target="_blank" rel="noreferrer" className="text-link" style={{ fontSize: '15px', fontWeight: 'bold' }}>{deviceAuth.url} <ExternalLink size={14}/></a><div style={{ marginTop: '8px' }}><strong>2. 일회성 인증 코드:</strong>{' '}<span style={{ fontSize: '18px', fontWeight: 'bold', letterSpacing: '2px', background: 'rgba(0,0,0,0.2)', padding: '2px 8px', borderRadius: '4px' }}>{deviceAuth.userCode}</span></div><small style={{ display: 'block', marginTop: '6px', color: 'var(--text-muted)' }}>브라우저에서 로그인 승인이 완료되면 작업실과 자동으로 연결됩니다.</small></div></div>}<ol className="simple-list"><li>위 <strong>[자체 디바이스 로그인 시작]</strong>을 눌러 코드 입력 후 간편하게 로그인</li><li>또는 터미널에서: <code>docker exec -it persona-app codex login --device-auth</code></li><li>로그인 세션은 컨테이너 전용 격리 볼륨에 안전하게 영구 보관됩니다</li></ol><div className="callout"><CircleHelp size={19}/><span>CLI의 <code>image_generation</code> 지원과 해당 계정의 사용 권한이 필요해요. 생성은 Codex 이용 한도를 사용합니다. API 키로 로그인되어 있다면 ChatGPT 계정으로 다시 로그인해 OAuth 연결을 선택해 주세요.</span></div><p className="muted-note">생성 작업은 읽기 전용 샌드박스에서 실행하고 셸, 앱과 브라우저 도구를 끈 전용 세션을 사용해요</p></>}
    {settings.provider === 'api' && <><div className="form-grid"><Field label="API Base URL" hint="/v1까지 포함해 입력해 주세요"><input type="url" value={settings.apiBase} onChange={e => change({ apiBase: e.target.value })}/></Field><Field label="이미지 생성 모델 ID"><input value={settings.apiModel} onChange={e => change({ apiModel: e.target.value })} placeholder="gpt-image-2"/></Field></div><Field label="API 키" hint="현재 탭 메모리에서만 사용해요. 새로고침하면 다시 입력해야 합니다"><input type="password" autoComplete="off" spellCheck="false" value={settings.apiKey} onChange={e => change({ apiKey: e.target.value })} placeholder="API key"/></Field><div className="callout"><Link2 size={18}/><span>참조 이미지 없이 <code>POST /images/generations</code>, 참조 이미지가 있으면 <code>POST /images/edits</code>를 사용해요. 응답의 <code>b64_json</code>과 이미지 URL을 지원합니다. 호환 서버가 해당 이미지 API와 선택한 모델을 지원해야 해요.</span></div><a className="text-link" href="https://developers.openai.com/api/docs/guides/image-generation" target="_blank" rel="noreferrer">OpenAI 이미지 생성 문서<ExternalLink size={14}/></a></>}
    <div className="connection-test"><Button variant="primary" busy={busy} icon={Plug} onClick={test}>{settings.provider === 'codex' ? 'Codex 로그인 확인' : '서버 연결 확인'}</Button></div></section><CaptionSettings settings={settings} updateSettings={updateSettings}/><GoogleConnection google={google} refreshGoogle={refreshGoogle} notify={notify}/><div className="privacy-note"><ShieldCheck size={19}/><p>연결 설정은 이 브라우저에 저장됩니다. API 키와 OAuth 토큰은 프로젝트 백업에 포함하지 않아요. 외부 생성 연결을 실행하면 프롬프트와 선택한 참조 이미지가 해당 서비스로 전송됩니다.</p></div></div>;
}
