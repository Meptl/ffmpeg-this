class FFmpegRegionCalculator {

  calculateRegion(displayRegion, mediaDimensions) {
    const displayWidth = mediaDimensions.displayWidth;
    const displayHeight = mediaDimensions.displayHeight;
    
    console.log(`Video metadata:`);
    console.log(`  Storage dimensions: ${mediaDimensions.width}x${mediaDimensions.height}`);
    console.log(`  Display dimensions: ${displayWidth}x${displayHeight}`);
    
    // Calculate scale from browser display to true display dimensions
    const scaleX = displayWidth / displayRegion.displayWidth;
    const scaleY = displayHeight / displayRegion.displayHeight;
    console.log(`Scale factors - X: ${scaleX.toFixed(3)}, Y: ${scaleY.toFixed(3)}`);
    console.log(`Frontend display size: ${displayRegion.displayWidth}x${displayRegion.displayHeight}`);
    console.log(`Frontend selection: x=${displayRegion.x}, y=${displayRegion.y}, ${displayRegion.width}x${displayRegion.height}`);
    
    // Scale the region to true display coordinates
    const scaledRegion = {
      x: Math.round(displayRegion.x * scaleX),
      y: Math.round(displayRegion.y * scaleY),
      width: Math.round(displayRegion.width * scaleX),
      height: Math.round(displayRegion.height * scaleY)
    };
    console.log(`Scaled region: x=${scaledRegion.x}, y=${scaledRegion.y}, ${scaledRegion.width}x${scaledRegion.height}`);
    
    return {
      scaledRegion,
      actualRegion: scaledRegion,
      displayDimensions: { width: displayWidth, height: displayHeight }
    };
  }

  validateRegion(region, dimensions) {
    return !(
      region.x < 0 || 
      region.y < 0 || 
      region.width <= 0 || 
      region.height <= 0 ||
      region.x + region.width > dimensions.width ||
      region.y + region.height > dimensions.height
    );
  }

  formatRegionString(region) {
    return `${region.x},${region.y} ${region.width}x${region.height}`;
  }

}

module.exports = FFmpegRegionCalculator;
