/** Web (et plateformes sans WebRTC natif) : pas de lecture, message clair. */
import React from 'react';
import { useI18n } from '@/context/I18nContext';
import { LiveCenterMessage } from '@/components/live/LiveStageParts';
import type { LiveViewerStageProps } from '@/components/live/types';

export function LiveViewerStage({ onClose }: LiveViewerStageProps) {
  const { t } = useI18n();
  return (
    <LiveCenterMessage
      icon="phone-portrait-outline"
      body={t('live.rtc.unsupported')}
      secondaryLabel={t('live.rtc.leave')}
      onSecondary={onClose}
    />
  );
}
