import '@mantine/core/styles.layer.css'
import '@mantine/notifications/styles.layer.css'
import '@mantine/nprogress/styles.layer.css'
import '@gfazioli/mantine-spinner/styles.css'
import './global.css'
import { DirectionProvider, MantineProvider, v8CssVariablesResolver } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { ModalsProvider } from '@mantine/modals'
import { Notifications } from '@mantine/notifications'
import { NavigationProgress } from '@mantine/nprogress'
import { polyfillCountryFlagEmojis } from 'country-flag-emoji-polyfill'
import { enableMainThreadBlocking } from 'ios-vibrator-pro-max'

import { theme } from '@shared/constants'
import { initDayjs } from '@shared/utils/time-utils'

import { Router } from './app/router/router'

polyfillCountryFlagEmojis()

enableMainThreadBlocking(false)

initDayjs()

export function App() {
    const mq = useMediaQuery('(min-width: 40em)')

    return (
        <DirectionProvider>
            <MantineProvider
                cssVariablesResolver={v8CssVariablesResolver}
                defaultColorScheme="dark"
                theme={theme}
            >
                <ModalsProvider>
                    <Notifications position={mq ? 'top-right' : 'bottom-right'} />
                    <NavigationProgress />

                    <Router />
                </ModalsProvider>
            </MantineProvider>
        </DirectionProvider>
    )
}
