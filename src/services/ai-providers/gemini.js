const { GoogleGenerativeAI } = require('@google/generative-ai');
const BaseAIProvider = require('./base-provider');

class GeminiProvider extends BaseAIProvider {
  constructor(config = {}) {
    super(config);
    this.client = null;
    this.model = null;
  }

  async initialize(config) {
    this.config = { ...this.config, ...config };
    if (this.isConfigured()) {
      this.client = new GoogleGenerativeAI(this.config.apiKey);
      this.model = this.client.getGenerativeModel({ 
        model: this.config.model || 'gemini-1.5-flash' 
      });
    }
  }

  async chat(messages, options = {}) {
    if (!this.model) {
      throw new Error('Gemini model not initialized. Please provide an API key.');
    }

    try {
      // Gemini expects a single string prompt, so we need to format messages
      const prompt = this.formatMessagesAsPrompt(messages);
      
      const generationConfig = {
        temperature: options.temperature ?? 0,
        maxOutputTokens: options.maxTokens || 1000,
      };
      
      const response = await this.model.generateContent(prompt, { generationConfig });
      const result = response.response;

      return {
        content: this.extractContent(result),
        usage: this.extractUsage(result),
        raw: response
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  isConfigured() {
    return !!this.config.apiKey;
  }

  getRequiredConfig() {
    return ['apiKey'];
  }

  getDisplayName() {
    return 'Google Gemini';
  }

  formatMessagesAsPrompt(messages) {
    // Convert message array to a single prompt string for Gemini
    let prompt = '';
    
    for (const message of messages) {
      if (message.role === 'system') {
        prompt += `System: ${message.content}\n\n`;
      } else if (message.role === 'user') {
        prompt += `User: ${message.content}\n\n`;
      } else if (message.role === 'assistant') {
        prompt += `Assistant: ${message.content}\n\n`;
      }
    }
    
    // Add a final "Assistant:" to prompt for response
    if (!prompt.endsWith('Assistant: ')) {
      prompt += 'Assistant: ';
    }
    
    return prompt.trim();
  }

  extractContent(response) {
    return response.text();
  }

  extractUsage(response) {
    // Gemini doesn't provide token usage in the same way
    // Would need to use a separate API call or estimation
    return null;
  }

  handleError(error) {
    if (error.message) {
      if (error.message.includes('API_KEY_INVALID')) {
        throw new Error('Invalid Google Gemini API key');
      } else if (error.message.includes('RATE_LIMIT_EXCEEDED')) {
        throw new Error('Google Gemini rate limit exceeded. Please try again later.');
      } else if (error.message.includes('INTERNAL')) {
        throw new Error('Google Gemini service error. Please try again.');
      }
    }
    
    const message = error.message || 'Unknown Google Gemini API error';
    throw new Error(`Google Gemini API error: ${message}`);
  }
}

module.exports = GeminiProvider;