import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { newProject, createSlots, PRESETS, GROUPS, resizeSlots, captionFor, promptFor, readiness } from '../src/lib/dataset.mjs';
import { exportDataset, validateBackup } from '../src/lib/export.mjs';
import { trainingConfig, TRAINING_MODELS, defaultTraining, migrateTraining, selectTrainingModel } from '../src/lib/training.mjs';

const image = { data: 'data:image/png;base64,iVBORw0KGgo=', name: 'test.png', width: 1024, height: 1024, type: 'image/png', hash: 'unique' };
test('every preset has exactly its count, all coverage groups and unique stable IDs', () => {
  for (const preset of PRESETS) { const slots = createSlots(preset.value); assert.equal(slots.length,preset.value); assert.equal(new Set(slots.map(s=>s.id)).size,preset.value); GROUPS.forEach((g,i)=> assert.equal(slots.filter(s=>s.group===g.key).length,preset.counts[i])); }
});
test('resizing preserves registered images and reports images that would be lost', () => {
  const p = newProject(); p.slots[7] = { ...p.slots[7], image, caption:'custom',reviewed:true };
  const larger = resizeSlots(p,48); assert.equal(larger.next.find(s=>s.id===p.slots[7].id).caption,'custom'); assert.equal(larger.removed.length,0);
  assert.equal(resizeSlots(p,12).removed.length,1);
});
test('caption starts with trigger and avoids immutable identity while prompt carries it', () => {
  const p = newProject(); p.identity='silver hair, red eyes'; const slot=p.slots[0];
  assert.ok(captionFor(p,slot).startsWith(p.trigger+', ')); assert.ok(!captionFor(p,slot).includes('silver hair')); assert.ok(promptFor(p,slot).includes('silver hair')); assert.ok(promptFor(p,slot).includes('front view'));
});
test('readiness blocks unreviewed captions, detects duplicate images and low resolution', () => {
  const p=newProject(); p.slots=p.slots.map((s,i)=>({...s,image:{...image,hash:String(i)},caption:captionFor(p,s),reviewed:true})); assert.equal(readiness(p).ready,true);
  p.slots[0].reviewed=false; assert.equal(readiness(p).ready,false);
  p.slots[1].image.hash=p.slots[0].image.hash; p.slots[0].image.width=300; assert.equal(readiness(p).warnings.length,3);
  p.trigger=''; assert.equal(readiness(p).ready,false);
});
test('training ZIP pairs each image with caption and has matching AI Toolkit config', async () => {
  const p=newProject(); p.size=12; p.slots=createSlots(12).map((s,i)=>({...s,image:{...image,hash:String(i)},caption:captionFor(p,s),reviewed:true}));
  const blob=await exportDataset(p); const zip=await JSZip.loadAsync(await blob.arrayBuffer());
  const files=Object.keys(zip.files); assert.equal(files.filter(f=>f.endsWith('.png')).length,12); assert.equal(files.filter(f=>f.startsWith('dataset/')&&f.endsWith('.txt')).length,12);
  const readme = await zip.file('README.txt').async('string'); assert.ok(readme.includes('modal run scripts/modal_train.py'));
  const config=JSON.parse(await zip.file('train.yaml').async('string')); assert.equal(config.config.process[0].model.arch,'flux'); assert.equal(config.config.process[0].datasets[0].folder_path,'/root/dataset'); assert.ok(!zip.file('dataset.toml'));
  assert.equal((await zip.file('dataset/my_persona_001.txt').async('string')).trim(),p.slots[0].caption);
});
test('unfinished set cannot be exported as training-ready', async()=>{ await assert.rejects(()=>exportDataset(newProject())); });
test('backup import rejects malformed and non-image data and creates a new project ID',()=>{
  const p=newProject(); const backup={format:'persona-project-v1',project:p}; assert.notEqual(validateBackup(backup).id,p.id);
  const legacyBackup={format:'personas-project-v1',project:p}; assert.notEqual(validateBackup(legacyBackup).id,p.id);
  assert.throws(()=>validateBackup({})); p.slots[0].image={data:'data:text/html;base64,abcd',width:100,height:100};assert.throws(()=>validateBackup(backup));
});
test('each base emits its own architecture, checkpoint, and training schedule',()=>{
  for(const profile of TRAINING_MODELS){const p=newProject();p.model=profile.id;p.training=defaultTraining(profile.id);const process=trainingConfig(p).config.process[0];assert.equal(process.model.arch,profile.arch);assert.equal(process.model.name_or_path,profile.checkpoint);assert.equal(process.train.timestep_type,profile.timestep);assert.equal(process.train.noise_scheduler,'flowmatch');assert.equal(process.train.dtype,'float16');assert.equal(process.save.push_to_hub,false);assert.equal(process.datasets[0].shuffle_tokens,false);assert.ok(!('control_path' in process.datasets[0]));}
  const p=newProject();p.model='qwen21';p.training=defaultTraining('qwen21');assert.equal(trainingConfig(p).config.process[0].model.qtype,'convrotint4');assert.equal(trainingConfig(p).config.process[0].model.model_kwargs.rgba,false);
});
test('legacy projects retain images, captions and previous training during migration',()=>{
  const p=newProject();p.model='sdxl';p.training.checkpoint='old-model';p.slots[0].caption='custom caption';const previous=p.training;
  const migrated=migrateTraining(p);assert.equal(migrated.model,'flux1dev');assert.equal(migrated.training.checkpoint,'black-forest-labs/FLUX.1-dev');assert.equal(migrated.slots,p.slots);assert.equal(migrated.slots[0].caption,'custom caption');assert.deepEqual(migrated.previousTraining.training,previous);assert.equal(p.model,'sdxl');
  const restored=validateBackup({format:'personas-project-v1',project:p});assert.equal(restored.model,'flux1dev');
  assert.deepEqual(selectTrainingModel(migrated,'krea2').previousTraining.training,previous);
});
test('training config rejects invalid settings and serializes checkpoint as data',()=>{
  const p=newProject();p.training.checkpoint='model\"; print(123)';assert.equal(trainingConfig(p).config.process[0].model.name_or_path,p.training.checkpoint);p.training.steps=-1;assert.throws(()=>trainingConfig(p));
});
