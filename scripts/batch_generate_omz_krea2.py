import json
import os
import random
import sqlite3
import sys
import time
import urllib.error
import urllib.request

COMFYUI_HOST = "127.0.0.1:8188"
COMFYUI_URL = f"http://{COMFYUI_HOST}"
DB_PATH = r"D:\PROJECTS\ComfyMUI\data\comfymui.db"
TOTAL_IMAGES = 64
PREFIX = "omz_krea2_v2/omz"

def load_assemble_elements():
    """Load assemble categories and attributes from ComfyMUI DB."""
    if os.path.exists(DB_PATH):
        try:
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute("SELECT value FROM state WHERE key='cm-prompt-assemble'")
            row = c.fetchone()
            conn.close()
            if row:
                return json.loads(row[0])
        except Exception as e:
            print(f"[WARN] Failed to load from DB: {e}, falling back to defaults")

    # Fallback to hardcoded defaults
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

def build_assembled_prompt(elements):
    """Assemble a random prompt from each category."""
    base_trigger = "omz, a sensual seductive photo of a Korean curvy woman"
    picked = []
    for elem in elements:
        attrs = elem.get("attributes", [])
        if attrs:
            picked.append(random.choice(attrs))
    random.shuffle(picked)
    return f"{base_trigger}, {', '.join(picked)}"

def create_workflow(prompt_text, seed, lora_strength=0.85):
    """Build ComfyUI workflow matching user's exact configuration."""
    return {
        "1": {
            "class_type": "UNETLoader",
            "inputs": {
                "unet_name": "Krea2/kroma-v0.3.1-turbo-opd-W8A8.safetensors",
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
                "width": 896,
                "height": 1152,
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
                "steps": 8,
                "cfg": 1.0,
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
                "filename_prefix": PREFIX
            }
        },
        "8": {
            "class_type": "CLIPLoader",
            "inputs": {
                "clip_name": "Qwen/qwen3vl_4b_fp8_scaled.safetensors",
                "type": "krea2"
            }
        },
        "9": {
            "class_type": "VAELoader",
            "inputs": {
                "vae_name": "Qwen/qwen_image_vae.safetensors"
            }
        },
        "100": {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {
                "model": ["1", 0],
                "lora_name": "Krea2/omz_krea2_v2.safetensors",
                "strength_model": lora_strength
            }
        }
    }

def queue_prompt(prompt_workflow):
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

def wait_for_prompt(prompt_id, timeout=120):
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
    count = TOTAL_IMAGES
    if len(sys.argv) > 1:
        try:
            count = int(sys.argv[1])
        except ValueError:
            pass

    print(f"=== Krea 2 + OMZ v2 LoRA Assemble Batch Generator (Total: {count}) ===")
    elements = load_assemble_elements()
    print(f"Loaded {len(elements)} assemble categories.")

    log_records = []
    success_count = 0

    for idx in range(1, count + 1):
        prompt_text = build_assembled_prompt(elements)
        seed = random.randint(100000000000, 999999999999)
        workflow = create_workflow(prompt_text, seed)

        print(f"\n[{idx}/{count}] Queuing seed={seed}...")
        print(f"  Prompt: {prompt_text[:100]}...")

        try:
            prompt_id = queue_prompt(workflow)
            if not prompt_id:
                print(f"  [ERR] Failed to get prompt_id for #{idx}")
                continue

            t0 = time.time()
            ok, images = wait_for_prompt(prompt_id)
            elapsed = time.time() - t0

            if ok:
                success_count += 1
                img_names = [img.get("filename") for img in images]
                print(f"  [OK] Completed in {elapsed:.1f}s -> {img_names}")
                
                # Copy from container to local output folder for easy browsing
                local_dir = r"D:\PROJECTS\Personas\output\batch_omz_v2"
                os.makedirs(local_dir, exist_ok=True)
                for fname in img_names:
                    try:
                        os.system(f'docker cp "comfymui-comfyui:/data/output/omz_krea2_v2/{fname}" "{local_dir}\\{fname}" >nul 2>&1')
                    except Exception:
                        pass

                record = {
                    "index": idx,
                    "prompt_id": prompt_id,
                    "seed": seed,
                    "prompt": prompt_text,
                    "images": img_names,
                    "elapsed": round(elapsed, 1)
                }
                log_records.append(record)

                # Real-time status update
                status_file = os.path.join(local_dir, "batch_status.json")
                try:
                    with open(status_file, "w", encoding="utf-8") as sf:
                        json.dump({
                            "current": idx,
                            "total": count,
                            "success": success_count,
                            "percent": round(success_count / count * 100, 1),
                            "latest_image": img_names,
                            "latest_prompt": prompt_text
                        }, sf, indent=2, ensure_ascii=False)
                except Exception:
                    pass
            else:
                print(f"  [WARN] Timed out or failed for #{idx}")
        except Exception as e:
            print(f"  [EXC] Error on #{idx}: {e}")

    # Save log
    os.makedirs(r"D:\PROJECTS\Personas\output\batch_omz_v2", exist_ok=True)
    out_json = r"D:\PROJECTS\Personas\output\batch_omz_v2\assembled_prompts_log.json"
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(log_records, f, indent=2, ensure_ascii=False)

    print(f"\n=== Batch Generation Finished: {success_count}/{count} succeeded ===")
    print(f"Log saved to: {out_json}")

if __name__ == "__main__":
    main()
