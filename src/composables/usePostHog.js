import posthog from 'posthog-js'

export function usePostHog() {
  posthog.init('phc_CaLOE6EX6PZmkuCsQTs3HcrrOMyhQinVOfvoDAh0cVT', {
    api_host: 'https://us.i.posthog.com',
    defaults: '2025-11-30'
  })

  return { posthog }
}
