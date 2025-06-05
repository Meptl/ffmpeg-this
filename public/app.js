// Global state
let conversationHistory = [];
let currentProvider = '';
let configuredProviders = [];
let ffmpegAvailable = false;
let currentFile = null;
let systemPrompt = '';
let jsonTemplate = '';
let showRawMessages = true; // Flag to show raw messages instead of structured display
let messagesData = []; // Store message data for re-rendering

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
const showRawMessagesToggle = document.getElementById('show-raw-messages-main');

// File path elements
const filePicker = document.getElementById('file-picker');
const fileStatus = document.getElementById('file-status');
const filePathContainer = document.getElementById('file-path-container');
const chatInputContainer = document.getElementById('chat-input-container');

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
        } else {
            // No pre-configured file, open file picker automatically
            setTimeout(() => {
                filePicker.click();
            }, 100);
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
showRawMessagesToggle.addEventListener('change', (e) => {
    showRawMessages = e.target.checked;
    console.log('Raw messages toggle:', showRawMessages); // Debug log
    reRenderAllMessages();
    
    // Show prompt header when raw JSON is enabled
    if (showRawMessages && systemPrompt) {
        showPromptHeaderMessage();
    } else {
        hidePromptHeaderMessage();
    }
});

// Tab switching functionality
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('tab-button')) {
        const targetTab = e.target.getAttribute('data-tab');
        
        // Remove active class from all tabs and content
        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        
        // Add active class to clicked tab and corresponding content
        e.target.classList.add('active');
        document.getElementById(targetTab + '-tab').classList.add('active');
    }
});

// File picker event listeners
filePicker.addEventListener('change', handleFileSelection);

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
            return data.file;
        }
        return null;
    } catch (error) {
        console.error('Error checking pre-configured file:', error);
        return null;
    }
}

// Show chat interface (used for both file paths and pre-configured files)
function showChatInterface() {
    filePathContainer.style.display = 'none';
    chatInputContainer.style.display = 'flex';
    
    // Show prompt header if raw mode is enabled and we have a system prompt
    if (showRawMessages && systemPrompt) {
        showPromptHeaderMessage();
    }
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

// Handle file selection from file picker
async function handleFileSelection(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    // Show loading status
    fileStatus.textContent = '📁 Processing file...';
    fileStatus.className = 'file-status loading';
    
    try {
        // Create a FormData object to send the file
        const formData = new FormData();
        formData.append('file', file);
        
        const response = await fetch('/api/upload-file', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (response.ok) {
            currentFile = data.file;
            
            // Show success status
            fileStatus.textContent = `✅ ${file.name} selected`;
            fileStatus.className = 'file-status success';
            
            // Switch to chat interface after a brief delay
            setTimeout(() => {
                showChatInterface();
            }, 500);
            
        } else {
            fileStatus.textContent = `❌ Error: ${data.error}`;
            fileStatus.className = 'file-status error';
        }
    } catch (error) {
        fileStatus.textContent = `❌ Error: ${error.message}`;
        fileStatus.className = 'file-status error';
    }
}


// Send message
async function sendMessage() {
    const userInput = messageInput.value.trim();
    if (!userInput || !currentFile) return;
    
    // Always use structured mode, send raw user input
    const messageToSend = userInput;
    
    // Format the JSON message that will be sent to show user what's actually being sent
    const formattedJsonMessage = jsonTemplate
        .replace('{INPUT_FILE}', '{INPUT_FILE}')
        .replace('{OUTPUT_FILE}', '{OUTPUT_FILE}')
        .replace('{USER_INPUT}', userInput);
    
    // Store both user input and formatted JSON for re-rendering
    storeUserMessageData(userInput, formattedJsonMessage);
    
    // Add message to UI - show formatted JSON in raw mode, user input in structured mode
    if (showRawMessages) {
        addMessageToUI('user', formattedJsonMessage);
    } else {
        addMessageToUI('user', userInput);
    }
    messageInput.value = '';
    
    // Show loading indicator
    const loadingId = addMessage('assistant', '...', true);
    
    try {
        const requestBody = {
            provider: currentProvider,
            message: messageToSend,
            conversationHistory: conversationHistory.slice(-10), // Keep last 10 messages for context
            useStructuredMode: true,
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
                // Always use structured message when we have parsed data
                addStructuredMessage('assistant', data.response, data.parsedResponse);
            } else {
                // Fallback to regular message
                addMessage('assistant', data.response);
            }
            conversationHistory.push({ role: 'assistant', content: data.response });
        } else {
            addMessage('error', `Error: ${data.error}`);
        }
    } catch (error) {
        removeMessage(loadingId);
        addMessage('error', `Error: ${error.message}`);
    }
}

// Add message to UI and store data
function addMessage(type, content, isLoading = false) {
    // Don't store loading messages
    if (!isLoading && type !== 'loading') {
        storeMessageData(type, content);
    }
    
    return addMessageToUI(type, content, isLoading);
}

// Store message data for re-rendering
function storeMessageData(type, content, parsedResponse = null) {
    messagesData.push({
        type,
        content,
        parsedResponse,
        timestamp: Date.now()
    });
}

// Store user message data with both formats
function storeUserMessageData(userInput, formattedJson) {
    messagesData.push({
        type: 'user',
        content: userInput,
        formattedJson: formattedJson,
        timestamp: Date.now()
    });
}

// Re-render all messages based on current showRawMessages setting
function reRenderAllMessages() {
    console.log('Re-rendering messages, count:', messagesData.length); // Debug log
    messagesDiv.innerHTML = '';
    
    // Show prompt header if raw mode is enabled and we have messages
    if (showRawMessages && systemPrompt && messagesData.length > 0) {
        showPromptHeaderMessage();
    }
    
    messagesData.forEach((msgData, index) => {
        console.log(`Message ${index}:`, msgData.type, msgData.parsedResponse ? 'has parsed data' : 'no parsed data'); // Debug log
        if (msgData.type === 'assistant' && msgData.parsedResponse) {
            if (showRawMessages) {
                addMessageToUI('assistant', msgData.content);
            } else {
                addStructuredMessageToUI('assistant', msgData.content, msgData.parsedResponse);
            }
        } else if (msgData.type === 'user' && msgData.formattedJson) {
            // User message with both formats available
            if (showRawMessages) {
                addMessageToUI('user', msgData.formattedJson);
            } else {
                addMessageToUI('user', msgData.content);
            }
        } else {
            addMessageToUI(msgData.type, msgData.content);
        }
    });
}

// Show prompt header message
function showPromptHeaderMessage() {
    const existingHeader = document.getElementById('prompt-header-message');
    if (existingHeader) return; // Already shown
    
    const headerDiv = document.createElement('div');
    headerDiv.id = 'prompt-header-message';
    headerDiv.className = 'message system prompt-header';
    headerDiv.innerHTML = `
        <div class="message-header">System Prompt</div>
        <div class="message-content">
            <pre><code>${formatMessageContent(systemPrompt)}</code></pre>
        </div>
    `;
    
    messagesDiv.insertBefore(headerDiv, messagesDiv.firstChild);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Hide prompt header message
function hidePromptHeaderMessage() {
    const existingHeader = document.getElementById('prompt-header-message');
    if (existingHeader) {
        existingHeader.remove();
    }
}

// Add message to UI only (without storing data)
function addMessageToUI(type, content, isLoading = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    if (isLoading) messageDiv.classList.add('loading');
    
    const id = Date.now() + Math.random();
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

// Add structured message to UI and store data
function addStructuredMessage(type, rawContent, parsedResponse) {
    // Store with parsed response data
    storeMessageData(type, rawContent, parsedResponse);
    
    if (showRawMessages) {
        return addMessageToUI(type, rawContent);
    } else {
        return addStructuredMessageToUI(type, rawContent, parsedResponse);
    }
}

// Add structured message to UI only (without storing data)
function addStructuredMessageToUI(type, rawContent, parsedResponse) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type} structured`;
    
    const id = Date.now() + Math.random();
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
    
    // Save persistent settings (ffmpeg path and prompt settings)
    const ffmpegPath = document.getElementById('ffmpeg-path').value;
    const newSystemPrompt = document.getElementById('system-prompt')?.value || '';
    const newJsonTemplate = document.getElementById('json-template')?.value || '';
    
    await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            ffmpegPath,
            systemPrompt: newSystemPrompt,
            jsonTemplate: newJsonTemplate
        })
    });
    
    // Update global prompt settings
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
