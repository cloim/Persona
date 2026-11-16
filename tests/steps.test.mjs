import test from 'node:test';
import assert from 'node:assert/strict';
import { newProject, createSlots, captionFor } from '../src/lib/dataset.mjs';
import { STEPS, TRIGGER_PATTERN, stepStatus, firstIncompleteStep } from '../src/lib/steps.mjs';

const image = { data: 'data:image/png;base64,AAAA', width: 1024, height: 1024, name: 'a.png' };
function filled(project, reviewed = true) {
  project.slots = project.slots.map((s, i) => ({ ...s, image: { ...image, hash: String(i) }, caption: captionFor(project, s), reviewed }));
  return project;
}

test('steps are fixed in the five stage order', () => {
  assert.deepEqual(STEPS.map(s => s.key), ['setup', 'dataset', 'captions', 'training', 'deploy']);
  assert.deepEqual(STEPS.map(s => s.path), ['/setup', '/dataset', '/captions', '/training', '/deploy']);
});

test('trigger pattern accepts only 2 to 64 safe characters', () => {
  assert.ok(TRIGGER_PATTERN.test('my_persona-1'));
  assert.ok(!TRIGGER_PATTERN.test('a'));
  assert.ok(!TRIGGER_PATTERN.test('한글'));
  assert.ok(!TRIGGER_PATTERN.test('a'.repeat(65)));
});

test('setup needs a trigger, a name and a reference or identity', () => {
  const p = newProject();
  assert.equal(stepStatus(p).setup.done, false);
  assert.equal(stepStatus(p).setup.detail, '기본 정보 입력');
  p.identity = ' silver hair ';
  assert.equal(stepStatus(p).setup.done, true);
  assert.equal(stepStatus(p).setup.detail, p.trigger);
  p.identity = ''; p.reference = image;
  assert.equal(stepStatus(p).setup.done, true);
  p.name = '  ';
  assert.equal(stepStatus(p).setup.done, false);
  p.name = 'x'; p.trigger = 'a';
  assert.equal(stepStatus(p).setup.done, false);
});

test('dataset and captions report counts', () => {
  const p = newProject(); p.size = 12; p.slots = createSlots(12);
  assert.deepEqual(stepStatus(p).dataset, { done: false, detail: '0 / 12장' });
  filled(p, false);
  assert.deepEqual(stepStatus(p).dataset, { done: true, detail: '12 / 12장' });
  assert.deepEqual(stepStatus(p).captions, { done: false, detail: '0 / 12 확인' });
  p.slots[0].reviewed = true;
  assert.equal(stepStatus(p).captions.detail, '1 / 12 확인');
  filled(p, true);
  assert.equal(stepStatus(p).captions.done, true);
});

test('training reflects job progress and the saved LoRA file', () => {
  const p = newProject();
  assert.deepEqual(stepStatus(p, { status: 'idle' }).training, { done: false, detail: '대기' });
  const running = stepStatus(p, { status: 'running', currentStep: 250, steps: 1000 }).training;
  assert.deepEqual(running, { done: false, detail: '학습 중 25%' });
  p.lora = { file: 'my.safetensors', size: 10, completedAt: 1, model: 'flux1dev' };
  assert.deepEqual(stepStatus(p, { status: 'idle' }).training, { done: true, detail: '완료' });
});

test('deploy is a terminal step that is never done', () => {
  const p = newProject();
  assert.deepEqual(stepStatus(p).deploy, { done: false, detail: '학습 후 사용' });
  p.lora = { file: 'my.safetensors' };
  assert.deepEqual(stepStatus(p).deploy, { done: false, detail: '다운로드 가능' });
});

test('first incomplete step falls back to deploy when everything is done', () => {
  const p = newProject(); p.identity = 'silver hair';
  assert.equal(firstIncompleteStep(stepStatus(newProject())), '/setup');
  assert.equal(firstIncompleteStep(stepStatus(p)), '/dataset');
  filled(p, false);
  assert.equal(firstIncompleteStep(stepStatus(p)), '/captions');
  filled(p, true);
  assert.equal(firstIncompleteStep(stepStatus(p)), '/training');
  p.lora = { file: 'my.safetensors' };
  assert.equal(firstIncompleteStep(stepStatus(p)), '/deploy');
});
