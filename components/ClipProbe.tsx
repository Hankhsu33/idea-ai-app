import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { useEngine } from '@/src/lib/engine';
import { pickFromLibrary, prepareForEmbedding } from '@/src/lib/imagePrep';
import { CLIP_EXPECTED_BYTES } from '@/src/lib/manifest';
import { toPercentages } from '@/src/lib/similarity';

const LABELS = [
  'a photo of a person',
  'a photo of a dog',
  'a photo of a cat',
  'a photo of food on a plate',
  'a photo of a car',
  'a photo of a building',
  'a photo of a plant or flower',
  'a screenshot of a user interface',
  'a photo of a landscape',
  'a photo of a piece of clothing',
  'a product photo on a plain background',
  'a photo of text or a document',
];

type RankedLabel = {
  label: string;
  score: number;
  percentage: number;
};

type ProbeResult = {
  uri: string;
  imageMs: number;
  textMs: number;
  ranked: RankedLabel[];
};

export default function ClipProbe() {
  const engine = useEngine();
  const labelVectorsRef = useRef<number[][] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ProbeResult | null>(null);

  const runProbe = useCallback(async () => {
    setMessage(null);

    let picked;
    try {
      picked = await pickFromLibrary();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not open the photo library.');
      return;
    }

    if (!picked) return;

    setBusy(true);
    setResult(null);

    try {
      const base64 = await prepareForEmbedding(picked.uri, picked.width, picked.height);
      const imageEmbedding = await engine.embedImage(base64, 'image/jpeg');
      let textMs = 0;

      if (!labelVectorsRef.current) {
        const textEmbedding = await engine.embedText(LABELS);
        labelVectorsRef.current = textEmbedding.vectors;
        textMs = textEmbedding.ms;
      }

      const scores = labelVectorsRef.current.map((vector) =>
        vector.reduce((sum, value, index) => {
          return sum + value * imageEmbedding.vectors[0][index];
        }, 0)
      );
      const percentages = toPercentages(scores);
      const ranked = LABELS.map((label, index) => ({
        label,
        score: scores[index],
        percentage: percentages[index],
      })).sort((a, b) => b.score - a.score);

      setResult({
        uri: picked.uri,
        imageMs: imageEmbedding.ms,
        textMs,
        ranked,
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Image recognition could not finish.');
    } finally {
      setBusy(false);
    }
  }, [engine]);

  const ready = engine.state === 'ready';

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>Image recognition (CLIP)</Text>
        <Text style={styles.badge}>NEW</Text>
      </View>
      <Text style={styles.note}>
        Pick a photo to test what the second AI model recognizes; its first use downloads about{' '}
        {formatMegabytes(CLIP_EXPECTED_BYTES)} MB.
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !ready || busy }}
        disabled={!ready || busy}
        onPress={runProbe}
        style={({ pressed }) => [
          styles.button,
          (!ready || busy) && styles.buttonDisabled,
          pressed && ready && !busy && styles.buttonPressed,
        ]}>
        {busy ? (
          <View style={styles.busyRow}>
            <ActivityIndicator color="#FFFFFF" />
            <Text style={styles.buttonText}>Recognizing…</Text>
          </View>
        ) : (
          <Text style={styles.buttonText}>{result ? 'Test another photo' : 'Pick and recognize'}</Text>
        )}
      </Pressable>

      {!ready && !busy ? <Text style={styles.hint}>The engine must be ready first.</Text> : null}
      {message ? <Text style={styles.error}>{message}</Text> : null}

      {result ? (
        <View style={styles.result}>
          <Image source={{ uri: result.uri }} style={styles.thumbnail} resizeMode="cover" />
          <Text style={styles.timing}>
            Image {result.imageMs} ms{result.textMs ? ` · Labels ${result.textMs} ms` : ''}
          </Text>
          {result.ranked.slice(0, 5).map((entry, index) => {
            const width: `${number}%` = `${Math.max(2, Math.round(entry.percentage * 100))}%`;

            return (
              <View key={entry.label} style={styles.scoreRow}>
                <Text style={[styles.label, index === 0 && styles.topLabel]} numberOfLines={1}>
                  {entry.label.replace('a photo of ', '')}
                </Text>
                <View style={styles.track}>
                  <View
                    style={[
                      styles.fill,
                      index === 0 && styles.topFill,
                      { width },
                    ]}
                  />
                </View>
                <Text style={styles.percentage}>{Math.round(entry.percentage * 100)}%</Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function formatMegabytes(bytes: number) {
  return (bytes / (1024 * 1024)).toFixed(0);
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 18,
    gap: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    flex: 1,
    color: '#831843',
    fontSize: 20,
    fontWeight: '700',
  },
  badge: {
    color: '#166534',
    backgroundColor: '#DCFCE7',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  note: {
    color: '#6B7280',
    fontSize: 14,
    lineHeight: 20,
  },
  button: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DB2777',
    borderRadius: 14,
    paddingHorizontal: 20,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  busyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  hint: {
    color: '#9D174D',
    fontSize: 13,
    textAlign: 'center',
  },
  error: {
    color: '#B42318',
    fontSize: 14,
    lineHeight: 20,
  },
  result: {
    gap: 10,
  },
  thumbnail: {
    width: '100%',
    height: 150,
    backgroundColor: '#FCE7F3',
    borderRadius: 14,
  },
  timing: {
    color: '#6B7280',
    fontSize: 13,
    textAlign: 'center',
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    width: 112,
    color: '#6B7280',
    fontSize: 12,
  },
  topLabel: {
    color: '#831843',
    fontWeight: '700',
  },
  track: {
    flex: 1,
    height: 7,
    backgroundColor: '#FCE7F3',
    borderRadius: 999,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: '#F9A8D4',
    borderRadius: 999,
  },
  topFill: {
    backgroundColor: '#DB2777',
  },
  percentage: {
    width: 34,
    color: '#6B7280',
    fontSize: 12,
    textAlign: 'right',
  },
});
