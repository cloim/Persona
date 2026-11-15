import test from 'node:test';
import assert from 'node:assert/strict';
import { newProject } from '../src/lib/dataset.mjs';
import { trainingConfig, defaultTraining, migrateTraining, selectTrainingTarget, selectTrainingModel } from '../src/lib/training.mjs';

test('Modal A10G configuration accelerates training with float16, 4bit quantization and gradient checkpointing', () => {
  const p = newProject();
  const process = trainingConfig(p).config.process[0];
  assert.deepEqual(process.datasets[0].resolution, [512]);
  assert.equal(process.train.dtype, 'float16');
  assert.equal(process.train.batch_size, 1);
  assert.equal(process.train.cache_text_embeddings, true);
  assert.equal(process.train.unload_text_encoder, true);
  assert.equal(process.train.gradient_checkpointing, true);
  assert.equal(process.train.disable_sampling, true);
  assert.equal(process.model.qtype, 'convrotint4');
  assert.equal(process.network.linear, 8);
  assert.equal(process.training_folder, '/root/output');
  assert.equal(process.datasets[0].folder_path, '/root/dataset');
});

test('Old projects keep dataset and previous settings while migrating their target to modal-a10g and clamping rank', () => {
  const p = newProject();
  delete p.training.target;
  p.training.rank = 32;
  const original = { ...p.training };
  const upgraded = migrateTraining(p);
  assert.equal(upgraded.training.target, 'modal-a10g');
  assert.equal(upgraded.training.rank, 8);
  assert.equal(upgraded.slots, p.slots);
  assert.deepEqual(upgraded.previousTraining.training, original);
  assert.equal(p.training.rank, 32);
  assert.deepEqual(defaultTraining('krea2').rank, 8);
  assert.equal(defaultTraining('krea2').target, 'modal-a10g');
});

test('Training target switching keeps modal-a10g as target', () => {
  const p = newProject();
  const switched = selectTrainingTarget(p, 'modal-a10g');
  assert.equal(switched.training.target, 'modal-a10g');
  const modelSwitched = selectTrainingModel(p, 'krea2');
  assert.equal(modelSwitched.training.target, 'modal-a10g');
});
