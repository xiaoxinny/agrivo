# Project Structure

```
photo_sampler/          # Main application package
├── sample_frames.py    # CLI entry point and all core logic
├── requirements.txt    # Python dependencies
└── README.md           # Usage documentation
```

- Single-script architecture — all logic lives in `sample_frames.py`
- No package structure (`__init__.py`) — run directly as a script
- Output frames are written to a directory named `frames_<video_stem>/` by default (gitignored)
- Test video files (e.g. `test.mp4`) are gitignored
