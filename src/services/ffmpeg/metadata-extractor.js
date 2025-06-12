const { spawn } = require('child_process');

class FFmpegMetadataExtractor {
  async getVideoRotation(filePath, ffprobePath = 'ffprobe') {
    return new Promise((resolve) => {
      const ffprobeProcess = spawn(ffprobePath, [
        '-loglevel', 'error',
        '-show_entries', 'stream=width,height:stream_side_data=displaymatrix',
        '-select_streams', 'v:0',
        '-of', 'default=nw=1',
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
        console.log('Rotation detection output:', stdout);
        console.log('Rotation detection stderr:', stderr);
        
        if (code === 0 && stdout) {
          const match = stdout.match(/rotation of (-?\d+(?:\.\d+)?)/);
          if (match) {
            const rotation = parseFloat(match[1]);
            console.log('Found rotation:', rotation);
            if (Math.abs(rotation - 90) < 1) return resolve(90);
            if (Math.abs(rotation + 90) < 1) return resolve(-90);
            if (Math.abs(rotation - 180) < 1) return resolve(180);
            if (Math.abs(rotation + 180) < 1) return resolve(-180);
            return resolve(Math.round(rotation));
          }
        }
        
        const jsonProcess = spawn(ffprobePath, [
          '-v', 'quiet',
          '-print_format', 'json',
          '-show_format', 
          '-show_streams',
          filePath
        ]);
        
        let jsonStdout = '';
        
        jsonProcess.stdout.on('data', (data) => {
          jsonStdout += data.toString();
        });
        
        jsonProcess.on('close', (code) => {
          if (code === 0) {
            try {
              const data = JSON.parse(jsonStdout);
              console.log('JSON probe data:', JSON.stringify(data, null, 2));
              
              if (data.streams) {
                for (const stream of data.streams) {
                  if (stream.codec_type === 'video') {
                    if (stream.tags && stream.tags.rotate) {
                      const rotation = parseInt(stream.tags.rotate);
                      console.log('Found rotate tag:', rotation);
                      if (!isNaN(rotation)) {
                        return resolve(rotation);
                      }
                    }
                    
                    if (stream.side_data_list) {
                      for (const sideData of stream.side_data_list) {
                        console.log('Side data:', sideData);
                        if (sideData.side_data_type === 'Display Matrix' || sideData.displaymatrix) {
                          if (sideData.rotation !== undefined) {
                            const rotation = parseFloat(sideData.rotation);
                            console.log('Found rotation in side_data:', rotation);
                            if (!isNaN(rotation)) {
                              if (Math.abs(rotation - 90) < 1) return resolve(90);
                              if (Math.abs(rotation + 90) < 1) return resolve(-90);
                              if (Math.abs(rotation - 180) < 1) return resolve(180);
                              if (Math.abs(rotation + 180) < 1) return resolve(-180);
                              return resolve(Math.round(rotation));
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            } catch (e) {
              console.error('Error parsing JSON from ffprobe:', e);
            }
          }
          
          console.log('No rotation found, returning 0');
          resolve(0);
        });
        
        jsonProcess.on('error', (err) => {
          console.error('JSON probe error:', err);
          resolve(0);
        });
      });
      
      ffprobeProcess.on('error', (err) => {
        console.error('First probe error:', err);
        resolve(0);
      });
    });
  }

  async getMediaDimensions(filePath, ffprobePath = 'ffprobe') {
    return new Promise((resolve, reject) => {
      const ffprobeProcess = spawn(ffprobePath, [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,sample_aspect_ratio,display_aspect_ratio',
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
      
      ffprobeProcess.on('close', async (code) => {
        if (code === 0) {
          try {
            const probeResult = JSON.parse(stdout);
            if (probeResult.streams && probeResult.streams[0]) {
              const stream = probeResult.streams[0];
              const width = stream.width;
              const height = stream.height;
              
              // Extract SAR (Sample/Pixel Aspect Ratio) and DAR (Display Aspect Ratio)
              let sar = stream.sample_aspect_ratio || '1:1';
              let dar = stream.display_aspect_ratio;
              
              // Parse aspect ratios to numeric values
              const parseRatio = (ratio) => {
                if (!ratio || ratio === 'N/A') return null;
                const parts = ratio.split(':');
                if (parts.length === 2) {
                  return parseFloat(parts[0]) / parseFloat(parts[1]);
                }
                return null;
              };
              
              const sarValue = parseRatio(sar) || 1;
              const darValue = parseRatio(dar);
              
              // Calculate true display dimensions
              let trueDisplayWidth, trueDisplayHeight;
              
              if (darValue) {
                // If we have DAR, use it to calculate display dimensions
                const storageAspectRatio = width / height;
                const aspectRatioMultiplier = darValue / storageAspectRatio;
                
                if (aspectRatioMultiplier > 1) {
                  // Video is wider than storage suggests
                  trueDisplayWidth = width * aspectRatioMultiplier;
                  trueDisplayHeight = height;
                } else {
                  // Video is taller than storage suggests
                  trueDisplayWidth = width;
                  trueDisplayHeight = height / aspectRatioMultiplier;
                }
              } else if (sarValue !== 1) {
                // If we only have SAR/PAR, use it
                trueDisplayWidth = width * sarValue;
                trueDisplayHeight = height;
              } else {
                // No aspect ratio correction needed
                trueDisplayWidth = width;
                trueDisplayHeight = height;
              }
              
              // Get rotation
              const rotation = await this.getVideoRotation(filePath, ffprobePath);
              
              // Apply rotation to display dimensions
              let displayWidth, displayHeight;
              if (rotation === 90 || rotation === -90) {
                displayWidth = trueDisplayHeight;
                displayHeight = trueDisplayWidth;
              } else {
                displayWidth = trueDisplayWidth;
                displayHeight = trueDisplayHeight;
              }
              
              resolve({
                width,
                height,
                rotation,
                displayWidth: Math.round(displayWidth),
                displayHeight: Math.round(displayHeight),
                sar,
                dar,
                sarValue,
                darValue,
                storageAspectRatio: width / height,
                displayAspectRatio: trueDisplayWidth / trueDisplayHeight
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

  async getFullMetadata(filePath, ffprobePath = 'ffprobe') {
    return new Promise((resolve, reject) => {
      const ffprobeProcess = spawn(ffprobePath, [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        filePath
      ]);
      
      let stdout = '';
      
      ffprobeProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      ffprobeProcess.on('close', (code) => {
        if (code === 0) {
          try {
            const metadata = JSON.parse(stdout);
            resolve(metadata);
          } catch (e) {
            reject(new Error('Failed to parse metadata: ' + e.message));
          }
        } else {
          reject(new Error(`ffprobe exited with code ${code}`));
        }
      });
      
      ffprobeProcess.on('error', reject);
    });
  }
}

module.exports = FFmpegMetadataExtractor;