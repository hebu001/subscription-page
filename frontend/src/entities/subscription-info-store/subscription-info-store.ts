import { GetSubscriptionInfoByShortUuidCommand } from '@remnawave/backend-contract'
import { create } from 'zustand'

import { IActions, IState } from './interfaces'

const initialState: IState = {
    paymentApiUrl: null,
    subscription: null
}

export const useSubscriptionInfoStore = create<IActions & IState>()((set) => ({
    ...initialState,
    actions: {
        setSubscriptionInfo: (info: IState) => {
            set((state) => ({
                ...state,
                paymentApiUrl: info.paymentApiUrl,
                subscription: info.subscription
            }))
        },
        getInitialState: () => {
            return initialState
        },
        resetState: async () => {
            set({ ...initialState })
        }
    }
}))

export const useSubscriptionInfoStoreActions = () =>
    useSubscriptionInfoStore((store) => store.actions)

export const useSubscriptionInfoStoreInfo = () => useSubscriptionInfoStore((state) => state)

export const usePaymentApiUrl = () => useSubscriptionInfoStore((state) => state.paymentApiUrl)

export const useSubscription = (): GetSubscriptionInfoByShortUuidCommand.Response['response'] => {
    const subscription = useSubscriptionInfoStore((state) => state.subscription)
    if (!subscription) {
        throw new Error(
            'useSubscription must be used after subscription is loaded (after RootLayout gate)'
        )
    }
    return subscription
}
