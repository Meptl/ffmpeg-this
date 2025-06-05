# FFmpeg This - Claude Instructions

## Project Overview

This is a Node.js CLI application that provides an AI-powered web interface for generating structured FFmpeg commands. Users specify file paths directly and request operations in natural language, receiving JSON-formatted FFmpeg commands with automatic file chaining for multi-step operations.

## Core Architecture

### File Structure
```
ffmpeg-this/
├── cli.js              # Main CLI entry point
├── package.json        # Dependencies and scripts
├── src/
│   ├── routes.js       # Express API routes and file handling
│   └── storage.js      # Persistent storage (config directory)
├── public/
│   ├── index.html      # Frontend HTML with tabbed settings
│   ├── app.js          # Frontend JavaScript
│   └── styles.css      # Frontend styling
└── /tmp/ffmpeg-this/   # Temporary files for chained operations
```

### Technology Stack
- **Backend**: Node.js + Express
- **File Access**: Direct file system access
- **Storage**: node-persist (cross-platform config directories)
- **AI Providers**: OpenAI, Anthropic, Google Gemini, Groq, DeepSeek, Local LLMs
- **Frontend**: Vanilla JavaScript (no frameworks)

## Key Features

### 1. Structured JSON Workflow
- Users specify file paths directly (no upload required)
- All requests use structured JSON format with placeholder substitution
- Automatic file chaining for multi-step operations
- Raw JSON message display with clean substitution strings
- Server-side path substitution for security and clarity

### 2. AI Provider Support
Multiple AI providers with environment variable configuration:
- OpenAI: `OPENAI_API_KEY`, `OPENAI_MODEL`
- Anthropic: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`
- Google Gemini: `GEMINI_API_KEY`, `GEMINI_MODEL`
- Groq: `GROQ_API_KEY`, `GROQ_MODEL`
- DeepSeek: `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`
- Local LLM: `LOCAL_LLM_ENDPOINT`, `LOCAL_LLM_API_KEY`

### 3. Persistent Settings
Saved to OS-appropriate config directories:
- **macOS**: `~/Library/Application Support/ffmpeg-this/`
- **Linux**: `$XDG_CONFIG_HOME/ffmpeg-this/` or `~/.config/ffmpeg-this/`
- **Windows**: `%APPDATA%/ffmpeg-this/`

Currently persisted:
- FFmpeg executable path
- System prompt (JSON format instructions)
- JSON template for user requests

### 4. Session-Based File Tracking
- Tracks input/output file chain per session
- Automatic temporary file generation
- Seamless multi-step operation support

### 5. FFmpeg Integration
- Requires FFmpeg to be available (blocks app if missing)
- Supports custom FFmpeg path configuration
- Validates FFmpeg availability on startup

## Structured JSON System

### System Prompt (Configurable)
Defines JSON format and rules for AI responses:
```
You are an FFmpeg command generator.
The user will ask you a series of operations to perform.

These will be in this exact JSON format:
{
  "input_file": "{INPUT_FILE}",
  "output_file": "{OUTPUT_FILE}", 
  "operation": "description of what to do"
}

For every response, you must provide output in this exact JSON format:
{
  "command": "complete ffmpeg command using {INPUT_FILE} and {OUTPUT_FILE} placeholders",
  "output_file": "{OUTPUT_FILE}",
  "error": null | "some issue"
}

Rules:
- Use {INPUT_FILE} and {OUTPUT_FILE} as placeholders in your ffmpeg commands
- Do NOT use actual file paths - only use the placeholder strings
- The system will handle file path substitution automatically
```

### JSON Template (Configurable)
```
{
  "input_file": "{INPUT_FILE}",
  "output_file": "{OUTPUT_FILE}",
  "operation": "{USER_INPUT}"
}
```

### Substitution System
- **Frontend Display**: Shows clean placeholder strings like `{INPUT_FILE}` and `{OUTPUT_FILE}`
- **Server Processing**: Substitutes actual file paths when communicating with AI
- **AI Response**: Contains placeholder strings for clean display
- **Execution**: Server substitutes real paths for actual FFmpeg execution

### Example Usage
User types: "convert to grayscale"

**Displayed to User (Raw JSON):**
```json
{
  "input_file": "{INPUT_FILE}",
  "output_file": "{OUTPUT_FILE}",
  "operation": "convert to grayscale"
}
```

**Sent to AI (with actual paths):**
```json
{
  "input_file": "/path/to/video.mp4",
  "output_file": "/tmp/ffmpeg-this/ffmpeg_12345_abc123.tmp",
  "operation": "convert to grayscale"
}
```

**AI Response (with placeholders):**
```json
{
  "command": "ffmpeg -i {INPUT_FILE} -vf format=gray {OUTPUT_FILE}",
  "output_file": "{OUTPUT_FILE}",
  "error": null
}
```

## CLI Usage

### Basic Usage
```bash
npm start                    # Start on port 3000, open browser
./cli.js --port 8080        # Custom port
./cli.js --no-open          # Don't open browser
./cli.js --file video.mp4   # Pre-configure with file
```

### Pre-configured Files
When `--file` is used:
- File info is validated and stored globally
- Frontend skips upload step and goes directly to chat
- File path is resolved to absolute path
- Sets initial input file for session tracking

## API Endpoints

### File Operations
- `POST /api/set-file-path` - Set file path for processing (validates file existence)
- `POST /api/file-info` - Get file information by path
- `GET /api/preconfigured-file` - Get pre-configured file info

### AI Chat
- `POST /api/chat` - Send structured message to AI provider (always JSON mode)
- `GET /api/configured-providers` - Get available AI providers

### Settings
- `GET /api/config` - Get AI provider configurations (masked keys)
- `POST /api/config` - Update AI provider configurations
- `GET /api/settings` - Get persistent settings
- `POST /api/settings` - Update persistent settings

### System
- `GET /api/ffmpeg-status` - Check FFmpeg availability

## Frontend State Management

### Global State Variables
- `currentFile` - Currently selected file object
- `currentProvider` - Selected AI provider
- `configuredProviders` - Available AI providers
- `systemPrompt` - System prompt for JSON format
- `jsonTemplate` - Template for formatting user requests
- `showRawMessages` - Flag to show raw JSON vs structured display
- `ffmpegAvailable` - FFmpeg status

### UI Flow
1. **Initialization**: Check FFmpeg, load settings, check for pre-configured file
2. **File Path Entry**: User enters file path, system validates existence
3. **Chat Interface**: Natural language input with provider selection
4. **Message Handling**: Placeholder-based JSON formatting with server-side path substitution

### Settings Interface
- **Tabbed Modal**: Backend, FFmpeg, and Prompt tabs
- **Backend Tab**: All AI provider configurations
- **FFmpeg Tab**: FFmpeg path settings
- **Prompt Tab**: System prompt, JSON template, display options

## Development Guidelines

### Code Style
- Use async/await for promises
- Prefer const/let over var
- Use template literals for string interpolation
- Keep functions focused and small

### Error Handling
- Always wrap async operations in try/catch
- Provide user-friendly error messages
- Log errors to console for debugging
- Fail gracefully (don't crash the app)

### Security Considerations
- API keys are session-only in web interface
- File uploads have size limits (500MB)
- File paths are resolved to prevent directory traversal
- Environment variables for persistent API keys

### Testing
- Test with various file types
- Verify AI provider integrations
- Test FFmpeg path detection
- Check cross-platform config directory handling

## Common Tasks

### Adding New AI Provider
1. Add to `apiConfigs` in `src/routes.js`
2. Add case in chat endpoint switch statement
3. Add to frontend provider list in `public/index.html`
4. Update provider handling in `public/app.js`
5. Document environment variables

### Modifying JSON System
- Default system prompt and JSON template in `src/storage.js`
- Settings loading in `public/app.js` loadPersistentSettings()
- JSON template usage in `public/app.js` sendMessage()
- Placeholder substitution system with server-side path management
- Session-based file tracking in `src/routes.js`

### File Type Support
- Currently accepts all file types (FFmpeg handles validation)
- Direct file system access - no upload restrictions
- File path validation in `src/routes.js`
- Frontend file path input in `public/index.html`

## Troubleshooting

### Common Issues
1. **FFmpeg not found**: Check PATH or configure custom path in settings
2. **File path invalid**: Check file exists and is accessible to the application
3. **AI provider errors**: Verify API keys and model availability
4. **Settings not persisting**: Check config directory permissions

### Debug Information
- Server logs provider configurations on startup
- Frontend logs errors to browser console
- FFmpeg status shown in UI when unavailable
- File path validation errors displayed in UI
- Session-based file tracking logged server-side
- JSON parsing errors logged with fallback to raw responses
- Placeholder substitution logged for debugging

## Dependencies

### Runtime Dependencies
- express: Web server framework
- node-persist: Cross-platform persistent storage
- cors: Cross-origin resource sharing
- open: Open browser automatically
- commander: CLI argument parsing
- axios: HTTP client for AI APIs
- Provider SDKs: openai, @anthropic-ai/sdk, @google/generative-ai, groq-sdk

### Development Dependencies
- nodemon: Development server with auto-restart

## Environment Variables

All environment variables are optional (fallback to empty strings):

```bash
# AI Provider API Keys
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
GROQ_API_KEY=...
DEEPSEEK_API_KEY=...

# Custom Models (optional)
OPENAI_MODEL=gpt-4-turbo-preview
ANTHROPIC_MODEL=claude-3-opus-20240229
GEMINI_MODEL=gemini-pro
GROQ_MODEL=mixtral-8x7b-32768
DEEPSEEK_MODEL=deepseek-chat

# Local LLM Configuration
LOCAL_LLM_ENDPOINT=http://localhost:8080/v1/chat/completions
LOCAL_LLM_API_KEY=...
LOCAL_LLM_MODEL=...
```

This documentation should provide sufficient context for understanding and modifying the codebase.
