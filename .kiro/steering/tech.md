# Tech Stack

- Language: Python 3.8+
- Core library: OpenCV (`opencv-python>=4.5.0`)
- Dependency management: pip with `requirements.txt`
- No test framework currently configured
- No build system — single-script CLI tool

## Common Commands

```bash
# Install dependencies
cd photo_sampler
pip install -r requirements.txt

# Run the tool
python sample_frames.py <video_file> [--fps N] [--output DIR] [--resize WxH]
```

## Code Conventions

- Type hints used throughout (Python 3.10+ union syntax: `tuple[int, int] | None`)
- Docstrings on all public functions (Google-style)
- `pathlib.Path` for all file/directory handling (no raw string paths)
- `argparse` for CLI argument parsing
- Graceful error handling: `RuntimeError` for video issues, `sys.exit(1)` for user-facing errors
- Progress output via `print()` to stdout
