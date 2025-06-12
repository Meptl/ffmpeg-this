// Global state
let messageManager = null; // Will be initialized after DOM loads
let currentProvider = '';
let configuredProviders = [];
let ffmpegAvailable = false;
let currentFile = null;
let initialFile = null;
let showRawMessages = false; // Flag to show raw messages instead of structured display - defaults to false
let autoExecuteCommands = true; // Flag to auto-execute FFmpeg commands - defaults to true
let settingsChanged = false; // Track if settings have been modified

// Region selection state
let regionSelection = null; // {x, y, width, height} in pixels relative to displayed size
let actualRegion = null; // {x, y, width, height} in pixels relative to original media
let isSelecting = false;
let selectionStart = null;
let activeSelectionContainer = null; // Track which container is in selection mode

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
// Remove reference to main UI toggle since it's been moved to settings
const cancelBtn = document.getElementById('cancel-btn');

// File upload elements
const fileInput = document.getElementById('file-input');
const fileStatus = document.getElementById('file-status');
const fileUploadContainer = document.getElementById('file-upload-container');
const chatInputContainer = document.getElementById('chat-input-container');

// Get provider display name
function getProviderDisplayName(provider) {
    const names = {
        openai: 'OpenAI',
        anthropic: 'Anthropic',
        gemini: 'Gemini',
        groq: 'Groq',
        deepseek: 'DeepSeek',
        local: 'Local LLM'
    };
    return names[provider] || provider;
}

// Initialize on load
initialize();

async function initialize() {
    // Initialize message manager
    messageManager = new MessageManager();
    
    const settings = await loadPersistentSettings();
    
    // Load autoExecute setting
    if (settings && settings.autoExecuteCommands !== undefined) {
        autoExecuteCommands = settings.autoExecuteCommands;
    }
    
    // Load showRawMessages setting
    if (settings && settings.showRawMessages !== undefined) {
        showRawMessages = settings.showRawMessages;
        messageManager.setDisplayMode(showRawMessages);
        // Also set the checkbox if it exists
        const showRawMessagesCheckbox = document.getElementById('show-raw-messages');
        if (showRawMessagesCheckbox) {
            showRawMessagesCheckbox.checked = showRawMessages;
        }
    }
    
    setupSettingsChangeTracking(); // Setup change tracking after DOM is loaded
    
    const ffmpegOk = await checkFFmpegStatus();
    if (ffmpegOk) {
        // Check for pre-configured file first
        const preConfiguredFile = await checkPreConfiguredFile();
        if (preConfiguredFile) {
            // Skip file upload, go directly to chat
            currentFile = preConfiguredFile;
            initialFile = { ...preConfiguredFile }; // Store initial file separately
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
// Event listener moved to settings modal

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

// Drag and drop event listeners
const dropZone = document.getElementById('drop-zone');

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-over');
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        // Use the first file
        fileInput.files = files;
        handleFileUpload();
    }
});

// Prevent default drag behavior on the whole document
document.addEventListener('dragover', (e) => {
    e.preventDefault();
});

document.addEventListener('drop', (e) => {
    e.preventDefault();
});

// Add paste event listener for clipboard image support
document.addEventListener('paste', async (e) => {
    // Only handle paste when file upload container is visible
    if (fileUploadContainer.style.display === 'none') return;
    
    // Check if clipboard contains image data
    const items = e.clipboardData.items;
    for (const item of items) {
        if (item.type.indexOf('image') !== -1) {
            e.preventDefault();
            
            // Get the image as a blob
            const blob = item.getAsFile();
            if (blob) {
                // Create a File object with a name based on the type
                const extension = blob.type.split('/')[1] || 'png';
                const fileName = `pasted-image-${Date.now()}.${extension}`;
                const file = new File([blob], fileName, { type: blob.type });
                
                // Create a DataTransfer object to set the files property
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(file);
                fileInput.files = dataTransfer.files;
                
                // Trigger file upload
                handleFileUpload();
                
                // Visual feedback
                dropZone.classList.add('drag-over');
                setTimeout(() => {
                    dropZone.classList.remove('drag-over');
                }, 300);
            }
            break;
        }
    }
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
    
    // Add initial file to message manager if not already there
    if (initialFile) {
        const messages = messageManager.getMessages();
        if (!messages.some(msg => msg.type === 'initial-file')) {
            messageManager.addInitialFileMessage(initialFile);
        }
    }
    
    // Re-render any existing messages to respect the current toggle state
    const messages = messageManager.getMessages();
    if (messages.length > 0) {
        reRenderAllMessages();
    } else {
        // Show prompt header if raw mode is enabled and we have a system prompt
        if (showRawMessages && messageManager.getSystemPrompt()) {
            showPromptHeaderMessage();
        }
    }
}

// Add initial media embed when chat starts
function addInitialFileEmbed() {
    if (!initialFile) return;
    
    // Remove existing file embed if it exists
    const existingEmbed = document.getElementById('initial-file-embed');
    if (existingEmbed) {
        existingEmbed.remove();
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message user initial-media';
    messageDiv.id = 'initial-file-embed';
    
    const mediaEmbed = createMediaEmbed(initialFile.filePath, initialFile.originalName, true, true);
    
    messageDiv.innerHTML = `
        <div class="message-content">
            ${mediaEmbed}
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
    
    // Clear any previous status
    fileStatus.textContent = '';
    fileStatus.className = 'file-status';
    
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
            initialFile = { ...data.file }; // Store initial file separately
            
            // Don't show success status, just switch to chat interface
            fileStatus.textContent = '';
            fileStatus.className = 'file-status';
            
            showChatInterface();
            
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
    
    // Calculate region coordinates if we have a selection
    let regionString = null;
    if (regionSelection && currentFile && currentFile.filePath) {
        // Check if the region selection was made on the current file
        if (regionSelection.filePath && regionSelection.filePath !== currentFile.filePath) {
            console.log('Region selection was made on a different file, clearing it');
            console.log('Region file:', regionSelection.filePath);
            console.log('Current file:', currentFile.filePath);
            regionSelection = null;
            actualRegion = null;
        } else {
            try {
                console.log('Calculating region coordinates for current file:', currentFile.filePath);
                const regionResponse = await fetch('/api/calculate-region', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        displayRegion: regionSelection,
                        filePath: currentFile.filePath
                    })
                });
            
                if (regionResponse.ok) {
                    const regionData = await regionResponse.json();
                    regionString = regionData.regionString;
                    console.log('Region calculated for current file:', regionString);
                } else {
                    const errorData = await regionResponse.json();
                    console.error('Failed to calculate region for current file:', errorData);
                    if (errorData.debug) {
                        console.error('Region calculation debug info:', errorData.debug);
                    }
                    // Clear region selection if calculation fails (e.g., dimensions don't match)
                    regionSelection = null;
                    actualRegion = null;
                    console.log('Region selection cleared due to calculation failure');
                }
            } catch (error) {
                console.error('Error calculating region:', error);
            }
        }
    }
    
    // Build JSON message for display with actual server filename
    const jsonMessage = MessageFormatter.formatUserMessage(userInput, currentFile, regionString);
    const formattedJsonMessage = JSON.stringify(jsonMessage, null, 2);
    
    // Always use structured mode, send formatted JSON
    const messageToSend = formattedJsonMessage;
    
    // Store user message in message manager
    const userMsg = messageManager.addUserMessage(userInput, jsonMessage);
    
    // Add message to UI - show formatted JSON in raw mode, user input in structured mode
    if (showRawMessages) {
        addMessageToUI('user', formattedJsonMessage);
    } else {
        addMessageToUI('user', userInput);
    }
    messageInput.value = '';
    
    // Clear region selection after sending message
    if (regionSelection) {
        console.log('Clearing region selection after message sent');
        regionSelection = null;
        actualRegion = null;
        
        // Clear visual selection from all containers
        document.querySelectorAll('.region-selection-container').forEach(container => {
            const overlay = container.querySelector('.region-selection-overlay');
            if (overlay) {
                overlay.innerHTML = '';
            }
            container.classList.remove('has-selection');
        });
        
        // Exit selection mode for any active containers
        if (activeSelectionContainer) {
            activeSelectionContainer.classList.remove('selection-mode');
            const activeBtn = activeSelectionContainer.closest('.media-embed').querySelector('.region-select-btn');
            if (activeBtn) {
                activeBtn.classList.remove('active');
                activeBtn.innerHTML = '✂️';
            }
            
            // Re-enable video controls if needed
            const video = activeSelectionContainer.querySelector('video');
            if (video) {
                video.controls = true;
            }
            
            activeSelectionContainer = null;
        }
    }
    
    // Show loading indicator
    const loadingId = addMessage('assistant', '...', true);
    
    try {
        const requestBody = {
            provider: currentProvider,
            message: messageToSend,
            conversationHistory: messageManager.getConversationHistory(10), // Keep last 10 messages for context
            useStructuredMode: true,
            userInput: userInput,
            // Send pre-calculated region string for consistency
            preCalculatedRegion: regionString
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
            // Try to parse the response as JSON even if not marked as structured
            let parsedJson = null;
            try {
                parsedJson = JSON.parse(data.response);
            } catch (e) {
                // Not JSON, that's okay
            }
            
            if (data.isStructured && data.parsedResponse) {
                // Always use structured message when we have parsed data
                addStructuredMessage('assistant', data.response, data.parsedResponse, data.executableResponse);
            } else if (parsedJson && (parsedJson.error || parsedJson.command)) {
                // We have valid JSON with error or command, display it structured
                addStructuredMessage('assistant', data.response, parsedJson, null);
            } else {
                // Fallback to regular message without warning
                addMessage('assistant', data.response, false, false);
            }
            
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
    // Store in message manager if not loading
    if (!isLoading && type !== 'loading') {
        messageManager.addSystemMessage(type, content);
    }
    
    return addMessageToUI(type, content, isLoading, hasParsingWarning);
}


// Re-render all messages based on current showRawMessages setting
function reRenderAllMessages() {
    messagesDiv.innerHTML = '';
    
    const messages = messageManager.getMessages();
    
    // Show prompt header if raw mode is enabled and we have messages
    if (showRawMessages && messageManager.getSystemPrompt() && messages.length > 0) {
        showPromptHeaderMessage();
    }
    
    messages.forEach((msgData) => {
        if (msgData.type === 'initial-file') {
            // Re-render initial file embed
            addInitialFileEmbed();
        } else if (msgData.type === 'assistant' && msgData.parsedResponse) {
            if (showRawMessages) {
                addMessageToUI('assistant', msgData.content || msgData.rawView);
            } else {
                addStructuredMessageToUI('assistant', msgData.content || msgData.rawView, msgData.parsedResponse, msgData.executableResponse || msgData.executableData);
            }
        } else if (msgData.type === 'user') {
            // User message with both formats available
            if (showRawMessages) {
                addMessageToUI('user', msgData.formattedJson || msgData.rawView);
            } else {
                addMessageToUI('user', msgData.content || msgData.humanView);
            }
        } else if (msgData.type === 'output-media') {
            // Re-render output media messages
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message assistant output-media';
            messageDiv.id = msgData.id || `msg-${Date.now() + Math.random()}`;
            
            const mediaEmbed = createMediaEmbed(msgData.outputFilePath || msgData.filePath, msgData.fileName, true);
            messageDiv.innerHTML = `
                <div class="message-content">
                    ${mediaEmbed}
                </div>
            `;
            
            messagesDiv.appendChild(messageDiv);
        } else {
            addMessageToUI(msgData.type, msgData.content || msgData.humanView || msgData.rawView);
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
            <pre><code>${formatMessageContent(messageManager.getSystemPrompt())}</code></pre>
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
                      type === 'assistant' ? getProviderDisplayName(currentProvider) : 
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
function addStructuredMessage(type, rawContent, parsedResponse, executableResponse = null) {
    messageManager.addAssistantMessage(rawContent, parsedResponse, executableResponse);
    
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
    
    const headerText = type === 'assistant' ? getProviderDisplayName(currentProvider) : type;
    
    // Create structured display
    let structuredHTML = `<div class="message-header">${headerText}</div>`;
    
    if (parsedResponse.error) {
        // Escape HTML in error message
        const escapedError = String(parsedResponse.error).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        structuredHTML += `
            <div class="message-content">
                <div class="error-section">
                    ${escapedError}
                </div>
            </div>`;
    } else {
        // Use executable command with real paths if available, otherwise use parsed response
        const commandToShow = executableResponse ? executableResponse.command : parsedResponse.command;
        
        structuredHTML += `
            <div class="message-content structured-content">
                <div class="command-section">
                    <pre><code>${commandToShow}</code></pre>
                    <div class="command-buttons">
                        <button class="copy-btn" data-command="${commandToShow.replace(/"/g, '&quot;')}" onclick="copyToClipboard(this.getAttribute('data-command'), this)">
                            📋 Copy Command
                        </button>
                        <button class="execute-btn" data-command="${commandToShow.replace(/"/g, '&quot;')}" data-output="${executableResponse ? executableResponse.output_file.replace(/"/g, '&quot;') : ''}" data-msgid="${id}" onclick="executeFFmpegCommand(this.getAttribute('data-command'), this.getAttribute('data-output'), this.getAttribute('data-msgid'))">
                            ▶️ Execute
                        </button>
                        ${!autoExecuteCommands ? `<button class="execute-auto-btn" data-command="${commandToShow.replace(/"/g, '&quot;')}" data-output="${executableResponse ? executableResponse.output_file.replace(/"/g, '&quot;') : ''}" data-msgid="${id}" onclick="executeAndToggleAuto(this.getAttribute('data-command'), this.getAttribute('data-output'), this.getAttribute('data-msgid'))">
                            ⚡ Execute (don't ask again)
                        </button>` : ''}
                    </div>
                </div>
            </div>`;
    }
    
    messageDiv.innerHTML = structuredHTML;
    
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    
    // Auto-execute if enabled and there's no error
    if (autoExecuteCommands && !parsedResponse.error && executableResponse) {
        // Small delay to allow the UI to render first
        setTimeout(() => {
            const executeBtn = messageDiv.querySelector('.execute-btn');
            if (executeBtn) {
                executeBtn.click();
            }
        }, 100);
    }
    
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

function createMediaEmbed(filePath, fileName, isResponseMedia = false, hideDownloadButton = false) {
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
    
    const downloadButton = hideDownloadButton ? '' : `<button class="download-btn" onclick="downloadFile('${filePath.replace(/'/g, "\\'")}', '${safeFileName.replace(/'/g, "\\'")}')">
        ${downloadIcon}
    </button>`;
    
    switch (mediaType) {
        case 'audio':
            if (isResponseMedia) {
                return `
                    <div class="media-embed audio-embed output-media">
                        <audio controls>
                            <source src="/api/serve-file?path=${encodeURIComponent(filePath)}" type="audio/${getFileExtension(filePath)}">
                            Your browser does not support the audio element.
                        </audio>
                        ${downloadButton}
                    </div>`;
            } else {
                return `
                    <div class="media-embed audio-embed">
                        <div class="media-header">${downloadButton} 🎵 ${safeFileName}</div>
                        <audio controls>
                            <source src="/api/serve-file?path=${encodeURIComponent(filePath)}" type="audio/${getFileExtension(filePath)}">
                            Your browser does not support the audio element.
                        </audio>
                    </div>`;
            }
        
        case 'video':
            if (isResponseMedia) {
                return `
                    <div class="media-embed video-embed output-media">
                        <div class="region-selection-container" data-file-path="${filePath.replace(/"/g, '&quot;')}">
                            <video controls>
                                <source src="/api/serve-file?path=${encodeURIComponent(filePath)}" type="video/${getFileExtension(filePath)}">
                                Your browser does not support the video element.
                            </video>
                            <div class="region-selection-overlay"></div>
                            <button class="clear-region-btn" onclick="clearRegionSelection(this)">Clear</button>
                        </div>
                        <button class="region-select-btn" onclick="toggleRegionSelectMode(this)" title="Select Region">✂️</button>
                        ${downloadButton}
                    </div>`;
            } else {
                return `
                    <div class="media-embed video-embed">
                        <div class="media-header"><button class="region-select-btn" onclick="toggleRegionSelectMode(this)" title="Select Region">✂️</button>${downloadButton} 🎬 ${safeFileName}</div>
                        <div class="region-selection-container" data-file-path="${filePath.replace(/"/g, '&quot;')}">
                            <video controls>
                                <source src="/api/serve-file?path=${encodeURIComponent(filePath)}" type="video/${getFileExtension(filePath)}">
                                Your browser does not support the video element.
                            </video>
                            <div class="region-selection-overlay"></div>
                            <button class="clear-region-btn" onclick="clearRegionSelection(this)">Clear</button>
                        </div>
                    </div>`;
            }
        
        case 'image':
            if (isResponseMedia) {
                return `
                    <div class="media-embed image-embed output-media">
                        <div class="region-selection-container" data-file-path="${filePath.replace(/"/g, '&quot;')}">
                            <img src="/api/serve-file?path=${encodeURIComponent(filePath)}" alt="${safeFileName}" loading="lazy">
                            <div class="region-selection-overlay"></div>
                            <button class="clear-region-btn" onclick="clearRegionSelection(this)">Clear</button>
                        </div>
                        <button class="region-select-btn" onclick="toggleRegionSelectMode(this)" title="Select Region">✂️</button>
                        ${downloadButton}
                    </div>`;
            } else {
                return `
                    <div class="media-embed image-embed">
                        <div class="media-header"><button class="region-select-btn" onclick="toggleRegionSelectMode(this)" title="Select Region">✂️</button>${downloadButton} 🖼️ ${safeFileName}</div>
                        <div class="region-selection-container" data-file-path="${filePath.replace(/"/g, '&quot;')}">
                            <img src="/api/serve-file?path=${encodeURIComponent(filePath)}" alt="${safeFileName}" loading="lazy">
                            <div class="region-selection-overlay"></div>
                            <button class="clear-region-btn" onclick="clearRegionSelection(this)">Clear</button>
                        </div>
                    </div>`;
            }
        
        default:
            if (isResponseMedia) {
                return `
                    <div class="media-embed file-embed output-media">
                        <div class="file-info">File type not supported for preview</div>
                        ${downloadButton}
                    </div>`;
            } else {
                return `
                    <div class="media-embed file-embed">
                        <div class="media-header">${downloadButton} 📄 ${safeFileName}</div>
                        <div class="file-info">File type not supported for preview</div>
                    </div>`;
            }
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
        
        // Update system settings checkboxes
        const showRawMessagesCheckbox = document.getElementById('show-raw-messages');
        if (showRawMessagesCheckbox) {
            showRawMessagesCheckbox.checked = showRawMessages;
        }
        
        const autoExecuteCheckbox = document.getElementById('auto-execute-commands');
        if (autoExecuteCheckbox) {
            autoExecuteCheckbox.checked = autoExecuteCommands;
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
    
    // Add event listener for show raw messages checkbox
    const showRawMessagesCheckbox = document.getElementById('show-raw-messages');
    if (showRawMessagesCheckbox) {
        showRawMessagesCheckbox.addEventListener('change', (e) => {
            showRawMessages = e.target.checked;
            messageManager.setDisplayMode(showRawMessages);
            reRenderAllMessages();
            
            // Show prompt header when raw JSON is enabled
            if (showRawMessages && messageManager.getSystemPrompt()) {
                showPromptHeaderMessage();
            } else {
                hidePromptHeaderMessage();
            }
        });
    }
    
    // Add event listener for auto execute checkbox
    const autoExecuteCheckbox = document.getElementById('auto-execute-commands');
    if (autoExecuteCheckbox) {
        autoExecuteCheckbox.addEventListener('change', (e) => {
            autoExecuteCommands = e.target.checked;
            // This is a persistent setting, so don't override settingsChanged
        });
    }
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

// Execute FFmpeg command and toggle auto-execute
async function executeAndToggleAuto(command, outputFile, messageId) {
    // Toggle the auto-execute setting
    autoExecuteCommands = true;
    
    // Update the checkbox in settings
    const autoExecuteCheckbox = document.getElementById('auto-execute-commands');
    if (autoExecuteCheckbox) {
        autoExecuteCheckbox.checked = true;
    }
    
    // Save the setting
    await saveAutoExecuteSetting();
    
    // Execute the command
    await executeFFmpegCommand(command, outputFile, messageId);
    
    // Hide all "don't ask again" buttons since auto-execute is now on
    document.querySelectorAll('.execute-auto-btn').forEach(btn => {
        btn.style.display = 'none';
    });
}

// Save only the auto-execute setting
async function saveAutoExecuteSetting() {
    try {
        await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                autoExecuteCommands: autoExecuteCommands
            })
        });
    } catch (error) {
        console.error('Error saving auto-execute setting:', error);
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
            
            // Add media embed as separate message if there's an output file
            if (result.outputFile) {
                addOutputMediaMessage(result.outputFile, messageId);
            }
            
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
    
    // Add media embed as separate message if there's an output file
    if (result.outputFile) {
        addOutputMediaMessage(result.outputFile, id);
    }
    
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    
    return id;
}

// Add output media as a separate message
function addOutputMediaMessage(outputFilePath, afterMessageId) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant output-media';
    
    const id = Date.now() + Math.random() + 0.1; // Slight offset to ensure unique ID
    messageDiv.id = `msg-${id}`;
    
    const fileName = outputFilePath.split('/').pop();
    const mediaEmbed = createMediaEmbed(outputFilePath, fileName, true);
    
    messageDiv.innerHTML = `
        <div class="message-content">
            ${mediaEmbed}
        </div>
    `;
    
    messageManager.addMediaOutputMessage(outputFilePath, fileName);
    
    // Insert after the command message
    const escapedId = afterMessageId.toString().replace(/\./g, '\\.');
    const afterMessage = document.getElementById(`msg-${escapedId}`);
    if (afterMessage && afterMessage.nextSibling) {
        messagesDiv.insertBefore(messageDiv, afterMessage.nextSibling);
    } else {
        messagesDiv.appendChild(messageDiv);
    }
    
    // Scroll to bottom after adding media
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
    
    // Save persistent settings (ffmpeg path, autoExecute, and showRawMessages)
    const ffmpegPath = document.getElementById('ffmpeg-path').value;
    const autoExecute = document.getElementById('auto-execute-commands').checked;
    const showRaw = document.getElementById('show-raw-messages').checked;
    
    await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            ffmpegPath,
            autoExecuteCommands: autoExecute,
            showRawMessages: showRaw
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

// Region Selection Functions
function initializeRegionSelection() {
    // Add event listeners to all region selection containers
    document.addEventListener('mousedown', handleRegionMouseDown);
    document.addEventListener('mousemove', handleRegionMouseMove);
    document.addEventListener('mouseup', handleRegionMouseUp);
}

function handleRegionMouseDown(e) {
    const container = e.target.closest('.region-selection-container');
    if (!container || e.target.tagName === 'BUTTON') return;
    
    // Only allow selection if this container is in selection mode
    if (!container.classList.contains('selection-mode')) return;
    
    // Prevent default drag behavior
    e.preventDefault();
    
    isSelecting = true;
    const rect = container.getBoundingClientRect();
    selectionStart = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        container: container
    };
    
    // Clear visual selection in this container only
    const overlay = container.querySelector('.region-selection-overlay');
    overlay.innerHTML = '';
    container.classList.remove('has-selection');
}

function handleRegionMouseMove(e) {
    if (!isSelecting || !selectionStart) return;
    
    const container = selectionStart.container;
    const rect = container.getBoundingClientRect();
    const media = container.querySelector('img, video');
    const mediaRect = media.getBoundingClientRect();
    
    // Calculate mouse position relative to container
    let currentX = e.clientX - rect.left;
    let currentY = e.clientY - rect.top;
    
    // Constrain to media boundaries
    const mediaOffsetX = mediaRect.left - rect.left;
    const mediaOffsetY = mediaRect.top - rect.top;
    const mediaWidth = media.offsetWidth;
    const mediaHeight = media.offsetHeight;
    
    currentX = Math.max(mediaOffsetX, Math.min(currentX, mediaOffsetX + mediaWidth));
    currentY = Math.max(mediaOffsetY, Math.min(currentY, mediaOffsetY + mediaHeight));
    
    // Constrain start position too (in case it was outside)
    const constrainedStartX = Math.max(mediaOffsetX, Math.min(selectionStart.x, mediaOffsetX + mediaWidth));
    const constrainedStartY = Math.max(mediaOffsetY, Math.min(selectionStart.y, mediaOffsetY + mediaHeight));
    
    // Calculate selection rectangle
    const x = Math.min(constrainedStartX, currentX);
    const y = Math.min(constrainedStartY, currentY);
    const width = Math.abs(currentX - constrainedStartX);
    const height = Math.abs(currentY - constrainedStartY);
    
    // Update region selection
    updateRegionSelection(container, x, y, width, height);
}

function handleRegionMouseUp(e) {
    if (!isSelecting) return;
    
    isSelecting = false;
    
    // Store the final selection
    const overlay = selectionStart.container.querySelector('.region-selection-overlay');
    const selection = overlay.querySelector('.region-selection');
    if (selection) {
        const container = selectionStart.container;
        const media = container.querySelector('img, video');
        
        const mediaContainer = selectionStart.container;
        const filePath = mediaContainer.getAttribute('data-file-path');
        
        regionSelection = {
            x: parseInt(selection.style.left),
            y: parseInt(selection.style.top),
            width: parseInt(selection.style.width),
            height: parseInt(selection.style.height),
            displayWidth: media.offsetWidth,
            displayHeight: media.offsetHeight,
            filePath: filePath // Track which file this selection was made on
        };
        
        console.log('Region selection stored:', regionSelection);
        console.log('Media element dimensions:', {
            offsetWidth: media.offsetWidth,
            offsetHeight: media.offsetHeight,
            clientWidth: media.clientWidth,
            clientHeight: media.clientHeight
        });
        container.classList.add('has-selection');
    }
    
    selectionStart = null;
}

function updateRegionSelection(container, x, y, width, height) {
    const overlay = container.querySelector('.region-selection-overlay');
    
    // Clear existing elements
    overlay.innerHTML = '';
    
    if (width < 5 || height < 5) return; // Minimum selection size
    
    // Create selection rectangle
    const selection = document.createElement('div');
    selection.className = 'region-selection';
    selection.style.left = x + 'px';
    selection.style.top = y + 'px';
    selection.style.width = width + 'px';
    selection.style.height = height + 'px';
    overlay.appendChild(selection);
    
    // Create darkening overlays
    const media = container.querySelector('img, video');
    const mediaWidth = media.offsetWidth;
    const mediaHeight = media.offsetHeight;
    
    // Top darkening
    const topDark = document.createElement('div');
    topDark.className = 'region-darkening top';
    topDark.style.height = y + 'px';
    overlay.appendChild(topDark);
    
    // Bottom darkening
    const bottomDark = document.createElement('div');
    bottomDark.className = 'region-darkening bottom';
    bottomDark.style.height = (mediaHeight - y - height) + 'px';
    overlay.appendChild(bottomDark);
    
    // Left darkening
    const leftDark = document.createElement('div');
    leftDark.className = 'region-darkening left';
    leftDark.style.top = y + 'px';
    leftDark.style.width = x + 'px';
    leftDark.style.height = height + 'px';
    overlay.appendChild(leftDark);
    
    // Right darkening
    const rightDark = document.createElement('div');
    rightDark.className = 'region-darkening right';
    rightDark.style.top = y + 'px';
    rightDark.style.width = (mediaWidth - x - width) + 'px';
    rightDark.style.height = height + 'px';
    overlay.appendChild(rightDark);
}

function clearRegionSelection(button) {
    console.log('Clearing region selection');
    const container = button.closest('.region-selection-container');
    const overlay = container.querySelector('.region-selection-overlay');
    overlay.innerHTML = '';
    container.classList.remove('has-selection');
    // Only clear if this was for the currently active selection
    const wasActiveContainer = container === activeSelectionContainer || 
                              container.classList.contains('selection-mode');
    if (wasActiveContainer || regionSelection) {
        regionSelection = null;
        actualRegion = null;
        console.log('Global region selection cleared');
    }
}

// Toggle region selection mode
function toggleRegionSelectMode(button) {
    // Find the container within the same media embed
    const mediaEmbed = button.closest('.media-embed');
    const container = mediaEmbed.querySelector('.region-selection-container');
    
    if (!container) return;
    
    const isActive = container.classList.contains('selection-mode');
    
    // Disable any other active selection mode
    if (activeSelectionContainer && activeSelectionContainer !== container) {
        activeSelectionContainer.classList.remove('selection-mode');
        const otherEmbed = activeSelectionContainer.closest('.media-embed');
        const otherBtn = otherEmbed.querySelector('.region-select-btn');
        if (otherBtn) {
            otherBtn.classList.remove('active');
            otherBtn.innerHTML = '✂️';
        }
    }
    
    if (isActive) {
        // Disable selection mode
        container.classList.remove('selection-mode');
        button.classList.remove('active');
        button.innerHTML = '✂️';
        activeSelectionContainer = null;
        
        // Re-enable video controls if needed
        const video = container.querySelector('video');
        if (video) {
            video.controls = true;
        }
    } else {
        // Enable selection mode
        container.classList.add('selection-mode');
        button.classList.add('active');
        button.innerHTML = '❌';
        activeSelectionContainer = container;
        
        // Disable video controls to prevent interference
        const video = container.querySelector('video');
        if (video) {
            video.controls = false;
        }
        
        // If we have a global region selection, display it
        if (regionSelection) {
            const media = container.querySelector('img, video');
            if (media) {
                // Check if this selection matches the current media dimensions
                const currentWidth = media.offsetWidth;
                const currentHeight = media.offsetHeight;
                
                // If dimensions match, show the selection
                if (Math.abs(currentWidth - regionSelection.displayWidth) < 5 && 
                    Math.abs(currentHeight - regionSelection.displayHeight) < 5) {
                    updateRegionSelection(container, regionSelection.x, regionSelection.y, 
                                        regionSelection.width, regionSelection.height);
                    container.classList.add('has-selection');
                    console.log('Restored region selection in this container');
                }
            }
        }
    }
}

// Make functions globally available
window.clearRegionSelection = clearRegionSelection;
window.toggleRegionSelectMode = toggleRegionSelectMode;


// Initialize region selection when DOM is ready
document.addEventListener('DOMContentLoaded', initializeRegionSelection);

// Also initialize on dynamic content
initializeRegionSelection();

// Image copy functionality
let hoveredMessage = null;
let hoveredImage = null;

// Track hovered messages that contain images
document.addEventListener('mouseover', (e) => {
    // Check if hovering over a message that contains media
    const message = e.target.closest('.message');
    if (message) {
        const mediaElement = message.querySelector('.media-embed img, .media-embed video');
        if (mediaElement) {
            hoveredMessage = message;
            hoveredImage = mediaElement;
            // Add subtle hover indication to the message
            message.style.outline = '2px solid rgba(0, 123, 255, 0.3)';
            message.style.outlineOffset = '2px';
        }
    }
});

document.addEventListener('mouseout', (e) => {
    // Remove hover indication when leaving a message
    const message = e.target.closest('.message');
    if (message && message === hoveredMessage) {
        // Check if we're moving to another element within the same message
        if (!e.relatedTarget || !message.contains(e.relatedTarget)) {
            message.style.outline = '';
            message.style.outlineOffset = '';
            hoveredMessage = null;
            hoveredImage = null;
        }
    }
});

// Handle Ctrl+C to copy hovered image
document.addEventListener('keydown', async (e) => {
    // Check for Ctrl+C (or Cmd+C on Mac)
    if ((e.ctrlKey || e.metaKey) && e.key === 'c' && hoveredImage) {
        // Don't interfere with text selection copying
        const selection = window.getSelection();
        if (selection && selection.toString().trim()) {
            return;
        }
        
        e.preventDefault();
        
        try {
            // Get the source URL
            const src = hoveredImage.src || hoveredImage.currentSrc;
            if (!src) return;
            
            // For video elements, we'll copy the current frame
            if (hoveredImage.tagName === 'VIDEO') {
                // Create a canvas to capture the current video frame
                const canvas = document.createElement('canvas');
                canvas.width = hoveredImage.videoWidth;
                canvas.height = hoveredImage.videoHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(hoveredImage, 0, 0);
                
                // Convert canvas to blob
                canvas.toBlob(async (blob) => {
                    if (blob) {
                        await copyBlobToClipboard(blob);
                        showCopyFeedback(hoveredImage, 'Video frame copied!');
                    }
                }, 'image/png');
            } else {
                // For images, fetch and copy
                const response = await fetch(src);
                const blob = await response.blob();
                await copyBlobToClipboard(blob);
                showCopyFeedback(hoveredImage, 'Image copied!');
            }
        } catch (error) {
            console.error('Failed to copy image:', error);
            showCopyFeedback(hoveredImage, 'Copy failed!', true);
        }
    }
});

// Copy blob to clipboard
async function copyBlobToClipboard(blob) {
    // Firefox on Linux has limited support for clipboard image types
    // Convert to PNG which has better support
    if (blob.type !== 'image/png') {
        blob = await convertBlobToPng(blob);
    }
    
    if (navigator.clipboard && window.ClipboardItem) {
        try {
            // Modern clipboard API
            const item = new ClipboardItem({ [blob.type]: blob });
            await navigator.clipboard.write([item]);
        } catch (error) {
            // Fallback for Firefox - try with just PNG
            if (blob.type !== 'image/png') {
                const pngBlob = await convertBlobToPng(blob);
                const item = new ClipboardItem({ 'image/png': pngBlob });
                await navigator.clipboard.write([item]);
            } else {
                throw error;
            }
        }
    } else {
        throw new Error('Clipboard API not supported');
    }
}

// Convert any image blob to PNG
async function convertBlobToPng(blob) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            canvas.toBlob(resolve, 'image/png');
        };
        img.onerror = reject;
        img.src = URL.createObjectURL(blob);
    });
}

// Show visual feedback when copying
function showCopyFeedback(element, message, isError = false) {
    // Create feedback element
    const feedback = document.createElement('div');
    feedback.className = 'copy-feedback';
    feedback.textContent = message;
    feedback.style.cssText = `
        position: absolute;
        background: ${isError ? '#dc3545' : '#28a745'};
        color: white;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 12px;
        pointer-events: none;
        z-index: 1000;
        animation: fadeInOut 1.5s ease-in-out;
    `;
    
    // Position feedback near the element
    const rect = element.getBoundingClientRect();
    feedback.style.left = rect.left + 'px';
    feedback.style.top = (rect.top - 30) + 'px';
    
    document.body.appendChild(feedback);
    
    // Remove after animation
    setTimeout(() => {
        feedback.remove();
    }, 1500);
}

// Add CSS animation for feedback
if (!document.getElementById('copy-feedback-styles')) {
    const style = document.createElement('style');
    style.id = 'copy-feedback-styles';
    style.textContent = `
        @keyframes fadeInOut {
            0% { opacity: 0; transform: translateY(10px); }
            20% { opacity: 1; transform: translateY(0); }
            80% { opacity: 1; transform: translateY(0); }
            100% { opacity: 0; transform: translateY(-10px); }
        }
    `;
    document.head.appendChild(style);
}
