import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import CheckerboardPreview from '@/components/CheckerboardPreview';
import { useGalleryPhotos } from '@/components/GalleryPhotosContext';
import TagChips from '@/components/TagChips';
import { useEngine } from '@/src/lib/engine';
import { describeImage } from '@/src/lib/tags';

export default function GalleryPreviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const engine = useEngine();
  const { photos, updatePhoto } = useGalleryPhotos();
  const photo = photos.find((item) => item.id === id) ?? null;
  const [describing, setDescribing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const describeAgain = async () => {
    if (!photo) {
      setMessage('This photo is no longer in the current session.');
      return;
    }

    if (engine.state !== 'ready') {
      setMessage('The AI engine is not ready yet.');
      return;
    }

    setDescribing(true);
    setMessage(null);
    try {
      const description = await describeImage(engine, {
        uri: photo.originalUri,
        width: photo.originalWidth,
        height: photo.originalHeight,
      });
      updatePhoto(photo.id, description);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The description could not finish.');
    } finally {
      setDescribing(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: 'Preview' }} />
      {photo ? (
        <>
          <View style={styles.preview}>
            <CheckerboardPreview uri={photo.uri} />
          </View>
          <TagChips tags={photo.tags} caption={photo.caption} pending={describing} />
          {!describing ? (
            <Pressable
              accessibilityRole="button"
              onPress={describeAgain}
              style={({ pressed }) => [styles.describeButton, pressed && styles.buttonPressed]}>
              <Text style={styles.describeButtonText}>
                {photo.tags?.length ? 'Describe again' : 'Describe this photo'}
              </Text>
            </Pressable>
          ) : null}
          {photo.inferenceMs !== undefined ? (
            <Text style={styles.meta}>
              {photo.width} x {photo.height} - background removal {Math.round(photo.inferenceMs)} ms
            </Text>
          ) : null}
        </>
      ) : (
        <Text style={styles.missing}>This photo is no longer in the current session.</Text>
      )}
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FCE7F3',
  },
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 24,
  },
  preview: {
    width: '100%',
    maxWidth: 420,
  },
  describeButton: {
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#F9A8D4',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 20,
  },
  buttonPressed: {
    opacity: 0.75,
  },
  describeButtonText: {
    color: '#9D174D',
    fontSize: 15,
    fontWeight: '700',
  },
  meta: {
    color: '#6B7280',
    fontSize: 13,
    textAlign: 'center',
  },
  missing: {
    color: '#6B7280',
    fontSize: 16,
    textAlign: 'center',
  },
  message: {
    color: '#B42318',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
});
