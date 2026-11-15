import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {newProject,createSlots,captionFor} from '../src/lib/dataset.mjs';
import {exportDataset,importTrainingPackage} from '../src/lib/export.mjs';

const image={data:'data:image/png;base64,iVBORw0KGgo=',name:'character.png',type:'image/png',width:1024,height:1024,hash:'a'.repeat(64)};
function fixture(){const p={...newProject(),size:12,identity:'silver hair',style:'anime',reference:image};p.slots=createSlots(12).map(s=>({...s,image,caption:captionFor(p,s),reviewed:true}));return p;}
const readImage=async file=>({...image,name:file.name,type:file.type});
test('Drive package restores character metadata, references, slots and actual TXT captions as a new project',async()=>{
 const p=fixture(),zip=await JSZip.loadAsync(await(await exportDataset(p)).arrayBuffer());zip.file('dataset/my_persona_001.txt','edited training caption');
 const {project,legacy}=await importTrainingPackage(await zip.generateAsync({type:'uint8array'}),readImage);
 assert.equal(legacy,false);assert.notEqual(project.id,p.id);assert.equal(project.identity,p.identity);assert.equal(project.style,p.style);assert.deepEqual(project.reference,p.reference);assert.deepEqual(project.training,p.training);assert.equal(project.slots[0].caption,'edited training caption');assert.equal(project.slots[0].reviewed,true);assert.equal(project.slots.length,12);assert.equal(p.slots[0].caption,captionFor(p,p.slots[0]));
});
test('Existing version 1 Drive packages restore images, captions and the selected training base',async()=>{
 const p=fixture();p.model='krea2';p.training.checkpoint='krea/Krea-2-Raw';
 const zip=await JSZip.loadAsync(await(await exportDataset(p)).arrayBuffer());const m=JSON.parse(await zip.file('manifest.json').async('string'));m.version=1;for(const key of ['identity','style','reference','training'])delete m[key];zip.file('manifest.json',JSON.stringify(m));
 const {project,legacy}=await importTrainingPackage(await zip.generateAsync({type:'uint8array'}),readImage);
 assert.equal(legacy,true);assert.equal(project.model,'krea2');assert.equal(project.slots[0].caption,p.slots[0].caption);assert.equal(project.identity,'');assert.equal(project.reference,null);assert.equal(project.training.checkpoint,p.training.checkpoint);
});
test('Drive import rejects incomplete archives, traversal paths, unsupported targets and cancellation',async()=>{
 const p=fixture(),bytes=await(await exportDataset(p)).arrayBuffer();
 let zip=await JSZip.loadAsync(bytes);zip.remove('dataset/my_persona_001.txt');await assert.rejects(importTrainingPackage(await zip.generateAsync({type:'uint8array'}),readImage),/이미지와 캡션/);
 zip=await JSZip.loadAsync(bytes);zip.file('../outside.txt','x');await assert.rejects(importTrainingPackage(await zip.generateAsync({type:'uint8array'}),readImage),/경로/);
 zip=await JSZip.loadAsync(bytes);const m=JSON.parse(await zip.file('manifest.json').async('string'));m.training.target='untrusted';zip.file('manifest.json',JSON.stringify(m));await assert.rejects(importTrainingPackage(await zip.generateAsync({type:'uint8array'}),readImage),/실행 대상/);
 const controller=new AbortController();controller.abort();await assert.rejects(importTrainingPackage(bytes,readImage,{signal:controller.signal}),{name:'AbortError'});
 await assert.rejects(importTrainingPackage(bytes,async()=>{throw Error('손상된 이미지');}),/손상된 이미지/);
});
