/** Web (et plateformes sans WebRTC natif) : pas de diffusion, message clair. */
import React from 'react';
import { useI18n } from '@/context/I18nContext';
import { LiveCenterMessage } from '@/components/live/LiveStageParts';
import type { LiveHostStageProps } from '@/components/live/types';

export function LiveHostStage({ onClose }: LiveHostStageProps) {
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
