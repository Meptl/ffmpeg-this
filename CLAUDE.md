# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ffmpeg-this is a Node.js CLI tool that provides an AI-powered chat interface for generating and executing FFmpeg commands. Users describe media operations in plain English, and the tool generates appropriate FFmpeg commands.

## Key Commands

### Development
```bash
# Install dependencies
npm install

# Run development server with auto-reload
npm run dev

# Start production server
npm start

# Manually start server
node cli.js
```

### FFmpeg Path Configuration
The tool requires FFmpeg to be installed. Set custom FFmpeg path via:
- Environment variable: `FFMPEG_PATH`
- Or through the settings UI in the web interface

## Architecture Overview

### Backend Structure
- **Entry Point**: `cli.js` starts an Express server on port 3232
- **Routes**: `src/routes.js` handles all API endpoints:
  - `/api/chat` - AI chat endpoint for FFmpeg command generation
  - `/api/execute` - FFmpeg command execution with SSE streaming
  - `/api/upload` - File upload handling
  - `/api/settings` - Configuration management

### AI Provider System
Located in `src/services/ai-providers/`:
- **Base Class**: `ai-provider.js` defines the provider interface
- **Implementations**: `openai.js`, `anthropic.js`, `google.js`, `groq.js`, `deepseek.js`, `local.js`
- **Factory**: `index.js` handles provider instantiation based on settings

Each provider requires specific environment variables for API keys:
- OpenAI: `OPENAI_API_KEY`
- Anthropic: `ANTHROPIC_API_KEY`
- Google: `GOOGLE_API_KEY`
- Groq: `GROQ_API_KEY`
- DeepSeek: `DEEPSEEK_API_KEY`

### Frontend Architecture
- **State Management**: `public/js/core/state.js` - Centralized state with observer pattern
- **API Client**: `public/js/services/api.js` - Handles all backend communication
- **UI Components**: Modular components in `public/js/ui/`
- **Main App**: `public/app.js` - Initializes and coordinates components

### Key Features Implementation

1. **FFmpeg Command Generation**:
   - Uses AI to parse natural language requests
   - Generates commands with placeholders like `{{input}}` and `{{output}}`
   - Validates and replaces placeholders before execution

2. **Real-time Output Streaming**:
   - Server-Sent Events (SSE) for streaming FFmpeg output
   - Cancellation support via execution IDs

3. **File Handling**:
   - Session-based file tracking
   - Automatic cleanup of uploaded files
   - Output chaining (previous output becomes next input)

4. **Settings Storage**:
   - Cross-platform persistent storage via `src/storage.js`
   - Stores AI provider selection, API keys, and FFmpeg path

## Development Guidelines

- The project uses vanilla JavaScript (no React/Vue/etc)
- Express.js for the backend API
- No build process - all frontend code is served directly
- File uploads are handled with multer and stored in `uploads/` directory
- Settings are stored in platform-specific locations (see `src/storage.js`)

## Important Notes

- No test suite exists - consider manual testing when making changes
- No linting configuration - follow existing code style
- The web UI is the primary interface; CLI just starts the server
- All AI providers implement the same interface for easy swapping