#!/usr/bin/env python3
# pyright: reportMissingImports=false
"""
Transcription script using faster-whisper
Outputs JSON to stdout, progress to stderr
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Optional

try:
    from faster_whisper import WhisperModel
except ImportError:
    print(
        "ERROR: faster-whisper not installed. Run: pip install faster-whisper",
        file=sys.stderr,
    )
    sys.exit(1)


def emit_progress(percent: int, status: str):
    """Emit progress message to stderr"""
    progress = {"percent": percent, "status": status}
    print(f"PROGRESS:{json.dumps(progress)}", file=sys.stderr)
    sys.stderr.flush()


def transcribe(
    audio_path: str,
    model_name: str = "base",
    language: Optional[str] = None,
    compute_type: str = "int8",
    device: str = "auto",
    word_timestamps: bool = False,
) -> dict:
    """
    Transcribe audio file using faster-whisper

    Returns:
        dict with keys: text, language, duration, segments
    """
    emit_progress(0, "Loading model...")

    # Load model
    model = WhisperModel(model_name, compute_type=compute_type, device=device)

    emit_progress(10, "Transcribing...")

    # Transcribe
    segments, info = model.transcribe(
        audio_path,
        language=language,
        task="transcribe",
        condition_on_previous_text=True,
        word_timestamps=word_timestamps,
    )

    # Collect segments
    segments_list = []
    full_text_parts = []

    # Convert generator to list to get total count
    segments = list(segments)
    total_segments = len(segments)

    for i, segment in enumerate(segments):
        segments_list.append(
            {
                "id": i,
                "start": segment.start,
                "end": segment.end,
                "text": segment.text.strip(),
            }
        )

        if word_timestamps and getattr(segment, "words", None):
            segments_list[-1]["words"] = [
                {
                    "word": word.word,
                    "start": word.start,
                    "end": word.end,
                    "probability": word.probability,
                }
                for word in segment.words
                if word.word is not None
                and word.start is not None
                and word.end is not None
            ]

        full_text_parts.append(segment.text.strip())

        # Emit progress (10% to 90%)
        if total_segments > 0:
            progress = 10 + int((i / total_segments) * 80)
            emit_progress(progress, f"Processing segment {i + 1}/{total_segments}...")

    emit_progress(90, "Finalizing...")

    result = {
        "text": " ".join(full_text_parts),
        "language": info.language,
        "duration": info.duration,
        "segments": segments_list,
    }

    emit_progress(100, "Complete")

    return result


def main():
    parser = argparse.ArgumentParser(description="Transcribe audio using Whisper")
    parser.add_argument("--audio", required=True, help="Path to audio file")
    parser.add_argument(
        "--model",
        default="base",
        choices=["tiny", "base", "small", "medium"],
        help="Whisper model to use (default: base)",
    )
    parser.add_argument(
        "--language", default=None, help="Language code (auto-detect if not specified)"
    )
    parser.add_argument(
        "--compute-type",
        default="int8",
        choices=["int8", "float16"],
        help="Compute type (default: int8)",
    )
    parser.add_argument(
        "--device",
        default="auto",
        choices=["auto", "cpu", "cuda"],
        help="Execution device (default: auto)",
    )
    parser.add_argument(
        "--output-format",
        default="json",
        choices=["json"],
        help="Output format (only json supported)",
    )
    parser.add_argument(
        "--word-timestamps",
        action="store_true",
        help="Include word-level timestamps in each segment",
    )

    args = parser.parse_args()

    # Validate audio file exists
    audio_path = Path(args.audio)
    if not audio_path.exists():
        print(f"ERROR: Audio file not found: {args.audio}", file=sys.stderr)
        sys.exit(1)

    try:
        result = transcribe(
            audio_path=str(audio_path),
            model_name=args.model,
            language=args.language,
            compute_type=args.compute_type,
            device=args.device,
            word_timestamps=args.word_timestamps,
        )
    except RuntimeError as e:
        print(f"ERROR: Transcription failed (runtime error): {e}", file=sys.stderr)
        sys.exit(1)
    except ValueError as e:
        print(f"ERROR: Transcription failed (invalid parameter): {e}", file=sys.stderr)
        sys.exit(1)

    # Output JSON to stdout (separate try for serialization errors)
    try:
        print(json.dumps(result))
    except (TypeError, ValueError) as e:
        print(
            f"ERROR: Transcription failed (serialization error): {e}", file=sys.stderr
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
