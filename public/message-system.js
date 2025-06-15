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

  // Get the system prompt for FFmpeg command generation
  getSystemPrompt() {
    return `You are an FFmpeg command generator.
The user will ask you a series of operations to perform.

These will be in this exact JSON format:
{
  "input_filename": "example.mp4",
  "operation": "description of what to do",
  "use_placeholders": true,
  "region": null | "x,y widthxheight"
}

The region field (when not null) specifies a region of interest where:
- x,y is the top-left corner offset in pixels
- widthxheight is the size of the region in pixels
- Example: "100,200 1280x720" means offset (100,200) with size 1280x720
- This is simply a region the user is referencing - only perform actions on it if explicitly requested

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
- When a region is specified, it indicates an area of interest - only use it if the user explicitly asks for operations on that region
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
  }
}

// Make globally available
window.MessageManager = MessageManager;
window.MessageFormatter = MessageFormatter;