const express = require('express');
const router = express.Router();
const multer = require('multer');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const ffmpegService = require('./services/ffmpeg');
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

    console.log('Sending JSON message to AI:', formattedJsonMessage);
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


The region field (when not null) specifies a region of interest:
- "x,y widthxheight" where x,y is the top-left corner in pixels
- Example: "100,200 1280x720" = offset (100,200), size 1280x720
- Only apply region-based operations when explicitly requested

For every response, you must provide output in this exact JSON format:
{
  "command": "ffmpeg command with {INPUT_FILE} and {OUTPUT_FILE} placeholders",
  "output_extension": "ext",
  "error": null | "error description"
}

Rules:
- ALWAYS use {INPUT_FILE} and {OUTPUT_FILE} placeholders - never use actual paths
- ALWAYS include -y flag to overwrite output files
- ALWAYS return valid JSON, even for errors
- Set output_extension to the appropriate file extension without the dot (e.g., "mp4" not ".mp4")
- For video operations, maintain quality unless asked to compress
- For audio extraction, use appropriate codec (mp3, wav, etc.)
- If region is given, but no region specific operation is requested, ignore the field.
- The system will handle file path substitution automatically
- If the operation is unclear or impossible, explain in the error field;

Operations Reference:
- Grayscale: -vf "format=gray" -pix_fmt yuv420p
- GIF: -filter_complex "[0:v]fps=10,scale=320:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" -loop 0
`;
    
    // Ensure system prompt is always the first message
    const hasSystemPrompt = conversationHistory.length > 0 && conversationHistory[0].role === 'system';
    if (!hasSystemPrompt) {
      conversationHistory.unshift({ role: 'system', content: systemPrompt });
    }
    
    const finalMessage = formattedJsonMessage;
    
    // Use AI provider factory to handle different providers
    const aiProvider = await AIProviderFactory.getProvider(provider, config);
    
    const messages = [...conversationHistory, { role: 'user', content: finalMessage }];
    const chatOptions = {
      temperature: 0,
      maxTokens: 1000
    };
    // Only include model if it exists
    if (config.model) {
      chatOptions.model = config.model;
    }
    const chatResponse = await aiProvider.chat(messages, chatOptions);
    
    const response = chatResponse.content;
    
    // Log raw response for debugging
    console.log('Raw AI response:', response);
    
    // Strip markdown code blocks if present
    let cleanedResponse = response;
    const markdownJsonRegex = /```(?:json)?\s*\n?([\s\S]*?)\n?```/;
    const match = response.match(markdownJsonRegex);
    if (match) {
      cleanedResponse = match[1].trim();
    }
    
    // Always try to parse structured response
    let parseError = null;
    try {
      // Try to parse JSON response
      const jsonResponse = JSON.parse(cleanedResponse);
      
      // If we got a valid JSON response with command and output_extension
      if (jsonResponse.command && jsonResponse.output_extension) {
        // Replace the temporary extension with the one specified by AI
        const extension = jsonResponse.output_extension;
        const finalOutputFile = outputFile.replace(/\.tmp$/, `.${extension}`);
        
        // Substitute actual file paths in the command for execution
        const executableCommand = jsonResponse.command
          .replace(/{INPUT_FILE}/g, currentInputFile)
          .replace(/{OUTPUT_FILE}/g, finalOutputFile);
        
        // DO NOT update the current input file here - wait until command executes successfully
        // setCurrentInputFile(sessionId, finalOutputFile);
        
        // Create a version with substituted paths for execution but keep placeholders for display
        const executableResponse = {
          ...jsonResponse,
          command: executableCommand,
          output_file: finalOutputFile,
          input_file: currentInputFile // Include current input file for reference
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
    } catch (error) {
      // If JSON parsing fails, fall back to regular response
      parseError = true;
    }
    
    res.json({ 
      response: chatResponse.content, // Original response for display
      parseError: parseError // Boolean indicating parse failure
    });
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
    
    // Check if execution was already cancelled before starting
    const execIdStr = String(executionId);
    if (cancelledExecutions.has(execIdStr)) {
      cancelledExecutions.delete(execIdStr);
      
      const sseConnection = sseConnections.get(executionId);
      if (sseConnection) {
        try {
          sseConnection.write(`data: ${JSON.stringify({ 
            type: 'cancelled', 
            message: 'Execution was cancelled'
          })}\n\n`);
          sseConnection.end();
        } catch (error) {
          // Connection already closed
        }
        sseConnections.delete(executionId);
      }
      
      return res.status(200).json({
        success: false,
        cancelled: true,
        message: 'FFmpeg execution was cancelled'
      });
    }
    
    const result = await ffmpegService.execute({
      command,
      inputFile,
      outputFile,
      executionId,
      onOutput
    });
    
    if (result.success) {
      // Check if execution was cancelled
      const wasCancelled = cancelledExecutions.has(execIdStr);
      
      // Only send completion message and update input file if not cancelled
      if (!wasCancelled) {
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
        
        // Update current input file for the session
        if (result.outputFile) {
          const sessionId = getSessionId(req);
          setCurrentInputFile(sessionId, result.outputFile);
        }
      } else {
        // Execution was cancelled - send cancelled message instead
        const sseConnection = sseConnections.get(executionId);
        if (sseConnection) {
          try {
            sseConnection.write(`data: ${JSON.stringify({ 
              type: 'cancelled', 
              message: 'Execution was cancelled'
            })}\n\n`);
            sseConnection.end();
          } catch (error) {
            // Connection already closed
          }
          sseConnections.delete(executionId);
        }
        
        // Clean up partial output file if it exists
        if (result.outputFile && fs.existsSync(result.outputFile)) {
          try {
            fs.unlinkSync(result.outputFile);
            console.log(`Deleted partial output file: ${result.outputFile}`);
          } catch (err) {
            console.error(`Failed to delete partial output file: ${err.message}`);
          }
        }
      }
      
      // Clean up cancelled execution tracking
      cancelledExecutions.delete(execIdStr);
      
      res.json({
        success: true,
        outputFile: wasCancelled ? null : result.outputFile,
        outputSize: wasCancelled ? null : result.outputSize,
        stdout: result.stdout,
        stderr: result.stderr,
        message: wasCancelled ? 
          'FFmpeg execution was cancelled' : 
          (result.outputFile ? 
            'FFmpeg command executed successfully' : 
            'FFmpeg command executed successfully (no output file created)')
      });
    }
  } catch (error) {
    // Check if this was a cancelled execution
    const execIdStr = String(req.body.executionId);
    const wasCancelled = cancelledExecutions.has(execIdStr);
    
    if (wasCancelled) {
    }
    
    // Send appropriate message via SSE based on whether it was cancelled
    const sseConnection = sseConnections.get(req.body.executionId);
    if (sseConnection) {
      try {
        if (wasCancelled) {
          sseConnection.write(`data: ${JSON.stringify({ 
            type: 'cancelled', 
            message: 'Execution was cancelled'
          })}\n\n`);
        } else {
          sseConnection.write(`data: ${JSON.stringify({ 
            type: 'error', 
            message: error.message,
            stderr: error.stderr,
            stdout: error.stdout
          })}\n\n`);
        }
        sseConnection.end();
      } catch (sseError) {
        // Connection already closed
      }
      sseConnections.delete(req.body.executionId);
    }
    
    // Clean up cancelled execution tracking
    cancelledExecutions.delete(execIdStr);
    
    if (wasCancelled) {
      // Return a cancelled status instead of error for cancelled executions
      res.status(200).json({
        success: false,
        cancelled: true,
        message: 'FFmpeg execution was cancelled',
        stderr: error.stderr,
        stdout: error.stdout
      });
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
