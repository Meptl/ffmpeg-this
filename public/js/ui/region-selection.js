// Region Selection Module
// Handles video/image region selection for cropping operations

import { state, updateState } from '../core/state.js';

class RegionSelection {
    constructor() {
        this.initialized = false;
    }

    // Initialize region selection event listeners
    initialize() {
        if (this.initialized) return;
        
        // Add global event listeners
        document.addEventListener('mousedown', this.handleMouseDown.bind(this));
        document.addEventListener('mousemove', this.handleMouseMove.bind(this));
        document.addEventListener('mouseup', this.handleMouseUp.bind(this));
        
        this.initialized = true;
    }

    // Handle mouse down event
    handleMouseDown(e) {
        // Check if we're clicking on a button or input
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        
        // Find the closest selection-mode container from the click point
        let targetContainer = null;
        
        // First check if we clicked directly on a container
        const directContainer = e.target.closest('.region-selection-container');
        if (directContainer && directContainer.classList.contains('selection-mode')) {
            targetContainer = directContainer;
        } else {
            // Check if we're clicking within a message that contains an active selection container
            const messageElement = e.target.closest('.message');
            if (messageElement) {
                const containerInMessage = messageElement.querySelector('.region-selection-container.selection-mode');
                if (containerInMessage) {
                    targetContainer = containerInMessage;
                }
            }
        }
        
        if (!targetContainer) return;
        
        // Prevent default drag behavior
        e.preventDefault();
        
        updateState({ isSelecting: true });
        const rect = targetContainer.getBoundingClientRect();
        const selectionStart = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            container: targetContainer
        };
        updateState({ selectionStart });
        
        // Clear visual selection in this container only
        const overlay = targetContainer.querySelector('.region-selection-overlay');
        overlay.innerHTML = '';
        targetContainer.classList.remove('has-selection');
    }

    // Handle mouse move event
    handleMouseMove(e) {
        if (!state.isSelecting || !state.selectionStart) return;
        
        const container = state.selectionStart.container;
        const rect = container.getBoundingClientRect();
        const media = container.querySelector('img, video');
        const mediaRect = media.getBoundingClientRect();
        
        // Calculate mouse position relative to container
        let currentX = e.clientX - rect.left;
        let currentY = e.clientY - rect.top;
        
        // Constrain to media boundaries
        const mediaOffsetX = mediaRect.left - rect.left;
        const mediaOffsetY = mediaRect.top - rect.top;
        const mediaWidth = media.offsetWidth;
        const mediaHeight = media.offsetHeight;
        
        currentX = Math.max(mediaOffsetX, Math.min(currentX, mediaOffsetX + mediaWidth));
        currentY = Math.max(mediaOffsetY, Math.min(currentY, mediaOffsetY + mediaHeight));
        
        // Constrain start position too (in case it was outside)
        const constrainedStartX = Math.max(mediaOffsetX, Math.min(state.selectionStart.x, mediaOffsetX + mediaWidth));
        const constrainedStartY = Math.max(mediaOffsetY, Math.min(state.selectionStart.y, mediaOffsetY + mediaHeight));
        
        // Calculate selection rectangle
        const x = Math.min(constrainedStartX, currentX);
        const y = Math.min(constrainedStartY, currentY);
        const width = Math.abs(currentX - constrainedStartX);
        const height = Math.abs(currentY - constrainedStartY);
        
        // Update region selection visual
        this.updateSelectionVisual(container, x, y, width, height);
    }

    // Handle mouse up event
    handleMouseUp(e) {
        if (!state.isSelecting) return;
        
        updateState({ isSelecting: false });
        
        // Store the final selection
        const overlay = state.selectionStart.container.querySelector('.region-selection-overlay');
        const selection = overlay.querySelector('.region-selection');
        if (selection) {
            const container = state.selectionStart.container;
            const media = container.querySelector('img, video');
            
            const mediaContainer = state.selectionStart.container;
            const filePath = mediaContainer.getAttribute('data-file-path');
            
            const regionSelection = {
                x: parseInt(selection.style.left),
                y: parseInt(selection.style.top),
                width: parseInt(selection.style.width),
                height: parseInt(selection.style.height),
                displayWidth: media.offsetWidth,
                displayHeight: media.offsetHeight,
                filePath: filePath // Track which file this selection was made on
            };
            
            updateState({ regionSelection });
            container.classList.add('has-selection');
        }
        
        updateState({ selectionStart: null });
    }

    // Update the visual selection display
    updateSelectionVisual(container, x, y, width, height) {
        const overlay = container.querySelector('.region-selection-overlay');
        
        // Clear existing elements
        overlay.innerHTML = '';
        
        if (width < 5 || height < 5) return; // Minimum selection size
        
        // Create selection rectangle
        const selection = document.createElement('div');
        selection.className = 'region-selection';
        selection.style.left = x + 'px';
        selection.style.top = y + 'px';
        selection.style.width = width + 'px';
        selection.style.height = height + 'px';
        overlay.appendChild(selection);
        
        // Create darkening overlays
        const media = container.querySelector('img, video');
        const mediaWidth = media.offsetWidth;
        const mediaHeight = media.offsetHeight;
        
        // Top darkening
        const topDark = document.createElement('div');
        topDark.className = 'region-darkening top';
        topDark.style.height = y + 'px';
        overlay.appendChild(topDark);
        
        // Bottom darkening
        const bottomDark = document.createElement('div');
        bottomDark.className = 'region-darkening bottom';
        bottomDark.style.height = (mediaHeight - y - height) + 'px';
        overlay.appendChild(bottomDark);
        
        // Left darkening
        const leftDark = document.createElement('div');
        leftDark.className = 'region-darkening left';
        leftDark.style.top = y + 'px';
        leftDark.style.width = x + 'px';
        leftDark.style.height = height + 'px';
        overlay.appendChild(leftDark);
        
        // Right darkening
        const rightDark = document.createElement('div');
        rightDark.className = 'region-darkening right';
        rightDark.style.top = y + 'px';
        rightDark.style.width = (mediaWidth - x - width) + 'px';
        rightDark.style.height = height + 'px';
        overlay.appendChild(rightDark);
    }

    // Clear region selection
    clear(button) {
        const container = button.closest('.region-selection-container');
        const overlay = container.querySelector('.region-selection-overlay');
        overlay.innerHTML = '';
        container.classList.remove('has-selection');
        
        // Only clear if this was for the currently active selection
        const wasActiveContainer = container === state.activeSelectionContainer || 
                                  container.classList.contains('selection-mode');
        if (wasActiveContainer || state.regionSelection) {
            updateState({ 
                regionSelection: null,
                actualRegion: null
            });
        }
    }

    // Toggle region selection mode
    toggleMode(button) {
        // Find the container within the same media embed
        const mediaEmbed = button.closest('.media-embed');
        const container = mediaEmbed.querySelector('.region-selection-container');
        
        if (!container) return;
        
        const isActive = container.classList.contains('selection-mode');
        
        // Disable any other active selection mode
        if (state.activeSelectionContainer && state.activeSelectionContainer !== container) {
            state.activeSelectionContainer.classList.remove('selection-mode');
            const otherEmbed = state.activeSelectionContainer.closest('.media-embed');
            const otherBtn = otherEmbed.querySelector('.region-select-btn');
            if (otherBtn) {
                otherBtn.classList.remove('active');
                otherBtn.innerHTML = '✂️';
            }
        }
        
        if (isActive) {
            // Disable selection mode
            container.classList.remove('selection-mode');
            button.classList.remove('active');
            button.innerHTML = '✂️';
            updateState({ activeSelectionContainer: null });
            
            // Re-enable video interaction
            const video = container.querySelector('video');
            if (video) {
                video.style.pointerEvents = '';
            }
        } else {
            // Enable selection mode
            container.classList.add('selection-mode');
            button.classList.add('active');
            button.innerHTML = '❌';
            updateState({ activeSelectionContainer: container });
            
            // Disable video interaction while keeping controls visible
            const video = container.querySelector('video');
            if (video) {
                video.style.pointerEvents = 'none';
            }
            
            // If we have a global region selection, display it
            if (state.regionSelection) {
                const media = container.querySelector('img, video');
                if (media) {
                    // Check if this selection matches the current media dimensions
                    const currentWidth = media.offsetWidth;
                    const currentHeight = media.offsetHeight;
                    
                    // If dimensions match, show the selection
                    if (Math.abs(currentWidth - state.regionSelection.displayWidth) < 5 && 
                        Math.abs(currentHeight - state.regionSelection.displayHeight) < 5) {
                        this.updateSelectionVisual(container, state.regionSelection.x, state.regionSelection.y, 
                                                 state.regionSelection.width, state.regionSelection.height);
                        container.classList.add('has-selection');
                    }
                }
            }
        }
    }

    // Get current region selection
    getSelection() {
        return state.regionSelection;
    }

    // Check if currently selecting
    isSelecting() {
        return state.isSelecting;
    }

    // Get active selection container
    getActiveContainer() {
        return state.activeSelectionContainer;
    }
}

// Create singleton instance
const regionSelection = new RegionSelection();

// Initialize function
export function initializeRegionSelection() {
    regionSelection.initialize();
}

// Export functions for global access (needed for inline event handlers)
export function clearRegionSelection(button) {
    regionSelection.clear(button);
}

export function toggleRegionSelectMode(button) {
    regionSelection.toggleMode(button);
}

// Export the service for programmatic access
export { regionSelection };