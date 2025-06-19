/**
 * Browser-compatible message management system
 * This is a client-side version of the message management system
 */

// Message Formatter
class MessageFormatter {
  static formatUserMessage(userInput, currentFile, regionString = null) {
    return {
      input_filename: currentFile.fileName,
      operation: userInput,
      use_placeholders: true,
      region: regionString
    };
  }

  static formatTextContent(content) {
    if (typeof content !== 'string') {
      return content;
    }

    // Escape HTML
    let formatted = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    
    // Format code blocks
    formatted = formatted.replace(/```([^`]+)```/g, '<pre><code>$1</code></pre>');
    
    // Format inline code
    formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Convert newlines to br
    formatted = formatted.replace(/\n/g, '<br>');
    
    return formatted;
  }

  static extractHumanContent(parsedResponse) {
    if (!parsedResponse) return null;

    if (parsedResponse.error) {
      return {
        type: 'error',
        message: parsedResponse.error
      };
    }

    if (parsedResponse.command) {
      return {
        type: 'command',
        command: parsedResponse.command,
        outputExtension: parsedResponse.output_extension,
        isExecutable: true
      };
    }

    return {
      type: 'text',
      message: JSON.stringify(parsedResponse, null, 2)
    };
  }

  static createExecutableData(parsedResponse, inputFile, outputFile) {
    if (!parsedResponse || !parsedResponse.command) {
      return null;
    }

    return {
      command: parsedResponse.command
        .replace(/{INPUT_FILE}/g, inputFile)
        .replace(/{OUTPUT_FILE}/g, outputFile),
      input_file: inputFile,
      output_file: outputFile,
      output_extension: parsedResponse.output_extension
    };
  }

  static formatMediaInfo(filePath, fileName, mediaType = null) {
    if (!mediaType) {
      mediaType = this.detectMediaType(filePath);
    }

    return {
      type: 'media',
      mediaType,
      filePath,
      fileName,
      extension: this.getFileExtension(filePath)
    };
  }

  static getFileExtension(filePath) {
    return filePath.split('.').pop().toLowerCase();
  }

  static detectMediaType(filePath) {
    const ext = this.getFileExtension(filePath);
    
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

  static escapeHtml(str) {
    const htmlEntities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    
    return str.replace(/[&<>"']/g, match => htmlEntities[match]);
  }

  static parseAIResponse(response) {
    if (typeof response === 'string') {
      try {
        return JSON.parse(response);
      } catch (e) {
        return null;
      }
    }
    return response;
  }
}

// Message Manager
class MessageManager {
  constructor() {
    this.messages = [];
    this.messageIdCounter = 0;
  }

  generateId() {
    return `msg-${Date.now()}-${this.messageIdCounter++}`;
  }

  addUserMessage(userInput, structuredData = null) {
    const message = {
      id: this.generateId(),
      type: 'user',
      timestamp: Date.now(),
      content: userInput,
      structuredData
    };
    
    this.messages.push(message);
    return message;
  }

  addAssistantMessage(rawResponse, parsedResponse = null, executableData = null) {
    const message = {
      id: this.generateId(),
      type: 'assistant',
      timestamp: Date.now(),
      content: this._formatAssistantResponse(parsedResponse || rawResponse),
      parsedResponse,
      executableData
    };
    
    this.messages.push(message);
    return message;
  }

  addSystemMessage(type, content) {
    const message = {
      id: this.generateId(),
      type: type,
      timestamp: Date.now(),
      humanView: content,
      rawView: content,
      content: content
    };
    
    this.messages.push(message);
    return message;
  }

  addMediaOutputMessage(filePath, fileName) {
    const message = {
      id: this.generateId(),
      type: 'output-media',
      timestamp: Date.now(),
      filePath,
      fileName,
      humanView: { type: 'media', filePath, fileName },
      rawView: { type: 'media', filePath, fileName },
      // Store for compatibility
      outputFilePath: filePath,
      content: null
    };
    
    this.messages.push(message);
    return message;
  }

  addInitialFileMessage(fileInfo) {
    const message = {
      id: this.generateId(),
      type: 'initial-file',
      timestamp: Date.now(),
      fileInfo,
      humanView: { type: 'file', ...fileInfo },
      rawView: { type: 'file', ...fileInfo },
      file: fileInfo
    };
    
    this.messages.push(message);
    return message;
  }

  getMessageById(id) {
    return this.messages.find(msg => msg.id === id);
  }

  removeMessage(id) {
    const index = this.messages.findIndex(msg => msg.id === id);
    if (index !== -1) {
      this.messages.splice(index, 1);
      return true;
    }
    return false;
  }

  getMessages() {
    return this.messages;
  }

  getConversationHistory(limit = 10) {
    const relevantMessages = this.messages
      .filter(msg => msg.type === 'user' || msg.type === 'assistant')
      .slice(-limit);
    
    return relevantMessages.map(msg => ({
      role: msg.type === 'user' ? 'user' : 'assistant',
      content: msg.type === 'user' ? 
        (msg.structuredData ? JSON.stringify(msg.structuredData) : msg.content) : 
        (typeof msg.content === 'object' ? JSON.stringify(msg.content) : msg.content)
    }));
  }

  clearMessages() {
    this.messages = [];
  }

  _formatAssistantResponse(response) {
    if (typeof response === 'string') {
      try {
        response = JSON.parse(response);
      } catch (e) {
        return response;
      }
    }

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

    return response;
  }

  // Add compatibility method for existing UI
  getAllMessages() {
    return this.messages;
  }
}

// Make globally available
window.MessageManager = MessageManager;
window.MessageFormatter = MessageFormatter;
