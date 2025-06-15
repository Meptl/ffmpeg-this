#!/usr/bin/env node

const { program } = require('commander');
const express = require('express');
const cors = require('cors');
const open = require('open');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Import routes and storage
const apiRoutes = require('./src/routes');
const { setPreConfiguredFile } = require('./src/routes/system');
const { initStorage, get } = require('./src/storage');

// Parse command line arguments
program
  .name('ffmpeg-this')
  .description('CLI tool for AI chat interface with ffmpeg integration')
  .version('1.0.0')
  .argument('[file]', 'file to pre-configure (can also use -f/--file)')
  .option('-p, --port <port>', 'port to run the server on', '3000')
  .option('-f, --file <path>', 'pre-configure with a file path')
  .option('--no-open', 'do not open browser automatically')
  .parse();

const options = program.opts();
const args = program.args;
const PORT = parseInt(options.port, 10);

// Create Express app
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// API Routes
app.use('/api', apiRoutes);

// Check ffmpeg availability
app.get('/api/ffmpeg-status', async (req, res) => {
  try {
    // Check custom ffmpeg path first
    const customPath = await get('ffmpegPath', '');
    const ffmpegCommand = customPath || 'ffmpeg';
    
    await execAsync(`"${ffmpegCommand}" -version`);
    res.json({ available: true, path: ffmpegCommand });
  } catch (error) {
    res.json({ available: false, error: error.message });
  }
});

// Initialize storage and start server
(async () => {
  await initStorage();
  
  // Handle pre-configured file if provided (either as positional arg or --file option)
  const fileToPreConfigure = args[0] || options.file;
  if (fileToPreConfigure) {
    setPreConfiguredFile(fileToPreConfigure);
  }
  
  app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  
    if (options.open) {
      open(`http://localhost:${PORT}`);
    }
  });
})();

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  process.exit();
});
