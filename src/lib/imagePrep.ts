import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

/**
 * Longest edge sent to the model.
 *
 * RMBG-1.4 resizes everything to 1024x1024 internally, so anything larger only costs
 * bridge bandwidth and memory. It also caps the returned PNG, which has to come back
 * across the same bridge.
 */
export const MAX_EDGE = 1024;

export interface PickedImage {
  uri: string;
  width: number;
  height: number;
}

export interface PreparedImage {
  base64: string;
  mimeType: string;
  width: number;
  height: number;
}

export class PermissionDenied extends Error {
  constructor(what: 'camera' | 'library') {
    super(
      what === 'camera'
        ? 'BGone needs camera access to take a photo.'
        : 'BGone needs photo access to pick an image.'
    );
    this.name = 'PermissionDenied';
  }
}

export async function pickFromLibrary(): Promise<PickedImage | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new PermissionDenied('library');

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    quality: 1,
    exif: false,
  });

  if (result.canceled || !result.assets.length) return null;
  const asset = result.assets[0];
  return { uri: asset.uri, width: asset.width, height: asset.height };
}

export async function pickFromCamera(): Promise<PickedImage | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new PermissionDenied('camera');

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 1,
    exif: false,
  });

  if (result.canceled || !result.assets.length) return null;
  const asset = result.assets[0];
  return { uri: asset.uri, width: asset.width, height: asset.height };
}

/**
 * Downscales to `MAX_EDGE` and returns JPEG base64 ready for the bridge.
 *
 * Always re-encodes, even when the image is already small: it normalises HEIC and
 * oversized PNGs into one predictable format, and the alpha channel of the input is
 * irrelevant because the model only reads RGB.
 */
export async function prepareForInference(image: PickedImage): Promise<PreparedImage> {
  const longest = Math.max(image.width, image.height);
  const context = ImageManipulator.manipulate(image.uri);

  if (longest > MAX_EDGE) {
    // Passing one dimension lets the native side keep the aspect ratio exactly.
    if (image.width >= image.height) {
      context.resize({ width: MAX_EDGE });
    } else {
      context.resize({ height: MAX_EDGE });
    }
  }

  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({
    format: SaveFormat.JPEG,
    compress: 0.92,
    base64: true,
  });

  if (!saved.base64) throw new Error('The picked image could not be read.');

  return {
    base64: saved.base64,
    mimeType: 'image/jpeg',
    width: saved.width,
    height: saved.height,
  };
}
