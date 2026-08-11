import json
import os
import sys

from faster_whisper import WhisperModel


def send(payload):
    print(json.dumps(payload, ensure_ascii=False), flush=True)


model_name = os.environ.get("CODEX_CLIPPY_WHISPER_MODEL", "base")
model = WhisperModel(model_name, device="cpu", compute_type="int8")

for raw_line in sys.stdin:
    request = {}
    try:
        request = json.loads(raw_line)
        segments, info = model.transcribe(
            request["path"],
            beam_size=5,
            vad_filter=True,
            condition_on_previous_text=False,
        )
        text = " ".join(segment.text.strip() for segment in segments).strip()
        send({
            "id": request["id"],
            "result": {
                "text": text,
                "language": info.language,
                "languageProbability": info.language_probability,
                "model": model_name,
            },
        })
    except Exception as error:
        send({"id": request.get("id"), "error": str(error)})
