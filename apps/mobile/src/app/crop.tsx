import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';
import Svg, { Polygon } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, Stack } from 'expo-router';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as Haptics from 'expo-haptics';

import { useTheme } from '@/hooks/use-theme';
import { takePendingCapture, setPendingCapture, type PendingCapture } from '@/state/pending-capture';
import { detectDocumentCorners } from '@/utils/detect-document-corners';

interface Point {
  x: number;
  y: number;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const HANDLE_TOUCH_SIZE = 48;
const HANDLE_VISUAL_SIZE = 22;
const DEFAULT_INSET = 0.08;
// Espaço à volta da imagem para a área de toque de cada bola (48px, centrada
// no ponto) nunca ficar tapada pela barra de botões nem pelo texto de dica.
const HANDLE_MARGIN = HANDLE_TOUCH_SIZE / 2;
// A pré-visualização é deliberadamente mais pequena do que o espaço
// disponível — não só para dar espaço à barra de botões, mas para afastar as
// bolas de baixo da zona junto ao fundo físico do ecrã, onde o gesto do
// home indicator do iOS compete com o nosso gesto de arrastar.
const PREVIEW_HEIGHT_RATIO = 0.58;
const PREVIEW_SIDE_MARGIN = 20;

function clamp(value: number, min: number, max: number): number {
  'worklet';
  return Math.min(Math.max(value, min), max);
}

export default function CropScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [capture, setCapture] = useState<PendingCapture | null | undefined>(undefined);
  const [imageRect, setImageRect] = useState<Rect | null>(null);
  // Ordem do perímetro (não bounding box): topo-esq, topo-dir, baixo-dir, baixo-esq.
  const [points, setPoints] = useState<Point[] | null>(null);
  const [processing, setProcessing] = useState(false);
  const [autoDetected, setAutoDetected] = useState(false);
  // Depois de o utilizador arrastar um canto, a deteção automática (que pode
  // chegar uns ms mais tarde) nunca deve sobrepor o ajuste manual.
  const userAdjustedRef = useRef(false);

  const blockWidth = Math.max(1, windowWidth - PREVIEW_SIDE_MARGIN * 2);
  const blockHeight = Math.max(1, windowHeight * PREVIEW_HEIGHT_RATIO);

  useEffect(() => {
    setCapture(takePendingCapture());
  }, []);

  useEffect(() => {
    if (!capture) return;

    const aspectRatio =
      capture.photoWidth && capture.photoHeight ? capture.photoWidth / capture.photoHeight : 3 / 4;
    const availableWidth = Math.max(1, blockWidth - HANDLE_MARGIN * 2);
    const availableHeight = Math.max(1, blockHeight - HANDLE_MARGIN * 2);
    let displayWidth = availableWidth;
    let displayHeight = displayWidth / aspectRatio;
    if (displayHeight > availableHeight) {
      displayHeight = availableHeight;
      displayWidth = displayHeight * aspectRatio;
    }
    const rect: Rect = {
      x: (blockWidth - displayWidth) / 2,
      y: (blockHeight - displayHeight) / 2,
      width: displayWidth,
      height: displayHeight,
    };
    setImageRect(rect);
    setPoints([
      { x: rect.x + rect.width * DEFAULT_INSET, y: rect.y + rect.height * DEFAULT_INSET },
      { x: rect.x + rect.width * (1 - DEFAULT_INSET), y: rect.y + rect.height * DEFAULT_INSET },
      { x: rect.x + rect.width * (1 - DEFAULT_INSET), y: rect.y + rect.height * (1 - DEFAULT_INSET) },
      { x: rect.x + rect.width * DEFAULT_INSET, y: rect.y + rect.height * (1 - DEFAULT_INSET) },
    ]);

    // Deteção automática das margens por contraste (100% local, ~100-300ms):
    // corre depois de o ecrã já estar interativo com as margens por omissão e
    // só as substitui se o utilizador ainda não tiver mexido em nada.
    detectDocumentCorners(capture.fileUri)
      .then((corners) => {
        if (!corners || userAdjustedRef.current) return;
        setPoints(
          corners.map((c) => ({ x: rect.x + c.x * rect.width, y: rect.y + c.y * rect.height })),
        );
        setAutoDetected(true);
      })
      .catch(() => {});
    // Só recalcular quando a captura muda — não quando o utilizador arrasta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capture]);

  if (capture === undefined) {
    return null;
  }

  if (capture === null) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <Text style={[styles.centerText, { color: theme.text }]}>Não há nenhuma foto para ajustar.</Text>
        <Pressable style={[styles.primaryButton, { backgroundColor: theme.accent }]} onPress={() => router.replace('/')}>
          <Text style={styles.primaryButtonText}>Voltar à câmara</Text>
        </Pressable>
      </View>
    );
  }

  function updatePoint(index: number, x: number, y: number) {
    userAdjustedRef.current = true;
    setPoints((prev) => (prev ? prev.map((p, i) => (i === index ? { x, y } : p)) : prev));
  }

  async function handleConfirm() {
    if (!points || !imageRect || processing) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setProcessing(true);
    try {
      const minX = Math.min(...points.map((p) => p.x));
      const maxX = Math.max(...points.map((p) => p.x));
      const minY = Math.min(...points.map((p) => p.y));
      const maxY = Math.max(...points.map((p) => p.y));

      let finalUri = capture!.fileUri;
      if (capture!.photoWidth && capture!.photoHeight) {
        const scaleX = capture!.photoWidth / imageRect.width;
        const scaleY = capture!.photoHeight / imageRect.height;
        const cropRect = {
          originX: Math.round((minX - imageRect.x) * scaleX),
          originY: Math.round((minY - imageRect.y) * scaleY),
          width: Math.max(1, Math.round((maxX - minX) * scaleX)),
          height: Math.max(1, Math.round((maxY - minY) * scaleY)),
        };
        const result = await manipulateAsync(capture!.fileUri, [{ crop: cropRect }], {
          compress: 0.9,
          format: SaveFormat.JPEG,
        });
        finalUri = result.uri;
      }

      setPendingCapture({ ...capture!, fileUri: finalUri, fileMimeType: 'image/jpeg' });
      router.replace('/validation');
    } finally {
      setProcessing(false);
    }
  }

  function handleSkip() {
    setPendingCapture(capture!);
    router.replace('/validation');
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen
        options={{
          title: 'Ajustar margens',
          headerLeft: () => (
            <Pressable onPress={() => router.replace('/')} hitSlop={12}>
              <Text style={{ color: theme.accent, fontSize: 16 }}>Cancelar</Text>
            </Pressable>
          ),
        }}
      />
      <Text style={[styles.hint, { color: theme.textSecondary }]}>
        {autoDetected
          ? 'Margens detetadas automaticamente — ajusta os cantos se necessário'
          : 'Arrasta os cantos para ajustar às margens do documento'}
      </Text>

      <View style={styles.centerWrap}>
        <View style={[styles.imageArea, { width: blockWidth, height: blockHeight }]}>
          {imageRect && (
            <Image
              source={{ uri: capture.fileUri }}
              style={{
                position: 'absolute',
                left: imageRect.x,
                top: imageRect.y,
                width: imageRect.width,
                height: imageRect.height,
              }}
            />
          )}
          {points && imageRect ? (
            <>
              <Svg
                width={blockWidth}
                height={blockHeight}
                style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}
              >
                <Polygon
                  points={points.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill={`${theme.accent}22`}
                  stroke={theme.accent}
                  strokeWidth={2}
                />
              </Svg>
              {points.map((point, index) => (
                <DraggableHandle
                  key={index}
                  point={point}
                  imageRect={imageRect}
                  color={theme.accent}
                  onChange={(x, y) => updatePoint(index, x, y)}
                />
              ))}
            </>
          ) : (
            <ActivityIndicator color={theme.textSecondary} />
          )}
        </View>
      </View>

      <View style={[styles.actions, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable style={styles.secondaryButton} onPress={handleSkip} disabled={processing}>
          <Text style={[styles.secondaryButtonText, { color: theme.textSecondary }]}>Usar imagem inteira</Text>
        </Pressable>
        <Pressable
          style={[styles.primaryButtonFlex, { backgroundColor: theme.accent, opacity: processing ? 0.6 : 1 }]}
          onPress={handleConfirm}
          disabled={processing}
        >
          {processing ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Confirmar recorte</Text>}
        </Pressable>
      </View>
    </View>
  );
}

function DraggableHandle({
  point,
  imageRect,
  color,
  onChange,
}: {
  point: Point;
  imageRect: Rect;
  color: string;
  onChange: (x: number, y: number) => void;
}) {
  const startX = useSharedValue(point.x);
  const startY = useSharedValue(point.y);

  const pan = Gesture.Pan()
    .onBegin(() => {
      startX.value = point.x;
      startY.value = point.y;
    })
    .onUpdate((event) => {
      const nextX = clamp(startX.value + event.translationX, imageRect.x, imageRect.x + imageRect.width);
      const nextY = clamp(startY.value + event.translationY, imageRect.y, imageRect.y + imageRect.height);
      runOnJS(onChange)(nextX, nextY);
    });

  return (
    <GestureDetector gesture={pan}>
      <View
        style={[
          styles.handleTouchArea,
          { left: point.x - HANDLE_TOUCH_SIZE / 2, top: point.y - HANDLE_TOUCH_SIZE / 2 },
        ]}
      >
        <View style={[styles.handleVisual, { backgroundColor: color }]} />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, padding: 24 },
  centerText: { fontSize: 16, textAlign: 'center' },
  hint: { fontSize: 13, textAlign: 'center', marginBottom: 12, paddingHorizontal: 24 },
  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  imageArea: { alignItems: 'center', justifyContent: 'center' },
  handleTouchArea: {
    position: 'absolute',
    width: HANDLE_TOUCH_SIZE,
    height: HANDLE_TOUCH_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleVisual: {
    width: HANDLE_VISUAL_SIZE,
    height: HANDLE_VISUAL_SIZE,
    borderRadius: HANDLE_VISUAL_SIZE / 2,
    borderWidth: 3,
    borderColor: '#fff',
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 16, paddingHorizontal: 24, width: '100%' },
  secondaryButton: { paddingVertical: 14, paddingHorizontal: 16, minHeight: 44, justifyContent: 'center' },
  secondaryButtonText: { fontSize: 14, fontWeight: '500' },
  primaryButton: { paddingVertical: 14, paddingHorizontal: 28, borderRadius: 14, alignItems: 'center' },
  primaryButtonFlex: { flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
