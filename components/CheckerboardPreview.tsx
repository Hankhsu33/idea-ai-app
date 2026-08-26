import { Image, StyleSheet, View } from 'react-native';

const squares = Array.from({ length: 64 }, (_, index) => index);

export default function CheckerboardPreview({ uri }: { uri: string }) {
  return (
    <View style={styles.container}>
      <View pointerEvents="none" style={styles.grid}>
        {squares.map((index) => {
          const row = Math.floor(index / 8);
          const column = index % 8;
          const isLight = (row + column) % 2 === 0;

          return (
            <View
              key={index}
              style={[styles.square, isLight ? styles.lightSquare : styles.darkSquare]}
            />
          );
        })}
      </View>
      <Image source={{ uri }} resizeMode="contain" style={StyleSheet.absoluteFillObject} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 16,
    overflow: 'hidden',
  },
  grid: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  square: {
    width: '12.5%',
    height: '12.5%',
  },
  lightSquare: {
    backgroundColor: '#F3F4F6',
  },
  darkSquare: {
    backgroundColor: '#D1D5DB',
  },
});
