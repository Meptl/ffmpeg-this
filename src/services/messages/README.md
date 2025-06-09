# Message Management System

An abstract message management system for handling chat messages with dual view states.

## Features

- **Dual View States**: Each message has both a raw/debug view (JSON) and a human-friendly view
- **Message Types**: Supports user, assistant, system (info/error/warning), media output, and initial file messages
- **Conversation History**: Maintains context for AI interactions
- **UI-Agnostic**: Works without any UI dependencies

## Usage

```javascript
const { MessageManager, MessageFormatter } = require('./services/messages');

// Initialize manager
const messageManager = new MessageManager();

// Set display mode
messageManager.setDisplayMode(true); // true for raw JSON, false for human-friendly

// Add user message
const userInput = "Convert this video to MP4";
const structuredData = MessageFormatter.formatUserMessage(
  userInput,
  currentFile,
  regionString
);
const userMsg = messageManager.addUserMessage(userInput, structuredData);

// Add assistant message
const aiResponse = '{"command": "ffmpeg -i {INPUT_FILE} -c:v libx264 {OUTPUT_FILE}", "output_extension": "mp4"}';
const parsedResponse = MessageFormatter.parseAIResponse(aiResponse);
const executableData = MessageFormatter.createExecutableData(
  parsedResponse,
  '/tmp/input.mov',
  '/tmp/output.mp4'
);
const assistantMsg = messageManager.addAssistantMessage(
  aiResponse,
  parsedResponse,
  executableData
);

// Add system messages
messageManager.addSystemMessage('info', 'Processing started...');
messageManager.addSystemMessage('error', 'FFmpeg execution failed');

// Add media output
messageManager.addMediaOutputMessage('/tmp/output.mp4', 'converted-video.mp4');

// Get messages for display
const messages = messageManager.getMessages();
// Each message has: id, type, timestamp, content (based on current mode)

// Get conversation history for AI
const history = messageManager.getConversationHistory(10);
// Returns: [{role: 'user', content: '...'}, {role: 'assistant', content: '...'}]
```

## Message Structure

Each message contains:
- `id`: Unique identifier
- `type`: Message type (user, assistant, info, error, warning, media-output, initial-file)
- `timestamp`: Creation timestamp
- `humanView`: Human-friendly representation
- `rawView`: Raw/debug representation (usually JSON)
- Additional type-specific data

## Integration with UI

The UI can:
1. Use `getMessages()` to get all messages with appropriate content based on mode
2. Listen for new messages and render them accordingly
3. Toggle between raw/human views using `setDisplayMode()`
4. Access message-specific data (parsedResponse, executableData, etc.) for actions
5. Get the system prompt using `getSystemPrompt()` for display in raw mode