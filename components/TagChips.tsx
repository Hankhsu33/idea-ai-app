import FontAwesome from '@expo/vector-icons/FontAwesome';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

export default function TagChips({
  tags,
  caption,
  pending,
}: {
  tags?: string[] | null;
  caption?: string | null;
  pending?: boolean;
}) {
  if (pending) {
    return (
      <View style={styles.pendingRow}>
        <ActivityIndicator size="small" color="#DB2777" />
        <Text style={styles.pending}>describing photo…</Text>
      </View>
    );
  }

  if (!tags?.length && !caption) return null;

  return (
    <View style={styles.container}>
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
      {tags?.length ? (
        <View style={styles.tags}>
          <FontAwesome name="tag" size={13} color="#9D174D" />
          {tags.map((tag) => (
            <View key={tag} style={styles.chip}>
              <Text style={styles.chipText}>{tag}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    gap: 10,
  },
  caption: {
    color: '#374151',
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  chip: {
    backgroundColor: '#FCE7F3',
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  chipText: {
    color: '#9D174D',
    fontSize: 13,
    fontWeight: '600',
  },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  pending: {
    color: '#9D174D',
    fontSize: 14,
  },
});
