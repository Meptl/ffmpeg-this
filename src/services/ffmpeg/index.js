const FFmpegCommandExecutor = require('./command-executor');
const { getAllSettings } = require('../../storage');
const { spawn } = require('child_process');

class FFmpegService {
  constructor() {
    this.commandExecutor = new FFmpegCommandExecutor();
  }

  _calculateRotationFromDisplayMatrix(sideDataList) {
    let rotation = 0;
    if (sideDataList) {
      const displayMatrixData = sideDataList.find(data => data.displaymatrix);
      if (displayMatrixData && displayMatrixData.displaymatrix) {
        // Parse the display matrix to calculate rotation
        // The matrix format shows rotation transformation
        // For -90 degrees: first row is [0, 65536, 0], second row is [-65536, 0, 0]
        const matrixLines = displayMatrixData.displaymatrix.trim().split('\n');
        if (matrixLines.length >= 2) {
          const firstRow = matrixLines[0].split(':')[1].trim().split(/\s+/).map(v => parseInt(v));
          const secondRow = matrixLines[1].split(':')[1].trim().split(/\s+/).map(v => parseInt(v));
          
          // Check for common rotation patterns in the matrix
          if (firstRow[0] === 0 && firstRow[1] === 65536 && secondRow[0] === -65536 && secondRow[1] === 0) {
            rotation = -90; // Counter-clockwise 90 degrees
          } else if (firstRow[0] === 0 && firstRow[1] === -65536 && secondRow[0] === 65536 && secondRow[1] === 0) {
            rotation = 90; // Clockwise 90 degrees
          } else if (firstRow[0] === -65536 && firstRow[1] === 0 && secondRow[0] === 0 && secondRow[1] === -65536) {
            rotation = 180; // 180 degrees
          }
        }
      }
    }
    return rotation;
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
        '-show_entries', 'stream=width,height:stream_side_data=displaymatrix',
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
              const sourceWidth = stream.width;
              const sourceHeight = stream.height;
              
              // Calculate rotation first
              const rotation = this._calculateRotationFromDisplayMatrix(stream.side_data_list);
              
              // For ±90 degree rotations, dimensions are swapped
              const effectiveSourceWidth = (rotation === 90 || rotation === -90 || rotation === 270 || rotation === -270) ? sourceHeight : sourceWidth;
              const effectiveSourceHeight = (rotation === 90 || rotation === -90 || rotation === 270 || rotation === -270) ? sourceWidth : sourceHeight;
              
              // Calculate scale from browser display to true display dimensions
              const scaleX = effectiveSourceWidth / displayRegion.displayWidth;
              const scaleY = effectiveSourceHeight / displayRegion.displayHeight;

              console.log("X scalar: ", scaleX);
              console.log("Y scalar: ", scaleY);

              // Scale the region to true display coordinates
              let scaledRegion = {
                x: Math.round(displayRegion.x * scaleX),
                y: Math.round(displayRegion.y * scaleY),
                width: Math.round(displayRegion.width * scaleX),
                height: Math.round(displayRegion.height * scaleY)
              };

              console.log("scaled region: ", scaledRegion);
              
              resolve({
                region: scaledRegion
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
