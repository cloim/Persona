"""Modal 기반 Personas OMZ Krea 2 Raw LoRA 추론(Inference) 파이프라인.

사양:
- GPU: NVIDIA A10G (24GB VRAM)
- 시스템 RAM: 32GB
- 베이스 모델: krea/Krea-2-Raw (12B 파라미터, 4bit convrotint4 양자화)
- 어댑터: 250스텝 체크포인트 (omz_krea2_modal_000000250.safetensors)
- 결과: 로컬 D:/PROJECTS/Personas/output/inference 에 이미지 직접 저장 및 Volume 백업
"""

import os
import sys
from pathlib import Path
import modal

app = modal.App("personas-krea2-inference")

output_volume = modal.Volume.from_name("personas-output", create_if_missing=True)

dataset_dir = Path("D:/PROJECTS/Personas/dataset_omz").resolve()

inference_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git", "libgl1", "libglib2.0-0")
    .pip_install(
        "torch==2.5.1",
        "torchvision==0.20.1",
        "torchaudio==2.5.1",
        extra_index_url="https://download.pytorch.org/whl/cu124",
    )
    .run_commands(
        "git clone --filter=blob:none https://github.com/ostris/ai-toolkit.git /root/ai-toolkit",
        "cd /root/ai-toolkit && git checkout d6a18ad72da9abca3ffb67ea8e42c25764eee61a && git submodule update --init --recursive",
        "pip install -r /root/ai-toolkit/requirements.txt",
    )
    .add_local_dir(str(dataset_dir), remote_path="/root/dataset")
)


@app.function(
    image=inference_image,
    gpu="A10G",
    memory=32768,
    timeout=1800,
    volumes={"/root/output": output_volume},
    secrets=[modal.Secret.from_name("huggingface")],
)
def generate_omz_images():
    import glob
    import os
    from pathlib import Path
    import torch
    from safetensors.torch import load_file

    torch.backends.cuda.enable_flash_sdp(False)
    os.environ["PYTORCH_ALLOC_CONF"] = "expandable_segments:True"

    print("=== Modal 컨테이너 GPU 환경 정보 ===", flush=True)
    gpu_name = torch.cuda.get_device_name(0)
    vram_gb = torch.cuda.get_device_properties(0).total_memory / (1024**3)
    print(f"GPU: {gpu_name} | VRAM: {vram_gb:.1f} GB", flush=True)

    # 1. 호환성 및 VAE 패치 적용
    for f in glob.glob("/root/ai-toolkit/**/*.py", recursive=True):
        p = Path(f)
        text = p.read_text(encoding="utf-8")
        if "-> list[torch.Tensor]:" in text:
            if "import List" not in text and "from typing import" in text:
                text = text.replace("from typing import ", "from typing import List, ")
            elif "import List" not in text:
                text = "from typing import List\n" + text
            text = text.replace("-> list[torch.Tensor]:", "-> List[torch.Tensor]:")
            p.write_text(text, encoding="utf-8")

    for qwen_vae_file in glob.glob("/root/ai-toolkit/**/qwen_image.py", recursive=True):
        p = Path(qwen_vae_file)
        text = p.read_text(encoding="utf-8")
        if "self.vae.encode(images)" in text:
            text = text.replace("self.vae.encode(images)", "self.vae.encode(images.to(self.vae.dtype))")
            p.write_text(text, encoding="utf-8")

    for quant_file in glob.glob("/root/ai-toolkit/**/convrot_quant.py", recursive=True):
        p = Path(quant_file)
        text = p.read_text(encoding="utf-8")
        if "def _unpack_lane(" in text and 'globals()["_unpack_lane"]' not in text:
            target = "            return code.to(tl.int8)\n"
            replacement = target + "    globals()[\"_unpack_lane\"] = _unpack_lane\n"
            if target in text:
                text = text.replace(target, replacement, 1)
                p.write_text(text, encoding="utf-8")

    for mmdit_file in glob.glob("/root/ai-toolkit/**/mmdit.py", recursive=True):
        p = Path(mmdit_file)
        text = p.read_text(encoding="utf-8")
        if "set_priority=True," in text:
            text = text.replace("set_priority=True,", "")
            p.write_text(text, encoding="utf-8")
    print("AI-Toolkit 호환성 패치 완료.", flush=True)

    # 2. AI-Toolkit 모듈 로드
    sys.path.insert(0, "/root/ai-toolkit")
    from toolkit.config_modules import ModelConfig, NetworkConfig, GenerateImageConfig
    from toolkit.util.get_model import get_model_class
    from toolkit.lora_special import LoRASpecialNetwork

    # 3. Krea 2 Raw 모델 설정 및 초기화
    model_config = ModelConfig(
        name_or_path="krea/Krea-2-Raw",
        arch="krea2",
        quantize=True,
        quantize_te=True,
        low_vram=True,
        qtype="convrotint4",
        qtype_te="convrotint4",
        vae_dtype="float32",
        dtype="float16",
        model_kwargs={
            "max_text_length": 256
        }
    )

    print("Krea 2 Raw 모델 인스턴스 초기화 중...", flush=True)
    ModelClass = get_model_class(model_config)
    scheduler = ModelClass.get_train_scheduler()
    sd = ModelClass(
        device="cuda:0",
        model_config=model_config,
        dtype="float16",
        noise_scheduler=scheduler
    )

    print("Krea 2 Raw 베이스 모델 및 가중치 로드 중...", flush=True)
    sd.load_model()
    print("베이스 모델 로드 성공!", flush=True)

    # 4. 250스텝 LoRA 가중치 로드 및 적용
    lora_path = "/root/output/omz_krea2_modal/omz_krea2_modal_000000250.safetensors"
    assert os.path.exists(lora_path), f"LoRA 가중치 파일을 찾을 수 없습니다: {lora_path}"
    print(f"OMZ 250스텝 LoRA 가중치 로드: {lora_path}", flush=True)

    lora_state_dict = load_file(lora_path)
    dim_key = next(k for k in lora_state_dict if k.endswith("lora_A.weight"))
    dim = int(lora_state_dict[dim_key].shape[0])
    print(f"LoRA Rank 감지: {dim}", flush=True)

    # 키 매핑 변환 (diffusion_model. -> transformer.)
    mapped_sd = {}
    for key, value in lora_state_dict.items():
        new_key = key.replace("diffusion_model.", "transformer.")
        mapped_sd[new_key] = value

    network_config = NetworkConfig(
        type="lora",
        linear=dim,
        linear_alpha=dim,
        transformer_only=True
    )
    LoRASpecialNetwork.LORA_PREFIX_UNET = "lora_transformer"
    network = LoRASpecialNetwork(
        text_encoder=None,
        unet=sd.unet,
        lora_dim=dim,
        multiplier=1.0,
        alpha=dim,
        train_unet=True,
        train_text_encoder=False,
        network_config=network_config,
        network_type="lora",
        transformer_only=True,
        is_transformer=True,
        target_lin_modules=sd.target_lora_modules,
    )
    network.apply_to(None, sd.unet, apply_text_encoder=False, apply_unet=True)
    network.force_to("cuda:0", dtype=torch.float16)
    network._update_torch_multiplier()
    network.load_weights(mapped_sd)
    network.eval()
    sd.network = network
    print("OMZ LoRA 어댑터 결합 완료!", flush=True)

    # 5. 추론 테스트 프롬프트 생성
    output_dir = Path("/root/output/inference")
    output_dir.mkdir(parents=True, exist_ok=True)

    prompts = [
        ("omz_portrait_01", "omz, a 3D animated character portrait in soft studio lighting, cute and friendly, highly detailed, 8k", 42),
        ("omz_fullbody_02", "omz, a full body cartoon character smiling cheerfully on a clean white background, vibrant colors", 123),
        ("omz_beach_03", "omz, wearing sunglasses on the sunny beach, vibrant summer day, clear blue sky", 777),
    ]

    image_configs = []
    for filename, prompt_text, seed in prompts:
        out_path = str(output_dir / f"{filename}.png")
        image_configs.append(GenerateImageConfig(
            prompt=prompt_text,
            width=512,
            height=512,
            num_inference_steps=28,
            guidance_scale=3.5,
            output_path=out_path,
            output_ext="png",
            seed=seed
        ))

    print(f"총 {len(image_configs)}장의 이미지 추론 생성을 시작합니다...", flush=True)
    sd.generate_images(image_configs, sampler="flowmatch")
    print("모든 이미지 생성 완료!", flush=True)

    output_volume.commit()
    print("Modal Volume 저장 완료.", flush=True)

    # 생성된 이미지들을 바이트로 패킹하여 로컬로 반환
    results = {}
    for filename, _, _ in prompts:
        img_file = output_dir / f"{filename}.png"
        if img_file.exists():
            results[f"{filename}.png"] = img_file.read_bytes()
            print(f"이미지 회수 준비: {filename}.png ({img_file.stat().st_size / 1024:.1f} KB)", flush=True)

    return results


@app.local_entrypoint()
def main():
    print("Modal A10G 클라우드에서 Krea 2 Raw + OMZ 250스텝 LoRA 추론을 시작합니다...")
    images_dict = generate_omz_images.remote()

    local_out_dir = Path("D:/PROJECTS/Personas/output/inference")
    local_out_dir.mkdir(parents=True, exist_ok=True)

    saved_paths = []
    for filename, img_bytes in images_dict.items():
        save_path = local_out_dir / filename
        save_path.write_bytes(img_bytes)
        print(f"로컬 저장 완료: {save_path} ({len(img_bytes) / 1024:.1f} KB)")
        saved_paths.append(str(save_path))

    print(f"\n총 {len(saved_paths)}장의 OMZ 캐릭터 추론 이미지가 성공적으로 로컬에 확보되었습니다!")
    return saved_paths
