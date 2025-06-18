const OpenAIProvider = require('./openai');
const AnthropicProvider = require('./anthropic');
const GeminiProvider = require('./gemini');
const GroqProvider = require('./groq');
const DeepSeekProvider = require('./deepseek');
const LocalLLMProvider = require('./local-llm');

/**
 * AI Provider Factory
 * Creates and manages AI provider instances
 */
class AIProviderFactory {
  constructor() {
    this.providers = {
      openai: OpenAIProvider,
      anthropic: AnthropicProvider,
      gemini: GeminiProvider,
      groq: GroqProvider,
      deepseek: DeepSeekProvider,
      local: LocalLLMProvider
    };
    
    this.instances = new Map();
  }

  /**
   * Get a provider instance
   * @param {string} providerName - Name of the provider (openai, anthropic, etc.)
   * @param {Object} config - Provider configuration
   * @returns {Promise<BaseAIProvider>} Provider instance
   */
  async getProvider(providerName, config = {}) {
    const normalizedName = providerName.toLowerCase();
    
    if (!this.providers[normalizedName]) {
      throw new Error(`Unknown provider: ${providerName}`);
    }

    // Create cache key from provider name and config
    const cacheKey = `${normalizedName}_${JSON.stringify(config)}`;
    
    // Return cached instance if available
    if (this.instances.has(cacheKey)) {
      return this.instances.get(cacheKey);
    }

    // Create new instance
    const ProviderClass = this.providers[normalizedName];
    const provider = new ProviderClass(config);
    await provider.initialize(config);
    
    // Cache the instance
    this.instances.set(cacheKey, provider);
    
    return provider;
  }

  /**
   * Create a provider from environment variables and optional overrides
   * @param {string} providerName - Name of the provider
   * @param {Object} overrides - Configuration overrides
   * @returns {Promise<BaseAIProvider>} Provider instance
   */
  async createFromEnv(providerName, overrides = {}) {
    const config = this.getConfigFromEnv(providerName);
    const finalConfig = { ...config, ...overrides };
    return this.getProvider(providerName, finalConfig);
  }

  /**
   * Get configuration from environment variables
   * @param {string} providerName - Name of the provider
   * @returns {Object} Configuration object
   */
  getConfigFromEnv(providerName) {
    const envPrefix = providerName.toUpperCase();
    const config = {};

    switch (providerName.toLowerCase()) {
      case 'openai':
        config.apiKey = process.env.OPENAI_API_KEY;
        if (process.env.OPENAI_MODEL) {
          config.model = process.env.OPENAI_MODEL;
        }
        break;
        
      case 'anthropic':
        config.apiKey = process.env.ANTHROPIC_API_KEY;
        if (process.env.ANTHROPIC_MODEL) {
          config.model = process.env.ANTHROPIC_MODEL;
        }
        break;
        
      case 'gemini':
        config.apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
        if (process.env.GEMINI_MODEL) {
          config.model = process.env.GEMINI_MODEL;
        }
        break;
        
      case 'groq':
        config.apiKey = process.env.GROQ_API_KEY;
        if (process.env.GROQ_MODEL) {
          config.model = process.env.GROQ_MODEL;
        }
        break;
        
      case 'deepseek':
        config.apiKey = process.env.DEEPSEEK_API_KEY;
        if (process.env.DEEPSEEK_MODEL) {
          config.model = process.env.DEEPSEEK_MODEL;
        }
        break;
        
      case 'local':
        config.endpoint = process.env.LOCAL_LLM_ENDPOINT || process.env.OLLAMA_API_BASE;
        config.apiKey = process.env.LOCAL_LLM_API_KEY;
        config.model = process.env.LOCAL_LLM_MODEL;
        // Parse headers from environment if provided
        if (process.env.LOCAL_LLM_HEADERS) {
          try {
            config.headers = JSON.parse(process.env.LOCAL_LLM_HEADERS);
          } catch (e) {
            // Silently ignore parse errors
          }
        }
        break;
    }

    return config;
  }

  /**
   * Get list of available providers
   * @returns {Array<string>} List of provider names
   */
  getAvailableProviders() {
    return Object.keys(this.providers);
  }

  /**
   * Get list of configured providers (with valid config from env)
   * @returns {Array<Object>} List of configured providers with metadata
   */
  getConfiguredProviders() {
    const configured = [];
    
    for (const providerName of this.getAvailableProviders()) {
      const config = this.getConfigFromEnv(providerName);
      const ProviderClass = this.providers[providerName];
      const tempProvider = new ProviderClass(config);
      
      if (tempProvider.isConfigured()) {
        configured.push({
          id: providerName,
          name: tempProvider.getDisplayName(),
          configured: true
        });
      }
    }
    
    return configured;
  }

  /**
   * Clear cached instances
   */
  clearCache() {
    this.instances.clear();
  }
}

// Export singleton instance
const factory = new AIProviderFactory();

module.exports = {
  AIProviderFactory: factory,
  BaseAIProvider: require('./base-provider'),
  // Export individual providers for direct use if needed
  OpenAIProvider,
  AnthropicProvider,
  GeminiProvider,
  GroqProvider,
  DeepSeekProvider,
  LocalLLMProvider
};