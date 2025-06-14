const FFmpegCommandExecutor = require('./command-executor');
const FFmpegMetadataExtractor = require('./metadata-extractor');
const FFmpegRegionCalculator = require('./region-calculator');

class FFmpegService {
  constructor() {
    this.commandExecutor = new FFmpegCommandExecutor();
    this.metadataExtractor = new FFmpegMetadataExtractor();
    this.regionCalculator = new FFmpegRegionCalculator();
  }

  async execute(options) {
    return this.commandExecutor.execute(options);
  }

  cancel(executionId) {
    return this.commandExecutor.cancel(executionId);
  }

  async checkAvailability(ffmpegPath) {
    return this.commandExecutor.checkAvailability(ffmpegPath);
  }

  async getMediaDimensions(filePath, ffprobePath) {
    return this.metadataExtractor.getMediaDimensions(filePath, ffprobePath);
  }

  // Private internal methods
  _calculateRegion(displayRegion, mediaDimensions) {
    return this.regionCalculator.calculateRegion(displayRegion, mediaDimensions);
  }

  _validateRegion(region, dimensions) {
    return this.regionCalculator.validateRegion(region, dimensions);
  }

  _formatRegionString(region) {
    return this.regionCalculator.formatRegionString(region);
  }

  async calculateRegionFromDisplay(displayRegion, filePath, ffprobePath) {
    const dimensions = await this.getMediaDimensions(filePath, ffprobePath);
    
    const result = this._calculateRegion(displayRegion, dimensions);
    
    const isValid = this._validateRegion(result.actualRegion, {
      width: dimensions.width,
      height: dimensions.height
    });
    
    // if (!isValid) {
    //   throw new Error('Invalid region dimensions calculated');
    // }
    
    return {
      regionString: this._formatRegionString(result.actualRegion),
      actualRegion: result.actualRegion,
      originalDimensions: {
        width: dimensions.width,
        height: dimensions.height
      },
      rotation: dimensions.rotation,
      displayDimensions: result.displayDimensions
    };
  }
}

module.exports = new FFmpegService();
