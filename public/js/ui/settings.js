// Settings UI Module
// Handles all settings modal functionality and configuration management

import { state, updateState } from '../core/state.js';
import { api } from '../services/api.js';

// DOM elements cache
let elements = null;

// Initialize DOM element references
function initializeElements() {
    elements = {
        modal: document.getElementById('settings-modal'),
        closeBtn: document.querySelector('.close'),
        saveBtn: document.getElementById('save-settings'),
        settingsBtn: document.getElementById('settings-btn'),
        
        // Provider inputs
        providers: {
            openai: {
                key: document.getElementById('openai-key'),
                model: document.getElementById('openai-model')
            },
            anthropic: {
                key: document.getElementById('anthropic-key'),
                model: document.getElementById('anthropic-model')
            },
            gemini: {
                key: document.getElementById('gemini-key'),
                model: document.getElementById('gemini-model')
            },
            groq: {
                key: document.getElementById('groq-key'),
                model: document.getElementById('groq-model')
            },
            deepseek: {
                key: document.getElementById('deepseek-key'),
                model: document.getElementById('deepseek-model')
            },
            local: {
                endpoint: document.getElementById('local-endpoint'),
                key: document.getElementById('local-key'),
                model: document.getElementById('local-model'),
                headers: document.getElementById('local-headers')
            }
        },
        
        // System settings
        autoExecuteCommands: document.getElementById('auto-execute-commands')
    };
}

// Track if settings have changed
let settingsChanged = false;

// Setup change tracking for all inputs
function setupChangeTracking() {
    const modal = elements.modal;
    if (!modal) return;
    
    const inputs = modal.querySelectorAll('input, textarea, select');
    inputs.forEach(input => {
        input.addEventListener('change', () => {
            settingsChanged = true;
        });
        input.addEventListener('input', () => {
            settingsChanged = true;
        });
    });
}

// Open settings modal
function openModal() {
    if (!elements.modal) return;
    
    elements.modal.style.display = 'block';
    settingsChanged = false;
    loadCurrentSettings();
}

// Close settings modal with change check
function closeModal() {
    if (!elements.modal) return;
    
    if (settingsChanged) {
        const shouldSave = confirm('You have unsaved changes. Would you like to save them before closing?');
        if (shouldSave) {
            saveSettings();
            return;
        }
    }
    elements.modal.style.display = 'none';
}

// Load current settings into the form
async function loadCurrentSettings() {
    try {
        // Load API configs
        const config = await api.getConfig();
        
        // Populate provider fields
        for (const [provider, settings] of Object.entries(config)) {
            if (provider === 'local' && elements.providers.local) {
                // Load from localStorage first, fallback to server config
                elements.providers.local.endpoint.value = localStorage.getItem('local_endpoint') || settings.endpoint || '';
                elements.providers.local.key.value = localStorage.getItem('local_apiKey') || '';
                elements.providers.local.model.value = localStorage.getItem('local_model') || settings.model || '';
                const savedHeaders = localStorage.getItem('local_headers');
                elements.providers.local.headers.value = savedHeaders || JSON.stringify(settings.headers || {}, null, 2);
            } else if (elements.providers[provider]) {
                const providerElements = elements.providers[provider];
                // Load API key from localStorage
                if (providerElements.key) {
                    const savedKey = localStorage.getItem(`${provider}_apiKey`);
                    providerElements.key.value = savedKey || '';
                }
                // Load model from localStorage, fallback to server config
                if (providerElements.model) {
                    const savedModel = localStorage.getItem(`${provider}_model`);
                    providerElements.model.value = savedModel || settings.model || '';
                }
            }
        }
        
        // Load persistent settings
        const persistentSettings = await api.getSettings();
        
        
        // Update system settings checkboxes
        if (elements.autoExecuteCommands) {
            // Load from localStorage
            const savedAutoExecute = localStorage.getItem('autoExecuteCommands');
            if (savedAutoExecute !== null) {
                elements.autoExecuteCommands.checked = savedAutoExecute === 'true';
            } else {
                elements.autoExecuteCommands.checked = state.autoExecuteCommands;
            }
        }
        
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

// Save all settings
async function saveSettings() {
    const providers = ['openai', 'anthropic', 'gemini', 'groq', 'deepseek'];
    
    try {
        // Save provider settings
        for (const provider of providers) {
            const providerElements = elements.providers[provider];
            if (!providerElements) continue;
            
            const apiKey = providerElements.key?.value;
            const model = providerElements.model?.value;
            
            // Save to localStorage
            if (apiKey !== undefined) {
                if (apiKey) {
                    localStorage.setItem(`${provider}_apiKey`, apiKey);
                } else {
                    localStorage.removeItem(`${provider}_apiKey`);
                }
            }
            if (model !== undefined) {
                if (model) {
                    localStorage.setItem(`${provider}_model`, model);
                } else {
                    localStorage.removeItem(`${provider}_model`);
                }
            }
            
            // Always save to server for current session (including empty values to trigger reset)
            const config = {};
            if (apiKey !== undefined) {
                config.apiKey = apiKey; // Include empty string to reset
            }
            if (model !== undefined) {
                config.model = model; // Include empty string to reset
            }
            
            // Only call saveConfig if we have something to update
            if (Object.keys(config).length > 0) {
                await api.saveConfig(provider, config);
            }
        }
        
        // Save local LLM settings
        if (elements.providers.local) {
            const localElements = elements.providers.local;
            const endpoint = localElements.endpoint.value;
            const apiKey = localElements.key.value;
            const model = localElements.model.value;
            let headers = {};
            
            try {
                headers = JSON.parse(localElements.headers.value);
            } catch (e) {
                console.error('Invalid JSON in headers field');
            }
            
            // Save to localStorage
            if (endpoint) {
                localStorage.setItem('local_endpoint', endpoint);
            } else {
                localStorage.removeItem('local_endpoint');
            }
            if (apiKey) {
                localStorage.setItem('local_apiKey', apiKey);
            } else {
                localStorage.removeItem('local_apiKey');
            }
            if (model) {
                localStorage.setItem('local_model', model);
            } else {
                localStorage.removeItem('local_model');
            }
            localStorage.setItem('local_headers', localElements.headers.value);
            
            // Always save to server for current session (including empty values to trigger reset)
            const localConfig = {};
            // Always include endpoint even if empty to allow reset
            localConfig.endpoint = endpoint;
            if (apiKey !== undefined) {
                localConfig.apiKey = apiKey;
            }
            if (model !== undefined) {
                localConfig.model = model;
            }
            localConfig.headers = headers;
            
            await api.saveConfig('local', localConfig);
        }
        
        // Save autoExecuteCommands to localStorage
        const autoExecuteValue = elements.autoExecuteCommands?.checked || false;
        localStorage.setItem('autoExecuteCommands', autoExecuteValue.toString());
        
        // Update state
        updateState({
            autoExecuteCommands: autoExecuteValue
        });
        
        settingsChanged = false;
        elements.modal.style.display = 'none';
        
        // Trigger callbacks for settings that changed
        if (window.onSettingsSaved) {
            window.onSettingsSaved();
        }
        
    } catch (error) {
        console.error('Error saving settings:', error);
        alert('Error saving settings. Please try again.');
    }
}

// Save only auto-execute setting
async function saveAutoExecuteSetting() {
    try {
        // Save to localStorage instead
        localStorage.setItem('autoExecuteCommands', state.autoExecuteCommands.toString());
    } catch (error) {
        console.error('Error saving auto-execute setting:', error);
    }
}

// Setup event listeners
function setupEventListeners() {
    if (!elements) return;
    
    // Settings button
    if (elements.settingsBtn) {
        elements.settingsBtn.addEventListener('click', openModal);
    }
    
    // Close button
    if (elements.closeBtn) {
        elements.closeBtn.addEventListener('click', closeModal);
    }
    
    // Save button
    if (elements.saveBtn) {
        elements.saveBtn.addEventListener('click', () => saveSettings());
    }
    
    // Close on outside click
    window.addEventListener('click', (e) => {
        if (e.target === elements.modal) {
            closeModal();
        }
    });
    
    // Auto execute toggle
    if (elements.autoExecuteCommands) {
        elements.autoExecuteCommands.addEventListener('change', (e) => {
            const checked = e.target.checked;
            updateState({ autoExecuteCommands: checked });
            // Save to localStorage immediately
            localStorage.setItem('autoExecuteCommands', checked.toString());
        });
    }
}

// Initialize the settings module
export function initializeSettings() {
    initializeElements();
    setupEventListeners();
    setupChangeTracking();
}

// Export functions that need to be called from outside
export const settings = {
    open: openModal,
    close: closeModal,
    save: saveSettings,
    saveAutoExecute: saveAutoExecuteSetting,
    load: loadCurrentSettings
};