const Groq = require('groq-sdk');
const BaseAIProvider = require('./base-provider');

class GroqProvider extends BaseAIProvider {
  constructor(config = {}) {
    super(config);
    this.client = null;
  }

  async initialize(config) {
    this.config = { ...this.config, ...config };
    if (this.isConfigured()) {
      this.client = new Groq({ apiKey: this.config.apiKey });
    }
  }

  async chat(messages, options = {}) {
    if (!this.client) {
      throw new Error('Groq client not initialized. Please provide an API key.');
    }

    try {
      // Remove maxTokens from options to avoid conflict
      const { maxTokens, ...otherOptions } = options;
      
      const response = await this.client.chat.completions.create({
        model: options.model || this.config.model || 'mixtral-8x7b-32768',
        messages: this.formatMessages(messages),
        temperature: options.temperature ?? 0.7,
        max_tokens: maxTokens || 1000,
        ...otherOptions
      });

      return {
        content: this.extractContent(response),
        usage: this.extractUsage(response),
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
    return 'Groq';
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
    if (error.status) {
      if (error.status === 401) {
        throw new Error('Invalid Groq API key');
      } else if (error.status === 429) {
        throw new Error('Groq rate limit exceeded. Please try again later.');
      } else if (error.status === 500 || error.status === 503) {
        throw new Error('Groq service error. Please try again.');
      }
    }
    
    const message = error.message || 'Unknown Groq API error';
    throw new Error(`Groq API error: ${message}`);
  }
}

module.exports = GroqProvider;