import { TSubscriptionPageLocalizedText } from '@remnawave/subscription-page-types'
import { useCallback } from 'react'

import { getLocalizedText } from '@shared/utils/config-parser'

import { useAppConfig, useCurrentLang } from '@entities/app-config-store'

export const useTranslation = () => {
    const config = useAppConfig()
    const currentLang = useCurrentLang()

    const t = useCallback(
        (textObj: TSubscriptionPageLocalizedText) => getLocalizedText(textObj, currentLang),
        [currentLang]
    )

    return {
        t,
        currentLang,
        baseTranslations: config.baseTranslations
    }
}
