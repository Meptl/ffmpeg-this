/**
 * Message formatting utilities for converting between different views
 */
class MessageFormatter {
  /**
   * Format user input into structured JSON for AI
   */
  static formatUserMessage(userInput, currentFile, regionString = null) {
    return {
      input_filename: currentFile.fileName,
      operation: userInput,
      use_placeholders: true,
      region: regionString
    };
  }

  /**
   * Format text content with basic markdown support
   */
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

  /**
   * Extract human-readable content from structured response
   */
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

  /**
   * Create executable command data with real file paths
   */
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

  /**
   * Format media information for display
   */
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

  /**
   * Get file extension from path
   */
  static getFileExtension(filePath) {
    return filePath.split('.').pop().toLowerCase();
  }

  /**
   * Detect media type from file extension
   */
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

  /**
   * Escape HTML entities in string
   */
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

  /**
   * Parse AI response to extract structured data
   */
  static parseAIResponse(response) {
    if (typeof response === 'string') {
      try {
        return JSON.parse(response);
      } catch (e) {
        // Not valid JSON
        return null;
      }
    }
    return response;
  }
}

module.exports = MessageFormatter;