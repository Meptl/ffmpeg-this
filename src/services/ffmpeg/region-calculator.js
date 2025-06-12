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

  calculateRegion(displayRegion, mediaDimensions) {
    // Use the DAR/PAR-corrected display dimensions from mediaDimensions
    const displayWidth = mediaDimensions.displayWidth;
    const displayHeight = mediaDimensions.displayHeight;
    const rotation = mediaDimensions.rotation || 0;
    
    console.log(`Video metadata:`);
    console.log(`  Storage dimensions: ${mediaDimensions.width}x${mediaDimensions.height}`);
    console.log(`  Display dimensions (DAR/PAR corrected + rotation): ${displayWidth}x${displayHeight}`);
    console.log(`  SAR: ${mediaDimensions.sar || '1:1'} (value: ${mediaDimensions.sarValue || 1})`);
    console.log(`  DAR: ${mediaDimensions.dar || 'N/A'} (value: ${mediaDimensions.darValue || 'N/A'})`);
    console.log(`  Rotation: ${rotation} degrees`);
    
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
    console.log(`Scaled region (in true display coordinate space): x=${scaledRegion.x}, y=${scaledRegion.y}, ${scaledRegion.width}x${scaledRegion.height}`);
    
    // Now we need to transform from display coordinates to storage coordinates
    // We need to work in the pre-rotation coordinate space for DAR/PAR transformations
    let preRotationRegion = scaledRegion;
    
    // If video is rotated, we need to reverse the rotation first to get back to pre-rotation display space
    if (rotation === 90 || rotation === -90) {
      // The display dimensions are already rotated, so we need to work with unrotated dimensions for DAR/PAR
      // Swap the coordinates back
      preRotationRegion = {
        x: rotation === 90 ? scaledRegion.y : displayHeight - scaledRegion.y - scaledRegion.height,
        y: rotation === 90 ? displayWidth - scaledRegion.x - scaledRegion.width : scaledRegion.x,
        width: scaledRegion.height,
        height: scaledRegion.width
      };
    }
    
    // Apply DAR/PAR transformation (reverse of what was done in metadata extractor)
    let storageRegion;
    
    if (mediaDimensions.darValue) {
      // Reverse the DAR transformation
      const storageAspectRatio = mediaDimensions.storageAspectRatio;
      const aspectRatioMultiplier = mediaDimensions.darValue / storageAspectRatio;
      
      if (aspectRatioMultiplier > 1) {
        // Width was scaled up, so scale down
        storageRegion = {
          x: Math.round(preRotationRegion.x / aspectRatioMultiplier),
          y: preRotationRegion.y,
          width: Math.round(preRotationRegion.width / aspectRatioMultiplier),
          height: preRotationRegion.height
        };
      } else {
        // Height was scaled up, so scale down
        storageRegion = {
          x: preRotationRegion.x,
          y: Math.round(preRotationRegion.y * aspectRatioMultiplier),
          width: preRotationRegion.width,
          height: Math.round(preRotationRegion.height * aspectRatioMultiplier)
        };
      }
    } else if (mediaDimensions.sarValue && mediaDimensions.sarValue !== 1) {
      // Reverse the SAR/PAR transformation
      storageRegion = {
        x: Math.round(preRotationRegion.x / mediaDimensions.sarValue),
        y: preRotationRegion.y,
        width: Math.round(preRotationRegion.width / mediaDimensions.sarValue),
        height: preRotationRegion.height
      };
    } else {
      // No aspect ratio transformation needed
      storageRegion = preRotationRegion;
    }
    
    console.log(`Storage region (after DAR/PAR reverse transform): x=${storageRegion.x}, y=${storageRegion.y}, ${storageRegion.width}x${storageRegion.height}`);
    
    // Apply rotation transformation to get final coordinates in stored video space
    const actualRegion = this.transformCropCoordinates(
      storageRegion.x,
      storageRegion.y,
      storageRegion.width,
      storageRegion.height,
      mediaDimensions.width,
      mediaDimensions.height,
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