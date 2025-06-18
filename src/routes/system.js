const express = require('express');
const router = express.Router();
const ffmpegService = require('../services/ffmpeg');
const { AIProviderFactory } = require('../services/ai-providers');
const fs = require('fs');
const path = require('path');

// Global variable for pre-configured file
let preConfiguredFile = null;

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
  }
}


// Session tracking functions (set by routes.js)
let setCurrentInputFileFunc = null;
let getSessionIdFunc = null;

function setSessionTrackingFunctions(setInputFile, getSessionId) {
  setCurrentInputFileFunc = setInputFile;
  getSessionIdFunc = getSessionId;
}

// Check FFmpeg availability
// Initialize API configurations from environment variables
let apiConfigs = {
  openai: { 
    apiKey: process.env.OPENAI_API_KEY || ''
  },
  anthropic: { 
    apiKey: process.env.ANTHROPIC_API_KEY || ''
  },
  gemini: { 
    apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || ''
  },
  groq: { 
    apiKey: process.env.GROQ_API_KEY || ''
  },
  deepseek: { 
    apiKey: process.env.DEEPSEEK_API_KEY || ''
  },
  local: { 
    endpoint: process.env.LOCAL_LLM_ENDPOINT || process.env.OLLAMA_API_BASE || '', 
    apiKey: process.env.LOCAL_LLM_API_KEY || '', 
    headers: {}
  }
};

// Add model configurations only if explicitly set via environment variables
if (process.env.OPENAI_MODEL) apiConfigs.openai.model = process.env.OPENAI_MODEL;
if (process.env.ANTHROPIC_MODEL) apiConfigs.anthropic.model = process.env.ANTHROPIC_MODEL;
if (process.env.GEMINI_MODEL) apiConfigs.gemini.model = process.env.GEMINI_MODEL;
if (process.env.GROQ_MODEL) apiConfigs.groq.model = process.env.GROQ_MODEL;
if (process.env.DEEPSEEK_MODEL) apiConfigs.deepseek.model = process.env.DEEPSEEK_MODEL;
if (process.env.LOCAL_LLM_MODEL) apiConfigs.local.model = process.env.LOCAL_LLM_MODEL;

// Check FFmpeg availability
router.get('/ffmpeg-status', async (req, res) => {
  try {
    const result = await ffmpegService.checkAvailability();
    res.json(result);
    
  } catch (error) {
    res.json({ available: false, error: error.message });
  }
});

// Settings endpoints removed - now using localStorage

// Store initial environment configs for reset functionality
const envConfigs = JSON.parse(JSON.stringify(apiConfigs));

// Update API configuration
router.post('/config', (req, res) => {
  const { provider, config } = req.body;
  if (apiConfigs[provider]) {
    // Handle API key updates specially
    if ('apiKey' in config) {
      if (config.apiKey === '' || config.apiKey === null || config.apiKey === undefined) {
        // Reset to environment default when cleared
        apiConfigs[provider].apiKey = envConfigs[provider].apiKey || '';
      } else {
        // Set new API key
        apiConfigs[provider].apiKey = config.apiKey;
      }
    }
    
    // Handle model updates
    if ('model' in config) {
      if (config.model === '' || config.model === null || config.model === undefined) {
        // Reset to environment default or remove if no env default
        if (envConfigs[provider].model) {
          apiConfigs[provider].model = envConfigs[provider].model;
        } else {
          delete apiConfigs[provider].model;
        }
      } else {
        // Set new model
        apiConfigs[provider].model = config.model;
      }
    }
    
    // Handle other config properties (like endpoint, headers for local)
    for (const [key, value] of Object.entries(config)) {
      if (key !== 'apiKey' && key !== 'model') {
        if (value !== '' && value !== null && value !== undefined) {
          apiConfigs[provider][key] = value;
        } else if (envConfigs[provider][key]) {
          // Reset to env default
          apiConfigs[provider][key] = envConfigs[provider][key];
        }
      }
    }
    
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

// Get pre-configured file info
router.get('/preconfigured-file', (req, res) => {
  if (preConfiguredFile) {
    // Set this as the current input file for the session
    if (setCurrentInputFileFunc && getSessionIdFunc) {
      const sessionId = getSessionIdFunc(req);
      setCurrentInputFileFunc(sessionId, preConfiguredFile.path);
    }
    
    res.json({ file: preConfiguredFile });
  } else {
    res.json({ file: null });
  }
});


module.exports = router;
module.exports.apiConfigs = apiConfigs;
module.exports.setPreConfiguredFile = setPreConfiguredFile;
module.exports.setSessionTrackingFunctions = setSessionTrackingFunctions;
