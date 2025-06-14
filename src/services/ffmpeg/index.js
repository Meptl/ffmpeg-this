const FFmpegCommandExecutor = require('./command-executor');
const { getAllSettings } = require('../../storage');
const { spawn } = require('child_process');

class FFmpegService {
  constructor() {
    this.commandExecutor = new FFmpegCommandExecutor();
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

  async transformRegion(displayRegion, filePath, ffprobePath = null) {
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
              
              // Calculate scale from browser display to true display dimensions
              const scaleX = width / displayRegion.displayWidth;
              const scaleY = height / displayRegion.displayHeight;
              
              // Scale the region to true display coordinates
              const scaledRegion = {
                x: Math.round(displayRegion.x * scaleX),
                y: Math.round(displayRegion.y * scaleY),
                width: Math.round(displayRegion.width * scaleX),
                height: Math.round(displayRegion.height * scaleY)
              };
              
              // Format region string
              const regionString = `${scaledRegion.x},${scaledRegion.y} ${scaledRegion.width}x${scaledRegion.height}`;
              
              resolve({
                regionString: regionString,
                actualRegion: scaledRegion,
                originalDimensions: {
                  width,
                  height
                },
                displayDimensions: {
                  width: width,
                  height: height
                }
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
}

module.exports = new FFmpegService();
