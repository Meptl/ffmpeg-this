// API Service Module
// Centralized API communication layer

class APIService {
    constructor() {
        this.baseUrl = '';
    }
    
    // Generic fetch wrapper with error handling
    async fetch(url, options = {}) {
        try {
            const response = await fetch(url, options);
            if (!response.ok && response.status !== 404) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response;
        } catch (error) {
            console.error(`API Error: ${url}`, error);
            throw error;
        }
    }
    
    // Get provider configuration
    async getConfig() {
        const response = await this.fetch('/api/config');
        return response.json();
    }
    
    // Save provider configuration
    async saveConfig(provider, config) {
        const response = await this.fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider, config })
        });
        return response.json();
    }
    
    // Settings methods removed - now using localStorage
    
    // Check FFmpeg status
    async checkFFmpegStatus() {
        const response = await this.fetch('/api/ffmpeg-status');
        return response.json();
    }
    
    // Get configured providers
    async getConfiguredProviders() {
        const response = await this.fetch('/api/configured-providers');
        return response.json();
    }
    
    // Check for pre-configured file
    async getPreConfiguredFile() {
        try {
            const response = await this.fetch('/api/preconfigured-file');
            const data = await response.json();
            return data.file || null;
        } catch (error) {
            return null;
        }
    }
    
    // Upload file
    async uploadFile(file) {
        const formData = new FormData();
        formData.append('file', file);
        
        const response = await this.fetch('/api/upload-file', {
            method: 'POST',
            body: formData
        });
        
        return response.json();
    }
    
    // Send chat message
    async sendChatMessage(provider, message, conversationHistory, useStructuredMode, userInput, preCalculatedRegion) {
        const requestData = {
            provider,
            message,
            conversationHistory,
            useStructuredMode,
            userInput,
            preCalculatedRegion
        };
        
        console.log('Sending to AI backend:', JSON.stringify(requestData, null, 2));
        
        const response = await this.fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestData)
        });
        
        const responseData = await response.json();
        console.log('Received from AI backend:', JSON.stringify(responseData, null, 2));
        
        return responseData;
    }
    
    // Calculate region from display coordinates
    async calculateRegion(displayRegion, filePath) {
        const response = await this.fetch('/api/calculate-region', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                displayRegion,
                filePath
            })
        });
        
        return response.json();
    }
    
    // Execute FFmpeg command
    async executeFFmpeg(command, outputFile, executionId) {
        const response = await this.fetch('/api/execute-ffmpeg', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                command,
                outputFile,
                executionId
            })
        });
        
        return response.json();
    }
    
    // Cancel FFmpeg execution
    async cancelFFmpeg(executionId) {
        const response = await this.fetch('/api/cancel-ffmpeg', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ executionId })
        });
        
        return response.json();
    }
    
    // Create SSE connection for FFmpeg output streaming
    createFFmpegStream(executionId) {
        return new EventSource(`/api/stream-ffmpeg-output/${executionId}`);
    }
}

// Create singleton instance
const api = new APIService();

// Export the API service
export { api };
