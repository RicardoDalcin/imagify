export async function test() {
  const targetImage = await fetch('image/target-256.jpg');
  const targetWeights = await fetch('image/weights-256.jpg');

  const targetImageBlob = await targetImage.blob();
  const targetWeightsBlob = await targetWeights.blob();

  const sourceImage = await fetch('image/source.jpg');
  const sourceImageBlob = await sourceImage.blob();
  const downsampledSourceImage = await downsampleImage(sourceImageBlob, 256);

  const sourcePixels = await imageToMatrix(downsampledSourceImage);
  const targetPixels = await imageToMatrix(targetImageBlob);
  const weightsPixels = await imageToMatrix(targetWeightsBlob);

  const weights = sourcePixels.map((row, i) => {
    return row.map((pixel, j) => {
      const [sr, sg, sb, sa] = pixel;
      const [tr, tg, tb, ta] = targetPixels[i][j];
      const [weightByte] = weightsPixels[i][j];
      const weight = weightByte / 255;

      // Euclidean distance of the source and target pixels
      return (
        Math.sqrt(
          (sr - tr) ** 2 + (sg - tg) ** 2 + (sb - tb) ** 2 + (sa - ta) ** 2,
        ) * weight
      );
    });
  });

  console.log({ weights });
}

async function imageToMatrix(image: Blob): Promise<number[][][]> {
  return new Promise((resolve, reject) => {
    const imageElement = new Image();
    const objectUrl = URL.createObjectURL(image);
    imageElement.src = objectUrl;

    imageElement.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = imageElement.naturalWidth;
      canvas.height = imageElement.naturalHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Failed to get canvas context'));
        return;
      }

      ctx.drawImage(imageElement, 0, 0);
      const { data, width, height } = ctx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      );

      const matrix: number[][][] = Array.from({ length: height }, () =>
        Array.from({ length: width }, () => [0, 0, 0, 0]),
      );

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const pixelIndex = (y * width + x) * 4;
          const r = data[pixelIndex];
          const g = data[pixelIndex + 1];
          const b = data[pixelIndex + 2];
          const a = data[pixelIndex + 3];

          matrix[y][x] = [r, g, b, a];
        }
      }

      URL.revokeObjectURL(objectUrl);
      resolve(matrix);
    };

    imageElement.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image'));
    };
  });
}

async function downsampleImage(image: Blob, size: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const imageElement = new Image();
    const objectUrl = URL.createObjectURL(image);
    imageElement.src = objectUrl;

    imageElement.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Failed to get canvas context'));
        return;
      }

      ctx.drawImage(imageElement, 0, 0, size, size);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(objectUrl);
          if (!blob) {
            reject(new Error('Failed to convert canvas to blob'));
            return;
          }
          resolve(blob);
        },
        'image/jpeg',
        0.92,
      );
    };

    imageElement.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image'));
    };
  });
}
