import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { deployLora, readLoraHeader } from '../server/deploy.mjs';

function fakeLora(file, { rank = 8, step = 1008 } = {}) {
  const header = JSON.stringify({
    __metadata__: { training_info: JSON.stringify({ step, epoch: 41 }) },
    'diffusion_model.blocks.0.attn.wk.lora_A.weight': { dtype: 'BF16', shape: [rank, 64], data_offsets: [0, 16] },
  });
  const size = Buffer.alloc(8);
  size.writeBigUInt64LE(BigInt(Buffer.byteLength(header)));
  writeFileSync(file, Buffer.concat([size, Buffer.from(header), Buffer.alloc(16)]));
}

const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('readLoraHeader reads rank, dtype and step from safetensors header', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'persona-deploy-'));
  try {
    const file = path.join(dir, 'a.safetensors');
    fakeLora(file, { rank: 16, step: 500 });
    assert.deepEqual(readLoraHeader(file), { rank: 16, dtype: 'BF16', step: 500 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('deployLora moves a root LoRA into the base model folder with preview and metadata', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'persona-deploy-'));
  try {
    fakeLora(path.join(dir, 'yjy_krea2.safetensors'));
    writeFileSync(path.join(dir, 'yjy_krea2.metadata.json'), JSON.stringify({ sha256: 'old', size: 1, favorite: true }));
    const result = await deployLora({
      loraDir: dir,
      viewDir: '/data/models-view/loras',
      file: 'yjy_krea2.safetensors',
      project: { name: 'YJY', trigger: 'yjy', model: 'krea2', identity: 'short black hair', reference: { data: pixel, type: 'image/png', hash: 'abc' } },
    });
    assert.equal(result.folder, 'Krea2');
    assert.equal(result.previewHash, 'abc');
    assert.ok(!existsSync(path.join(dir, 'yjy_krea2.safetensors')));
    assert.ok(!existsSync(path.join(dir, 'yjy_krea2.metadata.json')));
    assert.ok(existsSync(path.join(dir, 'Krea2', 'yjy_krea2.safetensors')));
    assert.ok(existsSync(path.join(dir, 'Krea2', 'yjy_krea2.png')));
    const meta = JSON.parse(readFileSync(path.join(dir, 'Krea2', 'yjy_krea2.metadata.json'), 'utf-8'));
    assert.equal(meta.file_path, '/data/models-view/loras/Krea2/yjy_krea2.safetensors');
    assert.equal(meta.preview_url, '/data/models-view/loras/Krea2/yjy_krea2.png');
    assert.equal(meta.base_model, 'Krea 2');
    assert.equal(meta.model_name, 'YJY');
    assert.match(meta.notes, /Rank 8, 1008 steps/);
    assert.deepEqual(meta.civitai.trainedWords, ['yjy']);
    assert.equal(meta.modelDescription, 'short black hair');
    assert.equal(meta.favorite, true);
    assert.notEqual(meta.sha256, 'old');
    assert.equal(meta.sha256.length, 64);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('deployLora rejects a LoRA that does not belong to the project trigger', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'persona-deploy-'));
  try {
    fakeLora(path.join(dir, 'other_krea2.safetensors'));
    await assert.rejects(deployLora({ loraDir: dir, file: 'other_krea2.safetensors', project: { trigger: 'yjy', model: 'krea2' } }));
    assert.ok(existsSync(path.join(dir, 'other_krea2.safetensors')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
