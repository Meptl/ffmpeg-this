const FFmpegCommandExecutor = require('./command-executor');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Handle ffmpeg path - always extract to temp for testing
let ffmpegPath;
let ffprobePath;

// Always extract binaries to temp directory for consistent testing
const tmpDir = path.join(os.tmpdir(), 'ffmpeg-this');
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}

// Extract ffmpeg binary
const ffmpegSrc = path.join(__dirname, '..', '..', '..', 'ffmpeg-static', 'packages', 'ffmpeg-static', 'ffmpeg' + (process.platform === 'win32' ? '.exe' : ''));
ffmpegPath = path.join(tmpDir, 'ffmpeg' + (process.platform === 'win32' ? '.exe' : ''));

try {
  fs.copyFileSync(ffmpegSrc, ffmpegPath);
  fs.chmodSync(ffmpegPath, 0o755);
} catch (e) {
  console.error('Failed to extract ffmpeg binary:', e);
  ffmpegPath = require('ffmpeg-static');
}

// Extract ffprobe binary
const ffprobeSrc = path.join(__dirname, '..', '..', '..', 'ffmpeg-static', 'packages', 'ffprobe-static', 'ffprobe' + (process.platform === 'win32' ? '.exe' : ''));
ffprobePath = path.join(tmpDir, 'ffprobe' + (process.platform === 'win32' ? '.exe' : ''));

try {
  fs.copyFileSync(ffprobeSrc, ffprobePath);
  fs.chmodSync(ffprobePath, 0o755);
} catch (e) {
  console.error('Failed to extract ffprobe binary:', e);
  ffprobePath = require('ffprobe-static').path;
}

class FFmpegService {
  constructor() {
    this.commandExecutor = new FFmpegCommandExecutor();
    this.ffmpegPath = ffmpegPath;
    this.ffprobePath = ffprobePath;
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
    // Always use our resolved ffmpeg path
    options = { ...options, ffmpegPath: ffmpegPath };
    return this.commandExecutor.execute(options);
  }

  cancel(executionId) {
    return this.commandExecutor.cancel(executionId);
  }

  async checkAvailability() {
    // Always check our resolved ffmpeg path availability
    return this.commandExecutor.checkAvailability(ffmpegPath);
  }

  async transformRegion(displayRegion, filePath) {
    // Use our resolved ffprobe path

    return new Promise((resolve, reject) => {
      const ffprobeProcess = spawn(ffprobePath, [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_format',
        '-show_streams',
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


              // Scale the region to true display coordinates
              let scaledRegion = {
                x: Math.round(displayRegion.x * scaleX),
                y: Math.round(displayRegion.y * scaleY),
                width: Math.round(displayRegion.width * scaleX),
                height: Math.round(displayRegion.height * scaleY)
              };

              
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
