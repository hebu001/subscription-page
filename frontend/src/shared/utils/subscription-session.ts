export function isSessionExpired(error: unknown): boolean {
    return (error as null | { status?: number })?.status === 401
}

export function reloadSubscriptionPage(): void {
    // Preserve the exact subscription URL and invoice token; mount resumes status GETs.
    window.location.reload()
}

export function sessionRecoveryText(language: string) {
    if (language.startsWith('ru')) {
        return {
            title: 'Сессия истекла',
            details:
                'Обновите страницу, чтобы продолжить. Если вы уже оплатили, проверим тот же счёт — повторно платить не нужно.',
            reload: 'Обновить страницу'
        }
    }
    return {
        title: 'Session expired',
        details:
            'Refresh the page to continue. If you already paid, we will check the same invoice; you do not need to pay again.',
        reload: 'Refresh page'
    }
}
