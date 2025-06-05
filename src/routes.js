const express = require('express');
const router = express.Router();
const { OpenAI } = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');
const axios = require('axios');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { getAllSettings, setAllSettings } = require('./storage');

// Configure multer for file uploads
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 500 * 1024 * 1024 // 500MB limit
  }
  // Accept any file type - ffmpeg supports many formats
});

// Ensure uploads directory exists
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Global variable for pre-configured file
let preConfiguredFile = null;

// Global variable for tracking current input file per session
const sessionFileTracking = new Map(); // sessionId -> currentInputFile

// Create tmp directory for intermediate files
const tmpDir = path.join(os.tmpdir(), 'ffmpeg-this');
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}

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
    preConfiguredFile = {
      originalName: path.basename(filePath),
      fileName: 'preconfigured',
      path: path.resolve(filePath),
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
  const { provider, message, conversationHistory = [], useStructuredMode = false, userInput } = req.body;
  
  if (!apiConfigs[provider]) {
    return res.status(400).json({ error: 'Invalid provider' });
  }
  
  const config = apiConfigs[provider];
  
  if (!config.apiKey && provider !== 'local') {
    return res.status(400).json({ error: 'API key not configured' });
  }
  
  const sessionId = getSessionId(req);
  
  try {
    let finalMessage = message;
    let isFirstMessage = false;
    
    // Handle structured mode for JSON workflow
    if (useStructuredMode) {
      const settings = await getAllSettings();
      const currentInputFile = getCurrentInputFile(sessionId);
      
      if (!currentInputFile) {
        return res.status(400).json({ error: 'No input file set for this session' });
      }
      
      // Generate output filename with temporary extension (will be updated based on AI response)
      const outputFile = generateOutputFilename('tmp');
      
      // Format JSON template with substitutions
      const formattedJsonMessage = settings.jsonTemplate
        .replace('{INPUT_FILE}', currentInputFile)
        .replace('{OUTPUT_FILE}', outputFile)
        .replace('{USER_INPUT}', userInput || message);
      
      // Add system prompt as first message if this is the start of conversation
      if (conversationHistory.length === 0) {
        conversationHistory.push({ role: 'system', content: settings.systemPrompt });
        isFirstMessage = true;
      }
      
      finalMessage = formattedJsonMessage;
    }
    
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
    
    // Handle structured mode response processing
    if (useStructuredMode) {
      try {
        // Try to parse JSON response
        const jsonResponse = JSON.parse(response);
        
        // If we got a valid JSON response with command and output_file
        if (jsonResponse.command && jsonResponse.output_file) {
          // Update the current input file for next operation
          setCurrentInputFile(sessionId, jsonResponse.output_file);
          
          // Return structured response
          res.json({ 
            response: response,
            isStructured: true,
            parsedResponse: jsonResponse
          });
          return;
        }
      } catch (parseError) {
        // If JSON parsing fails, fall back to regular response
        console.warn('Failed to parse structured response:', parseError.message);
      }
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

// File upload endpoint
router.post('/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Set this as the current input file for the session
    const sessionId = getSessionId(req);
    const fullPath = path.resolve(req.file.path);
    setCurrentInputFile(sessionId, fullPath);

    // Return file info
    res.json({
      success: true,
      file: {
        originalName: req.file.originalname,
        fileName: req.file.filename,
        path: fullPath,
        size: req.file.size,
        mimetype: req.file.mimetype
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get uploaded file info
router.get('/file/:filename', (req, res) => {
  const filePath = path.join('uploads', req.params.filename);
  if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    res.json({
      exists: true,
      size: stats.size,
      path: filePath
    });
  } else {
    res.status(404).json({ exists: false });
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

module.exports = router;
module.exports.setPreConfiguredFile = setPreConfiguredFile;