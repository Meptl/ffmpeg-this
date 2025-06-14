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
  storage: storage
  // No file size limit for local usage
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



// Calculate region coordinates
router.post('/calculate-region', async (req, res) => {
  try {
    const { displayRegion, filePath } = req.body;
    
    if (!displayRegion || !filePath) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    // Get media dimensions directly
    const dimensions = await ffmpegService.getMediaDimensions(filePath);
    
    // Calculate scale from browser display to true display dimensions
    const scaleX = dimensions.displayWidth / displayRegion.displayWidth;
    const scaleY = dimensions.displayHeight / displayRegion.displayHeight;
    
    // Scale the region to true display coordinates
    const scaledRegion = {
      x: Math.round(displayRegion.x * scaleX),
      y: Math.round(displayRegion.y * scaleY),
      width: Math.round(displayRegion.width * scaleX),
      height: Math.round(displayRegion.height * scaleY)
    };
    
    // Format region string
    const regionString = `${scaledRegion.x},${scaledRegion.y} ${scaledRegion.width}x${scaledRegion.height}`;
    
    const result = {
      regionString: regionString,
      actualRegion: scaledRegion,
      originalDimensions: {
        width: dimensions.width,
        height: dimensions.height
      },
      displayDimensions: {
        width: dimensions.displayWidth,
        height: dimensions.displayHeight
      }
    };
    
    res.json(result);
    
  } catch (error) {
    console.error('Error calculating region:', error);
    res.status(500).json({ error: error.message });
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

// Upload file endpoint with error handling
router.post('/upload-file', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      // Handle multer errors
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ 
            error: 'File too large. Maximum file size is 500MB.' 
          });
        }
        return res.status(400).json({ error: err.message });
      }
      return res.status(500).json({ error: err.message });
    }

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

// Global map to store SSE connections
const sseConnections = new Map();

// Global set to track cancelled executions
const cancelledExecutions = new Set();

// Server-Sent Events endpoint for FFmpeg output streaming
router.get('/stream-ffmpeg-output/:executionId', (req, res) => {
  const { executionId } = req.params;
  
  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });
  
  // Store the connection
  sseConnections.set(executionId, res);
  
  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
  
  // Handle client disconnect
  req.on('close', () => {
    sseConnections.delete(executionId);
  });
  
  req.on('aborted', () => {
    sseConnections.delete(executionId);
  });
});

// Execute FFmpeg command endpoint
router.post('/execute-ffmpeg', async (req, res) => {
  try {
    const { command, inputFile, outputFile, executionId } = req.body;
    
    console.log(`Starting execution with ID: ${executionId} (type: ${typeof executionId})`);
    
    if (!command) {
      return res.status(400).json({ error: 'No command provided' });
    }
    
    // Set up output streaming callback
    const onOutput = (type, data) => {
      const sseConnection = sseConnections.get(executionId);
      if (sseConnection) {
        try {
          sseConnection.write(`data: ${JSON.stringify({ type: 'output', stream: type, data })}\n\n`);
        } catch (error) {
          // Connection might be closed, remove it
          sseConnections.delete(executionId);
        }
      }
    };
    
    const result = await ffmpegService.execute({
      command,
      inputFile,
      outputFile,
      executionId,
      onOutput
    });
    
    // Send completion message via SSE
    const sseConnection = sseConnections.get(executionId);
    if (sseConnection) {
      try {
        sseConnection.write(`data: ${JSON.stringify({ 
          type: 'complete', 
          success: result.success,
          outputFile: result.outputFile,
          outputSize: result.outputSize
        })}\n\n`);
        sseConnection.end();
      } catch (error) {
        // Connection already closed
      }
      sseConnections.delete(executionId);
    }
    
    if (result.success) {
      // Update current input file for the session if output was created AND execution wasn't cancelled
      const execIdStr = String(executionId);
      const wasCancelled = cancelledExecutions.has(execIdStr);
      console.log(`Execution ${execIdStr} (type: ${typeof execIdStr}): success=${result.success}, outputFile=${result.outputFile}, wasCancelled=${wasCancelled}`);
      console.log(`Cancelled executions contains: ${Array.from(cancelledExecutions)}`);
      
      if (result.outputFile && !wasCancelled) {
        const sessionId = getSessionId(req);
        console.log(`Updating session input file to: ${result.outputFile}`);
        setCurrentInputFile(sessionId, result.outputFile);
      } else {
        console.log(`NOT updating session input file. outputFile=${result.outputFile}, wasCancelled=${wasCancelled}`);
      }
      
      // Clean up cancelled execution tracking
      cancelledExecutions.delete(execIdStr);
      
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
    
    // Send error message via SSE
    const sseConnection = sseConnections.get(req.body.executionId);
    if (sseConnection) {
      try {
        sseConnection.write(`data: ${JSON.stringify({ 
          type: 'error', 
          message: error.message,
          stderr: error.stderr,
          stdout: error.stdout
        })}\n\n`);
        sseConnection.end();
      } catch (sseError) {
        // Connection already closed
      }
      sseConnections.delete(req.body.executionId);
    }
    
    // Clean up cancelled execution tracking
    cancelledExecutions.delete(String(req.body.executionId));
    
    if (error.code !== undefined) {
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
    
    // Mark execution as cancelled
    const execIdStr = String(executionId);
    console.log(`Marking execution ${execIdStr} (type: ${typeof execIdStr}) as cancelled`);
    cancelledExecutions.add(execIdStr);
    console.log(`Cancelled executions now contains: ${Array.from(cancelledExecutions)}`);
    
    const result = ffmpegService.cancel(executionId);
    
    // Send cancellation message via SSE
    const sseConnection = sseConnections.get(executionId);
    if (sseConnection) {
      try {
        sseConnection.write(`data: ${JSON.stringify({ 
          type: 'cancelled', 
          message: 'Execution cancelled by user'
        })}\n\n`);
        sseConnection.end();
      } catch (error) {
        // Connection already closed
      }
      sseConnections.delete(executionId);
    }
    
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
    const result = await ffmpegService.checkAvailability();
    res.json(result);
    
  } catch (error) {
    res.json({ available: false, error: error.message });
  }
});

module.exports = router;
module.exports.setPreConfiguredFile = setPreConfiguredFile;
