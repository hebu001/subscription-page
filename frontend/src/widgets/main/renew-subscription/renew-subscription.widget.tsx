import { IconCircleCheck, IconCircleX, IconCreditCard, IconX } from '@tabler/icons-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader, Modal, UnstyledButton } from '@mantine/core'
import { ofetch } from 'ofetch'
import clsx from 'clsx'

import { usePaymentApiUrl, useSubscription } from '@entities/subscription-info-store'
import { useTranslation } from '@shared/hooks'

import classes from './renew-subscription.module.css'

interface IRenewalOption {
    basePriceKopeks: number
    devicesPriceKopeks: number
    extraDevices: number
    label: null | string
    periodDays: number
    priceKopeks: number
}

interface IRenewalOptionsResponse {
    cabinetUrl: null | string
    currency: string
    deviceLimit: null | number
    enabled: boolean
    expiresAt: null | string
    methods: { id: string; name: string }[]
    options: IRenewalOption[]
    tariffName: null | string
    trafficLimitGb: null | number
}

interface IInvoiceResponse {
    amountKopeks: number
    invoiceToken: string
    paymentUrl: string
}

interface IInvoiceRequest {
    periodDays: number
}

interface IInvoiceStatusResponse {
    newExpiresAt: null | string
    status: 'expired' | 'failed' | 'pending' | 'succeeded'
}

const STRINGS = {
    en: {
        change: 'Change',
        choosePeriod: 'Choose a period',
        close: 'Close',
        creating: 'Creating payment…',
        devicesRow: 'Extra devices',
        error: 'Something went wrong. Please try again.',
        failed: 'Payment was not completed. You can try again.',
        iPaid: 'I have paid — check again',
        loading: 'Loading tariffs…',
        modalTitle: 'Subscription renewal',
        pay: 'Pay',
        paymentChecking: 'Checking payment status…',
        perMonth: '₽/mo',
        rateLimited: 'Too many attempts. Please try again in a minute.',
        renew: 'Renew subscription',
        retry: 'Try again',
        succeeded: 'Subscription renewed',
        succeededUntil: 'until',
        tariff: 'Tariff',
        tariffRow: 'Tariff',
        toPay: 'Total',
        waitingTimeout:
            'Payment is still processing — the subscription will extend automatically once confirmed.'
    },
    ru: {
        change: 'Изменить',
        choosePeriod: 'Выберите период',
        close: 'Закрыть',
        creating: 'Создаём оплату…',
        devicesRow: 'Доп. устройства',
        error: 'Что-то пошло не так. Попробуйте ещё раз.',
        failed: 'Оплата не завершена. Можно попробовать ещё раз.',
        iPaid: 'Я оплатил — проверить ещё раз',
        loading: 'Загрузка тарифов…',
        modalTitle: 'Продление подписки',
        pay: 'Оплатить',
        paymentChecking: 'Проверяем статус оплаты…',
        perMonth: '₽/мес',
        rateLimited: 'Слишком много попыток. Попробуйте через минуту.',
        renew: 'Продлить подписку',
        retry: 'Повторить',
        succeeded: 'Подписка продлена',
        succeededUntil: 'до',
        tariff: 'Тариф',
        tariffRow: 'Тариф',
        toPay: 'К оплате',
        waitingTimeout:
            'Платёж ещё обрабатывается — подписка продлится автоматически после подтверждения.'
    }
}

const POLL_INTERVAL_MS = 3000
const POLL_MAX_MS = 5 * 60 * 1000

const formatRub = (kopeks: number) => {
    const value = kopeks / 100
    const rounded = Math.round(value * 100) / 100
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2)
}

const formatPerMonth = (kopeks: number, periodDays: number) => {
    if (periodDays < 30 || periodDays % 30 !== 0) return null
    const months = periodDays / 30
    return formatRub(Math.round(kopeks / months))
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
    const { shortUuid } = subscription.user

    const [options, setOptions] = useState<IRenewalOptionsResponse | null>(null)
    const [optionsStatus, setOptionsStatus] = useState<
        'error' | 'loading' | 'ready' | 'unavailable'
    >('loading')
    const [modalOpened, setModalOpened] = useState(false)
    const [selectedPeriod, setSelectedPeriod] = useState<null | number>(null)
    const [isCreating, setIsCreating] = useState(false)
    const [errorText, setErrorText] = useState<null | string>(null)

    const [returnStatus, setReturnStatus] = useState<
        'checking' | 'failed' | 'succeeded' | 'timeout' | null
    >(null)
    const [newExpiresAt, setNewExpiresAt] = useState<null | string>(null)
    const [activeToken, setActiveToken] = useState<null | string>(null)
    const pollStop = useRef(false)
    const pollTimer = useRef<null | ReturnType<typeof setTimeout>>(null)

    const fetchOptions = useCallback(async () => {
        if (!paymentApiUrl) return
        setOptionsStatus((prev) => (prev === 'ready' ? prev : 'loading'))
        try {
            const res = await ofetch<IRenewalOptionsResponse>(
                `${paymentApiUrl}/${shortUuid}/renewal-options`,
                { retry: 1 }
            )
            if (res.enabled && res.options.length > 0) {
                setOptions(res)
                setSelectedPeriod((prev) => prev ?? res.options[0].periodDays)
                setOptionsStatus('ready')
            } else {
                setOptionsStatus('unavailable')
            }
        } catch {
            setOptionsStatus((prev) => (prev === 'ready' ? prev : 'error'))
        }
    }, [paymentApiUrl, shortUuid])

    useEffect(() => {
        fetchOptions()
    }, [fetchOptions])

    const startPolling = useCallback(
        (invoiceToken: string) => {
            if (!paymentApiUrl) return

            if (pollTimer.current) clearTimeout(pollTimer.current)
            pollStop.current = false
            setActiveToken(invoiceToken)
            setReturnStatus('checking')
            setModalOpened(true)
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
                        `${paymentApiUrl}/${shortUuid}/invoice/${encodeURIComponent(invoiceToken)}`
                    )

                    if (res.status === 'succeeded') {
                        setReturnStatus('succeeded')
                        setNewExpiresAt(res.newExpiresAt)
                        clearInvoiceParam()
                        setModalOpened(true)
                        return
                    }
                    if (res.status === 'failed' || res.status === 'expired') {
                        setReturnStatus('failed')
                        clearInvoiceParam()
                        setModalOpened(true)
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

                pollTimer.current = setTimeout(poll, POLL_INTERVAL_MS)
            }

            poll()
        },
        [paymentApiUrl, shortUuid]
    )

    useEffect(() => {
        if (!paymentApiUrl) return undefined

        const params = new URLSearchParams(window.location.search)
        const invoiceToken = params.get('invoice')
        if (!invoiceToken) return undefined

        startPolling(invoiceToken)

        return () => {
            pollStop.current = true
            if (pollTimer.current) clearTimeout(pollTimer.current)
        }
    }, [paymentApiUrl, startPolling])

    const handlePay = useCallback(async () => {
        if (!paymentApiUrl || !options || selectedPeriod === null || isCreating) return

        setIsCreating(true)
        setErrorText(null)

        try {
            const body: IInvoiceRequest = {
                periodDays: selectedPeriod
            }
            const res = await ofetch<IInvoiceResponse>(`${paymentApiUrl}/${shortUuid}/invoice`, {
                body,
                method: 'POST'
            })
            // Keep the navigation in the current tab. Opening an empty tab before
            // the request can suspend mobile WebViews before the POST is sent.
            // The provider return URL includes the invoice token, so polling
            // resumes automatically when the user comes back to this page.
            window.location.assign(res.paymentUrl)
        } catch (error) {
            const status = (error as { status?: number })?.status
            setErrorText(status === 429 ? s.rateLimited : s.error)
            setIsCreating(false)
        }
    }, [paymentApiUrl, options, selectedPeriod, isCreating, shortUuid, s])

    if (!paymentApiUrl) return null

    const closeStatusView = () => {
        if (returnStatus === 'succeeded') {
            window.location.reload()
            return
        }
        setReturnStatus(null)
        setModalOpened(false)
    }

    if (optionsStatus === 'unavailable' && !returnStatus) return null

    const selectedOption = options?.options.find((o) => o.periodDays === selectedPeriod)

    return (
        <>
            <UnstyledButton
                className={classes.ctaButton}
                onClick={() => {
                    setModalOpened(true)
                    if (!options) fetchOptions()
                }}
            >
                <IconCreditCard size={18} />
                <span>{s.renew}</span>
            </UnstyledButton>

            <Modal
                centered
                classNames={{
                    content: classes.modalContent
                }}
                onClose={() => {
                    if (isCreating) return
                    if (returnStatus) closeStatusView()
                    else setModalOpened(false)
                }}
                opened={modalOpened}
                size={460}
                withCloseButton={false}
            >
                <UnstyledButton
                    aria-label="Close"
                    className={classes.modalClose}
                    onClick={() => {
                        if (isCreating) return
                        if (returnStatus) closeStatusView()
                        else setModalOpened(false)
                    }}
                >
                    <IconX size={16} />
                </UnstyledButton>

                {returnStatus ? (
                    <div className={classes.statusWrap}>
                        {returnStatus === 'checking' && (
                            <>
                                <div className={classes.statusSpinner}>
                                    <Loader color="orange" size={44} />
                                </div>
                                <div className={classes.statusTitle}>{s.paymentChecking}</div>
                            </>
                        )}
                        {returnStatus === 'succeeded' && (
                            <>
                                <div className={classes.statusCircle}>
                                    <IconCircleCheck color="#30d158" size={64} stroke={1.5} />
                                </div>
                                <div className={classes.statusTitle}>{s.succeeded}</div>
                                {newExpiresAt && (
                                    <div className={classes.statusSub}>
                                        {s.succeededUntil}{' '}
                                        {formatDateLocal(newExpiresAt, currentLang)}
                                    </div>
                                )}
                            </>
                        )}
                        {returnStatus === 'failed' && (
                            <>
                                <div
                                    className={clsx(
                                        classes.statusCircle,
                                        classes.statusCircleError
                                    )}
                                >
                                    <IconCircleX color="#ff453a" size={64} stroke={1.5} />
                                </div>
                                <div className={classes.statusTitle}>{s.failed}</div>
                            </>
                        )}
                        {returnStatus === 'timeout' && (
                            <>
                                <div className={classes.statusTitle}>{s.waitingTimeout}</div>
                                {activeToken && (
                                    <UnstyledButton
                                        className={classes.payButton}
                                        onClick={() => startPolling(activeToken)}
                                    >
                                        {s.iPaid}
                                    </UnstyledButton>
                                )}
                            </>
                        )}
                        {returnStatus !== 'checking' && (
                            <UnstyledButton className={classes.payButton} onClick={closeStatusView}>
                                {s.close}
                            </UnstyledButton>
                        )}
                    </div>
                ) : (
                    <>
                        <div className={classes.sectionLabel}>{s.choosePeriod}</div>

                        {!options && optionsStatus === 'loading' && (
                            <div className={classes.loadingBox}>{s.loading}</div>
                        )}
                        {!options && optionsStatus === 'error' && (
                            <div className={classes.errorBox}>
                                <div>{s.error}</div>
                                <UnstyledButton
                                    className={classes.payButton}
                                    onClick={fetchOptions}
                                >
                                    {s.retry}
                                </UnstyledButton>
                            </div>
                        )}

                        <div className={classes.tariffs}>
                            {(options?.options ?? []).map((option) => {
                                const perMonth = formatPerMonth(
                                    option.priceKopeks,
                                    option.periodDays
                                )
                                return (
                                    <UnstyledButton
                                        className={clsx(classes.tariff, {
                                            [classes.tariffActive]:
                                                selectedPeriod === option.periodDays
                                        })}
                                        key={option.periodDays}
                                        onClick={(e) => {
                                            if (isCreating) return
                                            setSelectedPeriod(option.periodDays)
                                            setErrorText(null)
                                            const btn = e.currentTarget
                                            const rect = btn.getBoundingClientRect()
                                            const size = Math.max(rect.width, rect.height) * 2
                                            const ripple = document.createElement('span')
                                            ripple.style.cssText = `position:absolute;border-radius:50%;background:rgba(255,255,255,0.12);width:${size}px;height:${size}px;left:${e.clientX - rect.left - size / 2}px;top:${e.clientY - rect.top - size / 2}px;transform:scale(0);animation:renew-ripple 6s cubic-bezier(0.22,0.61,0.36,1) forwards;pointer-events:none;z-index:0;`
                                            btn.appendChild(ripple)
                                            setTimeout(() => ripple.remove(), 6100)
                                        }}
                                    >
                                        <div className={classes.tariffLabel}>
                                            {option.label ?? `${option.periodDays}d`}
                                        </div>
                                        <div className={classes.tariffPrice}>
                                            {formatRub(option.priceKopeks)} ₽
                                        </div>
                                        {perMonth && (
                                            <div className={classes.tariffPerMonth}>
                                                {perMonth} {s.perMonth}
                                            </div>
                                        )}
                                    </UnstyledButton>
                                )
                            })}
                        </div>

                        {errorText && <div className={classes.errorBox}>{errorText}</div>}

                        {selectedOption && (
                            <div className={classes.summary}>
                                <div className={classes.summaryRow}>
                                    <span>
                                        {s.tariffRow}: <b>{selectedOption.label}</b>
                                    </span>
                                    <span>{formatRub(selectedOption.basePriceKopeks)} ₽</span>
                                </div>
                                {selectedOption.devicesPriceKopeks > 0 && (
                                    <div className={classes.summaryRow}>
                                        <span>
                                            {s.devicesRow} ({selectedOption.extraDevices})
                                        </span>
                                        <span>
                                            +{formatRub(selectedOption.devicesPriceKopeks)} ₽
                                        </span>
                                    </div>
                                )}
                                <div className={classes.summaryTotal}>
                                    <span className={classes.summaryTotalLabel}>{s.toPay}</span>
                                    <span className={classes.summaryTotalValue}>
                                        {formatRub(selectedOption.priceKopeks)} ₽
                                    </span>
                                </div>

                                <UnstyledButton
                                    className={clsx(classes.payButton, {
                                        [classes.payButtonBusy]: isCreating
                                    })}
                                    disabled={isCreating}
                                    onClick={handlePay}
                                >
                                    {isCreating ? (
                                        <Loader color="white" size={20} />
                                    ) : (
                                        `${s.pay}  ${formatRub(selectedOption.priceKopeks)} ₽`
                                    )}
                                </UnstyledButton>
                            </div>
                        )}
                    </>
                )}
            </Modal>
        </>
    )
}
