const express = require('express');
const router = express.Router();
const multer = require('multer');
const { OpenAI } = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { getAllSettings, setAllSettings } = require('./storage');

// Global variable for pre-configured file
let preConfiguredFile = null;

// Global variable for tracking current input file per session
const sessionFileTracking = new Map(); // sessionId -> currentInputFile

// Global variable for tracking active FFmpeg processes
const activeProcesses = new Map(); // executionId -> ffmpegProcess

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
Object.entries(apiConfigs).forEach(([provider, config]) => {
  const isConfigured = provider === 'local' 
    ? !!config.endpoint 
    : !!config.apiKey;
  if (isConfigured) {
    console.log(`✓ ${provider}`);
  }
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
  const providers = [];
  Object.entries(apiConfigs).forEach(([provider, config]) => {
    const isConfigured = provider === 'local' 
      ? !!config.endpoint 
      : !!config.apiKey;
    if (isConfigured) {
      providers.push({
        id: provider,
        name: getProviderDisplayName(provider)
      });
    }
  });
  res.json({ providers });
});

function getProviderDisplayName(provider) {
  const names = {
    openai: 'OpenAI',
    anthropic: 'Anthropic (Claude)',
    gemini: 'Google Gemini',
    groq: 'Groq',
    deepseek: 'DeepSeek',
    local: 'Local LLM'
  };
  return names[provider] || provider;
}

// Chat endpoint
router.post('/chat', async (req, res) => {
  const { provider, message, conversationHistory = [], userInput } = req.body;
  
  if (!apiConfigs[provider]) {
    return res.status(400).json({ error: 'Invalid provider' });
  }
  
  const config = apiConfigs[provider];
  
  if (!config.apiKey && provider !== 'local') {
    return res.status(400).json({ error: 'API key not configured' });
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
    
    // Format JSON template with substitutions
    const formattedJsonMessage = settings.jsonTemplate
      .replace('{INPUT_FILENAME}', inputFilename)
      .replace('{USER_INPUT}', userInput || message);
    
    // Add system prompt as first message if this is the start of conversation
    if (conversationHistory.length === 0) {
      conversationHistory.push({ role: 'system', content: settings.systemPrompt });
    }
    
    const finalMessage = formattedJsonMessage;
    
    let response;
    
    switch (provider) {
      case 'openai':
        const openai = new OpenAI({ apiKey: config.apiKey });
        const openaiResponse = await openai.chat.completions.create({
          model: config.model,
          messages: [...conversationHistory, { role: 'user', content: finalMessage }],
          temperature: 0.7,
          max_tokens: 1000
        });
        response = openaiResponse.choices[0].message.content;
        break;
        
      case 'anthropic':
        const anthropic = new Anthropic({ apiKey: config.apiKey });
        const anthropicResponse = await anthropic.messages.create({
          model: config.model,
          messages: [...conversationHistory, { role: 'user', content: finalMessage }],
          max_tokens: 1000
        });
        response = anthropicResponse.content[0].text;
        break;
        
      case 'gemini':
        const genAI = new GoogleGenerativeAI(config.apiKey);
        const geminiModel = genAI.getGenerativeModel({ model: config.model });
        const geminiResponse = await geminiModel.generateContent(finalMessage);
        response = geminiResponse.response.text();
        break;
        
      case 'groq':
        const groq = new Groq({ apiKey: config.apiKey });
        const groqResponse = await groq.chat.completions.create({
          model: config.model,
          messages: [...conversationHistory, { role: 'user', content: finalMessage }],
          temperature: 0.7,
          max_tokens: 1000
        });
        response = groqResponse.choices[0].message.content;
        break;
        
      case 'deepseek':
        // DeepSeek uses OpenAI-compatible API
        const deepseekResponse = await axios.post('https://api.deepseek.com/v1/chat/completions', {
          model: config.model,
          messages: [...conversationHistory, { role: 'user', content: finalMessage }],
          temperature: 0.7,
          max_tokens: 1000
        }, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`
          }
        });
        response = deepseekResponse.data.choices[0].message.content;
        break;
        
      case 'local':
        if (!config.endpoint) {
          throw new Error('Local endpoint not configured');
        }
        const headers = {
          'Content-Type': 'application/json',
          ...config.headers
        };
        if (config.apiKey) {
          headers['Authorization'] = `Bearer ${config.apiKey}`;
        }
        
        const localResponse = await axios.post(config.endpoint, {
          model: config.model,
          messages: [...conversationHistory, { role: 'user', content: finalMessage }],
          temperature: 0.7,
          max_tokens: 1000
        }, { headers });
        
        // Handle different response formats from local LLMs
        if (localResponse.data.choices && localResponse.data.choices[0]) {
          response = localResponse.data.choices[0].message?.content || localResponse.data.choices[0].text;
        } else if (localResponse.data.response) {
          response = localResponse.data.response;
        } else if (localResponse.data.content) {
          response = localResponse.data.content;
        } else {
          response = JSON.stringify(localResponse.data);
        }
        break;
        
      default:
        throw new Error('Unknown provider');
    }
    
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

// Get file info by path
router.post('/file-info', (req, res) => {
  try {
    const { filePath } = req.body;
    const fullPath = path.resolve(filePath);
    
    if (fs.existsSync(fullPath)) {
      const stats = fs.statSync(fullPath);
      res.json({
        exists: true,
        size: stats.size,
        path: fullPath,
        isFile: stats.isFile()
      });
    } else {
      res.status(404).json({ exists: false });
    }
  } catch (error) {
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
    
    // Parse the command to extract arguments
    // Remove 'ffmpeg' from the beginning if present
    let commandArgs = command.replace(/^ffmpeg\s+/, '').trim();
    
    // Split the command into arguments, respecting quotes
    const args = [];
    let currentArg = '';
    let inQuotes = false;
    let quoteChar = '';
    
    for (let i = 0; i < commandArgs.length; i++) {
      const char = commandArgs[i];
      
      if ((char === '"' || char === "'") && !inQuotes) {
        inQuotes = true;
        quoteChar = char;
      } else if (char === quoteChar && inQuotes) {
        inQuotes = false;
        quoteChar = '';
      } else if (char === ' ' && !inQuotes) {
        if (currentArg.trim()) {
          args.push(currentArg.trim());
          currentArg = '';
        }
      } else {
        currentArg += char;
      }
    }
    
    if (currentArg.trim()) {
      args.push(currentArg.trim());
    }
    
    console.log('\n🎬 FFMPEG EXECUTION STARTED');
    console.log('📂 Working Directory:', process.cwd());
    console.log('🔧 FFmpeg Path:', ffmpegPath);
    console.log('📝 Command:', command);
    console.log('⚙️  Arguments:', args);
    console.log('📥 Input File:', inputFile || 'Not specified');
    console.log('📤 Output File:', outputFile || 'Not specified');
    console.log('─'.repeat(60));
    
    // Execute FFmpeg command
    const ffmpegProcess = spawn(ffmpegPath, args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    // Track the process if executionId is provided
    if (executionId) {
      activeProcesses.set(executionId, ffmpegProcess);
    }
    
    let stdout = '';
    let stderr = '';
    let responseSent = false;
    
    ffmpegProcess.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      if (output.trim()) {
        console.log('📤 FFmpeg stdout:', output.trim());
      }
    });
    
    ffmpegProcess.stderr.on('data', (data) => {
      const output = data.toString();
      stderr += output;
      if (output.trim()) {
        console.log('📋 FFmpeg stderr:', output.trim());
      }
    });
    
    ffmpegProcess.on('close', (code) => {
      if (responseSent) return; // Prevent duplicate response
      responseSent = true;
      clearTimeout(timeoutId); // Clear the timeout
      
      // Clean up from active processes
      if (executionId) {
        activeProcesses.delete(executionId);
      }
      
      console.log('\n🏁 FFMPEG EXECUTION COMPLETED');
      console.log('🔢 Exit Code:', code);
      
      if (code === 0) {
        console.log('✅ Status: SUCCESS');
        
        // Check if output file was created
        if (outputFile && fs.existsSync(outputFile)) {
          const stats = fs.statSync(outputFile);
          console.log('📁 Output File Created:', outputFile);
          console.log('📊 File Size:', (stats.size / 1024 / 1024).toFixed(2), 'MB');
          
          // Update current input file for the session
          const sessionId = getSessionId(req);
          setCurrentInputFile(sessionId, outputFile);
          console.log('🔄 Updated session input file for chaining');
          
          res.json({
            success: true,
            outputFile: outputFile,
            outputSize: stats.size,
            stdout: stdout,
            stderr: stderr,
            message: 'FFmpeg command executed successfully'
          });
        } else {
          console.log('⚠️  No output file created');
          res.json({
            success: true,
            stdout: stdout,
            stderr: stderr,
            message: 'FFmpeg command executed successfully (no output file created)'
          });
        }
      } else {
        console.log('❌ Status: FAILED');
        console.log('💥 Error Details:', stderr.slice(-200)); // Last 200 chars of error
        res.status(500).json({
          error: `FFmpeg execution failed with code ${code}`,
          stderr: stderr,
          stdout: stdout
        });
      }
      console.log('═'.repeat(60));
    });
    
    ffmpegProcess.on('error', (error) => {
      if (responseSent) return; // Prevent duplicate response
      responseSent = true;
      clearTimeout(timeoutId); // Clear the timeout
      
      // Clean up from active processes
      if (executionId) {
        activeProcesses.delete(executionId);
      }
      
      console.log('\n💥 FFMPEG PROCESS ERROR');
      console.log('❌ Error Type:', error.code || 'Unknown');
      console.log('📝 Error Message:', error.message);
      console.log('💡 Possible Causes:');
      console.log('   - FFmpeg not installed or not in PATH');
      console.log('   - Invalid FFmpeg path in settings');
      console.log('   - Permissions issue');
      console.log('═'.repeat(60));
      
      res.status(500).json({
        error: 'Failed to start FFmpeg process: ' + error.message
      });
    });
    
    // Set a timeout to prevent hanging
    const timeoutId = setTimeout(() => {
      if (!ffmpegProcess.killed && !responseSent) {
        responseSent = true;
        console.log('\n⏰ FFMPEG EXECUTION TIMEOUT');
        console.log('🚫 Killing process after 60 seconds');
        console.log('═'.repeat(60));
        
        ffmpegProcess.kill();
        res.status(408).json({
          error: 'FFmpeg execution timed out'
        });
      }
    }, 60000); // 60 second timeout
    
  } catch (error) {
    console.error('Error executing FFmpeg:', error);
    res.status(500).json({ error: error.message });
  }
});

// Cancel FFmpeg execution endpoint
router.post('/cancel-ffmpeg', async (req, res) => {
  try {
    const { executionId } = req.body;
    
    if (!executionId) {
      return res.status(400).json({ error: 'No execution ID provided' });
    }
    
    const ffmpegProcess = activeProcesses.get(executionId);
    
    if (!ffmpegProcess) {
      return res.status(404).json({ error: 'No active process found for this execution' });
    }
    
    console.log(`\n🚫 CANCELLING FFMPEG EXECUTION: ${executionId}`);
    
    // Kill the process
    ffmpegProcess.kill('SIGTERM');
    
    // Clean up from active processes
    activeProcesses.delete(executionId);
    
    console.log('✅ FFmpeg process terminated');
    
    res.json({ success: true, message: 'FFmpeg execution cancelled' });
    
  } catch (error) {
    console.error('Error cancelling FFmpeg:', error);
    res.status(500).json({ error: error.message });
  }
});

// Check FFmpeg availability (override the existing one)
router.get('/ffmpeg-status', async (req, res) => {
  try {
    const settings = await getAllSettings();
    const ffmpegPath = settings.ffmpegPath || 'ffmpeg';
    
    // Test if FFmpeg is available
    const testProcess = spawn(ffmpegPath, ['-version'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let responseSet = false;
    
    testProcess.on('close', (code) => {
      if (!responseSet) {
        responseSet = true;
        res.json({ available: code === 0, path: ffmpegPath });
      }
    });
    
    testProcess.on('error', () => {
      if (!responseSet) {
        responseSet = true;
        res.json({ available: false, path: ffmpegPath });
      }
    });
    
    // Timeout after 5 seconds
    setTimeout(() => {
      if (!responseSet) {
        responseSet = true;
        testProcess.kill();
        res.json({ available: false, path: ffmpegPath });
      }
    }, 5000);
    
  } catch (error) {
    res.json({ available: false, error: error.message });
  }
});

module.exports = router;
module.exports.setPreConfiguredFile = setPreConfiguredFile;