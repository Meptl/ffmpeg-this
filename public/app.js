// Global state
let conversationHistory = [];
let currentProvider = '';
let configuredProviders = [];
let ffmpegAvailable = false;
let currentFile = null;
let systemPrompt = '';
let jsonTemplate = '';
let showRawMessages = true; // Flag to show raw messages instead of structured display

// DOM elements
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const providerSelect = document.getElementById('provider-select');
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const closeModal = document.querySelector('.close');
const saveSettingsBtn = document.getElementById('save-settings');
const ffmpegStatus = document.getElementById('ffmpeg-status');

// File upload elements
const fileInput = document.getElementById('file-input');
const fileUploadContainer = document.getElementById('file-upload-container');
const chatInputContainer = document.getElementById('chat-input-container');
const currentFileSpan = document.getElementById('current-file');
const changeFileBtn = document.getElementById('change-file-btn');

// Initialize on load
initialize();

async function initialize() {
    await loadPersistentSettings();
    const ffmpegOk = await checkFFmpegStatus();
    if (ffmpegOk) {
        // Check for pre-configured file first
        const preConfiguredFile = await checkPreConfiguredFile();
        if (preConfiguredFile) {
            // Skip file upload, go directly to chat
            currentFile = preConfiguredFile;
            showChatInterface();
        }
        await loadConfiguredProviders();
    }
}

// Event listeners
sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});
providerSelect.addEventListener('change', (e) => {
    currentProvider = e.target.value;
});
settingsBtn.addEventListener('click', () => {
    settingsModal.style.display = 'block';
    loadCurrentSettings();
});
closeModal.addEventListener('click', () => {
    settingsModal.style.display = 'none';
});
window.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
        settingsModal.style.display = 'none';
    }
});
saveSettingsBtn.addEventListener('click', saveSettings);

// File upload event listeners - auto upload on file selection
fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        uploadFile();
    }
});
changeFileBtn.addEventListener('click', () => {
    // Switch back to file upload interface
    fileUploadContainer.style.display = 'flex';
    chatInputContainer.style.display = 'none';
    currentFile = null;
    conversationHistory = [];
    messagesDiv.innerHTML = '';
});

// Load configured providers
async function loadConfiguredProviders() {
    try {
        const response = await fetch('/api/configured-providers');
        const data = await response.json();
        configuredProviders = data.providers;
        
        // Clear existing options
        providerSelect.innerHTML = '';
        
        if (configuredProviders.length === 0) {
            // No providers configured
            providerSelect.innerHTML = '<option value="">No providers configured</option>';
            providerSelect.disabled = true;
            messageInput.disabled = true;
            sendBtn.disabled = true;
            
            // Show welcome message
            addMessage('info', 'Welcome! Please click the Settings button to configure an API key for this session.');
        } else {
            // Add configured providers to dropdown
            providerSelect.disabled = false;
            messageInput.disabled = false;
            sendBtn.disabled = false;
            
            configuredProviders.forEach((provider, index) => {
                const option = document.createElement('option');
                option.value = provider.id;
                option.textContent = provider.name;
                providerSelect.appendChild(option);
                
                // Set first provider as current
                if (index === 0) {
                    currentProvider = provider.id;
                }
            });
        }
    } catch (error) {
        console.error('Error loading providers:', error);
        addMessage('error', 'Failed to load configured providers');
    }
}

// Load persistent settings
async function loadPersistentSettings() {
    try {
        const response = await fetch('/api/settings');
        const settings = await response.json();
        
        // Load prompt settings into global state
        if (settings.systemPrompt) {
            systemPrompt = settings.systemPrompt;
        }
        if (settings.jsonTemplate) {
            jsonTemplate = settings.jsonTemplate;
        }
        
        return settings;
    } catch (error) {
        console.error('Error loading persistent settings:', error);
    }
}

// Check for pre-configured file
async function checkPreConfiguredFile() {
    try {
        const response = await fetch('/api/preconfigured-file');
        const data = await response.json();
        
        if (data.file) {
            console.log('Pre-configured file found:', data.file.originalName);
            addMessage('info', `Using pre-configured file: ${data.file.originalName}`);
            addMessage('info', 'You can ask for FFmpeg commands to process this file. For example: "convert to grayscale", "reduce file size", "extract audio", etc.');
            return data.file;
        }
        return null;
    } catch (error) {
        console.error('Error checking pre-configured file:', error);
        return null;
    }
}

// Show chat interface (used for both uploaded and pre-configured files)
function showChatInterface() {
    fileUploadContainer.style.display = 'none';
    chatInputContainer.style.display = 'flex';
    currentFileSpan.textContent = currentFile.originalName;
}

// Check ffmpeg status
async function checkFFmpegStatus() {
    try {
        const response = await fetch('/api/ffmpeg-status');
        const data = await response.json();
        
        ffmpegAvailable = data.available;
        
        if (!data.available) {
            // Only show status when ffmpeg is NOT available
            ffmpegStatus.innerHTML = '⚠️ FFmpeg not found';
            ffmpegStatus.className = 'ffmpeg-status unavailable';
            ffmpegStatus.style.display = 'block';
            
            // Disable chat interface
            providerSelect.disabled = true;
            messageInput.disabled = true;
            sendBtn.disabled = true;
            
            // Show error message
            addMessage('error', 'FFmpeg is required but not found. Please install FFmpeg or configure the path in Settings.');
            
            return false;
        } else {
            // Hide status when ffmpeg IS available
            ffmpegStatus.style.display = 'none';
            return true;
        }
    } catch (error) {
        ffmpegStatus.innerHTML = '❌ Error checking FFmpeg';
        ffmpegStatus.className = 'ffmpeg-status error';
        ffmpegStatus.style.display = 'block';
        return false;
    }
}

// Upload file
async function uploadFile() {
    const file = fileInput.files[0];
    if (!file) return;
    
    const formData = new FormData();
    formData.append('file', file);
    
    // Show loading in the file label
    const label = document.querySelector('.file-input-label');
    const originalText = label.textContent;
    label.textContent = 'Uploading...';
    
    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (response.ok) {
            currentFile = data.file;
            
            // Switch to chat interface
            showChatInterface();
            
            // Show success message
            addMessage('info', `File uploaded successfully: ${currentFile.originalName}`);
            addMessage('info', 'Ask for FFmpeg operations. For example: "convert to grayscale", "reduce file size", "extract audio", etc.');
            
        } else {
            addMessage('error', `Upload failed: ${data.error}`);
            label.textContent = originalText;
        }
    } catch (error) {
        addMessage('error', `Upload error: ${error.message}`);
        label.textContent = originalText;
    }
}

// Send message
async function sendMessage() {
    const userInput = messageInput.value.trim();
    if (!userInput || !currentFile) return;
    
    let messageToSend = '';
    let conversationHistoryToSend = [...conversationHistory];
    
    if (useStructuredMode) {
        // In structured mode, send the raw user input
        messageToSend = userInput;
    } else {
        // In legacy mode, format with prompt template
        messageToSend = promptHeader
            .replace('{FILE_PATH}', currentFile.path)
            .replace('{USER_INPUT}', userInput);
        
        // Add formatted message to conversation history for legacy mode
        conversationHistoryToSend.push({ role: 'user', content: messageToSend });
    }
    
    // Add user's original input to UI
    addMessage('user', userInput);
    messageInput.value = '';
    
    // Show loading indicator
    const loadingId = addMessage('assistant', '...', true);
    
    try {
        const requestBody = {
            provider: currentProvider,
            message: messageToSend,
            conversationHistory: conversationHistoryToSend.slice(-10), // Keep last 10 messages for context
            useStructuredMode: useStructuredMode,
            userInput: userInput
        };
        
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });
        
        const data = await response.json();
        
        // Remove loading indicator
        removeMessage(loadingId);
        
        if (response.ok) {
            if (data.isStructured && data.parsedResponse) {
                // Handle structured response
                addStructuredMessage('assistant', data.response, data.parsedResponse);
                conversationHistory.push({ role: 'assistant', content: data.response });
            } else {
                // Handle regular response
                addMessage('assistant', data.response);
                if (!useStructuredMode) {
                    conversationHistory.push({ role: 'assistant', content: data.response });
                }
            }
        } else {
            addMessage('error', `Error: ${data.error}`);
        }
    } catch (error) {
        removeMessage(loadingId);
        addMessage('error', `Error: ${error.message}`);
    }
}

// Add message to UI
function addMessage(type, content, isLoading = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    if (isLoading) messageDiv.classList.add('loading');
    
    const id = Date.now();
    messageDiv.id = `msg-${id}`;
    
    // Format message content (handle code blocks, etc.)
    const formattedContent = formatMessageContent(content);
    const headerText = type === 'user' ? 'You' : 
                      type === 'assistant' ? currentProvider : 
                      type === 'info' ? 'Info' : 'System';
    messageDiv.innerHTML = `
        <div class="message-header">${headerText}</div>
        <div class="message-content">${formattedContent}</div>
    `;
    
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    
    return id;
}

// Remove message from UI
function removeMessage(id) {
    const element = document.getElementById(`msg-${id}`);
    if (element) element.remove();
}

// Add structured message to UI
function addStructuredMessage(type, rawContent, parsedResponse) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type} structured`;
    
    const id = Date.now();
    messageDiv.id = `msg-${id}`;
    
    const headerText = type === 'assistant' ? currentProvider : type;
    
    // Create structured display
    let structuredHTML = `<div class="message-header">${headerText}</div>`;
    
    if (parsedResponse.error) {
        structuredHTML += `
            <div class="message-content">
                <div class="error-section">
                    <strong>Error:</strong> ${parsedResponse.error}
                </div>
            </div>`;
    } else {
        structuredHTML += `
            <div class="message-content structured-content">
                <div class="command-section">
                    <strong>FFmpeg Command:</strong>
                    <pre><code>${parsedResponse.command}</code></pre>
                </div>`;
        
        if (parsedResponse.output_file) {
            structuredHTML += `
                <div class="output-section">
                    <strong>Output File:</strong> <code>${parsedResponse.output_file}</code>
                </div>`;
        }
        
        structuredHTML += `
                <div class="raw-response">
                    <details>
                        <summary>Raw Response</summary>
                        <pre><code>${formatMessageContent(rawContent)}</code></pre>
                    </details>
                </div>
            </div>`;
    }
    
    messageDiv.innerHTML = structuredHTML;
    
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    
    return id;
}

// Update mode display
function updateModeDisplay() {
    if (useStructuredMode) {
        messageInput.placeholder = "What operation do you want to perform? (e.g., 'convert to grayscale')";
    } else {
        messageInput.placeholder = "What would you like to do with this file? (e.g., 'convert to grayscale')";
    }
}

// Format message content
function formatMessageContent(content) {
    // Escape HTML
    content = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    // Format code blocks
    content = content.replace(/```([^`]+)```/g, '<pre><code>$1</code></pre>');
    
    // Format inline code
    content = content.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Convert newlines to br
    content = content.replace(/\n/g, '<br>');
    
    return content;
}

// Load current settings
async function loadCurrentSettings() {
    try {
        // Load API configs
        const response = await fetch('/api/config');
        const config = await response.json();
        
        // Populate form fields
        for (const [provider, settings] of Object.entries(config)) {
            if (provider === 'local') {
                document.getElementById('local-endpoint').value = settings.endpoint || '';
                document.getElementById('local-key').value = '';
                document.getElementById('local-model').value = settings.model || '';
                document.getElementById('local-headers').value = JSON.stringify(settings.headers || {}, null, 2);
            } else {
                const keyInput = document.getElementById(`${provider}-key`);
                const modelInput = document.getElementById(`${provider}-model`);
                if (keyInput) keyInput.value = '';
                if (modelInput) modelInput.value = settings.model || '';
            }
        }
        
        // Load persistent settings (ffmpeg path)
        const persistentResponse = await fetch('/api/settings');
        const persistentSettings = await persistentResponse.json();
        
        const ffmpegPathInput = document.getElementById('ffmpeg-path');
        if (ffmpegPathInput) {
            ffmpegPathInput.value = persistentSettings.ffmpegPath || '';
        }
        
        const promptHeaderInput = document.getElementById('prompt-header');
        if (promptHeaderInput) {
            promptHeaderInput.value = persistentSettings.promptHeader || 'Can you give me an ffmpeg command running on the input file {FILE_PATH} to {USER_INPUT}?';
        }
        
        const systemPromptInput = document.getElementById('system-prompt');
        if (systemPromptInput) {
            systemPromptInput.value = persistentSettings.systemPrompt || '';
        }
        
        const jsonTemplateInput = document.getElementById('json-template');
        if (jsonTemplateInput) {
            jsonTemplateInput.value = persistentSettings.jsonTemplate || '';
        }
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

// Save settings
async function saveSettings() {
    const providers = ['openai', 'anthropic', 'gemini', 'groq', 'deepseek'];
    
    for (const provider of providers) {
        const apiKey = document.getElementById(`${provider}-key`).value;
        const model = document.getElementById(`${provider}-model`).value;
        
        if (apiKey) {
            await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    provider,
                    config: { apiKey, model }
                })
            });
        }
    }
    
    // Save local LLM settings
    const localEndpoint = document.getElementById('local-endpoint').value;
    const localKey = document.getElementById('local-key').value;
    const localModel = document.getElementById('local-model').value;
    let localHeaders = {};
    
    try {
        localHeaders = JSON.parse(document.getElementById('local-headers').value);
    } catch (e) {
        console.error('Invalid JSON for headers');
    }
    
    if (localEndpoint) {
        await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                provider: 'local',
                config: {
                    endpoint: localEndpoint,
                    apiKey: localKey,
                    model: localModel,
                    headers: localHeaders
                }
            })
        });
    }
    
    // Save persistent settings (ffmpeg path and all prompt settings)
    const ffmpegPath = document.getElementById('ffmpeg-path').value;
    const newPromptHeader = document.getElementById('prompt-header').value;
    const newSystemPrompt = document.getElementById('system-prompt')?.value || '';
    const newJsonTemplate = document.getElementById('json-template')?.value || '';
    
    await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            ffmpegPath,
            promptHeader: newPromptHeader,
            systemPrompt: newSystemPrompt,
            jsonTemplate: newJsonTemplate
        })
    });
    
    // Update global prompt settings
    promptHeader = newPromptHeader;
    systemPrompt = newSystemPrompt;
    jsonTemplate = newJsonTemplate;
    
    settingsModal.style.display = 'none';
    alert('Settings saved successfully!');
    
    // Re-check ffmpeg status and reload providers
    const ffmpegOk = await checkFFmpegStatus();
    if (ffmpegOk) {
        await loadConfiguredProviders();
    }
}
