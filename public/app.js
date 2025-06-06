// Global state
let conversationHistory = [];
let currentProvider = '';
let configuredProviders = [];
let ffmpegAvailable = false;
let currentFile = null;
// Hardcoded prompts (moved from backend)
const systemPrompt = `You are an FFmpeg command generator.
The user will ask you a series of operations to perform.

These will be in this exact JSON format:
{
  "input_filename": "example.mp4",
  "operation": "description of what to do",
  "use_placeholders": true
}

For every response, you must provide output in this exact JSON format:
{
  "command": "complete ffmpeg command using {INPUT_FILE} and {OUTPUT_FILE} placeholders",
  "output_extension": "ext",
  "error": null | "some issue"
}

Rules:
- When use_placeholders is true (which it always will be), you MUST use {INPUT_FILE} and {OUTPUT_FILE} as placeholders in your ffmpeg commands
- Do NOT use actual file paths - only use the placeholder strings {INPUT_FILE} and {OUTPUT_FILE}
- Always provide output_extension - this field is mandatory
- Always include the -y flag in your ffmpeg commands to overwrite output files
- Set output_extension to the appropriate file extension (without the dot)
  Examples:
  - For MP3 audio: output_extension: "mp3"
  - For MP4 video: output_extension: "mp4"
  - For WAV audio: output_extension: "wav"
  - For GIF: output_extension: "gif"
  - For PNG image: output_extension: "png"
  - Choose extension based on the output format in your ffmpeg command
- Generate complete, runnable ffmpeg commands with placeholders
- For video operations, maintain quality unless asked to compress
- For audio extraction, use appropriate codec (mp3, wav, etc.)
- The system will handle file path substitution automatically
- If the operation is complex, break it into the most essential command
- If the operation is unclear or impossible, explain in the error field`;
let showRawMessages = false; // Flag to show raw messages instead of structured display
let messagesData = []; // Store message data for re-rendering
let settingsChanged = false; // Track if settings have been modified

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
const cancelBtn = document.getElementById('cancel-btn');

// File upload elements
const fileInput = document.getElementById('file-input');
const fileStatus = document.getElementById('file-status');
const fileUploadContainer = document.getElementById('file-upload-container');
const chatInputContainer = document.getElementById('chat-input-container');

// Initialize on load
initialize();

async function initialize() {
    await loadPersistentSettings();
    setupSettingsChangeTracking(); // Setup change tracking after DOM is loaded
    
    // Sync showRawMessages with checkbox state on page load
    showRawMessages = showRawMessagesToggle.checked;
    
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

// Global variable to track current execution
let currentExecutionId = null;

// Event listeners
sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});
cancelBtn.addEventListener('click', cancelExecution);
providerSelect.addEventListener('change', (e) => {
    currentProvider = e.target.value;
});
settingsBtn.addEventListener('click', () => {
    settingsModal.style.display = 'block';
    settingsChanged = false; // Reset change tracking when opening modal
    loadCurrentSettings();
});
closeModal.addEventListener('click', () => {
    closeSettingsModal();
});
window.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
        closeSettingsModal();
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

// File upload event listener
fileInput.addEventListener('change', handleFileUpload);

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

// Show chat interface (used for both file uploads and pre-configured files)
function showChatInterface() {
    fileUploadContainer.style.display = 'none';
    chatInputContainer.style.display = 'flex';
    
    // Ensure showRawMessages is synced with checkbox state
    showRawMessages = showRawMessagesToggle.checked;
    
    // Re-render any existing messages to respect the current toggle state
    if (messagesData.length > 0) {
        reRenderAllMessages();
    }
    
    // Show prompt header if raw mode is enabled and we have a system prompt
    if (showRawMessages && systemPrompt) {
        showPromptHeaderMessage();
    }
    
    // Add initial media embed for the current file
    if (currentFile) {
        addInitialFileEmbed();
    }
}

// Add initial media embed when chat starts
function addInitialFileEmbed() {
    if (!currentFile) return;
    
    // Remove existing file embed if it exists
    const existingEmbed = document.getElementById('initial-file-embed');
    if (existingEmbed) {
        existingEmbed.remove();
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message info file-intro';
    messageDiv.id = 'initial-file-embed';
    
    const mediaEmbed = createMediaEmbed(currentFile.filePath, currentFile.originalName);
    
    messageDiv.innerHTML = `
        <div class="message-header">Current Input File</div>
        <div class="message-content">
            ${mediaEmbed}
            <p style="margin-top: 1rem; color: #6c757d; font-size: 0.9rem;">
                Ready to process <strong>${currentFile.originalName}</strong>. 
                Describe what you'd like to do with this file.
            </p>
        </div>
    `;
    
    // Insert at the beginning of messages (after prompt header if it exists)
    const promptHeader = document.getElementById('prompt-header-message');
    if (promptHeader) {
        messagesDiv.insertBefore(messageDiv, promptHeader.nextSibling);
    } else {
        messagesDiv.insertBefore(messageDiv, messagesDiv.firstChild);
    }
    
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
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

// Handle file upload
async function handleFileUpload() {
    const file = fileInput.files[0];
    if (!file) return;
    
    // Show loading status
    fileStatus.textContent = '📁 Uploading file...';
    fileStatus.className = 'file-status loading';
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        const response = await fetch('/api/upload-file', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (response.ok) {
            currentFile = data.file;
            
            // Show success status
            fileStatus.textContent = `✅ ${data.file.originalName} uploaded`;
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
    
    // Build JSON message for display with actual server filename
    const jsonMessage = {
        input_filename: currentFile.fileName, // Use server-generated filename, not originalName
        operation: userInput,
        use_placeholders: true
    };
    const formattedJsonMessage = JSON.stringify(jsonMessage, null, 2);
    
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
                addStructuredMessage('assistant', data.response, data.parsedResponse, data.executableResponse);
            } else {
                // Fallback to regular message with parsing warning
                addMessage('assistant', data.response, false, true); // Add parsing warning flag
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
function addMessage(type, content, isLoading = false, hasParsingWarning = false) {
    // Don't store loading messages
    if (!isLoading && type !== 'loading') {
        storeMessageData(type, content);
    }
    
    return addMessageToUI(type, content, isLoading, hasParsingWarning);
}

// Store message data for re-rendering
function storeMessageData(type, content, parsedResponse = null, executableResponse = null) {
    messagesData.push({
        type,
        content,
        parsedResponse,
        executableResponse,
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
    
    // Re-add initial file embed if we have a current file
    if (currentFile) {
        addInitialFileEmbed();
    }
    
    messagesData.forEach((msgData, index) => {
        console.log(`Message ${index}:`, msgData.type, msgData.parsedResponse ? 'has parsed data' : 'no parsed data'); // Debug log
        if (msgData.type === 'assistant' && msgData.parsedResponse) {
            if (showRawMessages) {
                addMessageToUI('assistant', msgData.content);
            } else {
                addStructuredMessageToUI('assistant', msgData.content, msgData.parsedResponse, msgData.executableResponse);
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
function addMessageToUI(type, content, isLoading = false, hasParsingWarning = false) {
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
    
    const warningIcon = hasParsingWarning ? ' ⚠️' : '';
    
    messageDiv.innerHTML = `
        <div class="message-header">${headerText}${warningIcon}</div>
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
function addStructuredMessage(type, rawContent, parsedResponse, executableResponse = null) {
    // Store with parsed response data
    storeMessageData(type, rawContent, parsedResponse, executableResponse);
    
    console.log('addStructuredMessage called:', {
        type: type,
        showRawMessages: showRawMessages,
        hasParsedResponse: !!parsedResponse,
        hasExecutableResponse: !!executableResponse
    });
    
    if (showRawMessages) {
        return addMessageToUI(type, rawContent);
    } else {
        return addStructuredMessageToUI(type, rawContent, parsedResponse, executableResponse);
    }
}

// Add structured message to UI only (without storing data)
function addStructuredMessageToUI(type, rawContent, parsedResponse, executableResponse = null) {
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
        // Use executable command with real paths if available, otherwise use parsed response
        const commandToShow = executableResponse ? executableResponse.command : parsedResponse.command;
        const outputFileToShow = executableResponse ? executableResponse.output_file : null;
        const outputExtension = parsedResponse.output_extension;
        
        structuredHTML += `
            <div class="message-content structured-content">
                <div class="command-section">
                    <strong>FFmpeg Command (ready to run):</strong>
                    <pre><code>${commandToShow}</code></pre>
                    <div class="command-buttons">
                        <button class="copy-btn" data-command="${commandToShow.replace(/"/g, '&quot;')}" onclick="copyToClipboard(this.getAttribute('data-command'), this)">
                            📋 Copy Command
                        </button>
                        <button class="execute-btn" data-command="${commandToShow.replace(/"/g, '&quot;')}" data-output="${executableResponse ? executableResponse.output_file.replace(/"/g, '&quot;') : ''}" data-msgid="${id}" onclick="executeFFmpegCommand(this.getAttribute('data-command'), this.getAttribute('data-output'), this.getAttribute('data-msgid'))">
                            ▶️ Execute Command
                        </button>
                    </div>
                </div>`;
        
        if (outputExtension) {
            structuredHTML += `
                <div class="output-section">
                    <strong>Output Format:</strong> <code>.${outputExtension}</code>
                </div>`;
        }
        
        if (outputFileToShow) {
            structuredHTML += `
                <div class="output-section">
                    <strong>Output File:</strong> <code>${outputFileToShow}</code>
                </div>`;
            
            // Add media embed for output file if it exists and is a media file
            if (executableResponse && executableResponse.output_file) {
                const mediaType = getMediaType(executableResponse.output_file);
                if (mediaType !== 'unknown') {
                    const fileName = executableResponse.output_file.split('/').pop();
                    const mediaEmbed = createMediaEmbed(executableResponse.output_file, fileName);
                    structuredHTML += `
                        <div class="output-preview">
                            <strong>Output Preview:</strong>
                            ${mediaEmbed}
                        </div>`;
                }
            }
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


// Media embedding utilities
function getFileExtension(filePath) {
    return filePath.split('.').pop().toLowerCase();
}

function getMediaType(filePath) {
    const ext = getFileExtension(filePath);
    
    // Audio formats
    if (['mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a', 'wma'].includes(ext)) {
        return 'audio';
    }
    
    // Video formats
    if (['mp4', 'webm', 'ogg', 'avi', 'mov', 'wmv', 'flv', 'mkv', 'm4v'].includes(ext)) {
        return 'video';
    }
    
    // Image formats
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) {
        return 'image';
    }
    
    return 'unknown';
}

function createMediaEmbed(filePath, fileName) {
    const mediaType = getMediaType(filePath);
    const safeFileName = fileName.replace(/[<>&"']/g, function(match) {
        const htmlEntities = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' };
        return htmlEntities[match];
    });
    
    // Download icon SVG - resembles Firefox download icon (downward arrow to tray)
    const downloadIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" class="download-icon">
        <path d="M8 11L3 6h3V1h4v5h3l-5 5z"/>
        <rect x="1" y="12" width="14" height="2" rx="1"/>
    </svg>`;
    
    const downloadButton = `<button class="download-btn" onclick="downloadFile('${filePath.replace(/'/g, "\\'")}', '${safeFileName.replace(/'/g, "\\'")}')">
        ${downloadIcon}
    </button>`;
    
    switch (mediaType) {
        case 'audio':
            return `
                <div class="media-embed audio-embed">
                    <div class="media-header">🎵 ${safeFileName} ${downloadButton}</div>
                    <audio controls>
                        <source src="/api/serve-file?path=${encodeURIComponent(filePath)}" type="audio/${getFileExtension(filePath)}">
                        Your browser does not support the audio element.
                    </audio>
                </div>`;
        
        case 'video':
            return `
                <div class="media-embed video-embed">
                    <div class="media-header">🎬 ${safeFileName} ${downloadButton}</div>
                    <video controls>
                        <source src="/api/serve-file?path=${encodeURIComponent(filePath)}" type="video/${getFileExtension(filePath)}">
                        Your browser does not support the video element.
                    </video>
                </div>`;
        
        case 'image':
            return `
                <div class="media-embed image-embed">
                    <div class="media-header">🖼️ ${safeFileName} ${downloadButton}</div>
                    <img src="/api/serve-file?path=${encodeURIComponent(filePath)}" alt="${safeFileName}" loading="lazy">
                </div>`;
        
        default:
            return `
                <div class="media-embed file-embed">
                    <div class="media-header">📄 ${safeFileName} ${downloadButton}</div>
                    <div class="file-info">File type not supported for preview</div>
                </div>`;
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
        
        
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}


// Close settings modal with optional change check
function closeSettingsModal() {
    if (settingsChanged) {
        const shouldSave = confirm('You have unsaved changes. Would you like to save them before closing?');
        if (shouldSave) {
            saveSettings(true); // Pass flag to suppress success alert
            return;
        }
    }
    settingsModal.style.display = 'none';
}

// Track changes in settings inputs
function setupSettingsChangeTracking() {
    // Track all input changes in the settings modal
    const settingsInputs = settingsModal.querySelectorAll('input, textarea, select');
    settingsInputs.forEach(input => {
        input.addEventListener('change', () => {
            settingsChanged = true;
        });
        input.addEventListener('input', () => {
            settingsChanged = true;
        });
    });
}

// Download file function
function downloadFile(filePath, fileName) {
    // Create a download link
    const link = document.createElement('a');
    link.href = `/api/serve-file?path=${encodeURIComponent(filePath)}`;
    link.download = fileName;
    link.style.display = 'none';
    
    // Add to DOM, click, and remove
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Copy command to clipboard
async function copyToClipboard(command, buttonElement) {
    try {
        await navigator.clipboard.writeText(command);
        
        // Update button to show success
        const originalText = buttonElement.innerHTML;
        buttonElement.innerHTML = '✅ Copied!';
        buttonElement.classList.add('copied');
        
        // Reset button after 2 seconds
        setTimeout(() => {
            buttonElement.innerHTML = originalText;
            buttonElement.classList.remove('copied');
        }, 2000);
        
    } catch (error) {
        console.error('Failed to copy to clipboard:', error);
        
        // Fallback: create a temporary textarea
        const textarea = document.createElement('textarea');
        textarea.value = command;
        document.body.appendChild(textarea);
        textarea.select();
        
        try {
            document.execCommand('copy');
            
            // Update button to show success
            const originalText = buttonElement.innerHTML;
            buttonElement.innerHTML = '✅ Copied!';
            buttonElement.classList.add('copied');
            
            setTimeout(() => {
                buttonElement.innerHTML = originalText;
                buttonElement.classList.remove('copied');
            }, 2000);
            
        } catch (fallbackError) {
            console.error('Fallback copy also failed:', fallbackError);
            
            // Show error state
            const originalText = buttonElement.innerHTML;
            buttonElement.innerHTML = '❌ Copy Failed';
            buttonElement.classList.add('error');
            
            setTimeout(() => {
                buttonElement.innerHTML = originalText;
                buttonElement.classList.remove('error');
            }, 2000);
        }
        
        document.body.removeChild(textarea);
    }
}

// Execute FFmpeg command
async function executeFFmpegCommand(command, outputFile, messageId) {
    // Escape dots in the messageId for valid CSS selector
    const escapedId = messageId.toString().replace(/\./g, '\\.');
    const executeBtn = document.querySelector(`#msg-${escapedId} .execute-btn`);
    
    if (!executeBtn) return;
    
    // Disable button and show loading state
    executeBtn.disabled = true;
    executeBtn.innerHTML = '⏳ Executing...';
    executeBtn.classList.add('executing');
    
    // Set current execution and show cancel button
    currentExecutionId = messageId;
    cancelBtn.style.display = 'inline-block';
    
    try {
        const response = await fetch('/api/execute-ffmpeg', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                command: command,
                outputFile: outputFile,
                executionId: messageId
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            // Update button to show success
            executeBtn.innerHTML = '✅ Executed Successfully';
            executeBtn.classList.remove('executing');
            executeBtn.classList.add('executed');
            
            // Add execution result message
            addExecutionResultMessage(result, messageId);
            
            // If there's an output file, update the current file for chaining
            if (result.outputFile) {
                // Update current file info for next operations
                const fileName = result.outputFile.split('/').pop();
                currentFile = {
                    originalName: fileName,
                    fileName: fileName,
                    filePath: result.outputFile,
                    path: result.outputFile,
                    size: result.outputSize || 0,
                    mimetype: 'application/octet-stream'
                };
                
                console.log('Updated current file for chaining:', currentFile.originalName);
            }
            
        } else {
            // Show error
            executeBtn.innerHTML = '❌ Execution Failed';
            executeBtn.classList.remove('executing');
            executeBtn.classList.add('error');
            
            // Add error message
            addMessage('error', `FFmpeg execution failed: ${result.error}`);
        }
        
    } catch (error) {
        console.error('Error executing FFmpeg:', error);
        executeBtn.innerHTML = '❌ Execution Failed';
        executeBtn.classList.remove('executing');
        executeBtn.classList.add('error');
        
        addMessage('error', `Error executing FFmpeg: ${error.message}`);
    } finally {
        // Clear current execution and hide cancel button
        if (currentExecutionId === messageId) {
            currentExecutionId = null;
            cancelBtn.style.display = 'none';
        }
    }
}

// Cancel execution function
async function cancelExecution() {
    if (!currentExecutionId) return;
    
    try {
        const response = await fetch('/api/cancel-ffmpeg', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                executionId: currentExecutionId
            })
        });
        
        if (response.ok) {
            addMessage('info', '🚫 FFmpeg execution cancelled');
        }
    } catch (error) {
        console.error('Error cancelling execution:', error);
        addMessage('error', `Error cancelling execution: ${error.message}`);
    }
    
    // Clear execution state
    currentExecutionId = null;
    cancelBtn.style.display = 'none';
}

// Add execution result message
function addExecutionResultMessage(result, parentMessageId) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message system execution-result';
    
    const id = Date.now() + Math.random();
    messageDiv.id = `msg-${id}`;
    
    let resultHTML = `
        <div class="message-header">Execution Result</div>
        <div class="message-content">
            <div class="execution-success">
                <strong>✅ ${result.message}</strong>
            </div>`;
    
    if (result.outputFile) {
        const fileName = result.outputFile.split('/').pop();
        const mediaEmbed = createMediaEmbed(result.outputFile, fileName);
        
        resultHTML += `
            <div class="output-result">
                <strong>Generated Output:</strong>
                ${mediaEmbed}
                <p style="margin-top: 0.5rem; font-size: 0.9rem; color: #6c757d;">
                    This output is now ready as input for your next command.
                </p>
            </div>`;
    }
    
    if (result.stderr && result.stderr.trim()) {
        resultHTML += `
            <div class="ffmpeg-log">
                <details>
                    <summary>FFmpeg Log</summary>
                    <pre><code>${result.stderr}</code></pre>
                </details>
            </div>`;
    }
    
    resultHTML += '</div>';
    messageDiv.innerHTML = resultHTML;
    
    // Insert after the parent message
    // Escape dots in the parentMessageId for valid selector
    const escapedParentId = parentMessageId.toString().replace(/\./g, '\\.');
    const parentMessage = document.getElementById(`msg-${escapedParentId}`);
    if (parentMessage && parentMessage.nextSibling) {
        messagesDiv.insertBefore(messageDiv, parentMessage.nextSibling);
    } else {
        messagesDiv.appendChild(messageDiv);
    }
    
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    
    return id;
}

// Save settings
async function saveSettings(suppressAlert = false) {
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
    
    // Save persistent settings (ffmpeg path only)
    const ffmpegPath = document.getElementById('ffmpeg-path').value;
    
    await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            ffmpegPath
        })
    });
    
    settingsChanged = false; // Reset change tracking after saving
    settingsModal.style.display = 'none';
    
    if (!suppressAlert) {
        alert('Settings saved successfully!');
    }
    
    // Re-check ffmpeg status and reload providers
    const ffmpegOk = await checkFFmpegStatus();
    if (ffmpegOk) {
        await loadConfiguredProviders();
    }
}
