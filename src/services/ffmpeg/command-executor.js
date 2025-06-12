const { spawn } = require('child_process');
const fs = require('fs');

class FFmpegCommandExecutor {
  constructor() {
    this.activeProcesses = new Map();
  }

  parseCommand(command) {
    let commandArgs = command.replace(/^ffmpeg\s+/, '').trim();
    
    const args = [];
    let currentArg = '';
    let inQuotes = false;
    let quoteChar = '';
    
    for (let i = 0; i < commandArgs.length; i++) {
      const char = commandArgs[i];
      
      if ((char === '"' || char === "'") && !inQuotes) {
        inQuotes = true;
        quoteChar = char;
      } else if (char === quoteChar && inQuotes) {
        inQuotes = false;
        quoteChar = '';
      } else if (char === ' ' && !inQuotes) {
        if (currentArg.trim()) {
          args.push(currentArg.trim());
          currentArg = '';
        }
      } else {
        currentArg += char;
      }
    }
    
    if (currentArg.trim()) {
      args.push(currentArg.trim());
    }
    
    return args;
  }

  async execute({ command, ffmpegPath = 'ffmpeg', inputFile, outputFile, executionId, onOutput }) {
    return new Promise((resolve, reject) => {
      const args = this.parseCommand(command);
      
      console.log('FFmpeg Command:', command);
      
      const ffmpegProcess = spawn(ffmpegPath, args, {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      if (executionId) {
        this.activeProcesses.set(executionId, ffmpegProcess);
      }
      
      let stdout = '';
      let stderr = '';
      let responseSent = false;
      
      ffmpegProcess.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        if (output.trim()) {
          console.log(output.trim());
          if (onOutput) onOutput('stdout', output);
        }
      });
      
      ffmpegProcess.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        if (output.trim()) {
          console.log(output.trim());
          if (onOutput) onOutput('stderr', output);
        }
      });
      
      ffmpegProcess.on('close', (code) => {
        if (responseSent) return;
        responseSent = true;
        
        if (executionId) {
          this.activeProcesses.delete(executionId);
        }
        
        if (code === 0) {
          const result = {
            success: true,
            stdout,
            stderr,
            code
          };
          
          if (outputFile && fs.existsSync(outputFile)) {
            const stats = fs.statSync(outputFile);
            result.outputFile = outputFile;
            result.outputSize = stats.size;
          }
          
          resolve(result);
        } else {
          reject({
            code,
            stdout,
            stderr,
            message: `FFmpeg execution failed with code ${code}`
          });
        }
      });
      
      ffmpegProcess.on('error', (error) => {
        if (responseSent) return;
        responseSent = true;
        
        if (executionId) {
          this.activeProcesses.delete(executionId);
        }
        
        
        reject({
          error,
          message: 'Failed to start FFmpeg process: ' + error.message
        });
      });
      
    });
  }

  cancel(executionId) {
    const ffmpegProcess = this.activeProcesses.get(executionId);
    
    if (!ffmpegProcess) {
      throw new Error('No active process found for this execution');
    }
    
    ffmpegProcess.kill('SIGTERM');
    this.activeProcesses.delete(executionId);
    
    return { success: true, message: 'FFmpeg execution cancelled' };
  }

  async checkAvailability(ffmpegPath = 'ffmpeg') {
    return new Promise((resolve) => {
      const testProcess = spawn(ffmpegPath, ['-version'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      let responseSet = false;
      
      testProcess.on('close', (code) => {
        if (!responseSet) {
          responseSet = true;
          resolve({ available: code === 0, path: ffmpegPath });
        }
      });
      
      testProcess.on('error', () => {
        if (!responseSet) {
          responseSet = true;
          resolve({ available: false, path: ffmpegPath });
        }
      });
      
      setTimeout(() => {
        if (!responseSet) {
          responseSet = true;
          testProcess.kill();
          resolve({ available: false, path: ffmpegPath, timeout: true });
        }
      }, 5000);
    });
  }
}

module.exports = FFmpegCommandExecutor;