import { StyleSheet, Text, View } from 'react-native';

export default function NotFoundScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>NIA</Text>
      <Text style={styles.subtitle}>ça marche</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#D4AF37',
    fontSize: 48,
    fontWeight: '700',
    letterSpacing: 4,
  },
  subtitle: {
    color: '#F5F0E8',
    fontSize: 18,
    marginTop: 12,
  },
});
