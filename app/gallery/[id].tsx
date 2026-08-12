import { Stack, useLocalSearchParams } from 'expo-router';
import { Image, StyleSheet, Text, View } from 'react-native';

export default function GalleryPreviewScreen() {
  const { color = '#F9A8D4', emoji = '🌸', uri } = useLocalSearchParams<{
    color?: string;
    emoji?: string;
    uri?: string;
  }>();

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Preview' }} />
      <View style={[styles.preview, { backgroundColor: uri ? '#FFFFFF' : color }]}>
        {uri ? (
          <Image source={{ uri }} style={styles.photo} resizeMode="contain" />
        ) : (
          <Text style={styles.emoji}>{emoji}</Text>
        )}
      </View>
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
  preview: {
    width: '100%',
    maxWidth: 420,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    overflow: 'hidden',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  emoji: {
    fontSize: 96,
  },
});
