# FFmpeg This - Claude Instructions

## Project Overview

This is a Node.js CLI application that provides an AI-powered web interface for generating FFmpeg commands. Users upload media files and request operations in natural language, receiving specific FFmpeg commands tailored to their files.

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
│   ├── index.html      # Frontend HTML
│   ├── app.js          # Frontend JavaScript
│   └── styles.css      # Frontend styling
└── uploads/            # Uploaded files directory
```

### Technology Stack
- **Backend**: Node.js + Express
- **File Upload**: Multer
- **Storage**: node-persist (cross-platform config directories)
- **AI Providers**: OpenAI, Anthropic, Google Gemini, Groq, DeepSeek, Local LLMs
- **Frontend**: Vanilla JavaScript (no frameworks)

## Key Features

### 1. File-First Workflow
- Users start by uploading any file type (FFmpeg supports many formats)
- After upload, chat interface appears for natural language requests
- All user requests are formatted using a configurable prompt template

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
- Custom prompt template

### 4. FFmpeg Integration
- Requires FFmpeg to be available (blocks app if missing)
- Supports custom FFmpeg path configuration
- Validates FFmpeg availability on startup

## Prompt Template System

### Default Template
```
Can you give me an ffmpeg command running on the input file {FILE_PATH} to {USER_INPUT}?
```

### Variables
- `{FILE_PATH}` - Absolute path to uploaded file
- `{USER_INPUT}` - User's natural language request

### Example Usage
User types: "convert to grayscale"
Sent to AI: "Can you give me an ffmpeg command running on the input file /path/to/video.mp4 to convert to grayscale?"

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

## API Endpoints

### File Operations
- `POST /api/upload` - Upload file via multipart form
- `GET /api/file/:filename` - Get uploaded file info
- `GET /api/preconfigured-file` - Get pre-configured file info

### AI Chat
- `POST /api/chat` - Send message to AI provider
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
- `promptHeader` - Current prompt template
- `ffmpegAvailable` - FFmpeg status

### UI Flow
1. **Initialization**: Check FFmpeg, load settings, check for pre-configured file
2. **File Upload**: Show file selector or skip if pre-configured
3. **Chat Interface**: Natural language input with provider selection
4. **Message Handling**: Template formatting and AI communication

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

### Modifying Prompt Template
- Default template in `src/storage.js`
- Template loading in `public/app.js` loadPersistentSettings()
- Template usage in `public/app.js` sendMessage()
- Variable replacement uses simple `.replace()`

### File Type Support
- Currently accepts all file types (FFmpeg handles validation)
- Multer configuration in `src/routes.js`
- Frontend file input in `public/index.html`

## Troubleshooting

### Common Issues
1. **FFmpeg not found**: Check PATH or configure custom path in settings
2. **File upload fails**: Check file size (500MB limit) and disk space
3. **AI provider errors**: Verify API keys and model availability
4. **Settings not persisting**: Check config directory permissions

### Debug Information
- Server logs provider configurations on startup
- Frontend logs errors to browser console
- FFmpeg status shown in UI when unavailable
- File upload progress shown in UI

## Dependencies

### Runtime Dependencies
- express: Web server framework
- multer: File upload handling
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
