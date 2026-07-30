import {
    Alert,
    Box,
    Button,
    Group,
    Loader,
    SimpleGrid,
    Stack,
    Text,
    ThemeIcon,
    UnstyledButton
} from '@mantine/core'
import { IconCircleCheck, IconCircleX, IconCreditCard } from '@tabler/icons-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ofetch } from 'ofetch'
import clsx from 'clsx'

import { usePaymentApiUrl, useSubscription } from '@entities/subscription-info-store'
import { useTranslation } from '@shared/hooks'

import classes from './renew-subscription.module.css'

interface IRenewalOption {
    label: null | string
    periodDays: number
    priceKopeks: number
}

interface IRenewalOptionsResponse {
    currency: string
    enabled: boolean
    expiresAt: null | string
    methods: { id: string; name: string }[]
    options: IRenewalOption[]
}

interface IInvoiceResponse {
    amountKopeks: number
    invoiceToken: string
    paymentUrl: string
}

interface IInvoiceStatusResponse {
    newExpiresAt: null | string
    status: 'expired' | 'failed' | 'pending' | 'succeeded'
}

const STRINGS = {
    en: {
        error: 'Something went wrong. Please try again.',
        failed: 'Payment was not completed. You can try again.',
        pay: 'Pay',
        paymentChecking: 'Checking payment status…',
        rateLimited: 'Too many attempts. Please try again in a minute.',
        succeeded: 'Subscription extended until',
        title: 'Renew subscription',
        waitingTimeout: 'Payment is still processing. The subscription will be extended automatically once the payment is confirmed.'
    },
    ru: {
        error: 'Что-то пошло не так. Попробуйте ещё раз.',
        failed: 'Оплата не завершена. Можно попробовать ещё раз.',
        pay: 'Оплатить',
        paymentChecking: 'Проверяем статус оплаты…',
        rateLimited: 'Слишком много попыток. Попробуйте через минуту.',
        succeeded: 'Подписка продлена до',
        title: 'Продлить подписку',
        waitingTimeout: 'Платёж ещё обрабатывается. Подписка продлится автоматически после подтверждения оплаты.'
    }
}

const POLL_INTERVAL_MS = 3000
const POLL_MAX_MS = 5 * 60 * 1000

const formatPrice = (kopeks: number, currency: string, lang: string) => {
    try {
        return new Intl.NumberFormat(lang, {
            currency,
            maximumFractionDigits: kopeks % 100 === 0 ? 0 : 2,
            style: 'currency'
        }).format(kopeks / 100)
    } catch {
        return `${(kopeks / 100).toFixed(0)} ${currency}`
    }
}

const formatDateLocal = (iso: string, lang: string) => {
    try {
        return new Date(iso).toLocaleDateString(lang, {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        })
    } catch {
        return iso
    }
}

export const RenewSubscriptionWidget = () => {
    const subscription = useSubscription()
    const paymentApiUrl = usePaymentApiUrl()
    const { currentLang } = useTranslation()

    const s = STRINGS[currentLang === 'ru' ? 'ru' : 'en']
    const shortUuid = subscription.user.shortUuid

    const [options, setOptions] = useState<IRenewalOptionsResponse | null>(null)
    const [selectedPeriod, setSelectedPeriod] = useState<null | number>(null)
    const [isCreating, setIsCreating] = useState(false)
    const [errorText, setErrorText] = useState<null | string>(null)

    const [returnStatus, setReturnStatus] = useState<
        'checking' | 'failed' | 'succeeded' | 'timeout' | null
    >(null)
    const [newExpiresAt, setNewExpiresAt] = useState<null | string>(null)
    const pollStop = useRef(false)

    useEffect(() => {
        if (!paymentApiUrl) return

        const fetchOptions = async () => {
            try {
                const res = await ofetch<IRenewalOptionsResponse>(
                    `${paymentApiUrl}/${shortUuid}/renewal-options`,
                    { retry: 1 }
                )
                if (res.enabled && res.options.length > 0) {
                    setOptions(res)
                    setSelectedPeriod(res.options[0].periodDays)
                }
            } catch {
                // widget stays hidden when the payment API is unreachable
            }
        }

        fetchOptions()
    }, [paymentApiUrl, shortUuid])

    useEffect(() => {
        if (!paymentApiUrl) return undefined

        const params = new URLSearchParams(window.location.search)
        const invoiceToken = params.get('invoice')
        if (!invoiceToken) return undefined

        pollStop.current = false
        setReturnStatus('checking')
        const startedAt = Date.now()

        const clearInvoiceParam = () => {
            const url = new URL(window.location.href)
            url.searchParams.delete('invoice')
            window.history.replaceState({}, '', url.toString())
        }

        const poll = async () => {
            if (pollStop.current) return

            try {
                const res = await ofetch<IInvoiceStatusResponse>(
                    `${paymentApiUrl}/invoice/${encodeURIComponent(invoiceToken)}`
                )

                if (res.status === 'succeeded') {
                    setReturnStatus('succeeded')
                    setNewExpiresAt(res.newExpiresAt)
                    clearInvoiceParam()
                    return
                }
                if (res.status === 'failed' || res.status === 'expired') {
                    setReturnStatus('failed')
                    clearInvoiceParam()
                    return
                }
            } catch {
                // keep polling on transient errors
            }

            if (Date.now() - startedAt > POLL_MAX_MS) {
                setReturnStatus('timeout')
                clearInvoiceParam()
                return
            }

            setTimeout(poll, POLL_INTERVAL_MS)
        }

        poll()

        return () => {
            pollStop.current = true
        }
    }, [paymentApiUrl])

    const handlePay = useCallback(async () => {
        if (!paymentApiUrl || !options || selectedPeriod === null || isCreating) return

        setIsCreating(true)
        setErrorText(null)

        try {
            const res = await ofetch<IInvoiceResponse>(`${paymentApiUrl}/${shortUuid}/invoice`, {
                body: {
                    method: options.methods[0]?.id ?? 'yookassa',
                    periodDays: selectedPeriod
                },
                method: 'POST'
            })
            window.location.href = res.paymentUrl
        } catch (error) {
            const status = (error as { status?: number })?.status
            setErrorText(status === 429 ? s.rateLimited : s.error)
            setIsCreating(false)
        }
    }, [paymentApiUrl, options, selectedPeriod, isCreating, shortUuid, s])

    if (!paymentApiUrl) return null

    const statusBanner = returnStatus && (
        <Alert
            color={
                returnStatus === 'succeeded'
                    ? 'green'
                    : returnStatus === 'failed'
                      ? 'red'
                      : 'cyan'
            }
            icon={
                returnStatus === 'succeeded' ? (
                    <IconCircleCheck size={20} />
                ) : returnStatus === 'failed' ? (
                    <IconCircleX size={20} />
                ) : (
                    <Loader size={16} />
                )
            }
            radius="md"
            variant="light"
        >
            {returnStatus === 'checking' && s.paymentChecking}
            {returnStatus === 'succeeded' &&
                `${s.succeeded} ${newExpiresAt ? formatDateLocal(newExpiresAt, currentLang) : ''}`}
            {returnStatus === 'failed' && s.failed}
            {returnStatus === 'timeout' && s.waitingTimeout}
        </Alert>
    )

    if (!options) {
        return statusBanner ? <Box className={classes.card}>{statusBanner}</Box> : null
    }

    return (
        <Box className={classes.card}>
            <Stack gap="md">
                <Group gap="xs" wrap="nowrap">
                    <ThemeIcon
                        className={classes.iconGreen}
                        color="green"
                        radius="md"
                        size={36}
                        variant="light"
                    >
                        <IconCreditCard size={20} />
                    </ThemeIcon>
                    <Text c="white" fw={600} size="md">
                        {s.title}
                    </Text>
                </Group>

                {statusBanner}

                <SimpleGrid cols={{ base: 2, sm: Math.min(options.options.length, 4) }} spacing="xs">
                    {options.options.map((option) => (
                        <UnstyledButton
                            className={clsx(classes.periodButton, {
                                [classes.periodButtonActive]: selectedPeriod === option.periodDays
                            })}
                            key={option.periodDays}
                            onClick={() => setSelectedPeriod(option.periodDays)}
                            p="sm"
                            style={{ borderRadius: 'var(--mantine-radius-md)' }}
                        >
                            <Stack align="center" gap={2}>
                                <Text c="white" fw={600} size="sm">
                                    {option.label ?? `${option.periodDays}d`}
                                </Text>
                                <Text c="dimmed" size="xs">
                                    {formatPrice(option.priceKopeks, options.currency, currentLang)}
                                </Text>
                            </Stack>
                        </UnstyledButton>
                    ))}
                </SimpleGrid>

                {errorText && (
                    <Text c="red" size="sm">
                        {errorText}
                    </Text>
                )}

                <Button
                    color="cyan"
                    disabled={selectedPeriod === null}
                    fullWidth
                    loading={isCreating}
                    onClick={handlePay}
                    radius="md"
                    size="md"
                    variant="light"
                >
                    {s.pay}
                    {selectedPeriod !== null &&
                        ` · ${formatPrice(
                            options.options.find((o) => o.periodDays === selectedPeriod)
                                ?.priceKopeks ?? 0,
                            options.currency,
                            currentLang
                        )}`}
                </Button>
            </Stack>
        </Box>
    )
}
