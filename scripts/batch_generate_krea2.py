"""ComfyUI 및 ComfyMUI 기반 범용 Krea 2 LoRA 어셈블 배치 생성 파이프라인.

어떤 캐릭터 LoRA라도 트리거 워드와 LoRA 파일명, 수량을 지정하면 ComfyMUI의 어셈블 카테고리를 무작위 조합하여
다채롭고 고품질인 이미지를 연속 생성하고 로컬로 자동 동기화합니다.

주요 특징:
- ComfyMUI DB 연동: 사용자가 웹 UI에서 설정한 어셈블 카테고리와 속성(의상, 구도, 조명, 표정 등)을 실시간 반영
- 유연한 파라미터 제어: 캐릭터명, LoRA 파일명, 적용 강도, 수량, 해상도, 스텝 등을 CLI 인수로 완전 제어
- 실시간 로컬 동기화: 도커 컨테이너에서 생성된 이미지를 로컬 output 디렉터리로 즉시 복사 및 로그 기록

사용 예시:
  # 기본 OMZ 캐릭터 64장 생성
  python scripts/batch_generate_krea2.py --character omz --count 64

  # 다른 캐릭터 신규 생성 (예: ruby 캐릭터, LoRA 강도 0.8)
  python scripts/batch_generate_krea2.py --character ruby --lora "Krea2/ruby_krea2.safetensors" --strength 0.8 --count 32
"""

import argparse
import json
import os
import random
import sqlite3
import sys
import time
import urllib.request

COMFYUI_HOST = "127.0.0.1:8188"
COMFYUI_URL = f"http://{COMFYUI_HOST}"
DEFAULT_DB_PATH = r"D:\PROJECTS\ComfyMUI\data\comfymui.db"


def load_assemble_elements(db_path: str):
    """Load assemble categories and attributes from ComfyMUI DB or fallback defaults."""
    if os.path.exists(db_path):
        try:
            conn = sqlite3.connect(db_path)
            c = conn.cursor()
            c.execute("SELECT value FROM state WHERE key='cm-prompt-assemble'")
            row = c.fetchone()
            conn.close()
            if row:
                elements = json.loads(row[0])
                if isinstance(elements, list) and len(elements) > 0:
                    return elements
        except Exception as e:
            print(f"[WARN] Failed to load assemble from DB ({e}), using default assemble elements")

    # Fallback to standard 7 categories
    return [
        {
            "id": "wardrobe",
            "name": "의상",
            "attributes": [
                "completely topless", "bare breasts", "visible nipples", "unclad bare chest",
                "ultra-sheer black lace teddy", "see-through white chiffon slip",
                "wet semi-transparent mesh slip", "unbuttoned oversized white shirt",
                "open silk satin robe", "unbuttoned cashmere cardigan",
                "loosely wrapped bath towel", "tight champagne silk slip dress",
                "strappy black leather corset", "tiny lace panties"
            ]
        },
        {
            "id": "composition",
            "name": "구도",
            "attributes": [
                "close-up portrait", "sensual waist-up framing", "dramatic high-angle shot",
                "provocative low-angle perspective", "three-quarter medium shot",
                "rule-of-thirds off-center", "over-the-shoulder angle", "diagonal dutch-angle",
                "eye-level medium close-up", "wide-medium atmospheric framing"
            ]
        },
        {
            "id": "style_pose",
            "name": "스타일/포즈",
            "attributes": [
                "sensual boudoir art photography", "provocative glamour editorial",
                "arched back on silk bedding", "leaning back on velvet chaise",
                "kneeling on satin pillows", "lying on stomach propped on elbows",
                "seductive standing pose by window", "seated on high stool legs crossed",
                "relaxing in steamy bathtub", "tracing neckline before vanity mirror",
                "lounging on plush fur rug"
            ]
        },
        {
            "id": "setting",
            "name": "배경/장소",
            "attributes": [
                "luxury hotel suite bedroom", "penthouse night skyline window",
                "steamy marble bathtub", "cozy fireplace study room",
                "sun-drenched minimalist bedroom", "industrial modern loft",
                "moody private cocktail bar", "vintage vanity dressing room",
                "rainy day window floor cushions", "historic Parisian apartment"
            ]
        },
        {
            "id": "lighting",
            "name": "조명/분위기",
            "attributes": [
                "dramatic chiaroscuro lighting", "deep warm amber bedside lamps",
                "cinematic neon rim lighting", "golden hour sunset rays",
                "flickering candlelight", "diffused morning daylight",
                "warm fireplace glow", "cool blue midnight moonlight",
                "soft vanity bulb bokeh", "Venetian blinds shadow patterns"
            ]
        },
        {
            "id": "expression",
            "name": "표정/시선",
            "attributes": [
                "heavy-lidded bedroom eyes", "biting lower lip softly",
                "moist parted lips with shallow breath", "intense passionate direct gaze",
                "languid teasing smile", "over-the-shoulder smoldering look",
                "dreamy tender bedroom eyes", "fierce hypnotic gaze",
                "tilting head back closed eyes", "playful seductive side-glance"
            ]
        },
        {
            "id": "camera_texture",
            "name": "카메라/질감",
            "attributes": [
                "glistening dewy skin sheen", "fine beads of sweat moisture",
                "water droplets on bare skin", "visible skin pores micro-texture",
                "cinematic shallow depth of field", "creamy smooth background bokeh",
                "authentic 35mm film grain", "sculpted collarbones highlights",
                "wet dark hair clinging to skin", "photorealistic 8k raw photo",
                "50mm f/1.4 prime lens", "85mm f/1.2 portrait lens"
            ]
        }
    ]


def build_assembled_prompt(base_trigger: str, elements: list) -> str:
    """Assemble a random prompt from each category."""
    picked = []
    for elem in elements:
        attrs = elem.get("attributes", [])
        if attrs:
            picked.append(random.choice(attrs))
    random.shuffle(picked)
    return f"{base_trigger}, {', '.join(picked)}"


def create_workflow(
    prompt_text: str,
    seed: int,
    lora_name: str,
    lora_strength: float = 0.85,
    model_name: str = "Krea2/kroma-v0.3.1-turbo-opd-W8A8.safetensors",
    clip_name: str = "Qwen/qwen3vl_4b_fp8_scaled.safetensors",
    vae_name: str = "Qwen/qwen_image_vae.safetensors",
    width: int = 896,
    height: int = 1152,
    steps: int = 8,
    cfg: float = 1.0,
    prefix: str = "batch_krea2/img",
):
    """Build ComfyUI workflow for Krea 2."""
    return {
        "1": {
            "class_type": "UNETLoader",
            "inputs": {
                "unet_name": model_name,
                "weight_dtype": "default"
            }
        },
        "2": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": prompt_text,
                "clip": ["8", 0]
            }
        },
        "3": {
            "class_type": "ConditioningZeroOut",
            "inputs": {
                "conditioning": ["2", 0]
            }
        },
        "4": {
            "class_type": "EmptySD3LatentImage",
            "inputs": {
                "width": width,
                "height": height,
                "batch_size": 1
            }
        },
        "5": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["100", 0],
                "positive": ["2", 0],
                "negative": ["3", 0],
                "latent_image": ["4", 0],
                "seed": seed,
                "steps": steps,
                "cfg": cfg,
                "sampler_name": "euler",
                "scheduler": "simple",
                "denoise": 1.0
            }
        },
        "6": {
            "class_type": "VAEDecode",
            "inputs": {
                "samples": ["5", 0],
                "vae": ["9", 0]
            }
        },
        "7": {
            "class_type": "SaveImage",
            "inputs": {
                "images": ["6", 0],
                "filename_prefix": prefix
            }
        },
        "8": {
            "class_type": "CLIPLoader",
            "inputs": {
                "clip_name": clip_name,
                "type": "krea2"
            }
        },
        "9": {
            "class_type": "VAELoader",
            "inputs": {
                "vae_name": vae_name
            }
        },
        "100": {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {
                "model": ["1", 0],
                "lora_name": lora_name,
                "strength_model": lora_strength
            }
        }
    }


def queue_prompt(prompt_workflow: dict) -> str:
    """Send prompt to ComfyUI API and return prompt_id."""
    data = json.dumps({"prompt": prompt_workflow}).encode("utf-8")
    req = urllib.request.Request(
        f"{COMFYUI_URL}/prompt",
        data=data,
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req) as resp:
        res = json.loads(resp.read().decode("utf-8"))
        return res.get("prompt_id")


def wait_for_prompt(prompt_id: str, timeout: int = 180):
    """Wait for prompt execution to finish."""
    start = time.time()
    while time.time() - start < timeout:
        try:
            with urllib.request.urlopen(f"{COMFYUI_URL}/history/{prompt_id}") as resp:
                hist = json.loads(resp.read().decode("utf-8"))
                if prompt_id in hist:
                    entry = hist[prompt_id]
                    status = entry.get("status", {})
                    if status.get("completed", False):
                        outputs = entry.get("outputs", {})
                        images = outputs.get("7", {}).get("images", [])
                        return True, images
        except Exception:
            pass
        time.sleep(2)
    return False, []


def main():
    parser = argparse.ArgumentParser(description="ComfyUI 범용 Krea 2 LoRA 어셈블 배치 생성기")
    parser.add_argument("--character", type=str, default="omz", help="캐릭터 식별자 (예: omz, ruby)")
    parser.add_argument("--trigger", type=str, default="", help="기본 트리거 프롬프트 문구")
    parser.add_argument("--lora", type=str, default="", help="LoRA 파일명 (예: Krea2/omz_krea2_v2.safetensors)")
    parser.add_argument("--strength", type=float, default=0.85, help="LoRA 적용 강도 (기본값: 0.85)")
    parser.add_argument("--count", type=int, default=64, help="생성할 이미지 총 수량 (기본값: 64)")
    parser.add_argument("--width", type=int, default=896, help="가로 해상도 (기본값: 896)")
    parser.add_argument("--height", type=int, default=1152, help="세로 해상도 (기본값: 1152)")
    parser.add_argument("--steps", type=int, default=8, help="KSampler 스텝 수 (기본값: 8)")
    parser.add_argument("--cfg", type=float, default=1.0, help="CFG 스케일 (기본값: 1.0)")
    parser.add_argument("--model", type=str, default="Krea2/kroma-v0.3.1-turbo-opd-W8A8.safetensors", help="UNET 모델명")
    parser.add_argument("--db-path", type=str, default=DEFAULT_DB_PATH, help="ComfyMUI DB 경로")
    parser.add_argument("--output-dir", type=str, default="", help="로컬 저장 경로")
    args = parser.parse_args()

    # 파라미터 보정
    chara = args.character
    trigger = args.trigger if args.trigger else f"{chara}, a sensual seductive photo of a Korean curvy woman"
    
    if args.lora:
        lora_name = args.lora
    else:
        # 자동 탐색: v2 또는 일반 이름
        lora_name = f"Krea2/{chara}_krea2_v2.safetensors"

    prefix = f"{chara}_krea2/img"
    local_dir = args.output_dir if args.output_dir else rf"D:\PROJECTS\Persona\output\batch_{chara}"
    os.makedirs(local_dir, exist_ok=True)

    print("=== [ComfyUI 범용 Krea 2 LoRA 어셈블 배치 생성기] ===")
    print(f"  캐릭터: {chara}")
    print(f"  LoRA: {lora_name} (강도: {args.strength})")
    print(f"  트리거: {trigger}")
    print(f"  목표 수량: {args.count}장 | 해상도: {args.width}x{args.height} | {args.steps}스텝 (CFG {args.cfg})")
    print(f"  로컬 저장 위치: {local_dir}")

    elements = load_assemble_elements(args.db_path)
    print(f"어셈블 카테고리 로드 완료: {len(elements)}개 카테고리")

    log_records = []
    success_count = 0

    for idx in range(1, args.count + 1):
        prompt_text = build_assembled_prompt(trigger, elements)
        seed = random.randint(100000000000, 999999999999)
        workflow = create_workflow(
            prompt_text=prompt_text,
            seed=seed,
            lora_name=lora_name,
            lora_strength=args.strength,
            model_name=args.model,
            width=args.width,
            height=args.height,
            steps=args.steps,
            cfg=args.cfg,
            prefix=prefix,
        )

        print(f"\n[{idx}/{args.count}] 큐 등록 중 (seed: {seed})...")
        print(f"  프롬프트: {prompt_text[:90]}...")

        try:
            prompt_id = queue_prompt(workflow)
            if not prompt_id:
                print(f"  [ERROR] #{idx} 큐 등록 실패")
                continue

            t0 = time.time()
            ok, images = wait_for_prompt(prompt_id)
            elapsed = time.time() - t0

            if ok:
                success_count += 1
                img_names = [img.get("filename") for img in images]
                print(f"  [성공] 생성 소요 시간: {elapsed:.1f}초 -> {img_names}")

                # 도커 컨테이너에서 로컬로 실시간 복사
                for fname in img_names:
                    try:
                        os.system(f'docker cp "comfymui-comfyui:/data/output/{chara}_krea2/{fname}" "{local_dir}\\{fname}" >nul 2>&1')
                    except Exception:
                        pass

                record = {
                    "index": idx,
                    "prompt_id": prompt_id,
                    "seed": seed,
                    "prompt": prompt_text,
                    "images": img_names,
                    "elapsed": round(elapsed, 1),
                }
                log_records.append(record)

                # 실시간 진행 상황 파일 저장
                status_file = os.path.join(local_dir, "batch_status.json")
                try:
                    with open(status_file, "w", encoding="utf-8") as sf:
                        json.dump({
                            "current": idx,
                            "total": args.count,
                            "success": success_count,
                            "percent": round(success_count / args.count * 100, 1),
                            "latest_image": img_names,
                            "latest_prompt": prompt_text,
                        }, sf, indent=2, ensure_ascii=False)
                except Exception:
                    pass
            else:
                print(f"  [경고] #{idx} 생성 시간 초과 또는 실패")
        except Exception as e:
            print(f"  [예외] #{idx} 실행 오류: {e}")

    # 전체 로그 파일 저장
    out_json = os.path.join(local_dir, "assembled_prompts_log.json")
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(log_records, f, indent=2, ensure_ascii=False)

    print(f"\n=== 배치 생성 완료: {success_count}/{args.count}장 성공 ===")
    print(f"  결과 폴더: {local_dir}")
    print(f"  상세 로그: {out_json}")


if __name__ == "__main__":
    main()
