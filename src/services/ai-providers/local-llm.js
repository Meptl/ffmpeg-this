const axios = require('axios');
const BaseAIProvider = require('./base-provider');

class LocalLLMProvider extends BaseAIProvider {
  constructor(config = {}) {
    super(config);
  }

  async initialize(config) {
    this.config = { ...this.config, ...config };
  }

  async chat(messages, options = {}) {
    if (!this.isConfigured()) {
      throw new Error('Local LLM not configured. Please provide an endpoint.');
    }

    try {
      const headers = {
        'Content-Type': 'application/json',
        ...this.config.headers
      };

      if (this.config.apiKey) {
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
      }

      const response = await axios.post(this.config.endpoint, {
        model: options.model || this.config.model || 'default',
        messages: this.formatMessages(messages),
        temperature: options.temperature ?? 0,
        max_tokens: options.maxTokens || 1000,
        ...options
      }, { headers });

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
    return !!this.config.endpoint;
  }

  getRequiredConfig() {
    return ['endpoint'];
  }

  getDisplayName() {
    return 'Local LLM';
  }

  extractContent(response) {
    // Handle different response formats from local LLMs
    if (response.choices && response.choices[0]) {
      return response.choices[0].message?.content || response.choices[0].text;
    } else if (response.response) {
      return response.response;
    } else if (response.content) {
      return response.content;
    } else if (typeof response === 'string') {
      return response;
    }
    
    // Fallback to stringifying the response
    return JSON.stringify(response);
  }

  extractUsage(response) {
    // Try to extract usage if available in OpenAI-compatible format
    if (response.usage) {
      return {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens
      };
    }
    
    return null;
  }

  handleError(error) {
    if (error.response) {
      const status = error.response.status;
      const message = error.response.data?.error?.message || 
                     error.response.data?.message || 
                     error.message;
      
      if (status === 401) {
        throw new Error('Local LLM authentication failed. Check your API key if required.');
      } else if (status === 404) {
        throw new Error('Local LLM endpoint not found. Please check your configuration.');
      } else if (status === 500 || status === 503) {
        throw new Error('Local LLM service error. Please check if the service is running.');
      }
      
      throw new Error(`Local LLM error: ${message}`);
    } else if (error.code === 'ECONNREFUSED') {
      throw new Error('Could not connect to local LLM. Please check if the service is running.');
    }
    
    throw error;
  }
}

module.exports = LocalLLMProvider;