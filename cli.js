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

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  
  if (options.open) {
    open(`http://localhost:${PORT}`);
  }
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  process.exit();
});
