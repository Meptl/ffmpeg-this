const axios = require('axios');
const BaseAIProvider = require('./base-provider');

class DeepSeekProvider extends BaseAIProvider {
  constructor(config = {}) {
    super(config);
    this.endpoint = 'https://api.deepseek.com/v1/chat/completions';
  }

  async initialize(config) {
    this.config = { ...this.config, ...config };
  }

  async chat(messages, options = {}) {
    if (!this.isConfigured()) {
      throw new Error('DeepSeek not configured. Please provide an API key.');
    }

    try {
      // Extract only the options we want to pass through
      const { model, temperature, maxTokens, ...otherOptions } = options;
      
      const response = await axios.post(this.endpoint, {
        model: model || this.config.model || 'deepseek-chat',
        messages: this.formatMessages(messages),
        temperature: temperature ?? 0.7,
        max_tokens: maxTokens || 1000
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        }
      });

      return {
        content: this.extractContent(response.data),
        usage: this.extractUsage(response.data),
        raw: response.data
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
    return 'DeepSeek';
  }

  extractContent(response) {
    return response.choices[0].message.content;
  }

  extractUsage(response) {
    if (!response.usage) return null;
    
    return {
      promptTokens: response.usage.prompt_tokens,
      completionTokens: response.usage.completion_tokens,
      totalTokens: response.usage.total_tokens
    };
  }

  handleError(error) {
    if (error.response) {
      const status = error.response.status;
      const errorData = error.response.data;
      const message = errorData?.error?.message || errorData?.message || error.message;
      
      if (status === 401) {
        throw new Error('Invalid DeepSeek API key');
      } else if (status === 422) {
        // Log the full error details for 422 errors
        console.error('DeepSeek 422 error details:', errorData);
        throw new Error(`DeepSeek validation error: ${message}`);
      } else if (status === 429) {
        throw new Error('DeepSeek rate limit exceeded. Please try again later.');
      } else if (status === 500 || status === 503) {
        throw new Error('DeepSeek service error. Please try again.');
      }
      
      throw new Error(`DeepSeek API error: ${message}`);
    }
    
    throw error;
  }
}

module.exports = DeepSeekProvider;