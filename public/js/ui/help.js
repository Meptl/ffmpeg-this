// Help Modal Module
// Handles help modal functionality

// DOM elements
let helpModal = null;
let helpBtn = null;
let closeBtn = null;

// Initialize help modal functionality
export function initializeHelp() {
    // Get DOM elements
    helpModal = document.getElementById('help-modal');
    helpBtn = document.getElementById('help-btn');
    closeBtn = helpModal?.querySelector('.close');
    
    if (!helpModal || !helpBtn) {
        console.error('Help modal elements not found');
        return;
    }
    
    // Event listeners
    helpBtn.addEventListener('click', openHelpModal);
    closeBtn?.addEventListener('click', closeHelpModal);
    
    // Close modal when clicking outside
    window.addEventListener('click', (event) => {
        if (event.target === helpModal) {
            closeHelpModal();
        }
    });
    
    // Close on Escape key
    window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && helpModal.style.display === 'block') {
            closeHelpModal();
        }
    });
}

// Open help modal
function openHelpModal() {
    if (helpModal) {
        helpModal.style.display = 'block';
    }
}

// Close help modal
function closeHelpModal() {
    if (helpModal) {
        helpModal.style.display = 'none';
    }
}