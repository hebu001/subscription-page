import { z } from 'zod'

import { isSessionExpired } from '../../../shared/utils/subscription-session.ts'

export const invoiceStatusSchema = z.object({
    balanceCredited: z.boolean().optional().default(false),
    message: z.string().max(1024).nullable().optional().default(null),
    newExpiresAt: z.string().datetime({ offset: true }).nullable(),
    status: z.enum(['expired', 'failed', 'pending', 'succeeded'])
})

export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>
export type PaymentResult = 'credited' | 'failed' | 'review' | 'succeeded'

export function classifyInvoiceStatus(status: InvoiceStatus): null | PaymentResult {
    if (status.status === 'succeeded') return 'succeeded'
    if (status.balanceCredited) return 'credited'
    if (status.status === 'failed' || status.status === 'expired') {
        return status.message?.trim() ? 'review' : 'failed'
    }
    return null
}

export function safeCabinetUrl(value: null | string | undefined): null | string {
    if (!value) return null
    try {
        const url = new URL(value)
        return url.protocol === 'https:' && !url.username && !url.password ? url.href : null
    } catch {
        return null
    }
}

interface PollOptions {
    getStatus: (signal: AbortSignal) => Promise<unknown>
    onResult: (result: PaymentResult, status: InvoiceStatus) => void
    onSessionExpired: () => void
    onTimeout: () => void
}

// One poller owns one invoice and never publishes a result after disposal,
// including when the HTTP client ignores cancellation or finishes concurrently.
export function pollInvoice(options: PollOptions): () => void {
    const request = new AbortController()
    let stopped = false
    let pollTimer: ReturnType<typeof setTimeout> | undefined
    let deadline: ReturnType<typeof setTimeout> | undefined
    const stop = () => {
        stopped = true
        request.abort()
        clearTimeout(pollTimer)
        clearTimeout(deadline)
    }
    deadline = setTimeout(
        () => {
            if (stopped) return
            stop()
            options.onTimeout()
        },
        5 * 60 * 1000
    )

    const poll = async () => {
        let status: InvoiceStatus | undefined
        try {
            status = invoiceStatusSchema.parse(await options.getStatus(request.signal))
        } catch (error) {
            if (stopped) return
            if (isSessionExpired(error)) {
                stop()
                options.onSessionExpired()
                return
            }
            // A transport error or malformed response is not a payment failure.
        }
        if (stopped) return
        if (status) {
            const result = classifyInvoiceStatus(status)
            if (result) {
                stop()
                options.onResult(result, status)
                return
            }
        }
        pollTimer = setTimeout(() => {
            poll()
        }, 3000)
    }
    poll()
    return stop
}
