# FFmpeg This

A tool that starts a local web server with an AI chat interface supporting multiple providers.

## Installation

```bash
npm install
```

## Usage

Start the server:
```bash
npm start
# or with pre-configured file
./cli.js --file /path/to/your/video.mp4
```

## Configuration

### Environment Variables

The server automatically reads API keys from environment variables on startup:
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

Only providers with configured API keys will appear in the chat dropdown.

## FFmpeg Integration

FFmpeg is bundled with the application via ffmpeg-static, so no installation is required.

## Persistent Settings

The app saves certain settings persistently to your config directory:
- **macOS**: `~/Library/Application Support/ffmpeg-this/`
- **Linux**: `$XDG_CONFIG_HOME/ffmpeg-this/` or `~/.config/ffmpeg-this/`
- **Windows**: `%APPDATA%/ffmpeg-this/`

## TODO
I only tested: openai and anthropic.
