import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Redirect, router, Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { parseInvoiceQr } from '@invoice-scanner/shared';

import { setPendingCapture } from '@/state/pending-capture';
import { useTheme } from '@/hooks/use-theme';
import { usePendingCount } from '@/hooks/use-pending-count';
import { useEmailFeatureAvailable } from '@/hooks/use-email-feature';
import { logout } from '@/api/client';
import { pickAndImportDocument, pickAndImportFromGallery } from '@/utils/import-document';
import { confirmAction } from '@/utils/alert';
import { PendingCountBadge } from '@/components/pending-count-badge';

const FRAME_SIZE = 260;
const CORNER_LENGTH = 32;
const CORNER_THICKNESS = 5;

function normalizePictureUri(uri: string, format?: string): string {
  const looksLikeUsableUri =
    uri.startsWith('data:') || uri.startsWith('file:') || uri.startsWith('http') || uri.startsWith('blob:');
  return looksLikeUsableUri ? uri : `data:image/${format ?? 'jpeg'};base64,${uri}`;
}

/**
 * Só aceita a leitura se o QR estiver razoavelmente dentro da moldura — evita
 * apanhar um código incidental fora do enquadramento pretendido. As `bounds`
 * do scanner nem sempre estão disponíveis ou na mesma escala em todas as
 * plataformas, por isso falha "aberto" (aceita) sempre que não há dados
 * fiáveis para comparar, em vez de bloquear leituras válidas.
 */
function isWithinGuideFrame(
  result: BarcodeScanningResult,
  layout: { width: number; height: number },
): boolean {
  const bounds = result.bounds;
  if (!bounds || !layout.width || !layout.height) return true;
  const centerX = bounds.origin.x + bounds.size.width / 2;
  const centerY = bounds.origin.y + bounds.size.height / 2;
  if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) return true;

  const frameLeft = layout.width / 2 - FRAME_SIZE / 2;
  const frameTop = layout.height / 2 - FRAME_SIZE / 2;
  const margin = FRAME_SIZE * 0.4;
  return (
    centerX >= frameLeft - margin &&
    centerX <= frameLeft + FRAME_SIZE + margin &&
    centerY >= frameTop - margin &&
    centerY <= frameTop + FRAME_SIZE + margin
  );
}

export default function IndexScreen() {
  const params = useLocalSearchParams<{ camera?: string }>();
  // Na Web a "casa" é a lista de despesas — a câmara só abre quando pedida
  // explicitamente (menu "+" → Tirar foto, que navega para /?camera=1). No
  // iOS/Android a câmara continua a ser o ecrã inicial.
  if (Platform.OS === 'web' && params.camera !== '1') {
    return <Redirect href="/expenses" />;
  }
  return <CameraScreen />;
}

function CameraScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const pendingCount = usePendingCount();
  const emailFeatureAvailable = useEmailFeatureAvailable();
  const [permission, requestPermission] = useCameraPermissions();
  // Toque no preview = repasse único de focagem (ver comentário no autofocus).
  const [focusNudge, setFocusNudge] = useState(false);
  const focusNudgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [busy, setBusy] = useState(false);
  // null = ainda a tentar ler o QR; string = QR lido e confirmado (moldura
  // fica verde), à espera que o utilizador prima o botão de disparo.
  const [lockedQrPayload, setLockedQrPayload] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const cameraRef = useRef<CameraView>(null);
  const locked = lockedQrPayload !== null;

  // Repasse manual de focagem ao tocar no preview (à imagem do "tap to focus"
  // da app Câmara nativa): a transição off→on dispara uma passagem única de
  // autofocus (.autoFocus) e o regresso a "off" retoma a focagem contínua.
  function nudgeFocus() {
    if (Platform.OS === 'web') return;
    if (focusNudgeTimer.current) clearTimeout(focusNudgeTimer.current);
    setFocusNudge(true);
    focusNudgeTimer.current = setTimeout(() => setFocusNudge(false), 600);
  }

  useEffect(() => {
    return () => {
      if (focusNudgeTimer.current) clearTimeout(focusNudgeTimer.current);
    };
  }, []);

  async function captureAndGo(qrRawPayload: string | null) {
    if (!cameraRef.current || busy) return;
    setBusy(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9 });
      const fileUri = normalizePictureUri(photo.uri, photo.format);
      const parsedQr = qrRawPayload ? parseInvoiceQr(qrRawPayload) : null;

      setPendingCapture({
        fileUri,
        fileMimeType: `image/${photo.format ?? 'jpeg'}`,
        source: 'CAMERA',
        photoWidth: photo.width,
        photoHeight: photo.height,
        parsedQr,
        qrRawPayload: qrRawPayload ?? undefined,
      });
      router.push('/crop');
    } finally {
      setBusy(false);
      setLockedQrPayload(null);
    }
  }

  async function runImport(importer: () => Promise<boolean>) {
    if (busy) return;
    setBusy(true);
    try {
      await importer();
    } finally {
      setBusy(false);
    }
  }

  function handleUploadDocument() {
    if (busy) return;
    // Na Web o <input type=file> do browser já dá acesso a fotos e ficheiros
    // num só sítio; o Alert multi-botão do RN é no-op na Web (ver utils/alert).
    if (Platform.OS === 'web') {
      void runImport(pickAndImportDocument);
      return;
    }
    Alert.alert('Adicionar fatura', 'De onde queres importar o documento?', [
      { text: 'Fototeca', onPress: () => void runImport(pickAndImportFromGallery) },
      { text: 'Ficheiros', onPress: () => void runImport(pickAndImportDocument) },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  }

  function handleLogout() {
    confirmAction('Terminar sessão', 'Tens a certeza que queres sair da tua conta?', 'Terminar sessão', () => {
      logout();
    });
  }

  const handleBarcodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      if (locked || busy) return;
      if (!isWithinGuideFrame(result, layout)) return;

      setLockedQrPayload(result.data);
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      // Não tira a foto automaticamente — só confirma a leitura do QR (moldura
      // fica verde) e espera que o utilizador prima o botão de disparo.
    },
    [locked, busy, layout],
  );

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View
        style={[
          styles.center,
          { backgroundColor: theme.background, paddingTop: insets.top, paddingBottom: insets.bottom },
        ]}
      >
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[styles.permissionIconWrap, { backgroundColor: theme.backgroundElement }]}>
          <Ionicons name="camera-outline" size={40} color={theme.accent} />
        </View>
        <Text style={[styles.permissionTitle, { color: theme.text }]}>Acesso à câmara</Text>
        <Text style={[styles.permissionBody, { color: theme.textSecondary }]}>
          Precisamos da câmara para digitalizar o QR code das tuas faturas.
        </Text>
        <Pressable style={[styles.primaryButton, { backgroundColor: theme.accent }]} onPress={requestPermission}>
          <Text style={styles.primaryButtonText}>Permitir câmara</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        // ARMADILHA da API do expo-camera (confirmado no código nativo iOS,
        // CameraEnums.swift): autofocus="on" = .autoFocus = foca UMA vez e
        // TRANCA a focagem; autofocus="off" = .continuousAutoFocus = refoca
        // sempre que a cena muda (comportamento da app Câmara nativa). Com
        // "on" fixo, a câmara focava ao abrir e nunca mais — faturas a
        // distâncias diferentes ficavam desfocadas. "on" é usado só como
        // impulso momentâneo no toque (nudgeFocus).
        autofocus={focusNudge ? 'on' : 'off'}
        enableTorch={torchOn}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        // Desativar por completo o callback (undefined) assim que o QR fica
        // confirmado — a câmara para de tentar ler mais códigos enquanto se
        // espera que o utilizador prima o botão de disparo.
        onBarcodeScanned={locked || busy ? undefined : handleBarcodeScanned}
        onLayout={(event) => setLayout(event.nativeEvent.layout)}
      />

      {/* Camada de toque para refocar — por baixo das barras (irmãos seguintes
          recebem o toque primeiro), por isso não rouba cliques aos botões. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={nudgeFocus} />

      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Pressable style={styles.iconButton} onPress={() => setTorchOn((value) => !value)}>
          <Ionicons name={torchOn ? 'flash' : 'flash-off'} size={20} color="#fff" />
        </Pressable>
        <View style={styles.topBarRightGroup}>
          {emailFeatureAvailable && (
            <Pressable style={styles.iconButton} onPress={() => router.push('/pending')}>
              <Ionicons name="mail-unread-outline" size={20} color="#fff" />
              <PendingCountBadge count={pendingCount} />
            </Pressable>
          )}
          <Pressable style={styles.iconButton} onPress={() => router.push('/expenses')}>
            <Ionicons name="receipt-outline" size={20} color="#fff" />
          </Pressable>
          <Pressable style={styles.iconButton} onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={20} color="#fff" />
          </Pressable>
        </View>
      </View>

      <View style={styles.frameWrap} pointerEvents="none">
        <View style={styles.frame}>
          <View style={[styles.corner, styles.cornerTopLeft, locked && styles.cornerLocked]} />
          <View style={[styles.corner, styles.cornerTopRight, locked && styles.cornerLocked]} />
          <View style={[styles.corner, styles.cornerBottomLeft, locked && styles.cornerLocked]} />
          <View style={[styles.corner, styles.cornerBottomRight, locked && styles.cornerLocked]} />
          {locked && (
            <View style={styles.lockedBadge}>
              <Ionicons name="checkmark" size={28} color="#fff" />
            </View>
          )}
        </View>
        <View style={styles.hintPill}>
          <Text style={styles.hintText}>
            {locked ? 'QR code encontrado — tira a foto' : 'Aponta para o QR code da fatura'}
          </Text>
        </View>
      </View>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.bottomBarSideSlot} />
        <Pressable
          style={[styles.shutterOuter, locked && styles.shutterOuterLocked]}
          onPress={() => captureAndGo(lockedQrPayload)}
          disabled={busy}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <View style={styles.shutterInner} />}
        </Pressable>
        <Pressable style={styles.uploadButton} onPress={handleUploadDocument} disabled={busy}>
          <Ionicons name="document-attach-outline" size={20} color="#fff" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, padding: 32 },
  permissionIconWrap: {
    width: 76,
    height: 76,
    borderRadius: 38,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  permissionTitle: { fontSize: 22, fontWeight: '700' },
  permissionBody: { fontSize: 15, textAlign: 'center', lineHeight: 21, marginBottom: 8 },
  primaryButton: {
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 24,
    marginTop: 8,
  },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  topBarRightGroup: { flexDirection: 'row', gap: 10 },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  frameWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
  },
  frame: {
    width: FRAME_SIZE,
    height: FRAME_SIZE,
  },
  corner: {
    position: 'absolute',
    width: CORNER_LENGTH,
    height: CORNER_LENGTH,
    borderColor: '#fff',
  },
  cornerLocked: { borderColor: '#34C759' },
  cornerTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: CORNER_THICKNESS,
    borderLeftWidth: CORNER_THICKNESS,
    borderTopLeftRadius: 16,
  },
  cornerTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: CORNER_THICKNESS,
    borderRightWidth: CORNER_THICKNESS,
    borderTopRightRadius: 16,
  },
  cornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_THICKNESS,
    borderLeftWidth: CORNER_THICKNESS,
    borderBottomLeftRadius: 16,
  },
  cornerBottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_THICKNESS,
    borderRightWidth: CORNER_THICKNESS,
    borderBottomRightRadius: 16,
  },
  lockedBadge: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginTop: -22,
    marginLeft: -22,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(52,199,89,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  hintPill: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
  },
  hintText: { color: '#fff', fontSize: 14, fontWeight: '500' },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 16,
    paddingHorizontal: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // Placeholder invisível do lado esquerdo, com a mesma largura do botão de
  // upload à direita — mantém o obturador centrado independentemente da
  // largura do ecrã (truque de layout simétrico com justifyContent: 'space-between').
  bottomBarSideSlot: { width: 44, height: 44 },
  uploadButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterOuter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterOuterLocked: { borderColor: '#34C759' },
  shutterInner: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#fff',
  },
});
