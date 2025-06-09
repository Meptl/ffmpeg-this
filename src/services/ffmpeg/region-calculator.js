class FFmpegRegionCalculator {
  transformCropCoordinates(x, y, width, height, videoWidth, videoHeight, rotation) {
    switch(rotation) {
      case 90:
        return {
          x: videoHeight - y - height,
          y: x,
          width: height,
          height: width
        };
      case -90:
        return {
          x: y,
          y: videoHeight - x - width,
          width: height,
          height: width
        };
      case 180:
      case -180:
        return {
          x: videoWidth - x - width,
          y: videoHeight - y - height,
          width: width,
          height: height
        };
      default:
        return { x, y, width, height };
    }
  }

  calculateRegion(displayRegion, originalDimensions, rotation) {
    let displayWidth, displayHeight;
    
    if (rotation === 90 || rotation === -90) {
      displayWidth = originalDimensions.height;
      displayHeight = originalDimensions.width;
      console.log(`Video is rotated ${rotation} degrees. Swapping dimensions for display.`);
      console.log(`Original (stored): ${originalDimensions.width}x${originalDimensions.height}`);
      console.log(`Display (after rotation): ${displayWidth}x${displayHeight}`);
    } else {
      displayWidth = originalDimensions.width;
      displayHeight = originalDimensions.height;
      console.log(`Video has ${rotation} degree rotation. No dimension swap needed.`);
      console.log(`Original/Display: ${displayWidth}x${displayHeight}`);
    }
    
    const scaleX = displayWidth / displayRegion.displayWidth;
    const scaleY = displayHeight / displayRegion.displayHeight;
    console.log(`Scale factors - X: ${scaleX.toFixed(3)}, Y: ${scaleY.toFixed(3)}`);
    console.log(`Frontend display size: ${displayRegion.displayWidth}x${displayRegion.displayHeight}`);
    console.log(`Frontend selection: x=${displayRegion.x}, y=${displayRegion.y}, ${displayRegion.width}x${displayRegion.height}`);
    
    const scaledRegion = {
      x: Math.round(displayRegion.x * scaleX),
      y: Math.round(displayRegion.y * scaleY),
      width: Math.round(displayRegion.width * scaleX),
      height: Math.round(displayRegion.height * scaleY)
    };
    console.log(`Scaled region (in display coordinate space): x=${scaledRegion.x}, y=${scaledRegion.y}, ${scaledRegion.width}x${scaledRegion.height}`);
    
    const actualRegion = this.transformCropCoordinates(
      scaledRegion.x,
      scaledRegion.y,
      scaledRegion.width,
      scaledRegion.height,
      originalDimensions.width,
      originalDimensions.height,
      rotation
    );
    console.log(`Final region (after rotation transform): x=${actualRegion.x}, y=${actualRegion.y}, ${actualRegion.width}x${actualRegion.height}`);
    
    return {
      scaledRegion,
      actualRegion,
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

  parseRegionString(regionString) {
    const match = regionString.match(/^(\d+),(\d+)\s+(\d+)x(\d+)$/);
    if (!match) {
      throw new Error('Invalid region string format');
    }
    
    return {
      x: parseInt(match[1]),
      y: parseInt(match[2]),
      width: parseInt(match[3]),
      height: parseInt(match[4])
    };
  }

  getFFmpegCropFilter(region) {
    return `crop=${region.width}:${region.height}:${region.x}:${region.y}`;
  }
}

module.exports = FFmpegRegionCalculator;