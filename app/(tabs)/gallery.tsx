import { router } from 'expo-router';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import GalleryEmptyState from '@/components/GalleryEmptyState';
import { useGalleryPhotos } from '@/components/GalleryPhotosContext';

export default function GalleryScreen() {
  const { photos } = useGalleryPhotos();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Gallery</Text>
      {photos.length === 0 ? (
        <GalleryEmptyState />
      ) : (
        <FlatList
          data={photos}
          keyExtractor={(item) => item.id}
          numColumns={3}
          style={styles.list}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={styles.row}
          renderItem={({ item }) => (
            <Pressable
              accessibilityLabel={`Open gallery item ${item.id}`}
              accessibilityRole="button"
              onPress={() =>
                router.push({
                  pathname: '/gallery/[id]',
                  params: { id: item.id },
                })
              }
              style={({ pressed }) => [
                styles.tile,
                pressed && styles.tilePressed,
              ]}>
              <Image source={{ uri: item.uri }} style={styles.photo} resizeMode="cover" />
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FCE7F3',
    paddingHorizontal: 20,
    paddingTop: 64,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 24,
  },
  list: {
    width: '100%',
  },
  grid: {
    gap: 12,
  },
  row: {
    gap: 12,
  },
  tile: {
    width: '31%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    overflow: 'hidden',
  },
  tilePressed: {
    opacity: 0.75,
  },
  photo: {
    width: '100%',
    height: '100%',
  },
});
