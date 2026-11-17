import path from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, chownSync, openSync, readSync, closeSync } from 'node:fs';

// 학습 베이스별 ComfyUI loras 하위 폴더와 LoRA Manager base_model 표기
export const LORA_TARGETS = {
  flux1dev: { folder: 'Flux1.D', baseModel: 'Flux.1 D' },
  krea2: { folder: 'Krea2', baseModel: 'Krea 2' },
  qwen21: { folder: 'Qwen2.1', baseModel: 'Qwen-Image' },
  moss: { folder: 'MOSS', baseModel: 'MOSS-Image' },
};

const PREVIEW_EXTS = ['.webp', '.preview.webp', '.preview.png', '.preview.jpeg', '.preview.jpg', '.png', '.jpeg', '.jpg'];
const IMAGE_EXTS = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };

function findFile(dir, name) {
  if (!existsSync(dir)) return null;
  const direct = path.join(dir, name);
  if (existsSync(direct)) return direct;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const found = findFile(path.join(dir, entry.name), name);
    if (found) return found;
  }
  return null;
}

// safetensors 헤더에서 rank, dtype, 학습 스텝을 읽는다
export function readLoraHeader(file) {
  const fd = openSync(file, 'r');
  try {
    const size = Buffer.alloc(8);
    readSync(fd, size, 0, 8, 0);
    const length = Number(size.readBigUInt64LE());
    if (!length || length > 100 * 1024 * 1024) return {};
    const raw = Buffer.alloc(length);
    readSync(fd, raw, 0, length, 8);
    const header = JSON.parse(raw.toString('utf-8'));
    const meta = header.__metadata__ || {};
    const down = Object.entries(header).find(([key]) => /lora_(A|down)\.weight$/.test(key))?.[1];
    let step = null;
    try { step = JSON.parse(meta.training_info || '{}').step ?? null; } catch {}
    return { rank: down?.shape?.[0] ?? null, dtype: down?.dtype ?? null, step };
  } catch {
    return {};
  } finally {
    closeSync(fd);
  }
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file).on('data', chunk => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
  });
}

function removeSiblings(dir, base) {
  for (const ext of [...PREVIEW_EXTS, '.metadata.json']) rmSync(path.join(dir, base + ext), { force: true });
}

function matchOwner(file, dir) {
  try { const { uid, gid } = statSync(dir); chownSync(file, uid, gid); } catch {}
}

/**
 * 학습된 LoRA를 베이스 모델 폴더로 옮기고 미리보기 이미지와 LoRA Manager 메타데이터를 채운다.
 * loraDir는 이 서버에서 보이는 loras 루트, viewDir는 ComfyUI(LoRA Manager)에서 보이는 같은 폴더 경로다.
 */
export async function deployLora({ loraDir, viewDir = '/data/models-view/loras', file, project = {} }) {
  const name = path.basename(String(file || ''));
  if (!name.endsWith('.safetensors')) throw new Error('배포할 LoRA 파일을 확인해 주세요');
  const safeTrigger = String(project.trigger || '').replace(/[^a-zA-Z0-9_-]/g, '_');
  if (safeTrigger && !name.startsWith(safeTrigger)) throw new Error('현재 프로젝트 트리거로 학습한 LoRA만 배포할 수 있어요');
  const source = findFile(loraDir, name);
  if (!source) throw new Error(`LoRA 파일을 찾을 수 없어요: ${name}`);

  const modelId = LORA_TARGETS[project.model] ? project.model : 'krea2';
  const target = LORA_TARGETS[modelId];
  const targetDir = path.join(loraDir, target.folder);
  mkdirSync(targetDir, { recursive: true });
  const base = name.slice(0, -'.safetensors'.length);
  const dest = path.join(targetDir, name);
  const sourceDir = path.dirname(source);

  let previous = {};
  try { previous = JSON.parse(readFileSync(path.join(sourceDir, `${base}.metadata.json`), 'utf-8')); } catch {}
  if (path.resolve(source) !== path.resolve(dest)) {
    renameSync(source, dest);
    removeSiblings(sourceDir, base);
  }

  const stat = statSync(dest);
  const header = readLoraHeader(dest);
  const hash = previous.sha256 && previous.size === stat.size ? previous.sha256 : await sha256(dest);

  // 프로젝트 기본 이미지(참조 이미지)를 같은 이름의 미리보기로 저장한다
  let previewUrl = '';
  const ref = project.reference;
  const match = typeof ref?.data === 'string' && ref.data.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
  if (match) {
    for (const ext of PREVIEW_EXTS) rmSync(path.join(targetDir, base + ext), { force: true });
    const previewName = base + IMAGE_EXTS[match[1]];
    const previewPath = path.join(targetDir, previewName);
    writeFileSync(previewPath, Buffer.from(match[2], 'base64'));
    matchOwner(previewPath, targetDir);
    previewUrl = `${viewDir}/${target.folder}/${previewName}`;
  } else {
    const existing = PREVIEW_EXTS.find(ext => existsSync(path.join(targetDir, base + ext)));
    if (existing) previewUrl = `${viewDir}/${target.folder}/${base}${existing}`;
  }

  const trigger = String(project.trigger || '').trim();
  const rank = header.rank || Number(project.training?.rank) || null;
  const steps = header.step || Number(project.training?.steps) || null;
  const title = String(project.name || '').trim() || trigger || base;
  const details = [header.dtype?.toLowerCase().replace('bf16', 'bfloat16').replace('f16', 'float16'), rank && `Rank ${rank}`, steps && `${steps} steps`].filter(Boolean).join(', ');
  const metadata = {
    ...previous,
    file_name: base,
    model_name: title,
    file_path: `${viewDir}/${target.folder}/${name}`,
    size: stat.size,
    modified: stat.mtimeMs / 1000,
    sha256: hash,
    base_model: target.baseModel,
    preview_url: previewUrl,
    preview_nsfw_level: previous.preview_nsfw_level ?? 0,
    notes: `${title} Character LoRA for ${target.baseModel}${details ? ` (${details})` : ''}${trigger ? ` · trigger: ${trigger}` : ''}`,
    from_civitai: previous.from_civitai ?? false,
    civitai: { ...(previous.civitai || {}), ...(trigger ? { trainedWords: [trigger] } : {}) },
    tags: [...new Set(['character', trigger, target.baseModel.toLowerCase()].filter(Boolean))],
    modelDescription: String(project.identity || '').trim() || previous.modelDescription || '',
    civitai_deleted: previous.civitai_deleted ?? false,
    favorite: previous.favorite ?? false,
    exclude: previous.exclude ?? false,
    db_checked: previous.db_checked ?? false,
    skip_metadata_refresh: true,
    metadata_source: previous.metadata_source ?? null,
    last_checked_at: previous.last_checked_at ?? 0,
    hash_status: 'completed',
    autov3: previous.autov3 || hash.slice(0, 12),
    quantization: previous.quantization ?? null,
    usage_tips: JSON.stringify({ strength: 0.8, clipStrength: 0.8 }),
  };
  const metadataPath = path.join(targetDir, `${base}.metadata.json`);
  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + '\n', 'utf-8');
  matchOwner(metadataPath, targetDir);
  matchOwner(dest, targetDir);

  return { file: name, folder: target.folder, path: dest, preview: previewUrl, previewHash: match ? (ref.hash || null) : null, metadata };
}

// ComfyUI LoRA Manager가 옮긴 파일을 다시 읽고, 기존 항목의 캐시에도 새 메타데이터를 반영하도록 요청한다
// 일반 재스캔은 새 파일만 추가하므로 미리보기와 메타데이터 변경은 save-metadata로 캐시를 갱신한다
const CACHE_FIELDS = ['model_name', 'base_model', 'preview_url', 'preview_nsfw_level', 'notes', 'tags', 'modelDescription', 'usage_tips', 'civitai'];
export async function rescanLoraManager(comfyUrl, metadata) {
  if (!comfyUrl) return false;
  try {
    const scan = await fetch(new URL('/api/lm/loras/scan', comfyUrl), { signal: AbortSignal.timeout(20000) });
    if (!scan.ok || !metadata?.file_path) return scan.ok;
    const body = { file_path: metadata.file_path };
    for (const key of CACHE_FIELDS) if (key in metadata) body[key] = metadata[key];
    const save = await fetch(new URL('/api/lm/loras/save-metadata', comfyUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    return save.ok;
  } catch {
    return false;
  }
}
