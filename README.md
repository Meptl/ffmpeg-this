# FFmpeg-this

A chat interface to run ffmpeg commands.

https://github.com/user-attachments/assets/16d435b6-1dec-4482-88b8-e93d47ba5018

Note that this does in fact run scripts provided by a blackbox.

## Installation

### Executable
See the executables in the releases page.

### Local
```
git submodule update --init --recursive
npm prepare-ffmpeg
npm install
npm run dev
```

## Configuration

### Environment Variables

The app automatically reads API keys from environment variables on startup:
- `OPENAI_API_KEY` - OpenAI API key
- `ANTHROPIC_API_KEY` - Anthropic (Claude) API key
- `GEMINI_API_KEY` or `GOOGLE_API_KEY` - Google Gemini API key
- `GROQ_API_KEY` - Groq API key
- `DEEPSEEK_API_KEY` - DeepSeek API key
- `LOCAL_LLM_ENDPOINT` or `OLLAMA_API_BASE` - Local LLM endpoint URL
- `LOCAL_LLM_API_KEY` - Local LLM API key (optional)

You can also set custom models via environment variables:
- `OPENAI_MODEL` (default: gpt-4-turbo-preview)
- `ANTHROPIC_MODEL` (default: claude-3-opus-20240229)
- `GEMINI_MODEL` (default: gemini-pro)
- `GROQ_MODEL` (default: mixtral-8x7b-32768)
- `DEEPSEEK_MODEL` (default: deepseek-chat)
- `LOCAL_LLM_MODEL`

## Notes
We are including ffmpeg-static as a submodule because ffprobe-static includes
all architecture executables.
See https://github.com/eugeneware/ffmpeg-static/issues/19


## TODO
I only tested: openai and anthropic.
