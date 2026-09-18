import { Link, Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Colors, Fonts } from '@/constants/theme';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Introuvable' }} />
      <View style={styles.container}>
        <Text style={styles.title}>Page introuvable</Text>
        <Link href="/" style={styles.link}>
          <Text style={styles.linkText}>Retour à NIA</Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.noir,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    color: Colors.sable,
    fontFamily: Fonts.bold,
    fontSize: 20,
  },
  link: { marginTop: 16 },
  linkText: {
    color: Colors.or,
    fontFamily: Fonts.medium,
    fontSize: 16,
  },
});
