'use client'

import Link from 'next/link'
import { motion, type Variants } from 'framer-motion'
import { ArrowRight, Zap, Users, Globe, Phone, MessageSquare, BarChart3, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LoginDialog } from '@/components/auth/login-dialog'

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
}

const features = [
  {
    icon: Zap,
    title: 'Action Engine',
    description: 'Route any AI tool call | from Vapi, ManyChat, or any webhook | to any business action in milliseconds.',
  },
  {
    icon: Users,
    title: 'Full CRM',
    description: 'Contacts, companies, opportunities, custom fields, bulk import, and a sales pipeline all in one place.',
  },
  {
    icon: Globe,
    title: 'Multi-channel Inbox',
    description: 'WhatsApp, SMS, voice, web chat, Instagram, and Messenger unified in a single, AI-assisted inbox.',
  },
  {
    icon: Phone,
    title: 'Voice Campaigns',
    description: 'Launch outbound AI voice campaigns with cadence control, real-time status, and call transcripts.',
  },
  {
    icon: MessageSquare,
    title: 'Chat Widget',
    description: 'Drop a single script tag anywhere to embed an AI chat widget | no framework dependency required.',
  },
  {
    icon: BarChart3,
    title: 'Observability',
    description: 'Every tool execution, call, and conversation logged with full request/response payloads and timing.',
  },
]

const FALLBACK_CTA_IMAGE_URL =
  'https://mwklvkmggmsintqcqfvu.supabase.co/storage/v1/object/public/branding/landing/cta-bg.webp'

export function LandingPage({
  faviconUrl,
  ctaImageUrl,
  scrollImages: _scrollImages,
}: {
  faviconUrl?: string | null
  ctaImageUrl?: string | null
  scrollImages?: string[]
}) {
  const logoSrc = faviconUrl ?? '/favicon.ico'
  const ctaBg = ctaImageUrl || FALLBACK_CTA_IMAGE_URL
  // scrollImages is currently surfaced to the component for the upcoming scroll-animation section.
  void _scrollImages
  return (
    <div className="dark min-h-screen bg-[#08090A] text-[#FAFAFA] overflow-x-hidden">
      {/* Grid background */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
        }}
      />

      {/* Glow orb */}
      <div
        aria-hidden
        className="pointer-events-none fixed top-[-20%] left-1/2 -translate-x-1/2 w-[900px] h-[600px] rounded-full z-0"
        style={{
          background: 'radial-gradient(ellipse at center, rgba(99,102,241,0.12) 0%, transparent 70%)',
        }}
      />

      <div className="relative z-10">
        {/* Nav */}
        <header className="flex items-center justify-between px-6 sm:px-10 h-16 border-b border-white/5 backdrop-blur-sm">
          <Link href="/" className="inline-flex items-center gap-2 font-semibold text-base tracking-tight text-[#FAFAFA] hover:text-white transition-colors">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoSrc} alt="" width={22} height={22} />
            Xphere
          </Link>
          <LoginDialog>
            <Button
              size="sm"
              className="h-8 text-sm bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              Sign in
              <ChevronRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </LoginDialog>
        </header>

        {/* Hero */}
        <section className="flex flex-col items-center text-center px-6 pt-12 pb-14 sm:pt-16 sm:pb-20">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0, ease: [0.16, 1, 0.3, 1] }}
            className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/20 bg-indigo-500/8 px-3 py-1 text-xs text-indigo-300 mb-8"
          >
            <Zap className="h-3 w-3" />
            The AI Operations Platform
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-3xl text-[2.5rem] sm:text-[3.5rem] font-semibold leading-[1.08] tracking-[-0.03em]"
          >
            Run your business{' '}
            <span className="text-gradient-flow">on autopilot</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="mt-5 max-w-xl text-[1.0625rem] text-[#A1A1AA] leading-relaxed"
          >
            Centralize AI assistants, automate client workflows, and manage every interaction
            | voice, chat, SMS, and WhatsApp | from one powerful dashboard.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className="mt-8 flex flex-col sm:flex-row items-center gap-3"
          >
            <LoginDialog>
              <Button className="h-11 px-6 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white">
                Get started free
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </LoginDialog>
            <a href="#features">
              <Button
                variant="ghost"
                className="h-11 px-6 text-sm text-[#A1A1AA] hover:text-[#FAFAFA] hover:bg-white/5"
              >
                See features
              </Button>
            </a>
          </motion.div>
        </section>

        {/* Dashboard preview strip */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto max-w-5xl px-6 pb-24"
        >
          <div className="rounded-xl border border-white/8 bg-white/3 backdrop-blur-sm overflow-hidden">
            <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
              <span className="ml-2 text-[0.6875rem] text-[#52525B] font-mono">xphere.app/dashboard</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-0 divide-y sm:divide-y-0 sm:divide-x divide-white/5 p-6">
              {[
                { label: 'AI Calls Today', value: '284', trend: '+12%' },
                { label: 'Active Contacts', value: '14,382', trend: '+340' },
                { label: 'Open Conversations', value: '47', trend: '8 new' },
              ].map(({ label, value, trend }) => (
                <div key={label} className="flex flex-col items-center text-center px-0 sm:px-6 first:sm:pl-0 last:sm:pr-0 py-4 sm:py-0 first:pt-0 last:pb-0">
                  <p className="text-[0.75rem] text-[#71717A] mb-1">{label}</p>
                  <div className="flex items-baseline gap-2">
                    <p className="text-[1.5rem] font-semibold text-[#FAFAFA] tabular-nums">{value}</p>
                    <p className="text-[0.75rem] text-indigo-400">{trend}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        {/* Features */}
        <section id="features" className="px-6 pb-28">
          <div className="mx-auto max-w-5xl">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="text-center mb-12"
            >
              <h2 className="text-[1.75rem] sm:text-[2rem] font-semibold tracking-[-0.025em]">
                Everything your business needs
              </h2>
              <p className="mt-3 text-[#A1A1AA] text-[1rem]">
                One platform. All the primitives. Zero duct-tape.
              </p>
            </motion.div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {features.map(({ icon: Icon, title, description }, i) => (
                <motion.div
                  key={title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-60px' }}
                  transition={{ duration: 0.45, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
                  className="group rounded-xl border border-white/6 bg-white/2 p-5 hover:bg-white/4 hover:border-white/10 transition-all duration-200"
                >
                  <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500/10 border border-indigo-500/20">
                    <Icon className="h-4 w-4 text-indigo-400" />
                  </div>
                  <p className="font-medium text-[0.9375rem] text-[#FAFAFA] mb-1.5">{title}</p>
                  <p className="text-[0.8125rem] text-[#71717A] leading-relaxed">{description}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA — section stays compact; image overflows upward (via absolute) so its native top fade is preserved without inflating the layout */}
        <section className="relative px-6 pb-28">
          {/* Cyberpunk background — anchored to footer line, full natural height, extends above the section behind the features grid (-z-10) */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={ctaBg}
            alt=""
            aria-hidden
            className="pointer-events-none select-none absolute inset-x-0 bottom-0 w-full h-auto min-h-[560px] sm:min-h-[520px] md:min-h-[480px] lg:min-h-0 object-cover object-bottom -z-10"
          />
          {/* Subtle dark wash near the bottom to keep the card readable over the neon city */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-[340px] -z-10 bg-gradient-to-t from-[#08090A]/45 via-[#08090A]/15 to-transparent"
          />
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="relative mx-auto max-w-2xl text-center rounded-2xl border border-white/10 bg-gradient-to-b from-[#0A0A0B]/70 to-[#0A0A0B]/40 backdrop-blur-md p-12 shadow-2xl shadow-black/40"
          >
            <h2 className="text-[1.75rem] font-semibold tracking-[-0.025em] mb-3">
              Ready to scale your business?
            </h2>
            <p className="text-[#A1A1AA] text-[1rem] mb-7">
              Start automating client workflows today | no setup fees, no lock-in.
            </p>
            <LoginDialog>
              <Button className="h-11 px-8 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white">
                Get started free
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </LoginDialog>
          </motion.div>
        </section>

        {/* Footer */}
        <footer className="border-t border-white/5 bg-[#0A0A0B]/90 backdrop-blur-sm px-6 py-8">
          <div className="mx-auto max-w-5xl flex flex-col sm:flex-row items-center justify-between gap-4">
            <Link href="/" className="inline-flex items-center gap-2 text-base font-semibold text-[#FAFAFA] hover:text-white transition-colors">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoSrc} alt="" width={22} height={22} />
              Xphere
            </Link>
            <p className="text-[0.8125rem] text-[#52525B]">
              © {new Date().getFullYear()} Skale Club. All rights reserved.
            </p>
          </div>
        </footer>
      </div>
    </div>
  )
}
