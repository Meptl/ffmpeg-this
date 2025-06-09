const express = require('express');
const router = express.Router();
const multer = require('multer');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const ffmpegService = require('./services/ffmpeg');
const { getAllSettings, setAllSettings } = require('./storage');
const { AIProviderFactory } = require('./services/ai-providers');


// Global variable for pre-configured file
let preConfiguredFile = null;

// Global variable for tracking current input file per session
const sessionFileTracking = new Map(); // sessionId -> currentInputFile


// Create tmp directory for intermediate files and uploads
const tmpDir = path.join(os.tmpdir(), 'ffmpeg-this');
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, tmpDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB limit
});


// Generate unique output filename
function generateOutputFilename(extension = 'out') {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return path.join(tmpDir, `ffmpeg_${timestamp}_${random}.${extension}`);
}

// Get session ID from request (using IP + user agent as simple session identifier)
function getSessionId(req) {
  return Buffer.from(req.ip + req.get('User-Agent')).toString('base64').substring(0, 16);
}

// Set current input file for session
function setCurrentInputFile(sessionId, filePath) {
  sessionFileTracking.set(sessionId, filePath);
}

// Get current input file for session
function getCurrentInputFile(sessionId) {
  return sessionFileTracking.get(sessionId);
}

// Set pre-configured file (called from CLI)
function setPreConfiguredFile(filePath) {
  if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    const resolvedPath = path.resolve(filePath);
    preConfiguredFile = {
      originalName: path.basename(filePath),
      fileName: 'preconfigured',
      filePath: resolvedPath, // Add filePath for media embeds
      path: resolvedPath,
      size: stats.size,
      mimetype: 'application/octet-stream'
    };
    console.log(`✓ Pre-configured file: ${preConfiguredFile.originalName}`);
  } else {
    console.error(`✗ Pre-configured file not found: ${filePath}`);
  }
}

// Initialize API configurations from environment variables
let apiConfigs = {
  openai: { 
    apiKey: process.env.OPENAI_API_KEY || '', 
    model: process.env.OPENAI_MODEL || 'gpt-4-turbo-preview' 
  },
  anthropic: { 
    apiKey: process.env.ANTHROPIC_API_KEY || '', 
    model: process.env.ANTHROPIC_MODEL || 'claude-3-opus-20240229' 
  },
  gemini: { 
    apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '', 
    model: process.env.GEMINI_MODEL || 'gemini-pro' 
  },
  groq: { 
    apiKey: process.env.GROQ_API_KEY || '', 
    model: process.env.GROQ_MODEL || 'mixtral-8x7b-32768' 
  },
  deepseek: { 
    apiKey: process.env.DEEPSEEK_API_KEY || '', 
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat' 
  },
  local: { 
    endpoint: process.env.LOCAL_LLM_ENDPOINT || process.env.OLLAMA_API_BASE || '', 
    apiKey: process.env.LOCAL_LLM_API_KEY || '', 
    headers: {}, 
    model: process.env.LOCAL_LLM_MODEL || '' 
  }
};

// Log which providers are configured (without exposing keys)
console.log('Configured providers:');
const configuredProviders = AIProviderFactory.getConfiguredProviders();
configuredProviders.forEach(provider => {
  console.log(`✓ ${provider.id}`);
});

// Update API configuration
router.post('/config', (req, res) => {
  const { provider, config } = req.body;
  if (apiConfigs[provider]) {
    apiConfigs[provider] = { ...apiConfigs[provider], ...config };
    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'Invalid provider' });
  }
});

// Get current configuration (without sensitive data)
router.get('/config', (req, res) => {
  const safeConfig = {};
  for (const [provider, config] of Object.entries(apiConfigs)) {
    safeConfig[provider] = {
      ...config,
      apiKey: config.apiKey ? '***' : '',
      headers: provider === 'local' ? config.headers : undefined
    };
  }
  res.json(safeConfig);
});

// Get list of configured providers
router.get('/configured-providers', (req, res) => {
  const providers = AIProviderFactory.getConfiguredProviders();
  res.json({ providers });
});


// Chat endpoint
router.post('/chat', async (req, res) => {
  const { provider, message, conversationHistory = [], userInput, preCalculatedRegion } = req.body;
  
  if (!apiConfigs[provider]) {
    return res.status(400).json({ error: 'Invalid provider' });
  }
  
  const config = apiConfigs[provider];
  
  // Validate provider configuration using factory
  try {
    const testProvider = await AIProviderFactory.getProvider(provider, config);
    if (!testProvider.isConfigured()) {
      return res.status(400).json({ error: `${provider} is not properly configured` });
    }
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  
  const sessionId = getSessionId(req);
  
  try {
    // Always use structured mode
    const settings = await getAllSettings();
    const currentInputFile = getCurrentInputFile(sessionId);
    
    if (!currentInputFile) {
      return res.status(400).json({ error: 'No input file set for this session' });
    }
    
    // Generate output filename with temporary extension (will be updated based on AI response)
    const outputFile = generateOutputFilename('tmp');
    
    // Get just the filename from the current input file
    const inputFilename = path.basename(currentInputFile);
    
    // Use pre-calculated region if provided
    const regionString = preCalculatedRegion || null;
    
    // Build JSON message directly
    const jsonMessage = {
      input_filename: inputFilename,
      operation: userInput || message,
      use_placeholders: true,
      region: regionString
    };
    
    const formattedJsonMessage = JSON.stringify(jsonMessage, null, 2);
    
    // Hardcoded system prompt
    const systemPrompt = `You are an FFmpeg command generator.
The user will ask you a series of operations to perform.

These will be in this exact JSON format:
{
  "input_filename": "example.mp4",
  "operation": "description of what to do",
  "use_placeholders": true,
  "region": null | "x,y widthxheight"
}

The region field (when not null) specifies a region of interest where:
- x,y is the top-left corner offset in pixels
- widthxheight is the size of the region in pixels
- Example: "100,200 1280x720" means offset (100,200) with size 1280x720
- To parse: split by space, then "100,200" gives x=100,y=200 and "1280x720" gives width=1280,height=720
- This is simply a region the user is referencing - only perform actions on it if explicitly requested
- For cropping operations, use the crop filter: crop=width:height:x:y
- Example: region "100,200 1280x720" becomes crop=1280:720:100:200

For every response, you must provide output in this exact JSON format:
{
  "command": "complete ffmpeg command using {INPUT_FILE} and {OUTPUT_FILE} placeholders",
  "output_extension": "ext",
  "error": null | "some issue"
}

Rules:
- When use_placeholders is true (which it always will be), you MUST use {INPUT_FILE} and {OUTPUT_FILE} as placeholders in your ffmpeg commands
- Do NOT use actual file paths - only use the placeholder strings {INPUT_FILE} and {OUTPUT_FILE}
- Always provide output_extension - this field is mandatory
- Always include the -y flag in your ffmpeg commands to overwrite output files
- Set output_extension to the appropriate file extension (without the dot)
  Examples:
  - For MP3 audio: output_extension: "mp3"
  - For MP4 video: output_extension: "mp4"
  - For WAV audio: output_extension: "wav"
  - For GIF: output_extension: "gif"
  - For PNG image: output_extension: "png"
  - Choose extension based on the output format in your ffmpeg command
- Generate complete, runnable ffmpeg commands with placeholders
- For video operations, maintain quality unless asked to compress
- For audio extraction, use appropriate codec (mp3, wav, etc.)
- The system will handle file path substitution automatically
- If the operation is complex, break it into the most essential command
- If the operation is unclear or impossible, explain in the error field`;
    
    // Ensure system prompt is always the first message
    const hasSystemPrompt = conversationHistory.length > 0 && conversationHistory[0].role === 'system';
    if (!hasSystemPrompt) {
      conversationHistory.unshift({ role: 'system', content: systemPrompt });
    }
    
    const finalMessage = formattedJsonMessage;
    
    // Use AI provider factory to handle different providers
    const aiProvider = await AIProviderFactory.getProvider(provider, config);
    
    const messages = [...conversationHistory, { role: 'user', content: finalMessage }];
    const chatResponse = await aiProvider.chat(messages, {
      model: config.model,
      temperature: 0.7,
      maxTokens: 1000
    });
    
    const response = chatResponse.content;
    
    // Always try to parse structured response
    try {
      // Try to parse JSON response
      const jsonResponse = JSON.parse(response);
      
      // If we got a valid JSON response with command and output_extension
      if (jsonResponse.command && jsonResponse.output_extension) {
        // Replace the temporary extension with the one specified by AI
        const extension = jsonResponse.output_extension;
        const finalOutputFile = outputFile.replace(/\.tmp$/, `.${extension}`);
        
        // Substitute actual file paths in the command for execution
        const executableCommand = jsonResponse.command
          .replace(/{INPUT_FILE}/g, currentInputFile)
          .replace(/{OUTPUT_FILE}/g, finalOutputFile);
        
        // Update the current input file for next operation (use the actual output path)
        setCurrentInputFile(sessionId, finalOutputFile);
        
        // Create a version with substituted paths for execution but keep placeholders for display
        const executableResponse = {
          ...jsonResponse,
          command: executableCommand,
          output_file: finalOutputFile
        };
        
        // Return structured response with both display and executable versions
        res.json({ 
          response: response, // Original response with placeholders for display
          isStructured: true,
          parsedResponse: jsonResponse, // Original for display
          executableResponse: executableResponse // With actual paths for execution
        });
        return;
      }
    } catch (parseError) {
      // If JSON parsing fails, fall back to regular response
      console.warn('Failed to parse structured response:', parseError.message);
    }
    
    res.json({ response });
  } catch (error) {
    console.error(`Error with ${provider}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Get persistent settings
router.get('/settings', async (req, res) => {
  try {
    const settings = await getAllSettings();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update persistent settings
router.post('/settings', async (req, res) => {
  try {
    const success = await setAllSettings(req.body);
    if (success) {
      res.json({ success: true });
    } else {
      res.status(500).json({ error: 'Failed to save settings' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// Set file path endpoint
router.post('/set-file-path', (req, res) => {
  try {
    const { filePath } = req.body;
    
    if (!filePath) {
      return res.status(400).json({ error: 'No file path provided' });
    }

    // Resolve to absolute path
    const fullPath = path.resolve(filePath);
    
    // Check if file exists
    if (!fs.existsSync(fullPath)) {
      return res.status(400).json({ error: 'File does not exist' });
    }
    
    // Check if it's a file (not a directory)
    const stats = fs.statSync(fullPath);
    if (!stats.isFile()) {
      return res.status(400).json({ error: 'Path is not a file' });
    }

    // Set this as the current input file for the session
    const sessionId = getSessionId(req);
    setCurrentInputFile(sessionId, fullPath);

    // Return file info
    res.json({
      success: true,
      file: {
        originalName: path.basename(fullPath),
        fileName: path.basename(fullPath),
        filePath: fullPath, // Add filePath for media embeds
        path: fullPath,
        size: stats.size,
        mimetype: 'application/octet-stream'
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get file info by path (including media dimensions)
router.post('/file-info', async (req, res) => {
  try {
    const { filePath } = req.body;
    const fullPath = path.resolve(filePath);
    
    if (fs.existsSync(fullPath)) {
      const stats = fs.statSync(fullPath);
      const result = {
        exists: true,
        size: stats.size,
        path: fullPath,
        isFile: stats.isFile()
      };
      
      // Try to get media dimensions using ffprobe
      const settings = await getAllSettings();
      const ffmpegPath = settings.ffmpegPath || 'ffmpeg';
      const ffprobePath = ffmpegPath.replace(/ffmpeg([^\/\\]*)$/, 'ffprobe$1');
      
      try {
        const dimensions = await ffmpegService.getMediaDimensions(fullPath, ffprobePath);
        result.width = dimensions.width;
        result.height = dimensions.height;
        result.rotation = dimensions.rotation;
        result.displayWidth = dimensions.displayWidth;
        result.displayHeight = dimensions.displayHeight;
      } catch (error) {
        console.log('Could not get media dimensions:', error.message);
        // Continue without dimensions - not a critical error
      }
      
      res.json(result);
    } else {
      res.status(404).json({ exists: false });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Calculate region coordinates
router.post('/calculate-region', async (req, res) => {
  try {
    const { displayRegion, filePath } = req.body;
    
    if (!displayRegion || !filePath) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    const settings = await getAllSettings();
    const ffprobePath = (settings.ffmpegPath || 'ffmpeg').replace(/ffmpeg([^\/\\]*)$/, 'ffprobe$1');
    
    const result = await ffmpegService.calculateRegionFromDisplay(displayRegion, filePath, ffprobePath);
    
    console.log('Region calculation successful:', {
      displayRegion,
      ...result
    });
    
    res.json(result);
    
  } catch (error) {
    console.error('Error calculating region:', error);
    
    if (error.message.includes('Invalid region dimensions')) {
      res.status(400).json({ 
        error: error.message,
        debug: {
          displayRegion: req.body.displayRegion
        }
      });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// Get pre-configured file info
router.get('/preconfigured-file', (req, res) => {
  if (preConfiguredFile) {
    // Set this as the current input file for the session
    const sessionId = getSessionId(req);
    setCurrentInputFile(sessionId, preConfiguredFile.path);
    
    res.json({ file: preConfiguredFile });
  } else {
    res.json({ file: null });
  }
});

// Upload file endpoint
router.post('/upload-file', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const file = req.file;
    
    // Set this as the current input file for the session
    const sessionId = getSessionId(req);
    setCurrentInputFile(sessionId, file.path);

    // Return file info
    res.json({
      success: true,
      file: {
        originalName: file.originalname,
        fileName: file.filename,
        filePath: file.path, // Add filePath for media embeds
        path: file.path,
        size: file.size,
        mimetype: file.mimetype
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve media files endpoint
router.get('/serve-file', (req, res) => {
  try {
    const filePath = req.query.path;
    
    if (!filePath) {
      return res.status(400).json({ error: 'No file path provided' });
    }
    
    // Resolve to absolute path and check if file exists
    const fullPath = path.resolve(filePath);
    
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Check if it's a file (not a directory)
    const stats = fs.statSync(fullPath);
    if (!stats.isFile()) {
      return res.status(400).json({ error: 'Path is not a file' });
    }
    
    // Get file extension to determine Content-Type
    const ext = path.extname(fullPath).toLowerCase();
    let contentType = 'application/octet-stream';
    
    // Set appropriate Content-Type based on file extension
    const mimeTypes = {
      // Audio
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.aac': 'audio/aac',
      '.flac': 'audio/flac',
      '.m4a': 'audio/mp4',
      '.wma': 'audio/x-ms-wma',
      
      // Video
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.avi': 'video/x-msvideo',
      '.mov': 'video/quicktime',
      '.wmv': 'video/x-ms-wmv',
      '.flv': 'video/x-flv',
      '.mkv': 'video/x-matroska',
      '.m4v': 'video/mp4',
      
      // Images
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.svg': 'image/svg+xml'
    };
    
    if (mimeTypes[ext]) {
      contentType = mimeTypes[ext];
    }
    
    // Set headers for media streaming
    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
    
    // Handle range requests for video/audio streaming
    const range = req.headers.range;
    const fileSize = stats.size;
    
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      
      const fileStream = fs.createReadStream(fullPath, { start, end });
      
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Content-Length': chunksize
      });
      
      fileStream.pipe(res);
    } else {
      res.setHeader('Content-Length', fileSize);
      const fileStream = fs.createReadStream(fullPath);
      fileStream.pipe(res);
    }
    
  } catch (error) {
    console.error('Error serving file:', error);
    res.status(500).json({ error: error.message });
  }
});

// Execute FFmpeg command endpoint
router.post('/execute-ffmpeg', async (req, res) => {
  try {
    const { command, inputFile, outputFile, executionId } = req.body;
    
    if (!command) {
      return res.status(400).json({ error: 'No command provided' });
    }
    
    // Get FFmpeg path from settings
    const settings = await getAllSettings();
    const ffmpegPath = settings.ffmpegPath || 'ffmpeg';
    
    const result = await ffmpegService.execute({
      command,
      ffmpegPath,
      inputFile,
      outputFile,
      executionId
    });
    
    if (result.success) {
      // Update current input file for the session if output was created
      if (result.outputFile) {
        const sessionId = getSessionId(req);
        setCurrentInputFile(sessionId, result.outputFile);
        console.log('🔄 Updated session input file for chaining');
      }
      
      res.json({
        success: true,
        outputFile: result.outputFile,
        outputSize: result.outputSize,
        stdout: result.stdout,
        stderr: result.stderr,
        message: result.outputFile ? 
          'FFmpeg command executed successfully' : 
          'FFmpeg command executed successfully (no output file created)'
      });
    }
  } catch (error) {
    console.error('Error executing FFmpeg:', error);
    
    if (error.timeout) {
      res.status(408).json({ error: error.message });
    } else if (error.code !== undefined) {
      res.status(500).json({
        error: error.message,
        stderr: error.stderr,
        stdout: error.stdout
      });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// Cancel FFmpeg execution endpoint
router.post('/cancel-ffmpeg', async (req, res) => {
  try {
    const { executionId } = req.body;
    
    if (!executionId) {
      return res.status(400).json({ error: 'No execution ID provided' });
    }
    
    const result = ffmpegService.cancel(executionId);
    res.json(result);
    
  } catch (error) {
    console.error('Error cancelling FFmpeg:', error);
    if (error.message.includes('No active process')) {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// Check FFmpeg availability
router.get('/ffmpeg-status', async (req, res) => {
  try {
    const settings = await getAllSettings();
    const ffmpegPath = settings.ffmpegPath || 'ffmpeg';
    
    const result = await ffmpegService.checkAvailability(ffmpegPath);
    res.json(result);
    
  } catch (error) {
    res.json({ available: false, error: error.message });
  }
});

module.exports = router;
module.exports.setPreConfiguredFile = setPreConfiguredFile;
