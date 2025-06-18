const Anthropic = require('@anthropic-ai/sdk');
const BaseAIProvider = require('./base-provider');

class AnthropicProvider extends BaseAIProvider {
  constructor(config = {}) {
    super(config);
    this.client = null;
  }

  async initialize(config) {
    this.config = { ...this.config, ...config };
    if (this.isConfigured()) {
      this.client = new Anthropic({ apiKey: this.config.apiKey });
    }
  }


  isConfigured() {
    return !!this.config.apiKey;
  }

  getRequiredConfig() {
    return ['apiKey'];
  }

  getDisplayName() {
    return 'Anthropic (Claude)';
  }

  formatMessages(messages) {
    // Anthropic doesn't support system messages in the messages array
    // Extract system message and pass it separately
    const systemMessage = messages.find(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');
    
    // Store system message for use in the create call
    this._systemMessage = systemMessage?.content;
    
    return conversationMessages;
  }

  async chat(messages, options = {}) {
    if (!this.client) {
      throw new Error('Anthropic client not initialized. Please provide an API key.');
    }

    try {
      const formattedMessages = this.formatMessages(messages);
      
      const requestOptions = {
        model: options.model || this.config.model || 'claude-3-opus-20240229',
        messages: formattedMessages,
        max_tokens: options.maxTokens || 1000,
        temperature: options.temperature ?? 0
      };

      // Add system message if present
      if (this._systemMessage) {
        requestOptions.system = this._systemMessage;
      }

      const response = await this.client.messages.create(requestOptions);

      return {
        content: this.extractContent(response),
        usage: this.extractUsage(response),
        raw: response
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  extractContent(response) {
    return response.content[0].text;
  }

  extractUsage(response) {
    if (!response.usage) return null;
    
    return {
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens
    };
  }

  handleError(error) {
    if (error.status) {
      if (error.status === 401) {
        throw new Error('Invalid Anthropic API key');
      } else if (error.status === 429) {
        throw new Error('Anthropic rate limit exceeded. Please try again later.');
      } else if (error.status === 500) {
        throw new Error('Anthropic service error. Please try again.');
      }
    }
    
    const message = error.message || 'Unknown Anthropic API error';
    throw new Error(`Anthropic API error: ${message}`);
  }
}

module.exports = AnthropicProvider;