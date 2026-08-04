import { Directory, File, Paths } from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ExpenseInput } from '@invoice-scanner/shared';

// Fila de submissões feitas sem ligação à internet: a fatura fica copiada
// para um diretório persistente (Paths.document — ao contrário de Paths.cache,
// sobrevive a reinícios e não é limpo pelo sistema) e o formulário preenchido
// fica guardado como manifesto em AsyncStorage. use-offline-queue-sync.ts
// reenvia tudo (createExpense) assim que a ligação voltar.
export interface QueuedSubmission {
  id: string;
  fileUri: string;
  fileMimeType: string;
  input: ExpenseInput;
  createdAt: string;
  lastError?: string;
}

const MANIFEST_KEY = 'offline_submission_queue_v1';
const QUEUE_DIR_NAME = 'offline-queue';

function queueDir(): Directory {
  return new Directory(Paths.document, QUEUE_DIR_NAME);
}

async function loadManifest(): Promise<QueuedSubmission[]> {
  const raw = await AsyncStorage.getItem(MANIFEST_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as QueuedSubmission[];
  } catch {
    return [];
  }
}

async function saveManifest(items: QueuedSubmission[]): Promise<void> {
  await AsyncStorage.setItem(MANIFEST_KEY, JSON.stringify(items));
}

export async function listQueuedSubmissions(): Promise<QueuedSubmission[]> {
  return loadManifest();
}

export async function queuedSubmissionCount(): Promise<number> {
  return (await loadManifest()).length;
}

// Copia o ficheiro capturado para um diretório persistente antes de guardar o
// manifesto — o URI original (cache da câmara, ficheiro temporário do picker)
// pode ser limpo pelo sistema a qualquer momento, muito antes de voltar a
// haver rede para submeter.
export async function enqueueSubmission(
  sourceUri: string,
  fileMimeType: string,
  input: ExpenseInput,
): Promise<QueuedSubmission> {
  const dir = queueDir();
  if (!dir.exists) dir.create({ intermediates: true });

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const extension = fileMimeType.split('/')[1] ?? 'jpg';
  const destination = new File(dir, `${id}.${extension}`);
  new File(sourceUri).copy(destination);

  const entry: QueuedSubmission = {
    id,
    fileUri: destination.uri,
    fileMimeType,
    input,
    createdAt: new Date().toISOString(),
  };
  const items = await loadManifest();
  items.push(entry);
  await saveManifest(items);
  return entry;
}

export async function removeQueuedSubmission(id: string): Promise<void> {
  const items = await loadManifest();
  const entry = items.find((item) => item.id === id);
  if (entry) {
    try {
      const file = new File(entry.fileUri);
      if (file.exists) file.delete();
    } catch {
      // best-effort: se o ficheiro já não existir, não há nada a limpar
    }
  }
  await saveManifest(items.filter((item) => item.id !== id));
}

export async function markQueuedSubmissionError(id: string, error: string): Promise<void> {
  const items = await loadManifest();
  const next = items.map((item) => (item.id === id ? { ...item, lastError: error } : item));
  await saveManifest(next);
}
