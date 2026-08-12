import { ScrollView, StyleSheet, Text, View } from 'react-native';

export default function SettingsScreen() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Settings</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>App status</Text>
        <SettingsRow label="Mode" value="Screen prototype" />
        <SettingsRow label="AI processing" value="Not enabled" />
        <SettingsRow label="Photo storage" value="Not enabled" />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Gallery</Text>
        <SettingsRow label="Layout" value="3 columns" />
        <SettingsRow label="Photos" value="This session only" />
        <Text style={styles.note}>Selected photos disappear when the app restarts.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>About</Text>
        <SettingsRow label="Version" value="1.0.0" />
        <SettingsRow label="Expo SDK" value="54" />
        <Text style={styles.note}>
          This prototype keeps selected photos on your phone and does not upload them.
        </Text>
      </View>
    </ScrollView>
  );
}

function SettingsRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FCE7F3',
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 64,
    paddingBottom: 40,
    gap: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 18,
    gap: 14,
  },
  cardTitle: {
    color: '#831843',
    fontSize: 20,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  label: {
    color: '#374151',
    fontSize: 16,
  },
  value: {
    color: '#9D174D',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'right',
  },
  note: {
    color: '#6B7280',
    fontSize: 14,
    lineHeight: 20,
  },
});
