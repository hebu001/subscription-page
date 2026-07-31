import { IconCircleCheck, IconCircleX, IconCreditCard } from '@tabler/icons-react'
import { Loader, Modal, UnstyledButton } from '@mantine/core'
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
        cancel: 'Cancel',
        choosePeriod: 'Choose a period',
        creating: 'Creating payment…',
        currentUntil: 'Expires',
        daysLeft: 'Days left',
        error: 'Something went wrong. Please try again.',
        failed: 'Payment was not completed. You can try again.',
        loading: 'Loading tariffs…',
        modalTitle: 'Subscription renewal',
        pay: 'Pay',
        paymentChecking: 'Checking payment status…',
        rateLimited: 'Too many attempts. Please try again in a minute.',
        renew: 'Renew subscription',
        succeeded: 'Subscription extended until',
        waitingTimeout: 'Payment is still processing — the subscription will extend automatically once confirmed.'
    },
    ru: {
        cancel: 'Отмена',
        choosePeriod: 'Выберите период',
        creating: 'Создаём оплату…',
        currentUntil: 'Истекает',
        daysLeft: 'Осталось дней',
        error: 'Что-то пошло не так. Попробуйте ещё раз.',
        failed: 'Оплата не завершена. Можно попробовать ещё раз.',
        loading: 'Загрузка тарифов…',
        modalTitle: 'Продление подписки',
        pay: 'Оплатить',
        paymentChecking: 'Проверяем статус оплаты…',
        rateLimited: 'Слишком много попыток. Попробуйте через минуту.',
        renew: 'Продлить подписку',
        succeeded: 'Подписка продлена до',
        waitingTimeout: 'Платёж ещё обрабатывается — подписка продлится автоматически после подтверждения.'
    }
}

const POLL_INTERVAL_MS = 3000
const POLL_MAX_MS = 5 * 60 * 1000
const RELOAD_AFTER_SUCCESS_MS = 2500

const formatPrice = (kopeks: number, lang: string) => {
    const value = kopeks / 100
    try {
        return new Intl.NumberFormat(lang, {
            maximumFractionDigits: value % 1 === 0 ? 0 : 2
        }).format(value)
    } catch {
        return String(Math.round(value))
    }
}

const formatDateLocal = (iso: Date | string, lang: string) => {
    try {
        return new Date(iso).toLocaleDateString(lang, {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        })
    } catch {
        return String(iso)
    }
}

export const RenewSubscriptionWidget = () => {
    const subscription = useSubscription()
    const paymentApiUrl = usePaymentApiUrl()
    const { currentLang } = useTranslation()

    const s = STRINGS[currentLang === 'ru' ? 'ru' : 'en']
    const shortUuid = subscription.user.shortUuid

    const [options, setOptions] = useState<IRenewalOptionsResponse | null>(null)
    const [modalOpened, setModalOpened] = useState(false)
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
                // CTA stays hidden when the payment API is unreachable
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
                    setTimeout(() => window.location.reload(), RELOAD_AFTER_SUCCESS_MS)
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

        // Open the tab synchronously inside the click gesture so the browser
        // doesn't treat the post-fetch navigation as a blocked popup.
        const payWin = window.open('', '_blank')

        try {
            const res = await ofetch<IInvoiceResponse>(`${paymentApiUrl}/${shortUuid}/invoice`, {
                body: {
                    method: options.methods[0]?.id ?? 'yookassa',
                    periodDays: selectedPeriod
                },
                method: 'POST'
            })
            if (payWin && !payWin.closed) {
                payWin.location.href = res.paymentUrl
            } else {
                window.location.href = res.paymentUrl
            }
            setIsCreating(false)
            setModalOpened(false)
        } catch (error) {
            if (payWin && !payWin.closed) payWin.close()
            const status = (error as { status?: number })?.status
            setErrorText(status === 429 ? s.rateLimited : s.error)
            setIsCreating(false)
        }
    }, [paymentApiUrl, options, selectedPeriod, isCreating, shortUuid, s])

    if (!paymentApiUrl) return null

    const banner = returnStatus && (
        <div
            className={clsx(classes.banner, {
                [classes.bannerError]: returnStatus === 'failed',
                [classes.bannerSuccess]: returnStatus === 'succeeded'
            })}
        >
            {returnStatus === 'checking' && <Loader color="orange" size={18} />}
            {returnStatus === 'succeeded' && (
                <IconCircleCheck color="#30d158" size={20} style={{ flexShrink: 0 }} />
            )}
            {returnStatus === 'failed' && (
                <IconCircleX color="#ff453a" size={20} style={{ flexShrink: 0 }} />
            )}
            <span>
                {returnStatus === 'checking' && s.paymentChecking}
                {returnStatus === 'succeeded' &&
                    `${s.succeeded} ${newExpiresAt ? formatDateLocal(newExpiresAt, currentLang) : ''}`}
                {returnStatus === 'failed' && s.failed}
                {returnStatus === 'timeout' && s.waitingTimeout}
            </span>
        </div>
    )

    if (!options) return banner || null

    const { user } = subscription
    const selectedOption = options.options.find((o) => o.periodDays === selectedPeriod)

    return (
        <>
            {banner}

            <UnstyledButton className={classes.ctaButton} onClick={() => setModalOpened(true)}>
                <IconCreditCard size={18} />
                <span>{s.renew}</span>
            </UnstyledButton>

            <Modal
                centered
                classNames={{
                    content: classes.modalContent,
                    header: classes.modalHeader,
                    title: classes.modalTitle
                }}
                onClose={() => {
                    if (!isCreating) setModalOpened(false)
                }}
                opened={modalOpened}
                size={440}
                title={s.modalTitle}
            >
                <div className={classes.infoRow}>
                    <span>
                        {s.daysLeft}: <b>{user.daysLeft}</b>
                    </span>
                    <span>
                        {s.currentUntil}:{' '}
                        <b>{user.expiresAt ? formatDateLocal(user.expiresAt, currentLang) : '—'}</b>
                    </span>
                </div>

                <div className={classes.sectionLabel} style={{ marginTop: 14 }}>
                    {s.choosePeriod}
                </div>

                <div className={classes.tariffs}>
                    {options.options.map((option) => (
                        <UnstyledButton
                            className={clsx(classes.tariff, {
                                [classes.tariffActive]: selectedPeriod === option.periodDays
                            })}
                            key={option.periodDays}
                            onClick={() => {
                                if (!isCreating) {
                                    setSelectedPeriod(option.periodDays)
                                    setErrorText(null)
                                }
                            }}
                        >
                            <div className={classes.tariffLabel}>
                                {option.label ?? `${option.periodDays}d`}
                            </div>
                            <div className={classes.tariffPrice}>
                                {formatPrice(option.priceKopeks, currentLang)}
                                <small>₽</small>
                            </div>
                        </UnstyledButton>
                    ))}
                </div>

                {errorText && <div className={classes.errorBox}>{errorText}</div>}

                <div className={classes.footer}>
                    <UnstyledButton
                        className={classes.footerBtn}
                        disabled={isCreating}
                        onClick={() => setModalOpened(false)}
                    >
                        {s.cancel}
                    </UnstyledButton>
                    <UnstyledButton
                        className={clsx(classes.footerBtn, classes.footerBtnPrimary)}
                        disabled={selectedPeriod === null || isCreating}
                        onClick={handlePay}
                    >
                        {isCreating ? (
                            <>
                                <Loader color="white" size={14} />
                                {s.creating}
                            </>
                        ) : (
                            `${s.pay}${selectedOption ? ` · ${formatPrice(selectedOption.priceKopeks, currentLang)} ₽` : ''}`
                        )}
                    </UnstyledButton>
                </div>
            </Modal>
        </>
    )
}
