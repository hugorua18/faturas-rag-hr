import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';

import { useTheme } from '@/hooks/use-theme';
import { webMaxWidthStyle } from '@/constants/theme';

// Política de privacidade pública — exigida pela App Store (Privacy Policy
// URL). Acessível sem sessão: o guard de autenticação em _layout.tsx ignora
// esta rota de propósito.
const SECTIONS: Array<{ title: string; body: string }> = [
  {
    title: 'Quem somos',
    body:
      'O Digitalizador de Faturas é uma aplicação privada de registo de despesas, operada por Hugo Rua. ' +
      'Para qualquer questão sobre privacidade, contacte hugo.rua@gmail.com.',
  },
  {
    title: 'Dados que recolhemos',
    body:
      'Conta Google usada no início de sessão (nome e email); imagens e documentos de faturas que digitaliza, ' +
      'importa ou envia por email; e os dados fiscais extraídos desses documentos (NIFs, datas, números de ' +
      'documento e valores). Não recolhemos dados de localização, contactos nem identificadores de publicidade.',
  },
  {
    title: 'Como usamos os dados',
    body:
      'Exclusivamente para o funcionamento da aplicação: extrair os dados das faturas (código QR e OCR), ' +
      'organizar as despesas por NIF e por mês, gerar relatórios em PDF/Excel e arquivar os documentos no ' +
      'Google Drive da própria conta. O nome do prestador pode ser obtido a partir do NIF através do VIES, ' +
      'o serviço público de validação de IVA da Comissão Europeia. Não vendemos nem partilhamos dados com ' +
      'terceiros para fins de marketing.',
  },
  {
    title: 'Permissões Google',
    body:
      'A aplicação pede a permissão "drive.file", que só dá acesso aos ficheiros e pastas criados pela própria ' +
      'aplicação no seu Google Drive — não a outros ficheiros. A caixa de correio dedicada de ingestão de ' +
      'faturas é lida com a permissão "gmail.readonly", limitada a essa conta específica.',
  },
  {
    title: 'Onde ficam guardados',
    body:
      'Os dados das despesas ficam numa base de dados gerida (Neon) e o serviço corre em infraestrutura cloud ' +
      '(Render). As imagens dos documentos são arquivadas no Google Drive da conta do utilizador. As ligações ' +
      'são sempre cifradas (HTTPS) e os tokens de acesso são guardados cifrados.',
  },
  {
    title: 'Os seus direitos',
    body:
      'Pode eliminar qualquer despesa na aplicação (o registo é removido da base de dados) e revogar o acesso ' +
      'da aplicação à sua conta Google em myaccount.google.com/connections a qualquer momento. Para eliminação ' +
      'completa da conta e dos dados, contacte hugo.rua@gmail.com.',
  },
];

export default function PrivacyPolicyScreen() {
  const theme = useTheme();

  return (
    <ScrollView
      style={{ backgroundColor: theme.groupedBackground }}
      contentContainerStyle={[styles.content, webMaxWidthStyle]}
    >
      <Stack.Screen options={{ title: 'Política de Privacidade' }} />
      <Text style={[styles.title, { color: theme.text }]}>Política de Privacidade</Text>
      <Text style={[styles.updated, { color: theme.textSecondary }]}>Última atualização: julho de 2026</Text>
      {SECTIONS.map((section) => (
        <View key={section.title} style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>{section.title}</Text>
          <Text style={[styles.body, { color: theme.textSecondary }]}>{section.body}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 24, paddingBottom: 48, gap: 4 },
  title: { fontSize: 24, fontWeight: '700' },
  updated: { fontSize: 13, marginTop: 4, marginBottom: 12 },
  section: { marginTop: 14 },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginBottom: 4 },
  body: { fontSize: 14.5, lineHeight: 21 },
});
