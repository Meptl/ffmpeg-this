# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**ffmpeg-this** is a CLI tool that provides an AI-powered chat interface for generating FFmpeg commands. Users upload media files and describe desired operations in natural language to get AI-generated FFmpeg commands specific to their file.

## Common Development Commands

```bash
# Development with auto-reload
npm run dev

# Production start
npm start

# Install dependencies
npm install
```

## Architecture

The project uses a client-server architecture:

### Backend (Node.js/Express)
- **Entry Point**: `cli.js` - CLI wrapper using Commander.js
- **Main Server**: Express server with CORS, serves static files from `public/`
- **API Routes**: `src/routes.js` - All API endpoints including file upload, AI chat, FFmpeg execution
- **Storage**: `src/storage.js` - Persistent settings management using platform-specific config directories

### Frontend (Vanilla JS)
- Single-page application in `public/` directory
- `public/app.js` handles chat interface, file uploads, and FFmpeg execution

## Key Components

### File Management System
- Uses OS temp directory for uploads and outputs
- Session-based file tracking (IP + User-Agent)
- Automatic output chaining (output becomes next input)
- Supports 500MB file size limit

### AI Integration (`src/routes.js`)
- Multi-provider support: OpenAI, Anthropic, Google Gemini, Groq, DeepSeek, Local LLMs
- Structured JSON communication protocol
- Environment variable configuration with fallback to UI settings
- Hardcoded system prompt for consistent FFmpeg command generation

### FFmpeg Integration
- Process spawning with real-time output streaming
- Cancellable executions with 60-second timeout
- Custom FFmpeg path support via persistent settings
- Placeholder system using `{INPUT_FILE}` and `{OUTPUT_FILE}` for safety

### Advanced Video Features
- Region selection UI for crop operations in `public/app.js`
- Rotation metadata detection and coordinate transformation
- Support for 90°, -90°, 180° rotations with accurate crop calculations

## Configuration

### Environment Variables
Configure AI providers via environment variables:
- `OPENAI_API_KEY`, `OPENAI_MODEL`
- `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` 
- `GEMINI_API_KEY`/`GOOGLE_API_KEY`, `GEMINI_MODEL`
- `GROQ_API_KEY`, `GROQ_MODEL`
- `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`
- `LOCAL_LLM_ENDPOINT`/`OLLAMA_API_BASE`, `LOCAL_LLM_API_KEY`, `LOCAL_LLM_MODEL`

### Persistent Settings
Stored in platform-specific directories via `src/storage.js`:
- **macOS**: `~/Library/Application Support/ffmpeg-this/`
- **Linux**: `~/.config/ffmpeg-this/`
- **Windows**: `%APPDATA%/ffmpeg-this/`

## Important Implementation Notes

- The system uses IP + User-Agent for simple session identification
- Video rotation handling requires complex coordinate transformation in region calculations
- HTTP range requests are implemented for efficient media streaming
- The AI communication uses structured JSON format for reliable command generation
- FFmpeg commands use placeholder replacement for security
