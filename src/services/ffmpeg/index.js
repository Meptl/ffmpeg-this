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

  async getVideoRotation(filePath, ffprobePath) {
    return this.metadataExtractor.getVideoRotation(filePath, ffprobePath);
  }

  async getMediaDimensions(filePath, ffprobePath) {
    return this.metadataExtractor.getMediaDimensions(filePath, ffprobePath);
  }

  async getFullMetadata(filePath, ffprobePath) {
    return this.metadataExtractor.getFullMetadata(filePath, ffprobePath);
  }

  transformCropCoordinates(x, y, width, height, videoWidth, videoHeight, rotation) {
    return this.regionCalculator.transformCropCoordinates(x, y, width, height, videoWidth, videoHeight, rotation);
  }

  calculateRegion(displayRegion, mediaDimensions) {
    return this.regionCalculator.calculateRegion(displayRegion, mediaDimensions);
  }

  validateRegion(region, dimensions) {
    return this.regionCalculator.validateRegion(region, dimensions);
  }

  formatRegionString(region) {
    return this.regionCalculator.formatRegionString(region);
  }

  parseRegionString(regionString) {
    return this.regionCalculator.parseRegionString(regionString);
  }

  getFFmpegCropFilter(region) {
    return this.regionCalculator.getFFmpegCropFilter(region);
  }

  async calculateRegionFromDisplay(displayRegion, filePath, ffprobePath) {
    const dimensions = await this.getMediaDimensions(filePath, ffprobePath);
    
    const result = this.calculateRegion(displayRegion, dimensions);
    
    const isValid = this.validateRegion(result.actualRegion, {
      width: dimensions.width,
      height: dimensions.height
    });
    
    if (!isValid) {
      throw new Error('Invalid region dimensions calculated');
    }
    
    return {
      regionString: this.formatRegionString(result.actualRegion),
      actualRegion: result.actualRegion,
      originalDimensions: {
        width: dimensions.width,
        height: dimensions.height
      },
      rotation: dimensions.rotation,
      displayDimensions: result.displayDimensions,
      sar: dimensions.sar,
      dar: dimensions.dar,
      sarValue: dimensions.sarValue,
      darValue: dimensions.darValue
    };
  }
}

module.exports = new FFmpegService();
module.exports.FFmpegService = FFmpegService;
module.exports.FFmpegCommandExecutor = FFmpegCommandExecutor;
module.exports.FFmpegMetadataExtractor = FFmpegMetadataExtractor;
module.exports.FFmpegRegionCalculator = FFmpegRegionCalculator;