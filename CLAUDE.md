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
- **AI Providers**: `src/services/ai-providers/` - Modular AI provider system with factory pattern
- **FFmpeg Service**: `src/services/ffmpeg/` - Modular FFmpeg functionality (command execution, metadata extraction, region calculation)

### Frontend (Vanilla JS)
- Single-page application in `public/` directory
- `public/app.js` handles chat interface, file uploads, and FFmpeg execution

## Key Components

### File Management System
- Uses OS temp directory for uploads and outputs
- Session-based file tracking (IP + User-Agent)
- Automatic output chaining (output becomes next input)
- Supports 500MB file size limit

### AI Provider Service (`src/services/ai-providers/`)
A modular system for managing different AI providers with a unified interface:

#### Components:
- **Base Provider** (`base-provider.js`): Abstract base class defining the provider interface
- **Provider Implementations**: Individual provider classes (OpenAI, Anthropic, Gemini, Groq, DeepSeek, Local LLM)
- **Factory** (`index.js`): AIProviderFactory for creating and managing provider instances

#### Key Features:
- Unified `chat()` interface across all providers
- Automatic configuration from environment variables
- Provider validation and health checking
- Consistent error handling across providers
- Parameter name normalization (e.g., `maxTokens` → `max_tokens` for OpenAI)

#### Usage:
```javascript
const { AIProviderFactory } = require('./services/ai-providers');

// Get provider with config
const provider = await AIProviderFactory.getProvider('openai', {
  apiKey: 'your-key',
  model: 'gpt-4'
});

// Use provider
const response = await provider.chat(messages, {
  temperature: 0.7,
  maxTokens: 1000
});
```

### AI Integration (`src/routes.js`)
- Uses the AI Provider Service for all LLM interactions
- Structured JSON communication protocol
- Environment variable configuration with fallback to UI settings
- System prompt for consistent FFmpeg command generation

### FFmpeg Service (`src/services/ffmpeg/`)
A modular system for handling all FFmpeg-related operations:

#### Components:
- **Command Executor** (`command-executor.js`): Handles FFmpeg process execution, cancellation, and availability checking
- **Metadata Extractor** (`metadata-extractor.js`): Extracts video metadata including dimensions, rotation, and full media information
- **Region Calculator** (`region-calculator.js`): Handles coordinate transformations for crop regions considering video rotation
- **Main Service** (`index.js`): Unified interface combining all FFmpeg functionality

#### Key Features:
- Process spawning with real-time output streaming
- Cancellable executions with configurable timeout (default 60 seconds)
- Custom FFmpeg path support via persistent settings
- Placeholder system using `{INPUT_FILE}` and `{OUTPUT_FILE}` for safety
- Automatic rotation detection and coordinate transformation
- Support for 90°, -90°, 180° rotations with accurate crop calculations

#### Usage:
```javascript
const ffmpegService = require('./services/ffmpeg');

// Execute command
const result = await ffmpegService.execute({
  command: 'ffmpeg -i {INPUT_FILE} -c:v libx264 {OUTPUT_FILE}',
  ffmpegPath: '/usr/local/bin/ffmpeg',
  inputFile: 'input.mp4',
  outputFile: 'output.mp4',
  executionId: 'unique-id'
});

// Get media dimensions with rotation
const dimensions = await ffmpegService.getMediaDimensions('video.mp4', 'ffprobe');

// Calculate crop region from UI selection
const region = await ffmpegService.calculateRegionFromDisplay(
  displayRegion,
  'video.mp4',
  'ffprobe'
);
```

### Advanced Video Features
- Region selection UI for crop operations in `public/app.js`
- Automatic handling of rotated video metadata
- Coordinate transformation between display and stored video frames

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
- The FFmpeg service provides a clean separation of concerns for all FFmpeg-related operations
- All FFmpeg functionality is now centralized in `src/services/ffmpeg/` for better maintainability
- Please don't use icons/emojis unless asked.
