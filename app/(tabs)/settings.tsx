import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import ClipProbe from '@/components/ClipProbe';
import { useEngine } from '@/src/lib/engine';

export default function SettingsScreen() {
  const { download, error, modelStatus, refreshModelStatus, startDownload, state } = useEngine();
  const isReady = modelStatus?.phase === 'ready';
  const isDownloading = state === 'downloading';
  const progressPercent =
    download && download.bytesTotal > 0
      ? Math.min(100, Math.round((download.bytesDownloaded / download.bytesTotal) * 100))
      : 0;
  const progressWidth: `${number}%` = `${progressPercent}%`;

  useFocusEffect(
    useCallback(() => {
      void refreshModelStatus();
    }, [refreshModelStatus])
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Settings</Text>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>AI Model</Text>
          <Text style={[styles.status, isReady && styles.statusReady]}>
            {isReady ? 'Ready' : isDownloading ? 'Downloading' : 'Not downloaded'}
          </Text>
        </View>

        {isReady ? (
          <Text style={styles.note}>The model is ready to use on this device.</Text>
        ) : (
          <>
            <Text style={styles.note}>Download the model once before removing backgrounds.</Text>

            {isDownloading && download ? (
              <View style={styles.progressGroup}>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: progressWidth }]} />
                </View>
                <Text style={styles.progressText}>
                  {formatMegabytes(download.bytesDownloaded)} MB of{' '}
                  {formatMegabytes(download.bytesTotal)} MB · {progressPercent}%
                </Text>
              </View>
            ) : null}

            {state === 'download_failed' && error ? (
              <Text style={styles.errorText}>{error.message}</Text>
            ) : null}

            <Pressable
              accessibilityRole="button"
              disabled={isDownloading}
              onPress={startDownload}
              style={({ pressed }) => [
                styles.downloadButton,
                isDownloading && styles.downloadButtonDisabled,
                pressed && !isDownloading && styles.downloadButtonPressed,
              ]}>
              <Text style={styles.downloadButtonText}>
                {isDownloading
                  ? 'Downloading…'
                  : modelStatus?.phase === 'partial'
                    ? 'Resume Download'
                    : 'Download Model'}
              </Text>
            </Pressable>
          </>
        )}
      </View>

      <ClipProbe />

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

function formatMegabytes(bytes: number) {
  return (bytes / (1024 * 1024)).toFixed(1);
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
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  status: {
    color: '#9D174D',
    backgroundColor: '#FCE7F3',
    borderRadius: 999,
    fontSize: 13,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusReady: {
    color: '#166534',
    backgroundColor: '#DCFCE7',
  },
  progressGroup: {
    gap: 8,
  },
  progressTrack: {
    height: 10,
    backgroundColor: '#FBCFE8',
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#DB2777',
    borderRadius: 999,
  },
  progressText: {
    color: '#6B7280',
    fontSize: 14,
  },
  errorText: {
    color: '#B42318',
    fontSize: 14,
    lineHeight: 20,
  },
  downloadButton: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DB2777',
    borderRadius: 14,
    paddingHorizontal: 20,
  },
  downloadButtonDisabled: {
    opacity: 0.55,
  },
  downloadButtonPressed: {
    opacity: 0.8,
  },
  downloadButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
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
