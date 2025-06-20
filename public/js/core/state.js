// Global State Management Module
// Centralized state for the entire application

// Application state
const state = {
    // Message management
    messageManager: null,
    
    // Provider configuration
    currentProvider: '',
    configuredProviders: [],
    
    // System status
    ffmpegAvailable: false,
    
    // File management
    currentFile: null,
    initialFile: null,
    mostRecentMediaPath: null,
    
    // UI preferences
    autoExecuteCommands: true,
    
    // Settings tracking
    settingsChanged: false,
    
    // Region selection state
    regionSelection: null, // {x, y, width, height} in pixels relative to displayed size
    actualRegion: null, // {x, y, width, height} in pixels relative to original media
    isSelecting: false,
    selectionStart: null,
    activeSelectionContainer: null, // Track which container is in selection mode
    
    // Execution state
    currentExecutionId: null
};

// State update function with optional callback
function updateState(updates) {
    Object.assign(state, updates);
    
    // Notify listeners of state changes
    if (stateListeners.length > 0) {
        const changedKeys = Object.keys(updates);
        stateListeners.forEach(listener => {
            if (listener.keys.some(key => changedKeys.includes(key))) {
                listener.callback(state, updates);
            }
        });
    }
}

// State listeners for reactive updates
const stateListeners = [];

// Subscribe to state changes
function subscribe(keys, callback) {
    const listener = { keys, callback };
    stateListeners.push(listener);
    
    // Return unsubscribe function
    return () => {
        const index = stateListeners.indexOf(listener);
        if (index > -1) {
            stateListeners.splice(index, 1);
        }
    };
}

// Get current state (read-only)
function getState() {
    return { ...state };
}

// Initialize state from persistent storage
async function initializeState() {
    try {
        // Load autoExecuteCommands from localStorage
        const savedAutoExecute = localStorage.getItem('autoExecuteCommands');
        if (savedAutoExecute !== null) {
            state.autoExecuteCommands = savedAutoExecute === 'true';
        }
    } catch (error) {
        console.error('Error initializing state:', error);
    }
}

// Export state and functions
export { 
    state, 
    updateState, 
    getState,
    subscribe,
    initializeState
};