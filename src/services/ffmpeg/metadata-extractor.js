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
      
      ffprobeProcess.on('close', async (code) => {
        if (code === 0) {
          try {
            const probeResult = JSON.parse(stdout);
            if (probeResult.streams && probeResult.streams[0]) {
              const stream = probeResult.streams[0];
              const width = stream.width;
              const height = stream.height;
              
              // Get rotation
              const rotation = await this.getVideoRotation(filePath, ffprobePath);
              
              // Apply rotation to display dimensions
              let displayWidth, displayHeight;
              if (rotation === 90 || rotation === -90) {
                displayWidth = height;
                displayHeight = width;
              } else {
                displayWidth = width;
                displayHeight = height;
              }
              
              resolve({
                width,
                height,
                rotation,
                displayWidth,
                displayHeight
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

module.exports = FFmpegMetadataExtractor;