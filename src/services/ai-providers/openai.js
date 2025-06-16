const OpenAI = require('openai');
const BaseAIProvider = require('./base-provider');

class OpenAIProvider extends BaseAIProvider {
  constructor(config = {}) {
    super(config);
    this.client = null;
  }

  async initialize(config) {
    this.config = { ...this.config, ...config };
    if (this.isConfigured()) {
      this.client = new OpenAI({ apiKey: this.config.apiKey });
    }
  }

  async chat(messages, options = {}) {
    if (!this.client) {
      throw new Error('OpenAI client not initialized. Please provide an API key.');
    }

    try {
      // Remove maxTokens from options to avoid conflict
      const { maxTokens, ...otherOptions } = options;
      
      const model = options.model || this.config.model || 'gpt-4-turbo-preview';
      console.log('OpenAI chat - model selection:', {
        'options.model': options.model,
        'this.config.model': this.config.model,
        'final model': model
      });
      
      console.log('OpenAI otherOptions:', otherOptions);
      
      const requestParams = {
        messages: this.formatMessages(messages),
        temperature: options.temperature ?? 0.7,
        max_tokens: maxTokens || 1000,
        ...otherOptions,
        model: model  // Put model last to ensure it's not overridden
      };
      
      console.log('OpenAI final request params:', requestParams);
      
      const response = await this.client.chat.completions.create(requestParams);

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
    return 'OpenAI';
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
      const message = error.response.data?.error?.message || error.message;
      
      if (status === 401) {
        throw new Error('Invalid OpenAI API key');
      } else if (status === 429) {
        throw new Error('OpenAI rate limit exceeded. Please try again later.');
      } else if (status === 500) {
        throw new Error('OpenAI service error. Please try again.');
      }
      
      throw new Error(`OpenAI API error: ${message}`);
    }
    
    throw error;
  }
}

module.exports = OpenAIProvider;