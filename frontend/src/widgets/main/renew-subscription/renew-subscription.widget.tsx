import { IconCircleCheck, IconCircleX, IconCreditCard } from '@tabler/icons-react'
import { Loader, Modal, UnstyledButton } from '@mantine/core'
import { useCallback, useEffect, useRef, useState } from 'react'
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

interface IInvoiceStatusResponse {
    newExpiresAt: null | string
    status: 'expired' | 'failed' | 'pending' | 'succeeded'
}

const STRINGS = {
    en: {
        change: 'Change',
        choosePeriod: 'Choose a period',
        creating: 'Creating payment…',
        devicesRow: 'Extra devices',
        error: 'Something went wrong. Please try again.',
        failed: 'Payment was not completed. You can try again.',
        modalTitle: 'Subscription renewal',
        pay: 'Pay',
        paymentChecking: 'Checking payment status…',
        perMonth: '₽/mo',
        rateLimited: 'Too many attempts. Please try again in a minute.',
        renew: 'Renew subscription',
        succeeded: 'Subscription extended until',
        tariff: 'Tariff',
        tariffRow: 'Tariff',
        toPay: 'Total',
        waitingTimeout: 'Payment is still processing — the subscription will extend automatically once confirmed.'
    },
    ru: {
        change: 'Изменить',
        choosePeriod: 'Выберите период',
        creating: 'Создаём оплату…',
        devicesRow: 'Доп. устройства',
        error: 'Что-то пошло не так. Попробуйте ещё раз.',
        failed: 'Оплата не завершена. Можно попробовать ещё раз.',
        modalTitle: 'Продление подписки',
        pay: 'Оплатить',
        paymentChecking: 'Проверяем статус оплаты…',
        perMonth: '₽/мес',
        rateLimited: 'Слишком много попыток. Попробуйте через минуту.',
        renew: 'Продлить подписку',
        succeeded: 'Подписка продлена до',
        tariff: 'Тариф',
        tariffRow: 'Тариф',
        toPay: 'К оплате',
        waitingTimeout: 'Платёж ещё обрабатывается — подписка продлится автоматически после подтверждения.'
    }
}

const POLL_INTERVAL_MS = 3000
const POLL_MAX_MS = 5 * 60 * 1000
const RELOAD_AFTER_SUCCESS_MS = 2500

const formatRub = (kopeks: number) => {
    const value = kopeks / 100
    const rounded = Math.round(value * 100) / 100
    return Number.isInteger(rounded)
        ? String(rounded)
        : rounded.toFixed(2)
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
                size={460}
                title={s.modalTitle}
            >
                <div className={classes.sectionLabel}>{s.choosePeriod}</div>

                <div className={classes.tariffs}>
                    {options.options.map((option) => {
                        const perMonth = formatPerMonth(option.priceKopeks, option.periodDays)
                        return (
                            <UnstyledButton
                                className={clsx(classes.tariff, {
                                    [classes.tariffActive]: selectedPeriod === option.periodDays
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
                                <span>+{formatRub(selectedOption.devicesPriceKopeks)} ₽</span>
                            </div>
                        )}
                        <div className={classes.summaryTotal}>
                            <span className={classes.summaryTotalLabel}>{s.toPay}</span>
                            <span className={classes.summaryTotalValue}>
                                {formatRub(selectedOption.priceKopeks)} ₽
                            </span>
                        </div>

                        <UnstyledButton
                            className={classes.payButton}
                            disabled={isCreating}
                            onClick={handlePay}
                        >
                            {isCreating ? (
                                <>
                                    <Loader color="white" size={16} />
                                    {s.creating}
                                </>
                            ) : (
                                `${s.pay}  ${formatRub(selectedOption.priceKopeks)} ₽`
                            )}
                        </UnstyledButton>
                    </div>
                )}
            </Modal>
        </>
    )
}
