#!/usr/bin/env node

const { program } = require('commander');
const express = require('express');
const cors = require('cors');
const open = require('open');
const path = require('path');

// Import routes
const apiRoutes = require('./src/routes');
const { setPreConfiguredFile } = require('./src/routes/system');

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

// Start server
// Handle pre-configured file if provided (either as positional arg or --file option)
const fileToPreConfigure = args[0] || options.file;
if (fileToPreConfigure) {
  setPreConfiguredFile(fileToPreConfigure);
}

// Function to try starting the server on a port
const tryStartServer = (port, attempt = 1) => {
  const server = app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    
    if (options.open) {
      open(`http://localhost:${port}`);
    }
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempt < 5) {
      console.log(`Port ${port} is in use, trying port ${port + 1}...`);
      tryStartServer(port + 1, attempt + 1);
    } else if (err.code === 'EADDRINUSE') {
      console.error(`Unable to start server: Tried ports ${PORT} through ${PORT + 4}, all are in use.`);
      process.exit(1);
    } else {
      console.error('Server error:', err);
      process.exit(1);
    }
  });

  return server;
};

// Start the server
tryStartServer(PORT);

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  process.exit();
});
