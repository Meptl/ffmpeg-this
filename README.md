# FFmpeg This

A CLI tool that starts a local web server with an AI chat interface supporting multiple providers.

## Installation

```bash
npm install
```

## Usage

Start the server:
```bash
npm start
# or
./cli.js
# or with custom port
./cli.js --port 8080
# or without auto-opening browser
./cli.js --no-open
# or with pre-configured file
./cli.js --file /path/to/your/video.mp4
```

## Features

- **File-first workflow**: Upload any file type and get FFmpeg commands
- **AI-powered FFmpeg assistance**: Ask in natural language for media processing tasks
- **CLI file pre-configuration**: Start with a specific file using `--file` argument
- Chat interface supporting multiple AI providers:
  - OpenAI (GPT-4, etc.)
  - Anthropic (Claude)
  - Google Gemini
  - Groq
  - DeepSeek
  - Local LLMs (any OpenAI-compatible endpoint)
- Settings modal to configure API keys
- FFmpeg availability check and custom path configuration
- File upload with support for any file type (FFmpeg handles validation)
- Clean, responsive UI

## How to Use

1. **Start the app**: `npm start` or `./cli.js --file /path/to/file.mp4`
2. **Upload a file**: Choose any file type (FFmpeg supports many formats) or skip if using `--file`
3. **Ask for help**: Type what you want to do, e.g.:
   - "convert to grayscale"
   - "reduce file size"
   - "extract audio"
   - "add subtitles" 
   - "create a gif"
   - "change format to mp4"
   - "compress video"
4. **Get FFmpeg commands**: The AI will provide FFmpeg commands specific to your file

## Customization

### Prompt Template
You can customize how requests are sent to the AI by modifying the prompt template in Settings. The default template is:

```
Can you give me an ffmpeg command running on the input file {FILE_PATH} to {USER_INPUT}?
```

Available variables:
- `{FILE_PATH}` - Path to the uploaded file
- `{USER_INPUT}` - What the user typed (e.g., "convert to grayscale")

Example custom template:
```
Please provide an FFmpeg command to process {FILE_PATH} and {USER_INPUT}. Include explanation of the command parameters.
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

### Web Interface

Click the Settings button to configure API keys for each provider. Local LLM support includes:
- Custom endpoint URL
- Optional API key
- Custom headers (JSON format)

Only providers with configured API keys will appear in the chat dropdown.

## FFmpeg Integration

The app requires FFmpeg to function and will block usage if FFmpeg is not found. You can:
- Install FFmpeg system-wide and ensure it's in your PATH
- Configure a custom FFmpeg path in the Settings (persistently saved)

Future features will integrate FFmpeg commands through the chat interface.

## Persistent Settings

The app saves certain settings persistently to your config directory:
- **macOS**: `~/Library/Application Support/ffmpeg-this/`
- **Linux**: `$XDG_CONFIG_HOME/ffmpeg-this/` or `~/.config/ffmpeg-this/`
- **Windows**: `%APPDATA%/ffmpeg-this/`

Currently saved settings:
- FFmpeg executable path
- Custom prompt template for AI requests
