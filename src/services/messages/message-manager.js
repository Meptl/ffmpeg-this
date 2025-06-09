/**
 * Abstract message management system for handling chat messages
 * with dual view states (raw/debug and human-friendly)
 */
class MessageManager {
  constructor() {
    this.messages = [];
    this.showRawMode = false;
    this.messageIdCounter = 0;
  }

  /**
   * Set display mode (raw JSON vs human-friendly)
   */
  setDisplayMode(showRaw) {
    this.showRawMode = showRaw;
  }

  /**
   * Generate unique message ID
   */
  generateId() {
    return `msg-${Date.now()}-${this.messageIdCounter++}`;
  }

  /**
   * Add a user message
   * @param {string} userInput - Human-readable user input
   * @param {Object} structuredData - Structured JSON data sent to AI
   */
  addUserMessage(userInput, structuredData = null) {
    const message = {
      id: this.generateId(),
      type: 'user',
      timestamp: Date.now(),
      humanView: userInput,
      rawView: structuredData ? JSON.stringify(structuredData, null, 2) : userInput,
      structuredData
    };
    
    this.messages.push(message);
    return message;
  }

  /**
   * Add an assistant message
   * @param {string} rawResponse - Raw JSON response from AI
   * @param {Object} parsedResponse - Parsed JSON object
   * @param {Object} executableData - Additional data for execution (e.g., file paths)
   */
  addAssistantMessage(rawResponse, parsedResponse = null, executableData = null) {
    const message = {
      id: this.generateId(),
      type: 'assistant',
      timestamp: Date.now(),
      rawView: rawResponse,
      humanView: this._formatAssistantResponse(parsedResponse || rawResponse),
      parsedResponse,
      executableData
    };
    
    this.messages.push(message);
    return message;
  }

  /**
   * Add a system message (info, error, etc.)
   * @param {string} type - Message type (info, error, warning)
   * @param {string} content - Message content
   */
  addSystemMessage(type, content) {
    const message = {
      id: this.generateId(),
      type: type,
      timestamp: Date.now(),
      humanView: content,
      rawView: content // Same for both views
    };
    
    this.messages.push(message);
    return message;
  }

  /**
   * Add a media output message
   * @param {string} filePath - Path to output file
   * @param {string} fileName - Display name of file
   */
  addMediaOutputMessage(filePath, fileName) {
    const message = {
      id: this.generateId(),
      type: 'media-output',
      timestamp: Date.now(),
      filePath,
      fileName,
      humanView: { type: 'media', filePath, fileName },
      rawView: { type: 'media', filePath, fileName }
    };
    
    this.messages.push(message);
    return message;
  }

  /**
   * Add initial file message
   * @param {Object} fileInfo - File information object
   */
  addInitialFileMessage(fileInfo) {
    const message = {
      id: this.generateId(),
      type: 'initial-file',
      timestamp: Date.now(),
      fileInfo,
      humanView: { type: 'file', ...fileInfo },
      rawView: { type: 'file', ...fileInfo }
    };
    
    this.messages.push(message);
    return message;
  }

  /**
   * Get message by ID
   */
  getMessageById(id) {
    return this.messages.find(msg => msg.id === id);
  }

  /**
   * Remove message by ID
   */
  removeMessage(id) {
    const index = this.messages.findIndex(msg => msg.id === id);
    if (index !== -1) {
      this.messages.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get all messages with appropriate view based on current mode
   */
  getMessages() {
    return this.messages.map(msg => ({
      ...msg,
      content: this.showRawMode ? msg.rawView : msg.humanView
    }));
  }

  /**
   * Get messages for conversation history (for AI context)
   * @param {number} limit - Maximum number of messages to return
   */
  getConversationHistory(limit = 10) {
    const relevantMessages = this.messages
      .filter(msg => msg.type === 'user' || msg.type === 'assistant')
      .slice(-limit);
    
    return relevantMessages.map(msg => ({
      role: msg.type === 'user' ? 'user' : 'assistant',
      content: msg.rawView // Always use raw view for AI context
    }));
  }

  /**
   * Clear all messages
   */
  clearMessages() {
    this.messages = [];
  }

  /**
   * Format assistant response for human view
   * @private
   */
  _formatAssistantResponse(response) {
    // If it's already a string, try to parse it
    if (typeof response === 'string') {
      try {
        response = JSON.parse(response);
      } catch (e) {
        // Not JSON, return as is
        return response;
      }
    }

    // Format structured response
    if (response.error) {
      return {
        type: 'error',
        content: response.error
      };
    }

    if (response.command) {
      return {
        type: 'command',
        command: response.command,
        outputExtension: response.output_extension
      };
    }

    // Fallback to raw response
    return response;
  }

  /**
   * Export messages for persistence
   */
  exportMessages() {
    return {
      messages: this.messages,
      showRawMode: this.showRawMode
    };
  }

  /**
   * Import messages from persistence
   */
  importMessages(data) {
    if (data.messages) {
      this.messages = data.messages;
    }
    if (data.showRawMode !== undefined) {
      this.showRawMode = data.showRawMode;
    }
  }
}

module.exports = MessageManager;