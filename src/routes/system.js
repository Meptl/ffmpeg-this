const express = require('express');
const router = express.Router();
const ffmpegService = require('../services/ffmpeg');
const { getAllSettings, setAllSettings } = require('../storage');
const { AIProviderFactory } = require('../services/ai-providers');

// Check FFmpeg availability
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

// Check FFmpeg availability
router.get('/ffmpeg-status', async (req, res) => {
  try {
    const result = await ffmpegService.checkAvailability();
    res.json(result);
    
  } catch (error) {
    res.json({ available: false, error: error.message });
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
module.exports.apiConfigs = apiConfigs;
