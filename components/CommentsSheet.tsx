import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, Radii, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import {
  addComment,
  listComments,
  type CommentWithAuthor,
} from '@/lib/comments';

type Props = {
  visible: boolean;
  videoId: string | null;
  onClose: () => void;
  /** Incrémente / décrémente le compteur feed (optimiste) */
  onCommentAdded?: (videoId: string, delta?: number) => void;
};

function authorLabel(c: CommentWithAuthor): string {
  const u = c.profiles?.username || c.profiles?.display_name;
  if (u) return `@${u.replace(/^@/, '')}`;
  return '@utilisateur';
}

function authorAvatar(c: CommentWithAuthor): string {
  if (c.profiles?.avatar_url) return c.profiles.avatar_url;
  const u = c.profiles?.username || c.user_id;
  return `https://i.pravatar.cc/80?u=${encodeURIComponent(u)}`;
}

export function CommentsSheet({ visible, videoId, onClose, onCommentAdded }: Props) {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [comments, setComments] = useState<CommentWithAuthor[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!videoId) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await listComments(videoId);
      setComments(rows);
    } catch {
      setError('Impossible de charger les commentaires.');
      setComments([]);
    } finally {
      setLoading(false);
    }
  }, [videoId]);

  useEffect(() => {
    if (visible && videoId) {
      setDraft('');
      void load();
    } else if (!visible) {
      setComments([]);
      setError(null);
    }
  }, [visible, videoId, load]);

  const submit = async () => {
    if (!videoId || !user || sending) return;
    const text = draft.trim();
    if (!text) return;

    setSending(true);
    setError(null);

    const optimistic: CommentWithAuthor = {
      id: `opt_${Date.now()}`,
      video_id: videoId,
      user_id: user.id,
      body: text,
      created_at: new Date().toISOString(),
      profiles: {
        username: user.username,
        avatar_url: user.avatarUrl,
        display_name: user.username,
      },
    };
    setComments((prev) => [...prev, optimistic]);
    setDraft('');
    onCommentAdded?.(videoId, 1);

    try {
      const saved = await addComment(user.id, videoId, text);
      if (saved) {
        setComments((prev) =>
          prev.map((c) =>
            c.id === optimistic.id
              ? {
                  ...saved,
                  profiles:
                    saved.profiles ||
                    optimistic.profiles,
                }
              : c,
          ),
        );
      }
    } catch {
      setComments((prev) => prev.filter((c) => c.id !== optimistic.id));
      onCommentAdded?.(videoId, -1);
      setDraft(text);
      setError("Échec de l'envoi. Réessayez.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={styles.dismiss} onPress={onClose} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]}
        >
          <View style={styles.dragHandle} />
          <View style={styles.header}>
            <Text style={styles.title}>Commentaires</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Fermer">
              <Ionicons name="close" size={24} color={Colors.sable} />
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={Colors.or} />
            </View>
          ) : (
            <FlatList
              data={comments}
              keyExtractor={(c) => c.id}
              contentContainerStyle={
                comments.length === 0 ? styles.emptyList : styles.list
              }
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Ionicons name="chatbubbles-outline" size={40} color={Colors.or} />
                  <Text style={styles.emptyTitle}>Aucun commentaire</Text>
                  <Text style={styles.emptyBody}>
                    Soyez le premier à réagir — partagez votre avis avec respect.
                  </Text>
                </View>
              }
              renderItem={({ item }) => (
                <View style={styles.row}>
                  <Image source={{ uri: authorAvatar(item) }} style={styles.avatar} />
                  <View style={styles.rowBody}>
                    <Text style={styles.authorHandle}>{authorLabel(item)}</Text>
                    <Text style={styles.body}>{item.body}</Text>
                  </View>
                </View>
              )}
            />
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              placeholder={
                user ? 'Ajouter un commentaire…' : 'Connectez-vous pour commenter'
              }
              placeholderTextColor={Colors.textMuted}
              value={draft}
              onChangeText={setDraft}
              editable={!!user && !sending}
              multiline
              maxLength={500}
            />
            <Pressable
              onPress={() => void submit()}
              disabled={!user || !draft.trim() || sending}
              style={({ pressed }) => [
                styles.send,
                (!user || !draft.trim() || sending) && styles.sendDisabled,
                pressed && styles.pressed,
              ]}
              accessibilityLabel="Envoyer"
            >
              {sending ? (
                <ActivityIndicator size="small" color={Colors.noir} />
              ) : (
                <Ionicons name="send" size={18} color={Colors.noir} />
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  dismiss: { flex: 1 },
  sheet: {
    maxHeight: '72%',
    minHeight: 320,
    backgroundColor: Colors.noirElevated,
    borderTopLeftRadius: Radii.lg,
    borderTopRightRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
  },
  dragHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    marginTop: 10,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  title: {
    color: Colors.sable,
    fontFamily: Fonts.bold,
    fontSize: 18,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  list: { paddingBottom: Spacing.sm },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  empty: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.lg,
  },
  emptyTitle: {
    marginTop: Spacing.md,
    color: Colors.sable,
    fontFamily: Fonts.bold,
    fontSize: 16,
  },
  emptyBody: {
    marginTop: 8,
    color: Colors.textSecondary,
    fontFamily: Fonts.regular,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.or,
  },
  rowBody: { flex: 1 },
  authorHandle: {
    color: Colors.or,
    fontFamily: Fonts.medium,
    fontSize: 12,
    marginBottom: 2,
  },
  body: {
    color: Colors.textPrimary,
    fontFamily: Fonts.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  error: {
    color: Colors.danger,
    fontFamily: Fonts.regular,
    fontSize: 12,
    marginBottom: 6,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: Radii.pill,
    backgroundColor: Colors.noirSoft,
    color: Colors.sable,
    fontFamily: Fonts.regular,
    fontSize: 14,
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.or,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.4 },
  pressed: { opacity: 0.85 },
});
