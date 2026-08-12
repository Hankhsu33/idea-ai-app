import { StyleSheet, Text, View } from 'react-native';

export default function GalleryEmptyState() {
  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>🖼️</Text>
      <Text style={styles.title}>Your gallery is ready</Text>
      <Text style={styles.message}>Your creations will appear here when you make them.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  message: {
    color: '#6B7280',
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
  },
});
