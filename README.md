# Persona Studio

캐릭터 LoRA 학습 이미지셋을 구성하는 로컬 우선 React PWA입니다. 권장 구도 설계, 이미지 등록과 AI 생성, 캡션 검토, Modal CLI 클라우드 원클릭 자동 학습을 한 흐름으로 준비합니다.

## 실행

Node.js 22.12 이상에서 실행합니다.

```powershell
npm install
npm run dev
```

작업실: http://localhost:8190

관리 서비스에 등록된 실행 항목을 사용할 때는 해당 관리 화면에서 시작과 중지를 관리합니다. 같은 포트로 개발 서버를 실행하려면 기존 서비스를 먼저 중지해 주세요.

```powershell
npm run build
npm start
```

프로덕션 모드에서는 Chrome 또는 Edge 메뉴에서 PWA를 설치할 수 있습니다. 앱을 한 번 연 후 정적 화면과 자산을 캐시해 오프라인 편집을 지원합니다. AI 생성은 로컬 서버와 생성 서비스 연결이 필요합니다. 이 프로젝트는 로컬 서버에서 실행하도록 구성되어 있으며 외부 공개 배포는 수행하지 않습니다.

브라우저가 설치 요청을 제공하면 사이드바의 설치 버튼으로 설치 창을 엽니다. 설치 요청을 제공하지 않으면 공용 모달로 홈 화면 추가 안내를 표시합니다. 삼성 보안 폴더에서 메뉴가 없는 경우에는 북마크 사용과 보안 폴더 안의 다른 브라우저에서 메뉴를 확인하는 방법을 안내합니다. 실제 홈 아이콘 추가는 기기와 브라우저의 지원이 필요합니다. 브라우저를 변경할 때는 프로젝트 백업과 가져오기로 이미지셋을 옮깁니다.

## Tailscale 원격 접속

프로젝트 루트의 `.env`에 `PERSONA_ALLOWED_ORIGINS=https://workstation.example.com:8190`처럼 실제 Tailscale HTTPS origin을 지정한 뒤 서버를 재시작합니다. `.env`는 Git에서 제외됩니다. `tailscale serve --bg --https=8190 http://127.0.0.1:8190`로 전용 HTTPS 포트를 연결하면 Tailscale이 켜진 같은 네트워크의 기기에서 접근할 수 있습니다. 기존 Serve 포트와 겹치지 않는 번호를 사용하세요.

브라우저 데이터는 기기와 주소별로 저장되므로 기존 프로젝트를 옮기려면 프로젝트 백업과 가져오기를 사용합니다. 원격 기기에서도 ComfyUI와 Codex는 작업실 서버 PC의 연결을 사용합니다.

## 주요 기능

- 12, 24, 36, 48장 프리셋과 얼굴, 표정, 전신, 의상과 배경의 구도 가이드
- PNG, JPG, WebP 개별 등록과 일괄 드래그 업로드, 이미지 중앙 자르기
- 프로젝트별 참조 이미지, 캐릭터 설명, 트리거, 스타일과 FLUX.1 dev, Krea 2 Raw, Qwen-Image-2.1, MOSS-Image 설정
- ComfyUI API 워크플로, Codex OAuth CLI, OpenAI 호환 이미지 API 생성
- SHA-256 동일 이미지 감지와 모델별 저해상도 확인 안내
- 실제 이미지를 읽는 AI 영어 캡션, 개별/일괄 작성과 등록 직후 자동 작성, 검토 상태
- Modal CLI 기반 NVIDIA A10G 24GB 클라우드 원클릭 자동 학습 및 실시간 로그 모니터링
- Google 로그인, Drive에 프로젝트 데이터셋 백업 및 언제든 복원
- 이미지와 같은 파일명의 TXT, train.yaml, manifest.json 학습 데이터셋 패키지
- IndexedDB 자동 저장, 여러 프로젝트 전환과 JSON 백업/복원

## 생성 연결

### ComfyUI

연결 설정에 서버 주소를 입력하고 ComfyUI에서 **API 형식**으로 내보낸 워크플로 JSON을 등록합니다. 긍정 프롬프트에 `{{prompt}}`, 시드 입력에 `{{seed}}`를 사용하세요. 참조를 사용하는 워크플로의 LoadImage 입력에는 `{{reference}}`를 넣습니다. 참조 이미지는 `/upload/image`로 업로드됩니다. IPAdapter 등 워크플로에 필요한 노드와 모델은 ComfyUI에 직접 준비해 주세요.

작업은 `/prompt` 제출 후 `/history/{prompt_id}`를 조회하며 이미지 출력은 `/view`로 가져옵니다. 취소 시 해당 대기 항목만 제거합니다. 이미 실행 중인 ComfyUI 작업은 다른 사용자의 작업을 보호하기 위해 전체 interrupt를 호출하지 않으므로 서버에서 마저 실행될 수 있습니다.

### Codex OAuth

```powershell
npm install -g @openai/codex
codex login
```

ChatGPT 로그인을 완료하고 앱에서 연결 확인을 실행합니다. 공식 CLI의 `image_generation` 도구를 읽기 전용, 셸과 앱 및 브라우저 도구를 끈 별도 세션에서 호출합니다. OAuth 토큰은 CLI가 관리하며 앱에서 읽거나 추출하지 않습니다. CLI 버전과 계정 권한, 사용 한도에 따라 이미지 생성 지원 여부가 달라질 수 있습니다. CLI 경로를 자동으로 찾지 못하면 서버 환경변수 `CODEX_BIN`에 실행 파일 또는 `codex.js`의 절대 경로를 지정합니다. CLI 생성 이미지는 CLI의 generated_images 폴더에 보관되며 임시 참조 파일은 작업 후 삭제합니다.

### OpenAI Compatible API

`/v1`을 포함한 API base와 이미지 모델 ID를 입력합니다. 참조 이미지가 없으면 `/images/generations`, 있으면 multipart `/images/edits`를 사용합니다. `data[0].b64_json` 또는 이미지 URL 응답을 지원합니다. 제공자가 이미지 API와 선택한 모델, 1024×1024 크기와 참조 이미지 편집을 지원해야 합니다. API 키는 현재 탭의 메모리에서만 사용하며 디스크와 백업에 보관하지 않습니다.

## 학습과 Modal 자동화

기본 베이스는 **FLUX.1 dev**이고 **Krea 2 Raw**, **Qwen-Image-2.1**, **MOSS-Image**를 선택할 수 있습니다. 네 베이스 모두 AI Toolkit을 사용하며 모델 선택에 따라 아키텍처, 체크포인트와 스케줄을 적용합니다. `train.yaml`은 JSON 문법으로 직렬화한 유효한 YAML이며 AI Toolkit의 YAML 로더가 직접 읽습니다. Qwen-Image-2.1은 AI Toolkit 구현에 맞춰 `Comfy-Org/Qwen-Image-2.1`, `arch: qwen_image_2`를 사용합니다. Krea 2는 학습용 Raw를 기본값으로 사용하며, MOSS-Image는 OpenMOSS의 5B DiT 모델로 `OpenMOSS-Team/MOSS-Image-Base`, `arch: moss_image`를 적용합니다.

이전 SDXL/SD 1.5 프로젝트는 이미지와 캡션을 유지하면서 FLUX.1 dev로 전환하고 원래 모델과 학습 설정은 백업의 `previousTraining`에 보관합니다. 베이스 선택을 바꾸면 해당 모델의 시작 설정을 적용합니다. 모델별 이용 조건과 접근 권한은 모델 페이지에서 확인해 주세요.

### Modal 클라우드 자동 학습

학습 실행 대상은 **Modal Cloud (NVIDIA A10G 24GB VRAM, 32GB RAM)** 환경입니다.
웹 앱의 **학습과 내보내기** 페이지에서 **[Modal에서 자동 학습 시작]** 버튼을 누르면:

1. 브라우저의 이미지셋과 캡션이 로컬 백엔드를 통해 Modal 원격 컨테이너로 자동 전송됩니다.
2. Modal A10G GPU 인스턴스가 즉시 프로비저닝되어 AI Toolkit 고속 학습을 시작합니다.
3. 앱 화면에서 현재 스텝(Step X/1000), 실시간 Loss 수치, 콘솔 로그를 라이브로 확인할 수 있습니다.
4. 학습이 완료되면 생성된 `.safetensors` 가중치가 로컬 `output/` 폴더에 자동 동기화되며 웹 화면에서 바로 다운로드할 수 있습니다.

### Modal CLI 터미널 직접 실행

터미널에서 직접 실행할 수도 있습니다:

```powershell
modal run scripts/modal_train.py --dataset-dir ./dataset_abc --trigger abc --model krea2 --steps 1000 --rank 8
```

필요한 경우 **학습 데이터셋 ZIP 다운로드**로 `train.yaml`, 이미지, TXT 캡션이 포함된 압축 패키지를 받아 로컬 AI Toolkit에서 직접 학습할 수도 있습니다.

## Google 로그인과 Drive 프로젝트 보관

서버의 `.env`에 `GOOGLE_CLIENT_ID`와 `GOOGLE_CLIENT_SECRET`을 설정합니다. Google Auth Platform에서 웹 애플리케이션 OAuth 클라이언트를 만들고 실제 Tailscale HTTPS 주소와 `http://localhost:8190`을 승인된 JavaScript 원본으로, 각 주소 뒤에 `/api/google/callback`을 붙인 주소를 승인된 리디렉션 URI로 등록합니다. Drive API를 사용 설정하고 테스트 모드에서는 사용할 Google 계정을 테스트 사용자로 추가합니다. 로그인 범위는 `openid`, `email`, `profile`, `drive.file`입니다. 전체 Drive 접근 권한을 요청하지 않습니다.

앱의 **Google Drive 보관함**에서 로그인한 후 검토 완료 프로젝트를 저장합니다. 내 Drive의 `Persona Studio` 아래 새로운 폴더에 `dataset.zip`을 안전하게 백업합니다. 업로드는 8MB 조각으로 전송하며 중단해도 로컬 프로젝트는 유지합니다.

**Drive 프로젝트 불러오기 → 저장한 프로젝트 찾기**에서 이 앱이 저장한 폴더를 선택하고 새 프로젝트 사본으로 복원합니다. 이미지, TXT 캡션과 검토 상태, 구도 및 학습 설정을 가져오며 현재 프로젝트는 보관합니다. 새 패키지는 캐릭터 설명, 스타일과 참조 이미지도 포함합니다. 이전 버전의 패키지는 이미지와 캡션을 복원하고 저장 당시 포함되지 않았던 캐릭터 설명과 참조 이미지를 보완하도록 안내합니다. 저장 항목은 최근 순으로 50개씩 조회하며 ZIP 다운로드와 복원을 중단할 수 있습니다. 로그인한 계정의 앱 생성 파일만 조회하며 전체 Drive 접근 권한을 추가하지 않습니다. 파일 수, 압축 해제 크기와 경로, 이미지 및 캡션 짝을 검사한 뒤 브라우저에 저장합니다.

클라이언트 비밀과 OAuth 토큰은 브라우저 저장소나 프로젝트 백업에 포함하지 않습니다. 로그인 세션과 토큰은 서버 메모리에 유지하며 8시간 뒤 또는 서버 재시작 시 다시 로그인합니다. Google 로그아웃은 이 앱의 세션을 종료하며 Google 계정의 앱 접근 권한 철회는 Google 계정 설정에서 진행합니다.

## 저장과 보안

이미지와 프로젝트는 해당 브라우저의 IndexedDB에 저장됩니다. 사이트 데이터 삭제 전 백업해 주세요. 브라우저 저장 한도를 초과하면 이미지 크기를 줄이거나 백업으로 보관하세요. 로컬 서버는 127.0.0.1에만 바인딩하고 Host, Origin과 요청 토큰을 확인하며 API 응답은 캐시하지 않습니다. 선택한 외부 API 또는 ComfyUI로 생성 프롬프트와 참조 이미지가 전송됩니다.

## 검증과 아이콘

```powershell
npm test
npm run build
node scripts/generate-icons.mjs
```

아이콘 스크립트는 코드로 작성한 앱 심벌을 192px와 512px PNG로 생성합니다. `public/icon.svg` 또는 브랜드 색상을 변경할 때 해당 스크립트를 조정하고 다시 실행하세요. 공유 SelectControl과 Modal의 초기 구현은 Balance 번들에서 가져와 앱 토큰과 모바일 바텀시트 스타일을 적용했습니다.

UI 변경 시 선택 입력은 `components/ui`의 `SelectControl`, 모달은 `Modal`, 알림은 `Toast`를 사용합니다. SelectControl과 Modal은 Balance 번들 기반이며 Toast는 Balance의 포털, 비차단 알림 기준에 맞춘 프로젝트 공용 컴포넌트입니다. 화면 CSS는 `.field-label`, `.size-control-label`처럼 라벨을 명시해 적용하며, `span` 전체를 선택해 내부 래퍼까지 덮어쓰지 않습니다. chevron 위치와 여백은 SelectControl의 CSS에서, 메시지와 오른쪽 닫기 버튼 배치는 Toast의 CSS에서 관리합니다.

브라우저 QA에서는 `scripts/ui-component-audit.mjs`의 `auditComponentGeometry`를 ESM으로 가져와 `await page.evaluate(auditComponentGeometry)`로 실행합니다. 반환 배열이 비어 있어야 합니다. 325px, 390px, 768px, 1440px에서 각 화면과 캐릭터 설정 모달, 이미지 자르기 탭을 열어 검사하고, 짧은 성공 알림과 여러 줄 오류 알림도 표시해 검사합니다. 알림 등장 전후 레이아웃 이동, 닫기 버튼의 마우스와 키보드 조작은 별도로 확인합니다.

## 공식 자료

- [ComfyUI 서버 라우트](https://docs.comfy.org/development/comfyui-server/comms_routes)
- [OpenAI 이미지 API](https://developers.openai.com/api/docs/guides/image-generation)
- [Codex 이미지 생성 구현](https://github.com/openai/codex/tree/main/codex-rs/ext/image-generation)
- [AI Toolkit 지원 모델과 학습 가이드](https://github.com/ostris/ai-toolkit#supported-models)
