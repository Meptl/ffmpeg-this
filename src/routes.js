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
const systemRoutes = require('./routes/system');



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

const upload = multer({ storage: storage });


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

// Import apiConfigs from system routes
const { apiConfigs } = systemRoutes;

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
    const systemPrompt = `You are an FFmpeg command generator assistant.
The user will provide operations to perform on media files.

Input format (JSON):
{
  "input_filename": "example.mp4",
  "operation": "description of what to do",
  "use_placeholders": true,
  "region": null | "x,y widthxheight"
}

Region format (when provided):
- "x,y widthxheight" where x,y is the top-left corner in pixels
- Example: "100,200 1280x720" = offset (100,200), size 1280x720
- Only apply region-based operations when explicitly requested (crop, blur region, etc.)

Required output format (JSON):
{
  "command": "ffmpeg command with {INPUT_FILE} and {OUTPUT_FILE} placeholders",
  "output_extension": "ext",
  "error": null | "error description"
}

Critical Rules:
1. ALWAYS use {INPUT_FILE} and {OUTPUT_FILE} placeholders - never use actual paths
2. ALWAYS include -y flag to overwrite output files
3. ALWAYS return valid JSON, even for errors
4. Set output_extension without the dot (e.g., "mp4" not ".mp4")

Quality Guidelines:
- Video: Preserve quality by default (use -crf 18-23 for H.264/H.265)
- Audio: Use appropriate bitrates (192k+ for MP3, 256k+ for AAC)
- For "compress" requests: use -crf 28-32 for video, 128k for audio
- For "high quality": use -crf 15-18 for video, 320k for audio

Common Operations Reference:
- Trim: -ss START -t DURATION or -ss START -to END
- Crop: -vf "crop=w:h:x:y" (use region if provided)
- Scale: -vf "scale=WIDTH:HEIGHT" (use -1 to maintain aspect ratio)
- Rotate: -vf "transpose=1" (90° CW), "transpose=2" (90° CCW)
- Extract audio: -vn -acodec [codec] for audio-only output
- Remove audio: -an for video without audio
- Convert format: specify output codec with -c:v/-c:a
- Grayscale: -vf "format=gray" -pix_fmt yuv420p (IMPORTANT: include -pix_fmt to avoid green artifacts)
- GIF (high quality): -filter_complex "[0:v]fps=10,scale=320:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" -loop 0
- GIF (simple/fast): -vf "fps=10,scale=320:-1:flags=lanczos" -loop 0
- Concatenate: requires -f concat -safe 0 -i list.txt

Codec Selection (common examples):
- Video: libx264 (H.264), libx265 (H.265), libvpx-vp9 (WebM), mpeg4, theora
- Audio: libmp3lame (MP3), aac (AAC/M4A), pcm_s16le (WAV), libopus (Opus), flac
- Images: png, mjpeg (JPEG), libwebp (WebP)
- Use appropriate codec for the desired output format

Output Extensions (common examples, not exhaustive):
- Video: mp4, mkv, webm, avi, mov, m4v, flv, wmv, mpeg, 3gp, ts
- Audio: mp3, wav, aac, m4a, flac, ogg, opus, wma, ape, ac3
- Image: png, jpg, gif, bmp, tiff, webp
- Choose based on codec/format in command

Error Handling:
- If operation is unclear: provide helpful error message
- If operation is impossible: explain why
- If multiple interpretations exist: choose most likely or ask for clarification
- Common errors: unsupported format, conflicting parameters, missing required info

Examples:
- "make it smaller" → scale down resolution or compress file size (context-dependent)
- "extract audio" → -vn -acodec copy or transcode to common format
- "crop to the region" → use provided region coordinates
- "make a gif" → use palette generation for better colors: -filter_complex with palettegen/paletteuse

Remember: Focus on generating practical, efficient commands that accomplish the user's intent.`;
    
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


// Calculate region coordinates
router.post('/calculate-region', async (req, res) => {
  try {
    const { displayRegion, filePath } = req.body;
    
    if (!displayRegion || !filePath) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    // Use the new transformRegion function
    const result = await ffmpegService.transformRegion(displayRegion, filePath);
    
    res.json(result);
    
  } catch (error) {
    console.error('Error calculating region:', error);
    res.status(500).json({ error: error.message });
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
      
      if (result.outputFile && !wasCancelled) {
        const sessionId = getSessionId(req);
        setCurrentInputFile(sessionId, result.outputFile);
      } else {
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
    cancelledExecutions.add(execIdStr);
    
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


// Mount system routes (pass session tracking functions)
systemRoutes.setSessionTrackingFunctions(setCurrentInputFile, getSessionId);
router.use('/', systemRoutes);

module.exports = router;
