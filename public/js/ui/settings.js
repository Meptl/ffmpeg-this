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
        ffmpegPath: document.getElementById('ffmpeg-path'),
        showRawMessages: document.getElementById('show-raw-messages'),
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
            saveSettings(true);
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
                elements.providers.local.endpoint.value = settings.endpoint || '';
                elements.providers.local.key.value = '';
                elements.providers.local.model.value = settings.model || '';
                elements.providers.local.headers.value = JSON.stringify(settings.headers || {}, null, 2);
            } else if (elements.providers[provider]) {
                const providerElements = elements.providers[provider];
                if (providerElements.key) providerElements.key.value = '';
                if (providerElements.model) providerElements.model.value = settings.model || '';
            }
        }
        
        // Load persistent settings
        const persistentSettings = await api.getSettings();
        
        if (elements.ffmpegPath) {
            elements.ffmpegPath.value = persistentSettings.ffmpegPath || '';
        }
        
        // Update system settings checkboxes
        if (elements.showRawMessages) {
            elements.showRawMessages.checked = state.showRawMessages;
        }
        
        if (elements.autoExecuteCommands) {
            elements.autoExecuteCommands.checked = state.autoExecuteCommands;
        }
        
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

// Save all settings
async function saveSettings(suppressAlert = false) {
    const providers = ['openai', 'anthropic', 'gemini', 'groq', 'deepseek'];
    
    try {
        // Save provider settings
        for (const provider of providers) {
            const providerElements = elements.providers[provider];
            if (!providerElements) continue;
            
            const apiKey = providerElements.key?.value;
            const model = providerElements.model?.value;
            
            if (apiKey) {
                await api.saveConfig(provider, { apiKey, model });
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
            
            if (endpoint) {
                await api.saveConfig('local', { endpoint, apiKey, model, headers });
            }
        }
        
        // Save persistent settings
        const persistentData = {
            ffmpegPath: elements.ffmpegPath?.value || '',
            autoExecuteCommands: elements.autoExecuteCommands?.checked || false,
            showRawMessages: elements.showRawMessages?.checked || false
        };
        
        await api.saveSettings(persistentData);
        
        // Update state
        updateState({
            autoExecuteCommands: persistentData.autoExecuteCommands,
            showRawMessages: persistentData.showRawMessages
        });
        
        settingsChanged = false;
        elements.modal.style.display = 'none';
        
        if (!suppressAlert) {
            alert('Settings saved successfully!');
        }
        
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
        await api.saveSettings({ 
            autoExecuteCommands: state.autoExecuteCommands 
        });
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
    
    // Show raw messages toggle
    if (elements.showRawMessages) {
        elements.showRawMessages.addEventListener('change', (e) => {
            updateState({ showRawMessages: e.target.checked });
            
            // Trigger callback if defined
            if (window.onShowRawMessagesChanged) {
                window.onShowRawMessagesChanged(e.target.checked);
            }
        });
    }
    
    // Auto execute toggle
    if (elements.autoExecuteCommands) {
        elements.autoExecuteCommands.addEventListener('change', (e) => {
            updateState({ autoExecuteCommands: e.target.checked });
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