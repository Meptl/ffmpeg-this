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

  async execute({ command, ffmpegPath = 'ffmpeg', inputFile, outputFile, executionId, timeout = 60000 }) {
    return new Promise((resolve, reject) => {
      const args = this.parseCommand(command);
      
      console.log('\n🎬 FFMPEG EXECUTION STARTED');
      console.log('📂 Working Directory:', process.cwd());
      console.log('🔧 FFmpeg Path:', ffmpegPath);
      console.log('📝 Command:', command);
      console.log('⚙️  Arguments:', args);
      console.log('📥 Input File:', inputFile || 'Not specified');
      console.log('📤 Output File:', outputFile || 'Not specified');
      console.log('─'.repeat(60));
      
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
          console.log('📤 FFmpeg stdout:', output.trim());
        }
      });
      
      ffmpegProcess.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        if (output.trim()) {
          console.log('📋 FFmpeg stderr:', output.trim());
        }
      });
      
      ffmpegProcess.on('close', (code) => {
        if (responseSent) return;
        responseSent = true;
        clearTimeout(timeoutId);
        
        if (executionId) {
          this.activeProcesses.delete(executionId);
        }
        
        console.log('\n🏁 FFMPEG EXECUTION COMPLETED');
        console.log('🔢 Exit Code:', code);
        
        if (code === 0) {
          console.log('✅ Status: SUCCESS');
          
          const result = {
            success: true,
            stdout,
            stderr,
            code
          };
          
          if (outputFile && fs.existsSync(outputFile)) {
            const stats = fs.statSync(outputFile);
            console.log('📁 Output File Created:', outputFile);
            console.log('📊 File Size:', (stats.size / 1024 / 1024).toFixed(2), 'MB');
            
            result.outputFile = outputFile;
            result.outputSize = stats.size;
          } else {
            console.log('⚠️  No output file created');
          }
          
          resolve(result);
        } else {
          console.log('❌ Status: FAILED');
          console.log('💥 Error Details:', stderr.slice(-200));
          reject({
            code,
            stdout,
            stderr,
            message: `FFmpeg execution failed with code ${code}`
          });
        }
        console.log('═'.repeat(60));
      });
      
      ffmpegProcess.on('error', (error) => {
        if (responseSent) return;
        responseSent = true;
        clearTimeout(timeoutId);
        
        if (executionId) {
          this.activeProcesses.delete(executionId);
        }
        
        console.log('\n💥 FFMPEG PROCESS ERROR');
        console.log('❌ Error Type:', error.code || 'Unknown');
        console.log('📝 Error Message:', error.message);
        console.log('💡 Possible Causes:');
        console.log('   - FFmpeg not installed or not in PATH');
        console.log('   - Invalid FFmpeg path in settings');
        console.log('   - Permissions issue');
        console.log('═'.repeat(60));
        
        reject({
          error,
          message: 'Failed to start FFmpeg process: ' + error.message
        });
      });
      
      const timeoutId = setTimeout(() => {
        if (!ffmpegProcess.killed && !responseSent) {
          responseSent = true;
          console.log('\n⏰ FFMPEG EXECUTION TIMEOUT');
          console.log('🚫 Killing process after', timeout / 1000, 'seconds');
          console.log('═'.repeat(60));
          
          ffmpegProcess.kill();
          reject({
            message: 'FFmpeg execution timed out',
            timeout: true
          });
        }
      }, timeout);
    });
  }

  cancel(executionId) {
    const ffmpegProcess = this.activeProcesses.get(executionId);
    
    if (!ffmpegProcess) {
      throw new Error('No active process found for this execution');
    }
    
    console.log(`\n🚫 CANCELLING FFMPEG EXECUTION: ${executionId}`);
    
    ffmpegProcess.kill('SIGTERM');
    this.activeProcesses.delete(executionId);
    
    console.log('✅ FFmpeg process terminated');
    
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