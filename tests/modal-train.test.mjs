import test from 'node:test';
import assert from 'node:assert/strict';
import { checkModalCli, getModalTrainingJob, cancelModalTraining } from '../server/modal.mjs';
import { newProject } from '../src/lib/dataset.mjs';
import { trainingConfig, defaultTraining, migrateTraining, selectTrainingTarget, TRAINING_TARGETS } from '../src/lib/training.mjs';
import { exportDataset } from '../src/lib/export.mjs';
import JSZip from 'jszip';

test('Modal training target is configured as default and migrates legacy targets', () => {
  const p = newProject();
  const def = defaultTraining('krea2');
  assert.equal(def.target, 'modal-a10g');

  // 레거시 T4/TPU 대상 마이그레이션 확인
  const legacyT4 = { ...p, training: { target: 't4', steps: 1000, rank: 8, learningRate: '0.0001', checkpoint: 'krea/Krea-2-Raw' } };
  const migrated = migrateTraining(legacyT4);
  assert.equal(migrated.training.target, 'modal-a10g');

  const selected = selectTrainingTarget(p, 'modal-a10g');
  assert.equal(selected.training.target, 'modal-a10g');
  assert.ok(TRAINING_TARGETS.some(t => t.id === 'modal-a10g' && t.trainable === true));
});

test('Modal trainingConfig generates valid AI Toolkit configuration for Modal container', () => {
  const p = {
    ...newProject(),
    trigger: 'omz',
    model: 'krea2',
    training: { target: 'modal-a10g', steps: 1200, rank: 8, learningRate: '0.0001', checkpoint: 'krea/Krea-2-Raw' },
  };

  const config = trainingConfig(p);
  assert.equal(config.job, 'extension');
  const proc = config.config.process[0];
  assert.equal(proc.type, 'sd_trainer');
  assert.equal(proc.training_folder, '/root/output');
  assert.equal(proc.datasets[0].folder_path, '/root/dataset');
  assert.equal(proc.network.linear, 8);
  assert.equal(proc.train.steps, 1200);
  assert.equal(proc.train.dtype, 'float16');
  assert.equal(proc.model.arch, 'krea2');
  assert.equal(proc.model.qtype, 'convrotint4');
});

test('exportDataset creates train.yaml and manifest without Colab ipynb', async () => {
  const p = {
    ...newProject(),
    trigger: 'hero',
    model: 'flux1dev',
    training: { target: 'modal-a10g', steps: 1000, rank: 8, learningRate: '0.0001', checkpoint: 'black-forest-labs/FLUX.1-dev' },
    slots: [
      {
        id: 'slot-1',
        caption: 'hero, a character standing outdoors',
        reviewed: true,
        image: {
          name: 'hero_01.png',
          type: 'image/png',
          data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          width: 512,
          height: 512,
          hash: 'a'.repeat(64),
        },
      },
    ],
  };

  const blob = await exportDataset(p);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());

  assert.ok(zip.file('train.yaml'), 'train.yaml이 존재해야 합니다.');
  assert.ok(zip.file('manifest.json'), 'manifest.json이 존재해야 합니다.');
  assert.ok(zip.file('README.txt'), 'README.txt가 존재해야 합니다.');
  assert.equal(zip.file('train.ipynb'), null, 'Colab ipynb는 제외되어야 합니다.');

  const readme = await zip.file('README.txt').async('string');
  assert.ok(readme.includes('modal run scripts/modal_train.py'));
  assert.ok(!readme.includes('colab.research.google.com'));
});

test('Modal CLI check reports available environment', () => {
  const info = checkModalCli();
  assert.equal(typeof info.available, 'boolean');
  if (info.available) {
    assert.ok(info.version);
    assert.ok(info.profile);
  }
});

test('Modal training job status and cancellation handle idle state safely', () => {
  const status = getModalTrainingJob();
  assert.ok(status.status);
  const cancelRes = cancelModalTraining();
  assert.equal(typeof cancelRes.ok, 'boolean');
});

test('MOSS-Image trainingConfig emits moss_image arch and uncond_skip_layers', () => {
  const p = {
    ...newProject(),
    trigger: 'moss_char',
    model: 'moss',
    training: { target: 'modal-a10g', steps: 1000, rank: 8, learningRate: '0.0001', checkpoint: 'OpenMOSS-Team/MOSS-Image-Base' },
  };

  const config = trainingConfig(p);
  const proc = config.config.process[0];
  assert.equal(proc.model.arch, 'moss_image');
  assert.equal(proc.model.name_or_path, 'OpenMOSS-Team/MOSS-Image-Base');
  assert.deepEqual(proc.model.model_kwargs.uncond_skip_layers, [22]);
  assert.equal(proc.train.timestep_type, 'flowmatch');
});
