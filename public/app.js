// Import modules
import { state, updateState, getState, initializeState } from './js/core/state.js';
import { api } from './js/services/api.js';
import { initializeSettings, settings } from './js/ui/settings.js';
import { initializeRegionSelection, clearRegionSelection, toggleRegionSelectMode, regionSelection } from './js/ui/region-selection.js';
import { initializeHelp } from './js/ui/help.js';

// Global state - using imported state for most values
let messageManager = null; // Will be initialized after DOM loads

// These will be migrated to state module references
let currentProvider = '';
let configuredProviders = [];
let ffmpegAvailable = false;
let currentFile = null;
let initialFile = null;
let autoExecuteCommands = true;
let mostRecentMediaPath = null;

// Region selection state moved to state module

// DOM elements
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const providerSelect = document.getElementById('provider-select');
const ffmpegStatus = document.getElementById('ffmpeg-status');

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

// Global scroll handler for chat messages
function handleGlobalScroll(event) {
    // Check if any modal is active
    const modals = document.querySelectorAll('.modal');
    const isModalActive = Array.from(modals).some(modal => 
        modal.style.display === 'block' || modal.classList.contains('active')
    );
    
    // If a modal is active, don't intercept scroll
    if (isModalActive) {
        return;
    }
    
    // Get the messages container
    const messagesDiv = document.getElementById('messages');
    if (!messagesDiv) return;
    
    // Prevent default scroll behavior
    event.preventDefault();
    
    // Apply scroll to messages container
    const scrollAmount = event.deltaY;
    messagesDiv.scrollTop += scrollAmount;
}

// Add wheel event listener to capture scroll anywhere on page
document.addEventListener('wheel', handleGlobalScroll, { passive: false });

async function initialize() {
    // Initialize state from persistent storage
    await initializeState();
    
    // Initialize message manager
    messageManager = new MessageManager();
    updateState({ messageManager });
    
    // Get state values
    const currentState = getState();
    autoExecuteCommands = currentState.autoExecuteCommands;
    
    // Initialize settings module
    initializeSettings();
    
    // Initialize region selection
    initializeRegionSelection();
    
    // Initialize help modal
    initializeHelp();
    
    window.onSettingsSaved = async () => {
        // Re-check ffmpeg status and reload providers
        const ffmpegOk = await checkFFmpegStatus();
        if (ffmpegOk) {
            await loadConfiguredProviders();
        }
    };
    
    const ffmpegOk = await checkFFmpegStatus();
    if (ffmpegOk) {
        // Check for pre-configured file first
        const preConfiguredFile = await checkPreConfiguredFile();
        if (preConfiguredFile) {
            // Skip file upload, go directly to chat
            currentFile = preConfiguredFile;
            initialFile = { ...preConfiguredFile }; // Store initial file separately
            updateState({ currentFile, initialFile });
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
// Disable send button when input is empty
messageInput.addEventListener('input', (e) => {
    sendBtn.disabled = !messageInput.value.trim();
});
// Initial state - disable if empty
sendBtn.disabled = !messageInput.value.trim();
providerSelect.addEventListener('change', (e) => {
    currentProvider = e.target.value;
    updateState({ currentProvider });
    // Save to localStorage
    localStorage.setItem('selectedAIProvider', currentProvider);
});
// Settings module handles these events now
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
    if (!e.clipboardData || !e.clipboardData.items) {
        return;
    }
    
    const items = e.clipboardData.items;
    
    // Check if we have any files at all
    const fileItems = Array.from(items).filter(item => item.kind === 'file');
    
    // Show spinner immediately if we have any file items
    if (fileItems.length > 0) {
        const fileLabel = document.querySelector('.file-label');
        fileLabel.innerHTML = '<div class="upload-spinner"></div>';
        fileLabel.classList.add('uploading');
    }
    
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        
        if (item.kind === 'file' && item.type.indexOf('image/') !== -1) {
            e.preventDefault();
            
            try {
                const blob = item.getAsFile();
                if (blob) {
                    processClipboardBlob(blob);
                } else {
                    const fileLabel = document.querySelector('.file-label');
                    fileLabel.textContent = 'Select, drag or paste a file here';
                    fileLabel.classList.remove('uploading');
                }
            } catch (error) {
                const fileLabel = document.querySelector('.file-label');
                fileLabel.textContent = 'Select, drag or paste a file here';
                fileLabel.classList.remove('uploading');
            }
            return; // Exit after processing first image
        }
    }
    
    // If we showed spinner but found no images, hide it
    if (fileItems.length > 0) {
        const fileLabel = document.querySelector('.file-label');
        fileLabel.textContent = 'Select, drag or paste a file here';
        fileLabel.classList.remove('uploading');
    }
});

// Process clipboard blob
function processClipboardBlob(blob) {
    // Add timestamp to filename to ensure uniqueness
    const timestamp = Date.now();
    const extension = blob.type.split('/')[1] || 'png';
    const fileName = `pasted-image-${timestamp}.${extension}`;
    
    const file = new File([blob], fileName, { 
        type: blob.type,
        lastModified: timestamp
    });
    
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

// Load configured providers
async function loadConfiguredProviders() {
    try {
        const data = await api.getConfiguredProviders();
        configuredProviders = data.providers;
        updateState({ configuredProviders });
        
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
            sendBtn.disabled = !messageInput.value.trim(); // Check if input has text
            
            // Get saved provider from localStorage
            const savedProvider = localStorage.getItem('selectedAIProvider');
            let providerFound = false;
            
            configuredProviders.forEach((provider, index) => {
                const option = document.createElement('option');
                option.value = provider.id;
                option.textContent = provider.name;
                providerSelect.appendChild(option);
                
                // Check if this is the saved provider and it's still available
                if (savedProvider === provider.id) {
                    providerFound = true;
                    currentProvider = provider.id;
                    providerSelect.value = provider.id;
                    updateState({ currentProvider });
                }
            });
            
            // If saved provider not found or no saved provider, use first available
            if (!providerFound && configuredProviders.length > 0) {
                currentProvider = configuredProviders[0].id;
                providerSelect.value = configuredProviders[0].id;
                updateState({ currentProvider });
                // Save the new selection
                localStorage.setItem('selectedAIProvider', currentProvider);
            }
        }
    } catch (error) {
        addMessage('error', 'Failed to load configured providers');
    }
}

// Load persistent settings - now uses api module
async function loadPersistentSettings() {
    try {
        return await api.getSettings();
    } catch (error) {
        console.error('Error loading settings:', error);
        return null;
    }
}

// Check for pre-configured file
async function checkPreConfiguredFile() {
    return await api.getPreConfiguredFile();
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
    
    const showRegionBtn = initialFile.filePath === mostRecentMediaPath;
    const mediaEmbed = createMediaEmbed(initialFile.filePath, initialFile.originalName, true, true, showRegionBtn);
    
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
    
    // Scroll to bottom after delay
    scrollToBottomAfterDelay();
}

// Check ffmpeg status
async function checkFFmpegStatus() {
    try {
        const data = await api.checkFFmpegStatus();
        
        ffmpegAvailable = data.available;
        updateState({ ffmpegAvailable });
        
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
    
    // Show loading spinner if not already showing
    const fileLabel = document.querySelector('.file-label');
    if (!fileLabel.classList.contains('uploading')) {
        fileLabel.innerHTML = '<div class="upload-spinner"></div>';
        fileLabel.classList.add('uploading');
    }
    
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
            
            // Clear any existing region selection
            if (state.regionSelection) {
                updateState({ 
                    regionSelection: null,
                    actualRegion: null
                });
                
                // Clear visual selection from all containers
                document.querySelectorAll('.region-selection-container').forEach(container => {
                    const overlay = container.querySelector('.region-selection-overlay');
                    if (overlay) {
                        overlay.innerHTML = '';
                    }
                    container.classList.remove('has-selection');
                });
            }
            
            // Clear status and switch to chat interface
            fileStatus.textContent = '';
            fileStatus.className = 'file-status';
            
            showChatInterface();
            
        } else {
            fileStatus.textContent = `❌ Error: ${data.error}`;
            fileStatus.className = 'file-status error';
            // Restore label on error
            fileLabel.textContent = 'Select, drag or paste a file here';
            fileLabel.classList.remove('uploading');
        }
    } catch (error) {
        fileStatus.textContent = `❌ Error: ${error.message}`;
        fileStatus.className = 'file-status error';
        // Restore label on error
        const fileLabel = document.querySelector('.file-label');
        fileLabel.textContent = 'Select, drag or paste a file here';
        fileLabel.classList.remove('uploading');
    }
}


// Send message
async function sendMessage() {
    const userInput = messageInput.value.trim();
    if (!userInput || !currentFile) return;
    
    // Calculate region coordinates if we have a selection
    let regionString = null;
    if (state.regionSelection && currentFile && currentFile.filePath) {
        // Check if the region selection was made on the current file
        if (state.regionSelection.filePath && state.regionSelection.filePath !== currentFile.filePath) {
            updateState({ 
                regionSelection: null,
                actualRegion: null
            });
        } else {
            try {
                const regionResponse = await api.calculateRegion(state.regionSelection, currentFile.filePath);
                
                if (regionResponse && regionResponse.region) {
                    const region = regionResponse.region;
                    regionString = `${region.x},${region.y} ${region.width}x${region.height}`;
                } else {
                    // Clear region selection if calculation fails (e.g., dimensions don't match)
                    updateState({ 
                        regionSelection: null,
                        actualRegion: null
                    });
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
    
    // Add message to UI
    addMessageToUI('user', userInput);
    messageInput.value = '';
    sendBtn.disabled = true; // Disable send button after clearing input
    
    // Exit selection mode but keep visual selection after sending message
    if (state.regionSelection) {
        // Exit selection mode for any active containers
        if (state.activeSelectionContainer) {
            state.activeSelectionContainer.classList.remove('selection-mode');
            const activeBtn = state.activeSelectionContainer.closest('.media-embed').querySelector('.region-select-btn');
            if (activeBtn) {
                activeBtn.classList.remove('active');
                activeBtn.innerHTML = '<img src="assets/crop.svg" alt="Select Region" width="20" height="20" style="vertical-align: middle;">';
            }
            
            // Re-enable video controls if needed
            const video = state.activeSelectionContainer.querySelector('video');
            if (video) {
                video.controls = true;
            }
            
            updateState({ activeSelectionContainer: null });
        }
        
        updateState({ isSelecting: false });
        // Note: We're keeping regionSelection, actualRegion, and the visual overlay
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
            // Check if there was a parse error on the backend
            if (data.parseError) {
                // Show the response with a warning about parsing failure
                addMessage('assistant', data.response, false, true);
            } else if (data.isStructured && data.parsedResponse) {
                // Always use structured message when we have parsed data
                addStructuredMessage('assistant', data.response, data.parsedResponse, data.executableResponse);
            } else {
                // Try to parse the response as JSON even if not marked as structured
                let parsedJson = null;
                try {
                    parsedJson = JSON.parse(data.response);
                } catch (e) {
                    // Not JSON, that's okay
                }
                
                if (parsedJson && (parsedJson.error || parsedJson.command)) {
                    // We have valid JSON with error or command, display it structured
                    addStructuredMessage('assistant', data.response, parsedJson, null);
                } else {
                    // Fallback to regular message without warning
                    addMessage('assistant', data.response, false, false);
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

// Add message to UI and store data
function addMessage(type, content, isLoading = false, hasParsingWarning = false) {
    // Store in message manager if not loading
    if (!isLoading && type !== 'loading') {
        messageManager.addSystemMessage(type, content);
    }
    
    return addMessageToUI(type, content, isLoading, hasParsingWarning);
}


// Re-render all messages
function reRenderAllMessages() {
    messagesDiv.innerHTML = '';
    
    const messages = messageManager.getMessages();
    
    // First pass: find the most recent media
    let lastMediaPath = null;
    messages.forEach(msgData => {
        if (msgData.type === 'initial-file' && initialFile) {
            lastMediaPath = initialFile.filePath;
        } else if (msgData.type === 'output-media') {
            lastMediaPath = msgData.outputFilePath || msgData.filePath;
        }
    });
    mostRecentMediaPath = lastMediaPath;
    
    messages.forEach((msgData) => {
        if (msgData.type === 'initial-file') {
            // Re-render initial file embed
            addInitialFileEmbed();
        } else if (msgData.type === 'assistant' && msgData.parsedResponse) {
            addStructuredMessageToUI('assistant', msgData.content, msgData.parsedResponse, msgData.executableData);
        } else if (msgData.type === 'user') {
            addMessageToUI('user', msgData.content);
        } else if (msgData.type === 'output-media') {
            // Re-render output media messages
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message assistant output-media';
            messageDiv.id = msgData.id || `msg-${Date.now() + Math.random()}`;
            
            const filePath = msgData.outputFilePath || msgData.filePath;
            const showRegionBtn = filePath === mostRecentMediaPath;
            const mediaEmbed = createMediaEmbed(filePath, msgData.fileName, true, false, showRegionBtn);
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
        <div class="message-header">${headerText}${hasParsingWarning ? '<span class="parse-warning" title="Failed to parse JSON response"> ⚠️</span>' : ''}</div>
        <div class="message-content">${formattedContent}</div>
    `;
    
    messagesDiv.appendChild(messageDiv);
    scrollToBottomAfterDelay();
    
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
    return addStructuredMessageToUI(type, rawContent, parsedResponse, executableResponse);
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
                    <div class="command-code-wrapper">
                        <pre><code>${commandToShow}</code></pre>
                        <button class="copy-btn-overlay" data-command="${commandToShow.replace(/"/g, '&quot;')}" onclick="copyToClipboard(this.getAttribute('data-command'), this)" title="Copy command">
                            <img src="assets/copy.svg" alt="Copy" width="20" height="20">
                        </button>
                    </div>
                    <div class="command-buttons">
                        <button class="execute-btn" data-command="${commandToShow.replace(/"/g, '&quot;')}" data-output="${executableResponse ? executableResponse.output_file.replace(/"/g, '&quot;') : ''}" data-msgid="${id}" onclick="executeFFmpegCommand(this.getAttribute('data-command'), this.getAttribute('data-output'), this.getAttribute('data-msgid'))">
                            ▶️ Execute
                        </button>
                        <button class="cancel-execution-btn" data-msgid="${id}" onclick="cancelFFmpegExecution(this.getAttribute('data-msgid'))" style="display: none;">
                            🛑 Cancel
                        </button>
                        ${!autoExecuteCommands ? `<button class="execute-auto-btn" data-command="${commandToShow.replace(/"/g, '&quot;')}" data-output="${executableResponse ? executableResponse.output_file.replace(/"/g, '&quot;') : ''}" data-msgid="${id}" onclick="executeAndToggleAuto(this.getAttribute('data-command'), this.getAttribute('data-output'), this.getAttribute('data-msgid'))">
                            ⚡ Execute (don't ask again)
                        </button>` : ''}
                    </div>
                    <div class="ffmpeg-output-container" id="output-${id}">
                        <div class="ffmpeg-output-header">Output stream</div>
                        <div class="ffmpeg-output" id="output-content-${id}"></div>
                    </div>
                </div>
            </div>`;
    }
    
    messageDiv.innerHTML = structuredHTML;
    
    messagesDiv.appendChild(messageDiv);
    scrollToBottomAfterDelay();
    
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

function createMediaEmbed(filePath, fileName, isResponseMedia = false, hideDownloadButton = false, showRegionButton = false) {
    const mediaType = getMediaType(filePath);
    const safeFileName = fileName.replace(/[<>&"']/g, function(match) {
        const htmlEntities = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' };
        return htmlEntities[match];
    });
    
    // Use the download.svg asset
    const downloadIcon = `<img src="assets/download.svg" alt="Download" width="20" height="20" style="vertical-align: middle;">`;
    
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
                        ${showRegionButton ? '<button class="region-select-btn" onclick="toggleRegionSelectMode(this)" title="Select Region"><img src="assets/crop.svg" alt="Select Region" width="20" height="20" style="vertical-align: middle;"></button>' : ''}
                        ${downloadButton}
                    </div>`;
            } else {
                return `
                    <div class="media-embed video-embed">
                        <div class="media-header">${showRegionButton ? '<button class="region-select-btn" onclick="toggleRegionSelectMode(this)" title="Select Region">✂️</button>' : ''}${downloadButton} 🎬 ${safeFileName}</div>
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
                        ${showRegionButton ? '<button class="region-select-btn" onclick="toggleRegionSelectMode(this)" title="Select Region"><img src="assets/crop.svg" alt="Select Region" width="20" height="20" style="vertical-align: middle;"></button>' : ''}
                        ${downloadButton}
                    </div>`;
            } else {
                return `
                    <div class="media-embed image-embed">
                        <div class="media-header">${showRegionButton ? '<button class="region-select-btn" onclick="toggleRegionSelectMode(this)" title="Select Region">✂️</button>' : ''}${downloadButton} 🖼️ ${safeFileName}</div>
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

// Settings-related functions moved to settings.js module

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
        
        // Visual feedback - briefly change opacity
        buttonElement.style.opacity = '0.5';
        setTimeout(() => {
            buttonElement.style.opacity = '1';
        }, 200);
        
    } catch (error) {
        
        // Fallback: create a temporary textarea
        const textarea = document.createElement('textarea');
        textarea.value = command;
        document.body.appendChild(textarea);
        textarea.select();
        
        try {
            document.execCommand('copy');
            
            // Visual feedback
            buttonElement.style.opacity = '0.5';
            setTimeout(() => {
                buttonElement.style.opacity = '1';
            }, 200);
            
        } catch (fallbackError) {
            // Brief error indication
            buttonElement.style.opacity = '0.3';
            setTimeout(() => {
                buttonElement.style.opacity = '1';
            }, 500);
        }
        
        document.body.removeChild(textarea);
    }
}

// Execute FFmpeg command and toggle auto-execute
async function executeAndToggleAuto(command, outputFile, messageId) {
    // Toggle the auto-execute setting
    autoExecuteCommands = true;
    updateState({ autoExecuteCommands: true });
    
    // Save to localStorage
    localStorage.setItem('autoExecuteCommands', 'true');
    
    // Update the checkbox in settings
    const autoExecuteCheckbox = document.getElementById('auto-execute-commands');
    if (autoExecuteCheckbox) {
        autoExecuteCheckbox.checked = true;
    }
    
    // Execute the command
    await executeFFmpegCommand(command, outputFile, messageId);
    
    // Hide all "don't ask again" buttons since auto-execute is now on
    document.querySelectorAll('.execute-auto-btn').forEach(btn => {
        btn.style.display = 'none';
    });
}

// Save only the auto-execute setting
async function saveAutoExecuteSetting() {
    // Now handled directly in executeAndToggleAuto
    localStorage.setItem('autoExecuteCommands', autoExecuteCommands.toString());
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
    
    // Set current execution and show per-command cancel button
    currentExecutionId = messageId;
    const cancelExecutionBtn = document.querySelector(`#msg-${messageId.toString().replace(/\./g, '\\.')} .cancel-execution-btn`);
    if (cancelExecutionBtn) {
        cancelExecutionBtn.style.display = 'inline-block';
    }
    
    // Hide the "Execute (don't ask again)" button after clicking execute
    const executeAutoBtn = document.querySelector(`#msg-${messageId.toString().replace(/\./g, '\\.')} .execute-auto-btn`);
    if (executeAutoBtn) {
        executeAutoBtn.style.display = 'none';
    }
    
    // Clear output content but don't show container
    clearFFmpegOutput(messageId);
    
    // Set up SSE connection for real-time output
    const eventSource = new EventSource(`/api/stream-ffmpeg-output/${messageId}`);
    
    eventSource.onmessage = function(event) {
        try {
            const data = JSON.parse(event.data);
            
            if (data.type === 'output') {
                appendFFmpegOutput(messageId, data.data);
            } else if (data.type === 'complete') {
                eventSource.close();
                if (data.success && data.outputFile) {
                    addOutputMediaMessage(data.outputFile, messageId);
                    
                    // Update current file for chaining
                    const fileName = data.outputFile.split('/').pop();
                    currentFile = {
                        originalName: fileName,
                        fileName: fileName,
                        filePath: data.outputFile,
                        path: data.outputFile,
                        size: data.outputSize || 0,
                        mimetype: 'application/octet-stream'
                    };
                }
            } else if (data.type === 'error') {
                eventSource.close();
                appendFFmpegOutput(messageId, `Error: ${data.message}`);
            } else if (data.type === 'cancelled') {
                eventSource.close();
                appendFFmpegOutput(messageId, `Cancelled: ${data.message}`);
            }
        } catch (e) {
            console.error('Error parsing SSE data:', e);
        }
    };
    
    eventSource.onerror = function() {
        eventSource.close();
    };
    
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
        } else if (result.cancelled) {
            // Handle cancelled execution
            executeBtn.innerHTML = '🚫 Cancelled';
            executeBtn.classList.remove('executing');
            executeBtn.classList.add('cancelled');
            
            // SSE should have already closed and shown cancelled message
            eventSource.close();
        } else {
            // Show error
            executeBtn.innerHTML = '❌ Execution Failed';
            executeBtn.classList.remove('executing');
            executeBtn.classList.add('error');
            
            // Close SSE connection on error
            eventSource.close();
            appendFFmpegOutput(messageId, `Execution failed: ${result.error || result.message || 'Unknown error'}`);
        }
        
        // Hide cancel button
        if (cancelExecutionBtn) {
            cancelExecutionBtn.style.display = 'none';
        }
        
    } catch (error) {
        executeBtn.innerHTML = '❌ Execution Failed';
        executeBtn.classList.remove('executing');
        executeBtn.classList.add('error');
        
        // Close SSE connection on error
        eventSource.close();
        appendFFmpegOutput(messageId, `Error: ${error.message}`);
        
        // Hide cancel button
        if (cancelExecutionBtn) {
            cancelExecutionBtn.style.display = 'none';
        }
    } finally {
        // Clear current execution
        if (currentExecutionId === messageId) {
            currentExecutionId = null;
        }
    }
}



// Clear FFmpeg output content
function clearFFmpegOutput(messageId) {
    const outputContent = document.getElementById(`output-content-${messageId}`);
    if (outputContent) {
        outputContent.innerHTML = '';
    }
}

// Append FFmpeg output content
function appendFFmpegOutput(messageId, content) {
    const outputContent = document.getElementById(`output-content-${messageId}`);
    if (outputContent) {
        outputContent.innerHTML += content.replace(/\n/g, '<br>').replace(/ /g, '&nbsp;');
        outputContent.scrollTop = outputContent.scrollHeight;
        // Also scroll the main messages container after a delay
        scrollToBottomAfterDelay();
    }
}

// Cancel specific FFmpeg execution (called from per-command cancel button)
async function cancelFFmpegExecution(messageId) {
    if (!messageId) return;
    
    try {
        const response = await fetch('/api/cancel-ffmpeg', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                executionId: messageId
            })
        });
        
        if (response.ok) {
            appendFFmpegOutput(messageId, '\n🚫 FFmpeg execution cancelled');
            
            // Update button states
            const escapedId = messageId.toString().replace(/\./g, '\\.');
            const executeBtn = document.querySelector(`#msg-${escapedId} .execute-btn`);
            const cancelBtn = document.querySelector(`#msg-${escapedId} .cancel-execution-btn`);
            
            if (executeBtn) {
                executeBtn.innerHTML = '🚫 Cancelled';
                executeBtn.classList.remove('executing');
                executeBtn.classList.add('cancelled');
            }
            
            if (cancelBtn) {
                cancelBtn.style.display = 'none';
            }
        }
    } catch (error) {
        appendFFmpegOutput(messageId, `\nError cancelling execution: ${error.message}`);
    }
    
    // Clear execution state if this was the current execution
    if (currentExecutionId === messageId) {
        currentExecutionId = null;
    }
}

// Cancel execution function (legacy - for global cancel button)
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
    
    scrollToBottomAfterDelay();
    
    return id;
}

// Add output media as a separate message
function addOutputMediaMessage(outputFilePath, afterMessageId) {
    // Hide region button from previous most recent media
    if (mostRecentMediaPath) {
        document.querySelectorAll('.media-embed .region-select-btn').forEach(btn => {
            btn.style.display = 'none';
        });
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant output-media';
    
    const id = Date.now() + Math.random() + 0.1; // Slight offset to ensure unique ID
    messageDiv.id = `msg-${id}`;
    
    const fileName = outputFilePath.split('/').pop();
    mostRecentMediaPath = outputFilePath; // Update most recent media
    const mediaEmbed = createMediaEmbed(outputFilePath, fileName, true, false, true);
    
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
    
    // Scroll to bottom after delay
    scrollToBottomAfterDelay();
    
    return id;
}

// saveSettings function moved to settings.js module

// Region selection functions moved to region-selection.js module

// Make functions globally available for inline event handlers
window.clearRegionSelection = clearRegionSelection;
window.toggleRegionSelectMode = toggleRegionSelectMode;
window.cancelFFmpegExecution = cancelFFmpegExecution;
window.executeFFmpegCommand = executeFFmpegCommand;
window.executeAndToggleAuto = executeAndToggleAuto;
window.copyToClipboard = copyToClipboard;
window.downloadFile = downloadFile;


// Region selection initialization moved to main initialize() function


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
        }
    }
});

document.addEventListener('mouseout', (e) => {
    // Remove hover indication when leaving a message
    const message = e.target.closest('.message');
    if (message && message === hoveredMessage) {
        // Check if we're moving to another element within the same message
        if (!e.relatedTarget || !message.contains(e.relatedTarget)) {
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

// Helper function to scroll to bottom after adding message
function scrollToBottomAfterDelay() {
    setTimeout(() => {
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }, 150);
}
