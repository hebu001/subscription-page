import { GetSubscriptionInfoByShortUuidCommand } from '@remnawave/backend-contract'

export interface IState {
    paymentApiUrl: null | string
    subscription: GetSubscriptionInfoByShortUuidCommand.Response['response'] | null
}
