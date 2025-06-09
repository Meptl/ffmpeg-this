/**
 * Base AI Provider Interface
 * All AI providers must implement this interface
 */
class BaseAIProvider {
  constructor(config = {}) {
    this.config = config;
    this.name = this.constructor.name;
  }

  /**
   * Initialize the provider with configuration
   * @param {Object} config - Provider-specific configuration
   */
  async initialize(config) {
    throw new Error(`${this.name} must implement initialize() method`);
  }

  /**
   * Send a chat completion request
   * @param {Array} messages - Array of message objects with role and content
   * @param {Object} options - Additional options (temperature, model, etc.)
   * @returns {Promise<Object>} Response object with content and usage info
   */
  async chat(messages, options = {}) {
    throw new Error(`${this.name} must implement chat() method`);
  }

  /**
   * Check if the provider is properly configured
   * @returns {boolean} True if provider is ready to use
   */
  isConfigured() {
    throw new Error(`${this.name} must implement isConfigured() method`);
  }

  /**
   * Get the provider's display name
   * @returns {string} Human-readable provider name
   */
  getDisplayName() {
    return this.name.replace('Provider', '');
  }

  /**
   * Get required configuration keys
   * @returns {Array<string>} List of required config keys
   */
  getRequiredConfig() {
    return [];
  }

  /**
   * Validate configuration
   * @param {Object} config - Configuration to validate
   * @returns {Object} Validation result {valid: boolean, errors: Array<string>}
   */
  validateConfig(config) {
    const required = this.getRequiredConfig();
    const errors = [];

    for (const key of required) {
      if (!config[key]) {
        errors.push(`Missing required configuration: ${key}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Format messages for the specific provider's API
   * @param {Array} messages - Generic message format
   * @returns {Array} Provider-specific message format
   */
  formatMessages(messages) {
    return messages;
  }

  /**
   * Extract content from provider's response
   * @param {Object} response - Provider's response object
   * @returns {string} Extracted message content
   */
  extractContent(response) {
    throw new Error(`${this.name} must implement extractContent() method`);
  }

  /**
   * Extract usage information from response
   * @param {Object} response - Provider's response object
   * @returns {Object|null} Usage information {promptTokens, completionTokens, totalTokens}
   */
  extractUsage(response) {
    return null;
  }

  /**
   * Handle provider-specific errors
   * @param {Error} error - Original error
   * @throws {Error} Formatted error with useful message
   */
  handleError(error) {
    throw error;
  }
}

module.exports = BaseAIProvider;