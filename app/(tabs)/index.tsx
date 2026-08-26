import * as ImagePicker from 'expo-image-picker';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import CheckerboardPreview from '@/components/CheckerboardPreview';
import { useGalleryPhotos } from '@/components/GalleryPhotosContext';
import { useEngine } from '@/src/lib/engine';
import { prepareForInference, type PickedImage } from '@/src/lib/imagePrep';

export default function CreateScreen() {
  const engine = useEngine();
  const { addPhoto } = useGalleryPhotos();
  const [pickedImage, setPickedImage] = useState<PickedImage | null>(null);
  const [resultUri, setResultUri] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const runningRef = useRef(false);
  const engineStatusLabel = processing
    ? null
    : engine.modelStatus === null
      ? 'checking model status…'
      : engine.modelStatus.phase !== 'ready'
        ? 'model not downloaded — go to Settings'
        : engine.state !== 'ready'
          ? 'engine warming up…'
          : null;
  const removeDisabled = processing || engineStatusLabel !== null;

  const pickImage = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        setMessage('Photo access is off. Please allow photo access in Settings and try again.');
        return;
      }

      setMessage(null);

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
      });

      if (!result.canceled) {
        const selectedImage = result.assets[0];
        const picked = {
          uri: selectedImage.uri,
          width: selectedImage.width,
          height: selectedImage.height,
        };

        setPickedImage(picked);
        setResultUri(null);
        addPhoto(selectedImage.uri);
      }
    } catch {
      setMessage("We couldn't open your photo library. Please try again.");
    }
  };

  const removeBackground = async () => {
    if (!pickedImage) {
      setMessage('Choose a photo first.');
      return;
    }

    if (runningRef.current) {
      setMessage('Your photo is already being processed.');
      return;
    }

    if (engine.modelStatus?.phase !== 'ready') {
      setMessage('Please download the AI model in Settings first.');
      return;
    }

    if (engine.state !== 'ready') {
      setMessage('The AI engine is still getting ready. Please try again in a moment.');
      return;
    }

    runningRef.current = true;
    setProcessing(true);
    setMessage(null);
    setResultUri(null);

    try {
      const prepared = await prepareForInference(pickedImage);
      const result = await engine.process(prepared.base64, prepared.mimeType);

      setResultUri(`data:image/png;base64,${result.pngBase64}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The background could not be removed.');
    } finally {
      runningRef.current = false;
      setProcessing(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.title}>Create</Text>
      <Pressable
        accessibilityRole="button"
        disabled={processing}
        onPress={pickImage}
        style={({ pressed }) => [
          styles.button,
          processing && styles.buttonDisabled,
          pressed && !processing && styles.buttonPressed,
        ]}>
        <Text style={styles.buttonText}>Choose a Photo</Text>
      </Pressable>

      {message && <Text style={styles.message}>{message}</Text>}

      {pickedImage && (
        <>
          <Image source={{ uri: pickedImage.uri }} style={styles.image} resizeMode="contain" />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: removeDisabled }}
            disabled={removeDisabled}
            onPress={removeBackground}
            style={({ pressed }) => [
              styles.removeButton,
              removeDisabled && styles.buttonDisabled,
              pressed && !removeDisabled && styles.buttonPressed,
            ]}>
            {processing ? (
              <View style={styles.processingRow}>
                <ActivityIndicator color="#FFFFFF" />
                <Text style={styles.buttonText}>Removing background…</Text>
              </View>
            ) : (
              <Text style={styles.buttonText}>Remove background</Text>
            )}
          </Pressable>
          {engineStatusLabel && <Text style={styles.engineStatus}>{engineStatusLabel}</Text>}
        </>
      )}

      {processing && (
        <Text style={styles.processingText}>
          Working on your photo — this usually takes about 8 seconds.
        </Text>
      )}

      {resultUri && (
        <View style={styles.resultSection}>
          <Text style={styles.resultTitle}>Result</Text>
          <View style={styles.resultPreview}>
            <CheckerboardPreview uri={resultUri} />
          </View>
          {engine.lastInferenceMs !== null && (
            <Text style={styles.inferenceTime}>
              Last inference: {Math.round(engine.lastInferenceMs)} ms
            </Text>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FCE7F3',
  },
  container: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 64,
    paddingBottom: 40,
  },
  title: {
    alignSelf: 'flex-start',
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 28,
  },
  button: {
    width: '100%',
    maxWidth: 360,
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2563EB',
    borderRadius: 16,
    paddingHorizontal: 24,
  },
  removeButton: {
    width: '100%',
    maxWidth: 360,
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DB2777',
    borderRadius: 16,
    paddingHorizontal: 24,
    marginTop: 16,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },
  processingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  processingText: {
    color: '#831843',
    fontSize: 15,
    lineHeight: 21,
    marginTop: 14,
    textAlign: 'center',
  },
  engineStatus: {
    color: '#831843',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
    textAlign: 'center',
  },
  message: {
    marginTop: 18,
    color: '#B42318',
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
  },
  image: {
    width: '100%',
    maxWidth: 360,
    height: 280,
    marginTop: 24,
    borderRadius: 16,
  },
  resultSection: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    marginTop: 30,
  },
  resultTitle: {
    alignSelf: 'flex-start',
    color: '#831843',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
  },
  resultPreview: {
    width: '100%',
  },
  inferenceTime: {
    color: '#6B7280',
    fontSize: 14,
    marginTop: 10,
  },
});
