const FFmpegCommandExecutor = require('./command-executor');
const FFmpegRegionCalculator = require('./region-calculator');
const { getAllSettings } = require('../../storage');
const { spawn } = require('child_process');

class FFmpegService {
  constructor() {
    this.commandExecutor = new FFmpegCommandExecutor();
    this.regionCalculator = new FFmpegRegionCalculator();
  }

  async execute(options) {
    // If no ffmpegPath provided, get it from settings
    if (!options.ffmpegPath) {
      const settings = await getAllSettings();
      options = { ...options, ffmpegPath: settings.ffmpegPath || 'ffmpeg' };
    }
    return this.commandExecutor.execute(options);
  }

  cancel(executionId) {
    return this.commandExecutor.cancel(executionId);
  }

  async checkAvailability(ffmpegPath = null) {
    if (!ffmpegPath) {
      const settings = await getAllSettings();
      ffmpegPath = settings.ffmpegPath || 'ffmpeg';
    }
    return this.commandExecutor.checkAvailability(ffmpegPath);
  }

  async getMediaDimensions(filePath, ffprobePath = null) {
    if (!ffprobePath) {
      const settings = await getAllSettings();
      const ffmpegPath = settings.ffmpegPath || 'ffmpeg';
      ffprobePath = ffmpegPath.replace(/ffmpeg([^\/\\]*)$/, 'ffprobe$1');
    }
    
    return new Promise((resolve, reject) => {
      const ffprobeProcess = spawn(ffprobePath, [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height',
        '-of', 'json',
        filePath
      ]);
      
      let stdout = '';
      let stderr = '';
      
      ffprobeProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      ffprobeProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      ffprobeProcess.on('close', (code) => {
        if (code === 0) {
          try {
            const probeResult = JSON.parse(stdout);
            if (probeResult.streams && probeResult.streams[0]) {
              const stream = probeResult.streams[0];
              const width = stream.width;
              const height = stream.height;
              
              resolve({
                width,
                height,
                displayWidth: width,
                displayHeight: height
              });
            } else {
              reject(new Error('No video stream found'));
            }
          } catch (e) {
            reject(new Error('Failed to parse ffprobe output: ' + e.message));
          }
        } else {
          reject(new Error(`ffprobe exited with code ${code}: ${stderr}`));
        }
      });
      
      ffprobeProcess.on('error', (error) => {
        reject(error);
      });
    });
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

  async calculateRegionFromDisplay(displayRegion, filePath) {
    const dimensions = await this.getMediaDimensions(filePath);
    
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
      displayDimensions: result.displayDimensions
    };
  }
}

module.exports = new FFmpegService();
