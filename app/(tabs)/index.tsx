import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { useGalleryPhotos } from '@/components/GalleryPhotosContext';

export default function CreateScreen() {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { addPhoto } = useGalleryPhotos();

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
        const selectedImageUri = result.assets[0].uri;

        setImageUri(selectedImageUri);
        addPhoto(selectedImageUri);
      }
    } catch {
      setMessage("We couldn't open your photo library. Please try again.");
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Create</Text>
      <Pressable
        accessibilityRole="button"
        onPress={pickImage}
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}>
        <Text style={styles.buttonText}>Choose a Photo</Text>
      </Pressable>
      {message && <Text style={styles.message}>{message}</Text>}
      {imageUri && <Image source={{ uri: imageUri }} style={styles.image} resizeMode="contain" />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FCE7F3',
    padding: 24,
  },
  title: {
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
  buttonPressed: {
    opacity: 0.8,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '600',
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
    height: 300,
    marginTop: 24,
    borderRadius: 16,
  },
});
