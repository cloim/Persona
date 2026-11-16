export const TRAINING_MODELS = [
  { id: 'flux1dev', label: 'FLUX.1 dev', alias: 'Flux1.D', checkpoint: 'black-forest-labs/FLUX.1-dev', arch: 'flux', resolution: [512], timestep: 'sigmoid', rank: 8, steps: 1000, guidance: 4, sampleSteps: 20, vram: 'Modal A10G 24GB 가속', url: 'https://huggingface.co/black-forest-labs/FLUX.1-dev', note: 'Hugging Face에서 FLUX.1 dev 이용 조건을 확인하고 접근 권한(HF_TOKEN)을 준비해 주세요' },
  { id: 'krea2', label: 'Krea 2 Raw', alias: 'Krea2', checkpoint: 'krea/Krea-2-Raw', arch: 'krea2', resolution: [512], timestep: 'linear', rank: 8, steps: 1000, guidance: 3.5, sampleSteps: 28, vram: 'Modal A10G 24GB 가속', url: 'https://huggingface.co/krea/Krea-2-Raw', note: '학습용 Raw 체크포인트를 사용해요. Krea 2 Community License 동의와 HF_TOKEN을 준비해 주세요' },
  { id: 'qwen21', label: 'Qwen-Image-2.1', alias: 'Qwen2.1', checkpoint: 'Comfy-Org/Qwen-Image-2.1', arch: 'qwen_image_2', resolution: [512], timestep: 'shift', rank: 8, steps: 1000, guidance: 3, sampleSteps: 28, vram: 'Modal A10G 24GB 가속', url: 'https://huggingface.co/Qwen/Qwen-Image-2.1', note: 'AI Toolkit 전용 Comfy-Org 체크포인트와 convrotint4 가속 설정을 사용해요. 캐릭터 학습은 T2I 방식이에요' },
  { id: 'moss', label: 'MOSS-Image', alias: 'MOSS', checkpoint: 'OpenMOSS-Team/MOSS-Image-Base', arch: 'moss_image', resolution: [512], timestep: 'flowmatch', rank: 8, steps: 1000, guidance: 3, sampleSteps: 28, vram: 'Modal A10G 24GB 가속', url: 'https://huggingface.co/OpenMOSS-Team/MOSS-Image-Base', note: 'OpenMOSS의 5B DiT 모델이에요. 긴 프롬프트와 텍스트 렌더링에 강점이 있으며 Base 체크포인트를 사용해요' },
];
export const TRAINING_TARGETS = [
  { id: 'modal-a10g', label: 'Modal Cloud (A10G 24GB)', trainable: true, note: 'NVIDIA A10G 24GB GPU와 32GB RAM 환경에서 고속 LoRA 학습을 원클릭으로 자동 실행해요' },
];
export function trainingTarget(training) {
  const targetId = (training?.target === 't4' || training?.target === 'tpu-v5e-1') ? 'modal-a10g' : (training?.target ?? 'modal-a10g');
  const target = TRAINING_TARGETS.find(t => t.id === targetId);
  if (!target) throw new Error('학습 실행 대상을 확인해 주세요');
  return target;
}
export function selectTrainingTarget(project, target) {
  const t = TRAINING_TARGETS.find(item => item.id === target) || TRAINING_TARGETS[0];
  return { training: { ...project.training, target: t.id, rank: Math.min(Number(project.training.rank) || 8, 8) } };
}
export function trainingModel(id) {
  const model = TRAINING_MODELS.find(m => m.id === id);
  if (!model) throw new Error('FLUX.1 dev, Krea 2 Raw, Qwen-Image-2.1, MOSS-Image 중 학습 베이스를 선택해 주세요');
  return model;
}
export function defaultTraining(id = 'flux1dev', target = 'modal-a10g') {
  const model = trainingModel(id);
  return { target, steps: 1000, rank: 8, learningRate: '0.0001', checkpoint: model.checkpoint };
}
export function selectTrainingModel(project, id) {
  return { model: id, training: defaultTraining(id, project.training?.target || 'modal-a10g'), previousTraining: project.previousTraining || { model: project.model, training: { ...project.training } } };
}
export function migrateTraining(project) {
  if (TRAINING_MODELS.some(m => m.id === project.model)) {
    const currentTarget = project.training?.target;
    const target = currentTarget === 't4' || currentTarget === 'tpu-v5e-1' ? 'modal-a10g' : (currentTarget || 'modal-a10g');
    return { ...project, training: { ...project.training, target, rank: Math.min(Number(project.training?.rank) || 8, 8) }, previousTraining: project.previousTraining || { model: project.model, training: { ...project.training } } };
  }
  if (!['sdxl', 'sd15'].includes(project.model)) throw new Error('지원하는 학습 베이스를 확인해 주세요');
  return { ...project, previousTraining: { model: project.model, training: { ...project.training } }, model: 'flux1dev', training: defaultTraining(), updatedAt: Date.now() };
}
export function trainingConfig(project) {
  const profile = trainingModel(project.model), t = project.training || {};
  if (!Number.isInteger(Number(t.steps)) || t.steps < 100 || t.steps > 10000 || ![4, 8].includes(Number(t.rank)) || !(Number(t.learningRate) > 0 && Number(t.learningRate) <= 0.01) || typeof t.checkpoint !== 'string' || !t.checkpoint.trim()) {
    throw new Error('학습 스텝, rank 4 또는 8, 학습률과 체크포인트를 확인해 주세요');
  }
  const model = { name_or_path: t.checkpoint.trim(), arch: profile.arch, quantize: true, quantize_te: true, low_vram: true };
  if (profile.id === 'flux1dev') model.is_flux = true;
  Object.assign(model, { qtype: 'convrotint4', qtype_te: 'convrotint4', vae_dtype: 'float32' });
  if (profile.id === 'qwen21') Object.assign(model, { model_kwargs: { rgba: false } });
  if (profile.id === 'krea2') Object.assign(model, { model_kwargs: { max_text_length: 256 } });
  if (profile.id === 'moss') Object.assign(model, { model_kwargs: { uncond_skip_layers: [22] } });
  const name = project.trigger.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'character';
  return {
    job: 'extension',
    config: {
      name,
      process: [{
        type: 'sd_trainer',
        training_folder: '/root/output',
        device: 'cuda:0',
        trigger_word: project.trigger,
        network: { type: 'lora', linear: Number(t.rank), linear_alpha: Number(t.rank) },
        save: { dtype: 'float16', save_every: 250, max_step_saves_to_keep: 2, push_to_hub: false },
        datasets: [{ folder_path: '/root/dataset', caption_ext: 'txt', caption_dropout_rate: 0.05, shuffle_tokens: false, cache_latents_to_disk: true, cache_text_embeddings: true, resolution: [512] }],
        train: { batch_size: 1, steps: Number(t.steps), gradient_accumulation_steps: 4, train_unet: true, train_text_encoder: false, gradient_checkpointing: true, cache_text_embeddings: true, unload_text_encoder: true, noise_scheduler: 'flowmatch', timestep_type: profile.timestep, optimizer: 'adamw8bit', lr: Number(t.learningRate), dtype: 'float16', disable_sampling: true },
        model,
        sample: { sampler: 'flowmatch', sample_every: 250, width: 512, height: 512, prompts: [`${project.trigger}, a portrait in soft daylight`], seed: 42, walk_seed: false, guidance_scale: profile.guidance, sample_steps: profile.sampleSteps },
      }],
    },
    meta: { name: '[name]', version: '1.0' },
  };
}

export function trainingValid(project) {
  const t = project.training || {};
  return t.steps >= 100 && t.steps <= 10000 && [4, 8].includes(Number(t.rank)) && Number(t.learningRate) > 0 && Number(t.learningRate) <= 0.01 && typeof t.checkpoint === 'string' && t.checkpoint.trim().length > 2;
}
