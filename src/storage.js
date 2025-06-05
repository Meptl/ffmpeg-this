const path = require('path');
const os = require('os');
const fs = require('fs');

// Get the appropriate config directory
function getConfigDir() {
  const platform = process.platform;
  
  if (platform === 'darwin') {
    // macOS
    return path.join(os.homedir(), 'Library', 'Application Support', 'ffmpeg-this');
  } else if (platform === 'win32') {
    // Windows
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'ffmpeg-this');
  } else {
    // Linux and others
    const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    return path.join(xdgConfig, 'ffmpeg-this');
  }
}

// Get config file path
function getConfigFilePath() {
  return path.join(getConfigDir(), 'config.json');
}

// Default settings
const defaultSettings = {
  ffmpegPath: '',
  systemPrompt: `You are an FFmpeg command generator.
The user will ask you a series of operations to perform.

These will be in this exact JSON format:
{
  "input_file": "{INPUT_FILE}",
  "output_file": "{OUTPUT_FILE}", 
  "operation": "description of what to do"
}

For every response, you must provide output in this exact JSON format:
{
  "command": "complete ffmpeg command using {INPUT_FILE} and {OUTPUT_FILE} placeholders",
  "output_file": "{OUTPUT_FILE}.ext",
  "error": null | "some issue"
}

Rules:
- Use {INPUT_FILE} and {OUTPUT_FILE} as placeholders in your ffmpeg commands
- Do NOT use actual file paths - only use the placeholder strings
- CRITICAL: In output_file, you MUST add the appropriate file extension after {OUTPUT_FILE}
  Examples:
  - For MP3 audio: output_file: "{OUTPUT_FILE}.mp3"
  - For MP4 video: output_file: "{OUTPUT_FILE}.mp4"
  - For WAV audio: output_file: "{OUTPUT_FILE}.wav"
  - For GIF: output_file: "{OUTPUT_FILE}.gif"
  - Choose extension based on the output format in your ffmpeg command
- Generate complete, runnable ffmpeg commands with placeholders
- For video operations, maintain quality unless asked to compress
- For audio extraction, use appropriate codec (mp3, wav, etc.)
- The system will handle file path substitution automatically
- If the operation is complex, break it into the most essential command
- If the operation is unclear or impossible, explain in the error field`,
  jsonTemplate: `{
  "input_file": "{INPUT_FILE}",
  "output_file": "{OUTPUT_FILE}",
  "operation": "{USER_INPUT}"
}`
};

// Load settings from file
function loadSettings() {
  try {
    const configPath = getConfigFilePath();
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      return { ...defaultSettings, ...JSON.parse(data) };
    }
  } catch (error) {
    console.error('Error loading settings:', error);
  }
  return defaultSettings;
}

// Save settings to file
function saveSettings(settings) {
  try {
    const configDir = getConfigDir();
    const configPath = getConfigFilePath();
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    
    // Write settings with pretty formatting
    fs.writeFileSync(configPath, JSON.stringify(settings, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error saving settings:', error);
    return false;
  }
}

// Initialize storage (compatibility function)
async function initStorage() {
  // Ensure config directory exists
  const configDir = getConfigDir();
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  
  // Migrate from old node-persist storage if needed
  try {
    const oldStorageDir = path.join(configDir, '.node-persist');
    if (fs.existsSync(oldStorageDir)) {
      console.log('Migrating from old storage format...');
      // Load old settings using node-persist format
      const storage = require('node-persist');
      await storage.init({ dir: configDir });
      
      const ffmpegPath = await storage.getItem('ffmpegPath') || '';
      const systemPrompt = await storage.getItem('systemPrompt') || defaultSettings.systemPrompt;
      const jsonTemplate = await storage.getItem('jsonTemplate') || defaultSettings.jsonTemplate;
      
      // Save to new format
      saveSettings({ ffmpegPath, systemPrompt, jsonTemplate });
      
      // Remove old storage
      fs.rmSync(oldStorageDir, { recursive: true, force: true });
      console.log('Migration complete!');
    }
  } catch (error) {
    console.error('Migration error (continuing anyway):', error);
  }
}

// Get a value (compatibility function)
async function get(key, defaultValue = null) {
  const settings = loadSettings();
  return settings[key] !== undefined ? settings[key] : defaultValue;
}

// Set a value (compatibility function)
async function set(key, value) {
  const settings = loadSettings();
  settings[key] = value;
  return saveSettings(settings);
}

// Get all settings
async function getAllSettings() {
  return loadSettings();
}

// Set all settings
async function setAllSettings(newSettings) {
  const currentSettings = loadSettings();
  const merged = { ...currentSettings };
  
  // Only update provided fields
  if (newSettings.ffmpegPath !== undefined) {
    merged.ffmpegPath = newSettings.ffmpegPath;
  }
  if (newSettings.systemPrompt !== undefined) {
    merged.systemPrompt = newSettings.systemPrompt;
  }
  if (newSettings.jsonTemplate !== undefined) {
    merged.jsonTemplate = newSettings.jsonTemplate;
  }
  
  return saveSettings(merged);
}

module.exports = {
  initStorage,
  get,
  set,
  getAllSettings,
  setAllSettings,
  getConfigDir
};