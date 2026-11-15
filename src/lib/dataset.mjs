import { defaultTraining } from './training.mjs';
export const PRESETS = [
  { value: 12, label: '12장 · 빠른 실험', description: '캐릭터의 핵심 특징을 먼저 확인해요', counts: [4, 4, 2, 2] },
  { value: 24, label: '24장 · 균형 잡힌 구성 (권장)', description: '각도와 표정, 전신을 고르게 담는 시작점', counts: [8, 6, 6, 4] },
  { value: 36, label: '36장 · 다양한 표현', description: '의상과 배경, 포즈의 다양성을 더해요', counts: [12, 10, 8, 6] },
  { value: 48, label: '48장 · 풍부한 데이터', description: '디테일과 드문 각도까지 세밀하게 구성해요', counts: [16, 12, 12, 8] },
];
export const GROUPS = [
  { key: 'portrait', label: '얼굴과 각도', color: '#b6cdb8', tag: '얼굴', en: 'close-up portrait' },
  { key: 'expression', label: '표정과 감정', color: '#e2bd99', tag: '표정', en: 'upper body' },
  { key: 'body', label: '전신과 포즈', color: '#b6c5dc', tag: '전신', en: 'full body' },
  { key: 'variation', label: '의상과 배경', color: '#c9bad6', tag: '변화', en: 'medium shot' },
];
const recipes = {
  portrait: [
    ['정면 클로즈업', 'front view', 'neutral expression', '얼굴 윤곽과 눈, 코가 선명하게 보이도록'],
    ['왼쪽 45°', 'three-quarter view from the left', 'neutral expression', '코와 턱선이 자연스럽게 드러나는 각도'],
    ['오른쪽 45°', 'three-quarter view from the right', 'neutral expression', '반대쪽 얼굴의 특징도 고르게 담기'],
    ['왼쪽 측면', 'left side profile', 'neutral expression', '옆모습의 이마와 코, 턱선에 집중'],
    ['오른쪽 측면', 'right side profile', 'neutral expression', '가려지는 얼굴 없이 깔끔한 옆모습'],
    ['살짝 올려다보기', 'low angle view', 'neutral expression', '아래쪽 시점에서도 캐릭터의 특징 유지'],
    ['살짝 내려다보기', 'high angle view', 'neutral expression', '위쪽 시점과 자연스러운 눈맞춤'],
    ['뒷모습', 'back view', 'looking away', '헤어스타일과 뒤쪽 실루엣을 담기'],
  ],
  expression: [
    ['자연스러운 미소', 'front view', 'gentle smile', '입과 눈매에 자연스러운 변화 주기'],
    ['활짝 웃는 얼굴', 'three-quarter view', 'laughing happily', '입을 열고 웃는 표정까지 담기'],
    ['진지한 얼굴', 'front view', 'serious expression', '중립 표정과 구분되는 눈썹과 입매'],
    ['놀란 얼굴', 'front view', 'surprised expression', '눈과 입을 통해 놀라움을 표현'],
    ['생각에 잠긴 얼굴', 'three-quarter view', 'thoughtful expression', '과장되지 않은 자연스러운 감정'],
    ['눈을 감은 얼굴', 'front view', 'eyes closed, peaceful expression', '눈을 감아도 유지되는 캐릭터의 특징'],
    ['슬픈 얼굴', 'front view', 'sad expression', '눈물 없이도 읽히는 섬세한 감정'],
    ['장난스러운 얼굴', 'three-quarter view', 'playful expression', '한쪽 눈과 입매의 작은 변화'],
    ['자신감 있는 얼굴', 'low angle view', 'confident expression', '시선과 입꼬리의 변화'],
    ['옅은 미소의 측면', 'side profile', 'subtle smile', '각도와 감정을 함께 변화'],
  ],
  body: [
    ['편하게 서 있기', 'front view, standing', 'neutral expression', '머리부터 발끝까지 프레임 안에 담기'],
    ['옆으로 서 있기', 'side view, standing', 'neutral expression', '옆모습의 신체 비율을 유지'],
    ['걷는 모습', 'three-quarter view, walking', 'relaxed expression', '자연스러운 팔과 다리의 움직임'],
    ['앉아 있는 모습', 'front view, sitting on a stool', 'gentle smile', '앉은 자세에서도 손과 관절을 확인'],
    ['뒤돌아보기', 'back view, looking over shoulder', 'neutral expression', '어깨 너머 얼굴과 몸의 연결'],
    ['팔을 든 모습', 'front view, one arm raised', 'gentle smile', '손가락과 겨드랑이 주변의 형태 확인'],
    ['몸을 기댄 모습', 'leaning against a wall', 'relaxed expression', '무게 중심과 자연스러운 자세'],
    ['가볍게 달리기', 'side view, running', 'focused expression', '동적인 포즈에서도 정체성 유지'],
  ],
  variation: [
    ['밝은 야외', 'front view, in a park, daylight', 'gentle smile', '배경이 바뀌어도 얼굴과 실루엣 유지'],
    ['차분한 실내', 'three-quarter view, in a cafe, soft indoor light', 'relaxed expression', '조명이 달라질 때의 특징 확인'],
    ['다른 일상복', 'front view, wearing a plain casual shirt, gray background', 'neutral expression', '의상과 캐릭터 정체성을 분리해 학습'],
    ['따뜻한 저녁빛', 'side view, outdoors, warm evening light', 'peaceful expression', '다양한 색온도에서 특징 유지'],
    ['심플한 재킷', 'front view, wearing a simple jacket, beige background', 'neutral expression', '다른 옷으로 의상 편향 줄이기'],
    ['흐린 날', 'three-quarter view, outdoors, overcast daylight', 'gentle smile', '강한 그림자 없이 자연스러운 모습'],
  ],
};
export function createSlots(size = 24) {
  const preset = PRESETS.find(p => p.value === Number(size)) || PRESETS[1];
  return GROUPS.flatMap((g, gi) => Array.from({ length: preset.counts[gi] }, (_, i) => {
    const r = recipes[g.key][i % recipes[g.key].length];
    const cycle = Math.floor(i / recipes[g.key].length);
    return { id: `${g.key}-${i}`, group: g.key, title: r[0] + (cycle ? ` ${cycle + 1}` : ''), view: r[1], expression: r[2], tip: r[3], light: cycle ? 'soft natural daylight, pale gray background' : 'soft diffused lighting, simple off-white background', image: null, caption: '', prompt: '', reviewed: false };
  }));
}
export function newProject() {
  return { id: crypto.randomUUID(), name: '나의 첫 캐릭터', trigger: 'my_persona', identity: '', style: 'illustration', model: 'flux1dev', size: 24, reference: null, slots: createSlots(24), training: defaultTraining(), updatedAt: Date.now() };
}
export function captionFor(project, slot) {
  const group = GROUPS.find(g => g.key === slot.group);
  return [project.trigger, project.style === 'photo' ? 'photo' : project.style === 'anime' ? 'anime illustration' : 'illustration', group.en, slot.view, slot.expression, slot.light].filter(Boolean).join(', ');
}
export function promptFor(project, slot) {
  return `Create one high-quality ${project.style === 'photo' ? 'photograph' : project.style === 'anime' ? 'anime illustration' : 'character illustration'} for a character LoRA training dataset.\nCharacter identity: ${project.identity || 'Use the attached reference character and preserve its identity exactly'}.\nComposition: ${GROUPS.find(g => g.key === slot.group).en}, ${slot.view}.\nExpression: ${slot.expression}.\nLighting and background: ${slot.light}.\nPreserve facial structure, eye color, hairstyle, body proportions and all defining features of the reference. Only change the requested angle, pose, expression or outfit. One subject, clean anatomy, sharp details. No text, watermark, collage or multiple views.\nTraining trigger (metadata only, do not render as text): ${project.trigger}.`;
}
export function resizeSlots(project, size) {
  const next = createSlots(size).map(s => project.slots.find(old => old.id === s.id) || s);
  const removed = project.slots.filter(s => s.image && !next.some(n => n.id === s.id));
  return { next, removed };
}
export function readiness(project) {
  const filled = project.slots.filter(s => s.image);
  const reviewed = filled.filter(s => s.reviewed && s.caption.trim());
  const warnings = filled.flatMap(s => {
    const list = [];
    if (Math.min(s.image.width, s.image.height) < 768) list.push({ id: s.id, title: s.title, message: '해상도를 확인해 주세요' });
    if (filled.some(other => other.id !== s.id && other.image.hash === s.image.hash)) list.push({ id: s.id, title: s.title, message: '동일한 이미지가 포함되어 있어요' });
    return list;
  });
  return { filled: filled.length, reviewed: reviewed.length, total: project.slots.length, warnings, complete: filled.length === project.slots.length, ready: reviewed.length === project.slots.length && /^[a-zA-Z0-9_-]{2,64}$/.test(project.trigger) };
}
