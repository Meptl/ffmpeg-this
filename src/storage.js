const storage = require('node-persist');
const path = require('path');
const os = require('os');

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

// Initialize storage
async function initStorage() {
  await storage.init({
    dir: getConfigDir(),
    stringify: JSON.stringify,
    parse: JSON.parse,
    encoding: 'utf8',
    logging: false,
    ttl: false,
    expiredInterval: 2 * 60 * 1000, // 2 minutes
    forgiveParseErrors: true
  });
}

// Get a value
async function get(key, defaultValue = null) {
  try {
    const value = await storage.getItem(key);
    return value !== undefined ? value : defaultValue;
  } catch (error) {
    console.error(`Error getting ${key}:`, error);
    return defaultValue;
  }
}

// Set a value
async function set(key, value) {
  try {
    await storage.setItem(key, value);
    return true;
  } catch (error) {
    console.error(`Error setting ${key}:`, error);
    return false;
  }
}

// Get all settings
async function getAllSettings() {
  try {
    const ffmpegPath = await get('ffmpegPath', '');
    const systemPrompt = await get('systemPrompt', `You are an FFmpeg command generator.
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
  "output_file": "{OUTPUT_FILE}",
  "error": null | "some issue"
}

Rules:
- Use {INPUT_FILE} and {OUTPUT_FILE} as placeholders in your ffmpeg commands
- Do NOT use actual file paths - only use the placeholder strings
- Generate complete, runnable ffmpeg commands with placeholders
- For video operations, maintain quality unless asked to compress
- For audio extraction, use appropriate codec (mp3, wav, etc.)
- The system will handle file path substitution automatically
- If the operation is complex, break it into the most essential command
- If the operation is unclear or impossible, explain in the error field`);
    const jsonTemplate = await get('jsonTemplate', `{
  "input_file": "{INPUT_FILE}",
  "output_file": "{OUTPUT_FILE}",
  "operation": "{USER_INPUT}"
}`);
    return { ffmpegPath, systemPrompt, jsonTemplate };
  } catch (error) {
    console.error('Error getting all settings:', error);
    return { 
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
  "output_file": "{OUTPUT_FILE}",
  "error": null | "some issue"
}

Rules:
- Use {INPUT_FILE} and {OUTPUT_FILE} as placeholders in your ffmpeg commands
- Do NOT use actual file paths - only use the placeholder strings
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
  }
}

// Set all settings
async function setAllSettings(settings) {
  try {
    if (settings.ffmpegPath !== undefined) {
      await set('ffmpegPath', settings.ffmpegPath);
    }
    if (settings.systemPrompt !== undefined) {
      await set('systemPrompt', settings.systemPrompt);
    }
    if (settings.jsonTemplate !== undefined) {
      await set('jsonTemplate', settings.jsonTemplate);
    }
    return true;
  } catch (error) {
    console.error('Error setting all settings:', error);
    return false;
  }
}

module.exports = {
  initStorage,
  get,
  set,
  getAllSettings,
  setAllSettings,
  getConfigDir
};