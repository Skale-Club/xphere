import type { MetadataRoute } from 'next'
import { APP_NAME } from '@/lib/config'

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: 'AI Operations Platform',
    start_url: '/dashboard',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#09090b',
    theme_color: '#18181b',
    icons: [
      { src: '/api/pwa/icons/192', sizes: '192x192', type: 'image/png' },
      { src: '/api/pwa/icons/512', sizes: '512x512', type: 'image/png' },
      { src: '/api/pwa/icons/192?maskable=1', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/api/pwa/icons/512?maskable=1', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    categories: ['business', 'productivity'],
    shortcuts: [
      { name: 'Dashboard', url: '/dashboard', description: 'Open dashboard' },
      { name: 'Contacts',  url: '/contacts',  description: 'View contacts' },
      { name: 'Review Link', url: '/seo/reviews/review-link', description: 'Generate a Google review link' },
    ],
    // Sharing a business from the Google Maps app to the installed app opens the
    // Review Link tool with the shared name + link, which generates right away.
    share_target: {
      action: '/seo/reviews/review-link',
      method: 'GET',
      params: { title: 'title', text: 'text', url: 'url' },
    },
  }
}
