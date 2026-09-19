/**
 * Post-capture / create preview with NIA filter overlay wash.
 * Honest MVP: tint overlay approximates color-matrix / LUT — not real AR or GPU LUT.
 */
import React, { useMemo } from 'react';
import {
  Image,
  StyleSheet,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {
  getFilterById,
  getFilterOverlayStyle,
  type FilterDefinition,
} from '@/constants/filters';

type Props = {
  uri: string;
  filterId?: string | null;
  filter?: FilterDefinition | null;
  intensity?: number;
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
};

export function FilteredMediaPreview({
  uri,
  filterId,
  filter: filterProp,
  intensity,
  style,
  imageStyle,
}: Props) {
  const filter = filterProp ?? getFilterById(filterId ?? null);
  const overlay = useMemo(
    () => getFilterOverlayStyle(filter, intensity),
    [filter, intensity],
  );

  return (
    <View style={[styles.wrap, style]}>
      <Image source={{ uri }} style={[styles.image, imageStyle]} resizeMode="cover" />
      {overlay ? (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: overlay.backgroundColor,
              opacity: overlay.opacity,
            },
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    width: '100%',
    height: '100%',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
